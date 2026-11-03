import type { TaskDocument } from "../contracts";
import { parseTableClipboard, pasteTableCells } from "./table-paste";
export type ContentBlock = TaskDocument["contentBlocks"][number];
export const blankBlock = (
  type: ContentBlock["type"] = "paragraph",
): ContentBlock => ({
  type,
  text: "",
  items: [],
  columns: [],
  rows: [],
  language: "",
});

export class BlockConversionFailure extends Error {
  constructor(public readonly code: "text" | "list") {
    super(code);
  }
}

export function blockText(block: ContentBlock) {
  if (block.type === "list") return block.items.join("\n");
  if (block.type === "table")
    return [
      ...(block.columns.some((value) => value !== "") ? [block.columns] : []),
      ...block.rows,
    ]
      .map((row) => row.join("\t"))
      .join("\n");
  return block.text;
}

/** Convert visible content; never replace a filled list/table with an empty block. */
export function convertBlock(
  block: ContentBlock,
  type: ContentBlock["type"],
): ContentBlock {
  if (block.type === type) return block;
  const result = blankBlock(type);
  const text = blockText(block);
  if (type === "table") {
    const cells =
      block.type === "list"
        ? block.items.map((item) => [item])
        : text.includes("\t")
          ? parseTableClipboard(text)
          : text.split(/\r\n?|\n/).map((line) => [line]);
    const table = pasteTableCells(
      { columns: ["", ""], rows: [["", ""]] },
      cells,
      0,
      0,
    );
    return { ...result, ...table };
  }
  if (type === "list") {
    const items = text.split(/\r\n?|\n/);
    if (items.length > 100) throw new BlockConversionFailure("list");
    return { ...result, items };
  }
  if (text.length > 20000) throw new BlockConversionFailure("text");
  return { ...result, text, language: type === "code" ? block.language : "" };
}
