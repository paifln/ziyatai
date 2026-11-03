import { expect, it } from "vitest";
import {
  parseTableClipboard,
  pasteTableCells,
  TablePasteFailure,
} from "../packages/domain/table-paste";

it("reads spreadsheet TSV with CRLF, quoted delimiters and escaped quotes", () => {
  expect(
    parseTableClipboard('A\t"B\tC"\r\n"line 1\nline 2"\t"He said ""yes"""\r\n'),
  ).toEqual([
    ["A", "B\tC"],
    ["line 1\nline 2", 'He said "yes"'],
  ]);
  expect(parseTableClipboard("A\t\n\t\n")).toEqual([
    ["A", ""],
    ["", ""],
  ]);
});

it("rejects malformed quoting without a partial result", () => {
  for (const text of ['"unfinished\tcell', '"closed"extra\tcell'])
    expect(() => parseTableClipboard(text)).toThrow(TablePasteFailure);
});

it("expands from the selected cell and keeps unrelated cells and headers", () => {
  const table = {
    columns: ["First", "Second"],
    rows: [
      ["a", "b"],
      ["c", "d"],
    ],
  };
  const copy = structuredClone(table);
  expect(pasteTableCells(table, [["x", "y"], ["z"]], 1, 1)).toEqual({
    columns: ["First", "Second", ""],
    rows: [
      ["a", "b", ""],
      ["c", "x", "y"],
      ["", "z", ""],
    ],
  });
  expect(table).toEqual(copy);
});

it("bounds dimensions and cell length instead of silently truncating", () => {
  expect(() => parseTableClipboard(Array(21).fill("a").join("\t"))).toThrow(
    "size",
  );
  expect(() => parseTableClipboard(Array(201).fill("a").join("\n"))).toThrow(
    "size",
  );
  expect(() => parseTableClipboard("a".repeat(2001))).toThrow("cell");
  const table = { columns: ["A"], rows: [["a"]] };
  expect(() => pasteTableCells(table, [["x", "y"]], 0, 19)).toThrow("size");
  expect(() => pasteTableCells(table, [["x"], ["y"]], 199, 0)).toThrow("size");
  expect(() => pasteTableCells(table, [["x"]], -1, 0)).toThrow("format");
  expect(
    pasteTableCells(table, [["x".repeat(2000)]], 199, 19).rows,
  ).toHaveLength(200);
});
