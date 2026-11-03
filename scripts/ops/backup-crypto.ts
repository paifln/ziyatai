import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { appendFile, open, link, unlink } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";
const magic = Buffer.from("ZIYATBK1");
export function backupKey(value: string | undefined) {
  if (!value || !/^[a-f\d]{64}$/i.test(value))
    throw new Error(
      "BACKUP_ENCRYPTION_KEY must be 32 random bytes encoded as hex",
    );
  return Buffer.from(value, "hex");
}
export async function encryptBackup(
  source: Readable,
  path: string,
  key: Buffer,
) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const file = createWriteStream(path, { flags: "wx", mode: 0o600 });
  file.write(Buffer.concat([magic, iv]));
  const hash = createHash("sha256");
  const tap = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  await pipeline(source, tap, cipher, file);
  await appendFile(path, cipher.getAuthTag());
  return hash.digest("hex");
}
export async function decryptBackup(
  input: string,
  output: string,
  key: Buffer,
) {
  const file = await open(input, "r");
  let size = 0;
  const header = Buffer.alloc(20),
    tag = Buffer.alloc(16);
  try {
    size = (await file.stat()).size;
    if (size < 36) throw new Error("Invalid backup envelope");
    await file.read(header, 0, 20, 0);
    await file.read(tag, 0, 16, size - 16);
  } finally {
    await file.close();
  }
  if (!header.subarray(0, 8).equals(magic))
    throw new Error("Invalid backup envelope");
  const decipher = createDecipheriv("aes-256-gcm", key, header.subarray(8));
  decipher.setAuthTag(tag);
  const temporary = `${output}.${randomUUID()}.partial`;
  try {
    const source =
      size === 36
        ? Readable.from([])
        : createReadStream(input, { start: 20, end: size - 17 });
    await pipeline(
      source,
      decipher,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
    );
    // Never publish unauthenticated plaintext or overwrite an existing restore.
    await link(temporary, output);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
}

/** Consumers must await verified before committing any restored data. */
export async function openBackupStream(input: string, key: Buffer) {
  const file = await open(input, "r");
  const header = Buffer.alloc(20),
    tag = Buffer.alloc(16);
  let size = 0;
  try {
    size = (await file.stat()).size;
    if (size < 36) throw new Error("Invalid backup envelope");
    await file.read(header, 0, 20, 0);
    await file.read(tag, 0, 16, size - 16);
  } finally {
    await file.close();
  }
  if (!header.subarray(0, 8).equals(magic))
    throw new Error("Invalid backup envelope");
  const stream = createDecipheriv("aes-256-gcm", key, header.subarray(8));
  stream.setAuthTag(tag);
  const verified = pipeline(
    size === 36
      ? Readable.from([])
      : createReadStream(input, { start: 20, end: size - 17 }),
    stream,
  );
  void verified.catch(() => undefined);
  return { stream, verified };
}
