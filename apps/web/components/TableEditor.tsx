"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
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
  const pages = Math.max(1, Math.ceil(block.rows.length / pageSize));
  const current = Math.min(page, pages - 1);
  return (
    <>
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
                      className="icon-button"
                      disabled={block.columns.length <= 1}
                      aria-label={`${t.removeColumn} ${index + 1}`}
                      onClick={() =>
                        onChange({
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
                        <input
                          aria-label={`${t.row} ${rowIndex + 1}, ${t.column} ${columnIndex + 1}`}
                          value={cell}
                          maxLength={2000}
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
                        className="icon-button"
                        disabled={block.rows.length <= 1}
                        aria-label={`${t.removeRow} ${rowIndex + 1}`}
                        onClick={() =>
                          onChange({
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
            className="text-button"
            disabled={block.rows.length >= 200}
            onClick={() => {
              onChange({ rows: [...block.rows, block.columns.map(() => "")] });
              setPage(Math.floor(block.rows.length / pageSize));
            }}
          >
            <Plus size={12} />
            {t.addRow}
          </button>
          <button
            className="text-button"
            disabled={block.columns.length >= 20}
            onClick={() =>
              onChange({
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
