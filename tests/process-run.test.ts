import { expect, it, vi } from "vitest";
vi.mock("../apps/web/lib/env", () => ({
  env: () => ({ TESSERACT_PATH: "tesseract" }),
}));
import { processRun } from "../apps/web/lib/files";

it.each([
  ["ZIYAT_ERROR:PRIVATE_SOURCE_FRAGMENT", "FILE_INVALID", 422],
  ["private text ZIYAT_ERROR:FILE_SIZE", "FILE_INVALID", 422],
  ["ZIYAT_ERROR:FILE_SIZE", "FILE_SIZE", 413],
  ["ZIYAT_ERROR:FILE_TYPE", "FILE_TYPE", 415],
  ["ZIYAT_ERROR:RENDER_UNAVAILABLE", "RENDER_UNAVAILABLE", 503],
] as const)(
  "allows only complete known subprocess error markers: %s",
  async (stderr, code, status) => {
    await expect(
      processRun(process.execPath, [
        "-e",
        `process.stderr.write(${JSON.stringify(stderr)}+'\\n');process.exitCode=1;`,
      ]),
    ).rejects.toMatchObject({ code, status });
  },
);

it("preserves Kazakh UTF-8 characters split between separate stdout chunks", async () => {
  const text = "Ә Ғ Қ Ң Ө Ұ Ү Һ І — Қазақ тілі";
  const code = `const data=Buffer.from(${JSON.stringify(text)});let i=0;const timer=setInterval(()=>{if(i===data.length){clearInterval(timer);return;}process.stdout.write(data.subarray(i,++i));},2);`;
  expect(await processRun(process.execPath, ["-e", code], 5000)).toBe(text);
});

it("bounds stdout by UTF-8 bytes and stops an overproducing child", async () => {
  await expect(
    processRun(
      process.execPath,
      ["-e", "process.stdout.write('Ә'.repeat(1000));setInterval(()=>{},1000)"],
      5000,
      1500,
    ),
  ).rejects.toMatchObject({ code: "FILE_SIZE", status: 413 });
});

it("terminates timed-out children and does not expose their stderr", async () => {
  await expect(
    processRun(
      process.execPath,
      [
        "-e",
        "process.stderr.write('synthetic-private-text');setInterval(()=>{},1000)",
      ],
      150,
    ),
  ).rejects.toMatchObject({ code: "INTERNAL", status: 503 });
});
