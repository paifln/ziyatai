"use client";
import { useState } from "react";
import { Check, AlertTriangle, ChevronRight } from "lucide-react";
import { api } from "../lib/client";
import type { Texts, UiLocale } from "../lib/i18n";
import { kazakhMessages, messages } from "../../../packages/domain/errors";
export function Jobs({
  jobs,
  t,
  onOpen,
  refresh,
  locale,
}: {
  jobs: any[];
  t: Texts;
  onOpen?: (j: any) => void;
  refresh: () => Promise<void>;
  locale?: UiLocale;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [mutating, setMutating] = useState<Record<string, boolean>>({});
  return (
    <>
      {jobs.map((j) => (
        <div className="job-card" key={j.id}>
          {["running", "queued"].includes(j.status) ? (
            <span className="spinner" />
          ) : j.status === "succeeded" ? (
            <Check size={18} color="#37764e" />
          ) : (
            <AlertTriangle size={18} color="#b06c24" />
          )}
          <div className="job-body">
            <strong>
              {["succeeded", "failed", "cancelled"].includes(j.status)
                ? (t as any)[j.status]
                : ((t as any)[j.stage] ?? t.processing)}
            </strong>
            <small>
              {["queued", "running"].includes(j.status)
                ? ((t as any)[j.status] ?? t.processing)
                : j.format?.toUpperCase()}
              {j.attempt > 1
                ? ` · ${locale === "kk" ? "Қайта әрекет" : "Повторная попытка"} (${j.attempt})`
                : j.error_code || j.error
                  ? ` · ${t.retry}`
                  : ""}
            </small>
            {(j.error || j.error_code) &&
              ["failed", "cancelled"].includes(j.status) && (
                <small className="job-error">
                  {(locale === "kk" ? kazakhMessages : messages)[
                    j.error?.code ?? j.error_code
                  ] ??
                    (locale === "kk"
                      ? kazakhMessages.INTERNAL
                      : messages.INTERNAL)}
                </small>
              )}
            {errors[j.id] && <div role="alert">{errors[j.id]}</div>}
          </div>
          {["queued", "running"].includes(j.status) ? (
            <button
              className="text-button"
              disabled={
                mutating[j.id] || j.cancelRequested || j.cancel_requested
              }
              onClick={async () => {
                setMutating((current) => ({ ...current, [j.id]: true }));
                try {
                  await api(`jobs/${j.id}/cancel`, "POST", {});
                  await refresh();
                } catch (e) {
                  setErrors({ ...errors, [j.id]: (e as Error).message });
                } finally {
                  setMutating((current) => ({ ...current, [j.id]: false }));
                }
              }}
            >
              {j.cancelRequested || j.cancel_requested
                ? locale === "kk"
                  ? "Бас тартылуда…"
                  : "Отменяем…"
                : t.cancel}
            </button>
          ) : (
            onOpen && (
              <button
                className="icon-button"
                onClick={() => onOpen(j)}
                aria-label={t.select}
              >
                <ChevronRight size={16} />
              </button>
            )
          )}
          {["failed", "cancelled"].includes(j.status) &&
            ["import", "export"].includes(j.kind) && (
              <button
                className="button secondary"
                disabled={mutating[j.id]}
                onClick={async () => {
                  setMutating((current) => ({ ...current, [j.id]: true }));
                  try {
                    await api(`jobs/${j.id}/retry`, "POST", {});
                    await refresh();
                  } catch (e) {
                    setErrors({ ...errors, [j.id]: (e as Error).message });
                  } finally {
                    setMutating((current) => ({ ...current, [j.id]: false }));
                  }
                }}
              >
                {t.retry}
              </button>
            )}
        </div>
      ))}
    </>
  );
}
