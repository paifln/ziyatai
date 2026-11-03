import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "./env";
import { AppError } from "../../../packages/domain/errors";
import { isolatedRequest } from "./renderer";
import { scanStream } from "./antivirus";
import { uploadFormat } from "../../../packages/domain/uploads";
const processErrors = new Map([
  ["FILE_INVALID", 422],
  ["FILE_SIZE", 413],
  ["FILE_TYPE", 415],
  ["OCR_UNAVAILABLE", 422],
  ["FONT_UNAVAILABLE", 422],
  ["RENDER_UNAVAILABLE", 503],
]);
export function processRun(
  executable: string,
  args: string[],
  timeout = 60000,
  maxOutput = 8 * 1024 * 1024,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        NODE_ENV: process.env.NODE_ENV,
        PATH: process.env.PATH,
        SystemRoot: process.env.SystemRoot,
        TEMP: process.env.TEMP,
        TMP: process.env.TMP,
        LANG: "C.UTF-8",
        PYTHONUTF8: "1",
        PYTHONIOENCODING: "utf-8",
        TESSERACT_PATH: env().TESSERACT_PATH,
      },
      shell: false,
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0;
    let err = Buffer.alloc(0);
    let settled = false;
    let force: ReturnType<typeof setTimeout> | undefined;
    function fail(error: AppError) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      force = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null)
          child.kill("SIGKILL");
      }, 1000);
      force.unref();
      reject(error);
    }
    const timer = setTimeout(() => {
      fail(new AppError("INTERNAL", 503));
    }, timeout);
    child.stdout.on("data", (b) => {
      if (settled) return;
      outputBytes += b.length;
      if (outputBytes > maxOutput) return fail(new AppError("FILE_SIZE", 413));
      chunks.push(b);
    });
    child.stderr.on("data", (b) => {
      if (!settled && err.length < 4000)
        err = Buffer.concat([err, b.subarray(0, 4000 - err.length)]);
    });
    child.on("error", () => {
      clearTimeout(timer);
      clearTimeout(force);
      if (settled) return;
      settled = true;
      reject(new AppError("INTERNAL", 503));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      clearTimeout(force);
      if (settled) return;
      settled = true;
      if (code !== 0) {
        const reported = err
          .toString("utf8")
          .match(/^ZIYAT_ERROR:([A-Z_]+)\r?$/m)?.[1];
        const safe =
          reported && processErrors.has(reported) ? reported : "FILE_INVALID";
        reject(new AppError(safe, processErrors.get(safe)!));
      } else resolve(Buffer.concat(chunks, outputBytes).toString("utf8"));
    });
  });
}
export function sniffFile(bytes: Buffer, name: string) {
  const format = uploadFormat(name);
  if (!format) throw new AppError("FILE_TYPE", 415);
  const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
  const zip = bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
  const ole = bytes
    .subarray(0, 8)
    .equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]));
  if (format.ext === "pdf" ? pdf : format.ext === "xls" ? ole : zip)
    return format;
  throw new AppError("FILE_TYPE", 415);
}
export async function inspectFile(bytes: Buffer, name: string) {
  if (env().APP_ENV !== "local" && env().SCAN_REQUIRED !== "true")
    throw new AppError("SCAN_UNAVAILABLE", 503);
  const type = sniffFile(bytes, name);
  const dir = await mkdtemp(join(tmpdir(), "ziyatai-upload-"));
  const path = join(dir, `source.${type.ext}`);
  try {
    await writeFile(path, bytes);
    if (env().SCAN_REQUIRED === "true") {
      if (env().CLAMAV_HOST) await scanStream(bytes);
      else {
        try {
          await processRun(env().CLAMSCAN_PATH, ["--no-summary", path], 60000);
        } catch {
          throw new AppError("SCAN_UNAVAILABLE", 503);
        }
      }
    }
    if (env().RENDERER_URL) await isolatedRequest("inspect", bytes, type.ext);
    else
      await processRun(
        env().PYTHON_PATH,
        ["apps/worker/parser.py", "--inspect", path],
        60000,
      );
    return type;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
