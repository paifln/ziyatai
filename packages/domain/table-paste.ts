export type TablePasteError = "size" | "cell" | "format";
export class TablePasteFailure extends Error {
  constructor(public readonly code: TablePasteError) {
    super(code);
  }
}

/** Excel/Sheets TSV, including quoted tabs, newlines and escaped quotes. */
export function parseTableClipboard(text: string): string[][] {
  if (text.length > 200 * 20 * 2000) throw new TablePasteFailure("size");
  const normalized = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  const pushCell = () => {
    if (cell.length > 2000) throw new TablePasteFailure("cell");
    row.push(cell);
    if (row.length > 20) throw new TablePasteFailure("size");
    cell = "";
    closed = false;
  };
  const pushRow = () => {
    rows.push(row);
    if (rows.length > 200) throw new TablePasteFailure("size");
    row = [];
  };
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized[i];
    if (quoted) {
      if (char === '"') {
        if (normalized[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += char;
    } else if (char === "\t" || char === "\n") {
      pushCell();
      if (char === "\n") pushRow();
    } else if (closed) throw new TablePasteFailure("format");
    else if (char === '"' && cell === "") quoted = true;
    else cell += char;
    if (cell.length > 2000) throw new TablePasteFailure("cell");
  }
  if (quoted) throw new TablePasteFailure("format");
  // Spreadsheet clipboards append one final line ending; it is not another row.
  if (!normalized.endsWith("\n") || row.length || cell.length) {
    pushCell();
    pushRow();
  }
  return rows;
}

export function pasteTableCells(
  table: { columns: string[]; rows: string[][] },
  cells: string[][],
  rowIndex: number,
  columnIndex: number,
) {
  if (
    !Number.isInteger(rowIndex) ||
    !Number.isInteger(columnIndex) ||
    rowIndex < 0 ||
    columnIndex < 0
  )
    throw new TablePasteFailure("format");
  const width = Math.max(
    table.columns.length,
    columnIndex + Math.max(0, ...cells.map((row) => row.length)),
  );
  const height = Math.max(table.rows.length, rowIndex + cells.length);
  if (width > 20 || height > 200) throw new TablePasteFailure("size");
  if (cells.some((row) => row.some((cell) => cell.length > 2000)))
    throw new TablePasteFailure("cell");
  const columns = Array.from(
    { length: width },
    (_, i) => table.columns[i] ?? "",
  );
  const rows = Array.from({ length: height }, (_, i) =>
    Array.from({ length: width }, (_, j) => table.rows[i]?.[j] ?? ""),
  );
  cells.forEach((row, i) =>
    row.forEach((cell, j) => {
      rows[rowIndex + i][columnIndex + j] = cell;
    }),
  );
  return { columns, rows };
}
