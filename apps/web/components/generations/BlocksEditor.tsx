"use client";
import { textForKey } from "../../lib/i18n";
import { useState } from "react";
import { Plus, Trash2, Undo2 } from "lucide-react";
import {
  blankBlock,
  convertBlock,
  BlockConversionFailure,
  type ContentBlock as Block,
} from "../../../../packages/domain/content-blocks";
import { TablePasteFailure } from "../../../../packages/domain/table-paste";
import type { Texts } from "../../lib/i18n";
import TableEditor from "../TableEditor";

export function BlocksEditor({
  blocks,
  onChange,
  t,
}: {
  blocks: Block[];
  onChange: (b: Block[]) => void;
  t: Texts;
}) {
  const [error, setError] = useState("");
  const [undo, setUndo] = useState<{
    index: number;
    before: Block;
    after: Block;
  }>();
  function update(index: number, change: Partial<Block>) {
    setError("");
    setUndo(undefined);
    onChange(blocks.map((b, i) => (i === index ? { ...b, ...change } : b)));
  }
  return (
    <div className="blocks">
      {error && <p role="alert">{error}</p>}
      {blocks.map((b, i) => (
        <div className="block-editor" key={i}>
          <div className="block-top">
            <select
              aria-label={t.format}
              value={b.type}
              onChange={(e) => {
                const type = e.target.value as Block["type"];
                try {
                  const after = convertBlock(b, type);
                  onChange(
                    blocks.map((block, index) => (index === i ? after : block)),
                  );
                  setUndo({ index: i, before: b, after });
                  setError("");
                } catch (failure) {
                  setError(
                    failure instanceof TablePasteFailure
                      ? failure.code === "cell"
                        ? t.tablePasteCell
                        : failure.code === "size"
                          ? t.tablePasteSize
                          : t.tablePasteFormat
                      : failure instanceof BlockConversionFailure &&
                          failure.code === "list"
                        ? t.blockListLimit
                        : t.blockTextLimit,
                  );
                }
              }}
            >
              {["paragraph", "list", "table", "code"].map((type) => (
                <option key={type} value={type}>
                  {textForKey(t, type, type)}
                </option>
              ))}
            </select>
            {b.type === "code" && (
              <input
                aria-label={t.language}
                placeholder="Python 3.13"
                value={b.language}
                onChange={(e) => update(i, { language: e.target.value })}
              />
            )}
            {undo?.index === i && undo.after === b && (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  onChange(
                    blocks.map((block, index) =>
                      index === i ? undo.before : block,
                    ),
                  );
                  setUndo(undefined);
                  setError("");
                }}
              >
                <Undo2 size={13} />
                {t.undoBlockChange}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={t.remove}
              onClick={() => onChange(blocks.filter((_, j) => j !== i))}
            >
              <Trash2 size={13} />
            </button>
          </div>
          {b.type === "list" ? (
            <textarea
              aria-label={t.list}
              value={b.items.join("\n")}
              onChange={(e) => update(i, { items: e.target.value.split("\n") })}
            />
          ) : b.type === "table" ? (
            <TableEditor
              block={b}
              onChange={(value) => update(i, value)}
              t={t}
            />
          ) : (
            <textarea
              className={b.type === "code" ? "code-input" : ""}
              aria-label={t[b.type]}
              value={b.text}
              onChange={(e) => update(i, { text: e.target.value })}
              maxLength={20000}
            />
          )}
        </div>
      ))}
      <button
        type="button"
        className="text-button"
        disabled={blocks.length >= 30}
        onClick={() => onChange([...blocks, blankBlock()])}
      >
        <Plus size={13} />
        {t.addBlock}
      </button>
    </div>
  );
}
