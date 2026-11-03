import { scanStream } from "../../apps/web/lib/antivirus";
import { writeFile, mkdir, readFile } from "node:fs/promises";
process.env.CLAMAV_HOST = "127.0.0.1";
process.env.CLAMAV_PORT = "13310";
await scanStream(await readFile("tests/fixtures/ru-table-1.docx"));
const eicar = Buffer.from(
  "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
);
let rejected = false;
try {
  await scanStream(eicar);
} catch (e) {
  rejected = (e as any).code === "FILE_UNSAFE";
}
if (!rejected)
  throw new Error("Standard antivirus test signature was not rejected");
const report = {
  engine: "ClamAV 1.4.6",
  cleanDocxAccepted: true,
  standardEicarTestRejected: true,
  scope: "local TCP INSTREAM adapter; harmless standard test signature",
};
await mkdir(".local/reports", { recursive: true });
await writeFile(".local/reports/antivirus.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
