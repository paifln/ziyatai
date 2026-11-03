import { describe, it, expect } from "vitest";
import { syntheticDemo } from "../packages/domain/demo";
import { validateDocument } from "../packages/domain/validation";
import { sniffFile } from "../server/infrastructure/documents/files";
import { renderDocx } from "../packages/document-renderer";
import { normalizeDate } from "../packages/domain/dates";
import { arithmetic } from "../packages/domain/arithmetic";
it("verifies simple calculations without executing source as code", () => {
  expect(arithmetic("(2+3)*2")).toBe(10);
  expect(arithmetic("process.exit()")).toBeNull();
  expect(arithmetic("1/0")).toBeNull();
  const { document, snapshot } = syntheticDemo("ru");
  document.tasks[0].verificationCases = [{ input: "2+3", expected: "6" }];
  expect(validateDocument(document, snapshot).issues).toContain(
    "ARITHMETIC_ANSWER",
  );
});
it("keeps ambiguous dates raw, checks calendar validity and normalizes ranges", () => {
  expect(normalizeDate("02.09").dateStart).toBeNull();
  expect(normalizeDate("31.02.2026").warnings).toContain("invalid_date");
  expect(normalizeDate("2026-09-01–2026-09-03")).toMatchObject({
    dateStart: "2026-09-01",
    dateEnd: "2026-09-03",
  });
});
describe("generation contract", () => {
  it("validates three levels with scores and snapshot linkage", () => {
    const sample = syntheticDemo("kk");
    const report = validateDocument(sample.document, sample.snapshot);
    expect(report.issues).toEqual([]);
    expect(report.status).toBe("needs_review");
  });
  it("rejects duplicate tasks, foreign objectives and score disagreement", () => {
    const { document, snapshot } = syntheticDemo("ru");
    document.tasks[1] = structuredClone(document.tasks[0]);
    document.tasks[0].rubric[0].points = 100;
    document.tasks[0].objectiveRefs = ["foreign"];
    expect(validateDocument(document, snapshot).issues).toEqual(
      expect.arrayContaining([
        "DUPLICATE_ID",
        "DUPLICATE_TASK",
        "POINTS",
        "OBJECTIVE_REF",
      ]),
    );
  });
  it("requires an aligned translation for bilingual output", () => {
    const { document, snapshot } = syntheticDemo("kk");
    document.localeMode = "kk+ru";
    snapshot.locale = "kk+ru" as any;
    expect(validateDocument(document, snapshot).issues).toContain(
      "TRANSLATION_MISSING",
    );
  });
});
describe("file allowlist", () => {
  it("requires both extension and magic", () => {
    expect(() => sniffFile(Buffer.from("%PDF-1.7"), "file.xlsx")).toThrow();
    expect(() =>
      sniffFile(Buffer.from("ordinary text"), "file.docx"),
    ).toThrow();
    expect(() =>
      sniffFile(
        Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]),
        "file.doc",
      ),
    ).toThrow();
    expect(sniffFile(Buffer.from("%PDF-1.7"), "file.pdf").mime).toBe(
      "application/pdf",
    );
  });
});
describe("document renderer", () => {
  it("creates OOXML bytes from the same versioned AST", async () => {
    const { document, snapshot } = syntheticDemo("kk");
    const bytes = await renderDocx(document, snapshot, {}, "full");
    expect(bytes.subarray(0, 2).toString()).toBe("PK");
    expect(bytes.length).toBeGreaterThan(5000);
  });
});
