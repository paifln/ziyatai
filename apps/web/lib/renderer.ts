import { env } from "./env";
import { AppError } from "../../../packages/domain/errors";
import { readBoundedBody } from "./request-body";
const responseLimits = {
  inspect: 64 * 1024,
  parse: 8 * 1024 * 1024,
  preview: 16 * 1024 * 1024,
  render: 32 * 1024 * 1024,
};
const rendererErrors = new Map([
  ["FILE_INVALID", 422],
  ["FILE_SIZE", 413],
  ["OCR_UNAVAILABLE", 422],
  ["FONT_UNAVAILABLE", 422],
  ["RENDER_UNAVAILABLE", 503],
]);
export async function isolatedRequest(
  endpoint: "inspect" | "parse" | "render" | "preview",
  bytes: Buffer,
  ext: string,
  options: {
    font?: string;
    includeHidden?: boolean;
    page?: number;
    signal?: AbortSignal;
  } = {},
) {
  const e = env();
  if (!e.RENDERER_URL || !e.RENDERER_TOKEN)
    throw new AppError("RENDER_UNAVAILABLE", 503);
  const deadline = AbortSignal.timeout(
    endpoint === "preview" ? 20000 : endpoint === "inspect" ? 60000 : 300000,
  );
  try {
    const r = await fetch(`${e.RENDERER_URL}/${endpoint}`, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${e.RENDERER_TOKEN}`,
        "Content-Type": "application/octet-stream",
        "X-Format": ext,
        "X-Font": options.font ?? "Times New Roman",
        "X-Include-Hidden": String(options.includeHidden ?? false),
        "X-Page": String(options.page ?? 1),
      },
      body: new Uint8Array(bytes),
      signal: options.signal
        ? AbortSignal.any([options.signal, deadline])
        : deadline,
    });
    if (!r.ok) {
      let code = "RENDER_UNAVAILABLE";
      try {
        const reported: unknown = JSON.parse(
          new TextDecoder().decode(await readBoundedBody(r, 64 * 1024)),
        )?.code;
        if (
          r.status >= 400 &&
          r.status < 500 &&
          typeof reported === "string" &&
          rendererErrors.has(reported)
        )
          code = reported;
      } catch {}
      // Renderer diagnostics are untrusted: neither arbitrary text nor its
      // internal authentication failures belong in user responses or job logs.
      throw new AppError(code, rendererErrors.get(code)!);
    }
    const output = await readBoundedBody(r, responseLimits[endpoint]);
    return Buffer.from(output.buffer, output.byteOffset, output.byteLength);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("RENDER_UNAVAILABLE", 503);
  }
}
