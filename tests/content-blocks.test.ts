import { expect, it } from "vitest";
import {
  blankBlock,
  blockText,
  convertBlock,
} from "../packages/domain/content-blocks";

it("preserves visible list and table content when switching to text or code", () => {
  const list = { ...blankBlock("list"), items: ["Бірінші", "Екінші"] };
  expect(convertBlock(list, "paragraph").text).toBe("Бірінші\nЕкінші");
  const table = {
    ...blankBlock("table"),
    columns: ["A", "B"],
    rows: [
      ["1", "2"],
      ["3", "4"],
    ],
  };
  expect(convertBlock(table, "code").text).toBe("A\tB\n1\t2\n3\t4");
  expect(convertBlock(table, "list").items).toEqual(["A\tB", "1\t2", "3\t4"]);
  expect(table.rows).toEqual([
    ["1", "2"],
    ["3", "4"],
  ]);
});

it("keeps paragraph text and separate list items when building a table", () => {
  const quoted = { ...blankBlock(), text: '"Цитата"\nЖаңа жол' };
  expect(convertBlock(quoted, "table").rows).toEqual([
    ['"Цитата"', ""],
    ["Жаңа жол", ""],
  ]);
  expect(
    convertBlock(
      { ...blankBlock("list"), items: ["Line\ninside", "Second"] },
      "table",
    ).rows,
  ).toEqual([
    ["Line\ninside", ""],
    ["Second", ""],
  ]);
  const code = { ...blankBlock("code"), text: "A\tB\n1\t2" };
  expect(convertBlock(code, "table").rows).toEqual([
    ["A", "B"],
    ["1", "2"],
  ]);
});

it("rejects conversions that would exceed editor bounds rather than truncating content", () => {
  const long = { ...blankBlock(), text: "x".repeat(2001) };
  expect(() => convertBlock(long, "table")).toThrow("cell");
  const table = {
    ...blankBlock("table"),
    columns: [""],
    rows: Array.from({ length: 101 }, () => ["x"]),
  };
  expect(() => convertBlock(table, "list")).toThrow("list");
  const large = {
    ...blankBlock("list"),
    items: Array(30).fill("x".repeat(1000)),
  };
  expect(() => convertBlock(large, "paragraph")).toThrow("text");
  expect(blockText(blankBlock("table"))).toBe("");
});
