import { expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { syntheticDemo } from "../packages/domain/demo";
import { renderDocx } from "../packages/document-renderer";

function documentXml(bytes: Buffer) {
  let cursor = bytes.indexOf(Buffer.from("PK\x01\x02"));
  while (cursor >= 0 && bytes.readUInt32LE(cursor) === 0x02014b50) {
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes
      .subarray(cursor + 46, cursor + 46 + nameLength)
      .toString();
    if (name === "word/document.xml") {
      const local = bytes.readUInt32LE(cursor + 42);
      const start =
        local +
        30 +
        bytes.readUInt16LE(local + 26) +
        bytes.readUInt16LE(local + 28);
      const content = bytes.subarray(
        start,
        start + bytes.readUInt32LE(cursor + 20),
      );
      return (
        bytes.readUInt16LE(cursor + 10) === 8
          ? inflateRawSync(content)
          : content
      ).toString();
    }
    cursor +=
      46 +
      nameLength +
      bytes.readUInt16LE(cursor + 30) +
      bytes.readUInt16LE(cursor + 32);
  }
  throw new Error("Missing document.xml");
}

it("prints the snapshotted subject in both languages and keeps old unknown subjects neutral", async () => {
  for (const [locale, subject, expected] of [
    ["ru", "mathematics", "Математика • Класс 7"],
    ["kk", "biology", "Биология • Сынып 7"],
    ["ru", "Шахматы", "Шахматы • Класс 7"],
    ["ru", undefined, "Класс 7"],
  ] as const) {
    const { document, snapshot } = syntheticDemo(locale);
    const xml = documentXml(
      await renderDocx(document, { ...snapshot, subject }, {}, "full"),
    );
    expect(xml).toContain(expected);
    expect(xml).not.toContain("Информатика •");
  }
});
