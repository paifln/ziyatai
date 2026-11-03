"use client";
import { useState } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import {
  parseTableClipboard,
  pasteTableCells,
  TablePasteFailure,
} from "../../../packages/domain/table-paste";
import type { TaskDocument } from "../../../packages/contracts";
import type { Texts } from "../lib/i18n";
type Block = TaskDocument["contentBlocks"][number];
const pageSize = 10;

export default function TableEditor({
  block,
  onChange,
  t,
}: {
  block: Block;
  onChange: (change: Partial<Block>) => void;
  t: Texts;
}) {
  const [page, setPage] = useState(0);
  const [pasteMessage, setPasteMessage] = useState("");
  const [pasteError, setPasteError] = useState(false);
  const [undoPaste, setUndoPaste] = useState<{
    before: Pick<Block, "columns" | "rows">;
    after: Pick<Block, "columns" | "rows">;
    label: string;
    page: number;
  }>();
  const pages = Math.max(1, Math.ceil(block.rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  function commit(change: Partial<Block>, label = t.undoTableChange) {
    const after = {
      columns: change.columns ?? block.columns,
      rows: change.rows ?? block.rows,
    };
    onChange(after);
    setUndoPaste({
      before: { columns: block.columns, rows: block.rows },
      after,
      label,
      page: current,
    });
    setPasteError(false);
    setPasteMessage("");
  }
  return (
    <>
      <p className="muted">{t.tablePasteHint}</p>
      {pasteMessage && (
        <p role={pasteError ? "alert" : "status"}>{pasteMessage}</p>
      )}
      {undoPaste &&
        block.rows === undoPaste.after.rows &&
        block.columns === undoPaste.after.columns && (
          <button
            type="button"
            className="text-button"
            onClick={() => {
              onChange(undoPaste.before);
              setPage(undoPaste.page);
              setUndoPaste(undefined);
              setPasteMessage("");
            }}
          >
            {undoPaste.label}
          </button>
        )}
      <div className="table-grid">
        <table>
          <caption className="sr-only">{t.table}</caption>
          <thead>
            <tr>
              {block.columns.map((column, index) => (
                <th key={index} scope="col">
                  <div className="table-column-header">
                    <input
                      aria-label={`${t.column} ${index + 1}`}
                      value={column}
                      maxLength={2000}
                      onChange={(e) =>
                        onChange({
                          columns: block.columns.map((value, i) =>
                            i === index ? e.target.value : value,
                          ),
                        })
                      }
                    />
                    <button
                      type="button"
                      className="icon-button"
                      disabled={block.columns.length <= 1}
                      aria-label={`${t.removeColumn} ${index + 1}`}
                      onClick={() =>
                        commit({
                          columns: block.columns.filter((_, i) => i !== index),
                          rows: block.rows.map((row) =>
                            row.filter((_, i) => i !== index),
                          ),
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </th>
              ))}
              <th scope="col">
                <span className="sr-only">{t.removeRow}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {block.rows
              .slice(current * pageSize, (current + 1) * pageSize)
              .map((row, offset) => {
                const rowIndex = current * pageSize + offset;
                return (
                  <tr key={rowIndex}>
                    {row.map((cell, columnIndex) => (
                      <td key={columnIndex}>
                        <textarea
                          rows={Math.min(4, cell.split(/\r?\n/).length)}
                          aria-label={`${t.row} ${rowIndex + 1}, ${t.column} ${columnIndex + 1}`}
                          value={cell}
                          maxLength={2000}
                          onPaste={(event) => {
                            const text =
                              event.clipboardData.getData("text/plain");
                            if (!/[\t\r\n]/.test(text)) return;
                            event.preventDefault();
                            try {
                              const cells = parseTableClipboard(text);
                              const after = pasteTableCells(
                                block,
                                cells,
                                rowIndex,
                                columnIndex,
                              );
                              commit(after, t.undoTablePaste);
                              setPasteError(false);
                              setPasteMessage(
                                `${t.tablePasteDone}: ${cells.length} × ${Math.max(0, ...cells.map((values) => values.length))}`,
                              );
                            } catch (error) {
                              setPasteError(true);
                              setPasteMessage(
                                error instanceof TablePasteFailure
                                  ? error.code === "size"
                                    ? t.tablePasteSize
                                    : error.code === "cell"
                                      ? t.tablePasteCell
                                      : t.tablePasteFormat
                                  : t.tablePasteFormat,
                              );
                            }
                          }}
                          onChange={(e) =>
                            onChange({
                              rows: block.rows.map((values, i) =>
                                i === rowIndex
                                  ? values.map((value, j) =>
                                      j === columnIndex
                                        ? e.target.value
                                        : value,
                                    )
                                  : values,
                              ),
                            })
                          }
                        />
                      </td>
                    ))}
                    <td>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={block.rows.length >= 200}
                        aria-label={`${t.duplicateRow} ${rowIndex + 1}`}
                        onClick={() => {
                          commit({
                            rows: [
                              ...block.rows.slice(0, rowIndex + 1),
                              [...row],
                              ...block.rows.slice(rowIndex + 1),
                            ],
                          });
                          setPage(Math.floor((rowIndex + 1) / pageSize));
                        }}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        disabled={block.rows.length <= 1}
                        aria-label={`${t.removeRow} ${rowIndex + 1}`}
                        onClick={() =>
                          commit({
                            rows: block.rows.filter((_, i) => i !== rowIndex),
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      <div className="table-editor-actions">
        <div className="actions">
          <button
            type="button"
            className="text-button"
            disabled={block.rows.length >= 200}
            onClick={() => {
              commit({ rows: [...block.rows, block.columns.map(() => "")] });
              setPage(Math.floor(block.rows.length / pageSize));
            }}
          >
            <Plus size={12} />
            {t.addRow}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={block.columns.length >= 20}
            onClick={() =>
              commit({
                columns: [...block.columns, ""],
                rows: block.rows.map((row) => [...row, ""]),
              })
            }
          >
            <Plus size={12} />
            {t.addColumn}
          </button>
        </div>
        <nav className="pagination" aria-label={t.tablePages}>
          <button
            type="button"
            className="button secondary"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
          >
            {t.back}
          </button>
          <select
            aria-label={t.tablePages}
            value={current}
            onChange={(e) => setPage(Number(e.target.value))}
          >
            {Array.from({ length: pages }, (_, index) => (
              <option key={index} value={index}>
                {index + 1} / {pages}
              </option>
            ))}
          </select>
          <span>
            {t.rows}: {block.rows.length}
          </span>
          <button
            type="button"
            className="button secondary"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
          >
            {t.next}
          </button>
        </nav>
      </div>
    </>
  );
}
