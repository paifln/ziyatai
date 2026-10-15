"use client";
import { useState } from "react";
import { Check, AlertTriangle, ChevronRight } from "lucide-react";
import { api } from "../lib/client";
import type { Texts } from "../lib/i18n";
export function Jobs({
  jobs,
  t,
  onOpen,
  refresh,
}: {
  jobs: any[];
  t: Texts;
  onOpen?: (j: any) => void;
  refresh: () => Promise<void>;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
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
            <strong>{(t as any)[j.stage] ?? t.processing}</strong>
            <small>
              {(t as any)[j.status] ?? t.processing}
              {j.error_code ? ` · ${t.retry}` : ""}
            </small>
            {errors[j.id] && <div role="alert">{errors[j.id]}</div>}
          </div>
          {["queued", "running"].includes(j.status) ? (
            <button
              className="text-button"
              onClick={async () => {
                try {
                  await api(`jobs/${j.id}/cancel`, "POST", {});
                  await refresh();
                } catch (e) {
                  setErrors({ ...errors, [j.id]: (e as Error).message });
                }
              }}
            >
              {t.cancel}
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
                onClick={async () => {
                  try {
                    await api(`jobs/${j.id}/retry`, "POST", {});
                    await refresh();
                  } catch (e) {
                    setErrors({ ...errors, [j.id]: (e as Error).message });
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
