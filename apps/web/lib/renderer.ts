import { env } from "./env";
import { AppError } from "../../../packages/domain/errors";
export async function isolatedRequest(
  endpoint: "inspect" | "parse" | "render" | "preview",
  bytes: Buffer,
  ext: string,
  options: { font?: string; includeHidden?: boolean; page?: number } = {},
) {
  const e = env();
  if (!e.RENDERER_URL || !e.RENDERER_TOKEN)
    throw new AppError("RENDER_UNAVAILABLE", 503);
  try {
    const r = await fetch(`${e.RENDERER_URL}/${endpoint}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${e.RENDERER_TOKEN}`,
        "Content-Type": "application/octet-stream",
        "X-Format": ext,
        "X-Font": options.font ?? "Times New Roman",
        "X-Include-Hidden": String(options.includeHidden ?? false),
        "X-Page": String(options.page ?? 1),
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(endpoint === "preview" ? 20000 : endpoint === "inspect" ? 60000 : 300000),
    });
    if (!r.ok) {
      let code = "RENDER_UNAVAILABLE";
      try {
        code = (await r.json()).code ?? code;
      } catch {}
      throw new AppError(code, r.status);
    }
    return Buffer.from(await r.arrayBuffer());
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError("RENDER_UNAVAILABLE", 503);
  }
}
