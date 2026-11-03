import { expect, it } from "vitest";
import { Readable } from "node:stream";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  backupKey,
  encryptBackup,
  decryptBackup,
} from "../scripts/ops/backup-crypto";
it("round-trips encrypted backups and refuses tampering before publishing plaintext", async () => {
  const folder = await mkdtemp(join(tmpdir(), "ziyatai-backup-test-"));
  try {
    const key = backupKey("12".repeat(32)),
      input = join(folder, "backup.enc"),
      output = join(folder, "restore");
    await encryptBackup(
      Readable.from([Buffer.from("private synthetic data")]),
      input,
      key,
    );
    await decryptBackup(input, output, key);
    expect(await readFile(output, "utf8")).toBe("private synthetic data");
    await expect(decryptBackup(input, output, key)).rejects.toThrow();
    const damaged = await readFile(input);
    damaged[23] ^= 1;
    await writeFile(input, damaged);
    await expect(
      decryptBackup(input, join(folder, "untrusted"), key),
    ).rejects.toThrow();
    await expect(readFile(join(folder, "untrusted"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    if (folder.startsWith(join(tmpdir(), "ziyatai-backup-test-")))
      await rm(folder, { recursive: true, force: true });
  }
});
