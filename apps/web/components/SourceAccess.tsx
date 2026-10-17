"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ShieldCheck } from "lucide-react";
import { useAccountApi } from "../lib/account-client";
import { usePolling } from "../lib/use-polling";
import type { UiLocale } from "../lib/i18n";
import { messages, kazakhMessages } from "../../../packages/domain/errors";

type Status = {
  available: boolean;
  canCheck: boolean;
  job: {
    id: string;
    status: string;
    cancel_requested: boolean;
    error_code?: string;
  } | null;
};
export function SourceAccess({
  planId,
  uploadId,
  locale,
  onAvailability,
}: {
  planId: string;
  uploadId: string;
  locale: UiLocale;
  onAvailability: (available: boolean) => void;
}) {
  const api = useAccountApi();
  const [state, setState] = useState<Status>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const key = useRef<string | null>(null);
  const load = useCallback(async () => {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    try {
      const result: Status = await api(
        `ktp/${planId}/source`,
        "GET",
        undefined,
        undefined,
        next.signal,
      );
      if (next.signal.aborted) return;
      setState(result);
      setError("");
      onAvailability(result.available);
      if (
        result.job &&
        ["failed", "cancelled", "succeeded"].includes(result.job.status)
      )
        key.current = null;
    } catch (e) {
      if (!next.signal.aborted) setError((e as Error).message);
    }
  }, [api, planId, onAvailability]);
  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);
  const checking =
    !!state?.job && ["queued", "running"].includes(state.job.status);
  usePolling(load, checking && !state?.available);
  const ru = locale === "ru";
  async function act(cancel = false) {
    setBusy(true);
    setError("");
    try {
      if (cancel && state?.job)
        await api(`jobs/${state.job.id}/cancel`, "POST", {});
      else {
        key.current ??= crypto.randomUUID();
        await api(`ktp/${planId}/source`, "POST", {}, key.current);
      }
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="source-access"
      aria-label={ru ? "Исходный файл" : "Бастапқы файл"}
    >
      {!state?.available && state?.job?.status === "failed" && (
        <p className="notice error" role="alert">
          {(ru ? messages : kazakhMessages)[
            state.job.error_code ?? "INTERNAL"
          ] ?? (ru ? messages.INTERNAL : kazakhMessages.INTERNAL)}
        </p>
      )}
      {state?.available ? (
        <a className="button secondary" href={`/api/uploads/${uploadId}`}>
          <Download size={16} />
          {ru ? "Скачать исходник" : "Бастапқы файлды жүктеу"}
        </a>
      ) : (
        <>
          <p className="muted" role="status">
            {!state
              ? ru
                ? "Проверяем доступность источника…"
                : "Бастапқы файлдың қолжетімділігі тексерілуде…"
              : checking
                ? ru
                  ? "Проверяем файл. Уроки и ваши правки сохраняются."
                  : "Файл тексерілуде. Сабақтар мен түзетулер сақталады."
                : state.canCheck
                  ? ru
                    ? "Для исходника нужна повторная проверка. Уроки и задания останутся без изменений."
                    : "Бастапқы файлды қайта тексеру қажет. Сабақтар мен тапсырмалар өзгермейді."
                  : ru
                    ? "Этот исходник недоступен. Загрузите оригинал заново; сохранённые уроки остаются в этом КТП."
                    : "Бұл бастапқы файл қолжетімсіз. Түпнұсқаны қайта жүктеңіз; сақталған сабақтар осы КТЖ-да қалады."}
          </p>
          <div className="actions">
            {state?.canCheck && !checking && (
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void act()}
              >
                <ShieldCheck size={16} />
                {ru ? "Проверить исходник" : "Бастапқы файлды тексеру"}
              </button>
            )}
            {checking && (
              <button
                className="text-button"
                disabled={busy || state?.job?.cancel_requested}
                onClick={() => void act(true)}
              >
                {ru ? "Отменить проверку" : "Тексеруді тоқтату"}
              </button>
            )}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => void load()}
            >
              {ru ? "Обновить состояние файла" : "Файл күйін жаңарту"}
            </button>
          </div>
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
