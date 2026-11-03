import { expect, it } from "vitest";
import { inflateRawSync } from "node:zlib";
import { syntheticDemo } from "../packages/domain/demo";
import { renderDocx } from "../packages/document-renderer";
import { hasRequiredGoals, isAssessmentTopic } from "../packages/domain/goals";

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

it("allows explicit objective omission only for assessment rows", () => {
  for (const topic of ["СОР № 2", "Итоговый СОЧ", "БЖБ (3)", "ТЖБ"]) {
    expect(isAssessmentTopic(topic)).toBe(true);
    expect(hasRequiredGoals({ topic, goals: "", goalsSkipped: true })).toBe(
      true,
    );
    expect(hasRequiredGoals({ topic, goals: "" })).toBe(false);
  }
  for (const topic of ["Сортировка", "Сочетания", "Раздел СОРТ", "Алгебра"]) {
    expect(hasRequiredGoals({ topic, goals: "", goalsSkipped: true })).toBe(
      false,
    );
  }
  expect(hasRequiredGoals({ topic: "Алгебра", goals: "7.1.1.1" })).toBe(false);
  expect(
    hasRequiredGoals({ topic: "Алгебра", goals: "Решать уравнения" }),
  ).toBe(true);
});

it("exports A4 portrait and landscape with two flowing columns and generous answer lines", async () => {
  const { document, snapshot } = syntheticDemo("ru");
  const portrait = documentXml(
    await renderDocx(document, snapshot, {}, "student", true),
  );
  const landscape = documentXml(
    await renderDocx(
      document,
      snapshot,
      { layout: "landscape-columns" },
      "student",
      true,
    ),
  );
  expect(portrait).toContain('w:orient="portrait"');
  expect(landscape).toContain('w:orient="landscape"');
  expect(landscape).toMatch(/<w:cols[^>]*w:num="2"/);
  expect(landscape).toContain('w:w="16838"');
  expect(landscape).toContain('w:h="11906"');
  expect(portrait).not.toContain("Ответы и объяснения");
  expect((portrait.match(/<w:bottom[^>]*w:color="B8B8B8"/g) || []).length).toBe(
    54,
  );
  const noLines = documentXml(
    await renderDocx(
      document,
      snapshot,
      { answerSpace: false },
      "student",
      true,
    ),
  );
  expect(noLines).not.toContain('w:color="B8B8B8"');
});

it("omits solutions from student exports while retaining them in full exports", async () => {
  const { document, snapshot } = syntheticDemo("ru");
  const task = document.tasks[0];
  task.answerBlocks[0].text = "PRIVATE_ANSWER";
  task.explanationHow = "PRIVATE_HOW";
  task.explanationWhy = "PRIVATE_WHY";
  task.rubric[0].criterion = "PRIVATE_RUBRIC";
  task.translation = {
    contentBlocks: structuredClone(task.contentBlocks),
    answerBlocks: [
      { ...task.answerBlocks[0], text: "PRIVATE_TRANSLATED_ANSWER" },
    ],
    explanationHow: "PRIVATE_TRANSLATED_HOW",
    explanationWhy: "PRIVATE_TRANSLATED_WHY",
    rubric: [{ ...task.rubric[0], criterion: "PRIVATE_TRANSLATED_RUBRIC" }],
  };
  const student = documentXml(
    await renderDocx(document, snapshot, {}, "student"),
  );
  const full = documentXml(await renderDocx(document, snapshot, {}, "full"));
  for (const marker of [
    "PRIVATE_ANSWER",
    "PRIVATE_HOW",
    "PRIVATE_WHY",
    "PRIVATE_RUBRIC",
    "PRIVATE_TRANSLATED_ANSWER",
    "PRIVATE_TRANSLATED_HOW",
    "PRIVATE_TRANSLATED_WHY",
    "PRIVATE_TRANSLATED_RUBRIC",
  ]) {
    expect(student).not.toContain(marker);
    expect(full).toContain(marker);
  }
});

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
