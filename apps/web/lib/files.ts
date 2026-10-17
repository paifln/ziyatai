import { spawn } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env } from "./env";
import { AppError } from "../../../packages/domain/errors";
import { isolatedRequest } from "./renderer";
import { scanStream } from "./antivirus";
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
    let out = "",
      err = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new AppError("INTERNAL", 503));
    }, timeout);
    child.stdout.on("data", (b) => {
      out += b;
      if (out.length > maxOutput) {
        child.kill();
        reject(new AppError("FILE_SIZE", 413));
      }
    });
    child.stderr.on("data", (b) => {
      if (err.length < 4000) err += b;
    });
    child.on("error", () => {
      clearTimeout(timer);
      reject(new AppError("INTERNAL", 503));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        const safe = err.match(/ZIYAT_ERROR:([A-Z_]+)/)?.[1] ?? "FILE_INVALID";
        reject(new AppError(safe, 422));
      } else resolve(out);
    });
  });
}
export function sniffFile(bytes: Buffer, name: string) {
  const ext = name.toLowerCase().split(".").pop();
  const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
  const zip = bytes.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
  const ole = bytes
    .subarray(0, 8)
    .equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]));
  if (ext === "pdf" && pdf) return { ext, mime: "application/pdf" };
  if (ext === "docx" && zip)
    return {
      ext,
      mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    };
  if (ext === "xlsx" && zip)
    return {
      ext,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    };
  if (ext === "xls" && ole) return { ext, mime: "application/vnd.ms-excel" };
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
