import { expect, it } from "vitest";
import { syntheticDemo } from "../packages/domain/demo";
import { validateDocument } from "../packages/domain/validation";
import { renderDocx } from "../packages/document-renderer";
it("recognizes table-only conditions and rejects blank answers with the task location", () => {
  const { document, snapshot } = syntheticDemo("ru");
  document.tasks[0].contentBlocks = [
    {
      type: "table",
      text: "",
      items: [],
      columns: ["a", "b"],
      rows: [["1", "2"]],
      language: "",
    },
  ];
  document.tasks[0].answerBlocks = [
    {
      type: "paragraph",
      text: "  ",
      items: [],
      columns: [],
      rows: [],
      language: "",
    },
  ];
  const result = validateDocument(document, snapshot);
  expect(result.details).toContainEqual({
    code: "MISSING_CONTENT",
    taskId: document.tasks[0].id,
    taskIndex: 0,
  });
  document.tasks[0].answerBlocks[0].text = "3";
  expect(validateDocument(document, snapshot).issues).not.toContain(
    "MISSING_CONTENT",
  );
});
it("rejects excessive table allocations before building a DOCX", async () => {
  const { document, snapshot } = syntheticDemo("ru");
  document.tasks[0].contentBlocks = [
    {
      type: "table",
      text: "",
      items: [],
      columns: ["a"],
      rows: [Array(10001).fill("")],
      language: "",
    },
  ];
  expect(() => validateDocument(document, snapshot)).toThrow("DOCUMENT_LIMIT");
  await expect(renderDocx(document, snapshot, {}, "full")).rejects.toThrow(
    "DOCUMENT_LIMIT",
  );
});
