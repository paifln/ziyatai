import type { GenerationDocument } from "../contracts";
import { AppError } from "./errors";
export function assertDocumentBudget(doc: GenerationDocument) {
  let blocks = 0,
    cells = 0,
    characters = doc.title.length;
  if (doc.tasks.length > 15) throw new AppError("DOCUMENT_LIMIT", 422);
  for (const task of doc.tasks) {
    if (
      task.contentBlocks.length > 30 ||
      task.answerBlocks.length > 30 ||
      task.rubric.length > 100 ||
      task.objectiveRefs.length > 100 ||
      task.verificationCases.length > 100
    )
      throw new AppError("DOCUMENT_LIMIT", 422);
    characters +=
      task.explanationHow.length +
      task.explanationWhy.length +
      task.rubric.reduce((sum, r) => sum + r.criterion.length, 0) +
      task.verificationCases.reduce(
        (sum, c) => sum + c.input.length + c.expected.length,
        0,
      );
    if (task.translation)
      characters +=
        task.translation.explanationHow.length +
        task.translation.explanationWhy.length +
        task.translation.rubric.reduce((sum, r) => sum + r.criterion.length, 0);
    const content = [
      ...task.contentBlocks,
      ...task.answerBlocks,
      ...(task.translation?.contentBlocks || []),
      ...(task.translation?.answerBlocks || []),
    ];
    blocks += content.length;
    for (const block of content) {
      if (
        block.rows.length > 200 ||
        block.columns.length > 20 ||
        block.items.length > 100
      )
        throw new AppError("DOCUMENT_LIMIT", 422);
      cells +=
        block.columns.length +
        block.rows.reduce((sum, row) => sum + row.length, 0);
      characters +=
        block.text.length +
        block.items.join("").length +
        block.columns.join("").length +
        block.rows.reduce((sum, row) => sum + row.join("").length, 0);
    }
    if (blocks > 200 || cells > 10000 || characters > 250000)
      throw new AppError("DOCUMENT_LIMIT", 422);
  }
}
