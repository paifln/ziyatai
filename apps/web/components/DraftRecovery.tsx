"use client";
import { useEffect, useRef, useState } from "react";
import type { UiLocale } from "../lib/i18n";
import type { StoredDraft } from "../../../packages/contracts/drafts";
import type { useServerDraft } from "../lib/use-server-draft";
import { useConfirm } from "./ui/ConfirmProvider";

function returnRecoveryFocus(source: HTMLElement | null) {
  requestAnimationFrame(() => {
    if (!source?.isConnected) return;
    const details = source.closest("details");
    if (details && !details.open) details.querySelector("summary")?.focus();
    else source.focus();
  });
}

export function DraftRecovery<T>({
  controller,
  dirty,
  disabled,
  locale,
  onRestore,
  onBusyChange,
}: {
  controller: ReturnType<typeof useServerDraft<T>>;
  dirty: boolean;
  disabled: boolean;
  locale: UiLocale;
  onRestore: (value: StoredDraft<T>) => void;
  onBusyChange: (value: boolean) => void;
}) {
  const ru = locale === "ru",
    confirm = useConfirm();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [restoring, setRestoring] = useState(false);
  const recovery = useRef<AbortController | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(
    () => () => {
      recovery.current?.abort();
      recovery.current = null;
    },
    [],
  );
  useEffect(() => {
    if (restoring) cancel.current?.focus();
  }, [restoring]);
  function cancelRecovery() {
    const request = recovery.current;
    if (!request) return;
    recovery.current = null;
    request.abort();
    setRestoring(false);
    setBusy(false);
    onBusyChange(false);
    returnRecoveryFocus(trigger.current);
  }
  if (
    !dirty &&
    !controller.candidates.length &&
    !controller.error &&
    !controller.listError &&
    !error
  )
    return null;
  const time = (value: string) =>
    new Date(value).toLocaleString(ru ? "ru-RU" : "kk-KZ", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <section
      className="draft-recovery"
      aria-label={ru ? "Резервные черновики" : "Сақтық нобайлар"}
    >
      {restoring && (
        <div className="status-bar draft-recovery-pending">
          <span role="status">
            {ru ? "Загружаем резервный черновик…" : "Сақтық нобай жүктелуде…"}
          </span>
          <button
            ref={cancel}
            className="button secondary"
            onClick={cancelRecovery}
          >
            {ru ? "Отменить восстановление" : "Қалпына келтіруден бас тарту"}
          </button>
        </div>
      )}
      {dirty && (
        <p role="status" className="status-bar">
          {controller.stage === "saved"
            ? ru
              ? `Резервный черновик сохранён в аккаунте · ${time(controller.savedAt)}`
              : `Сақтық нобай аккаунтта сақталды · ${time(controller.savedAt)}`
            : controller.stage === "saving"
              ? ru
                ? "Сохраняем резервный черновик…"
                : "Сақтық нобай сақталуда…"
              : controller.stage === "error"
                ? ru
                  ? "Резервный черновик не обновлён. Не закрывайте вкладку с правками."
                  : "Сақтық нобай жаңартылмады. Өзгерістер бар қойындыны жаппаңыз."
                : ru
                  ? "Есть правки без обновлённой резервной копии."
                  : "Жаңартылған сақтық көшірмесі жоқ өзгерістер бар."}
          {controller.stage === "error" && (
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => void controller.saveNow()}
            >
              {ru ? "Повторить" : "Қайталау"}
            </button>
          )}
        </p>
      )}
      {(controller.error || controller.listError || error) && (
        <div className="notice error" role="alert">
          {error || controller.error || controller.listError}
          {(controller.listError || error || controller.error) && (
            <button
              className="text-button"
              disabled={busy || disabled}
              onClick={() => {
                setError("");
                void controller.refresh();
              }}
            >
              {ru ? "Обновить список" : "Тізімді жаңарту"}
            </button>
          )}
        </div>
      )}
      {controller.candidates.length > 0 && (
        <details open className="card">
          <summary>
            {ru ? "Найдены резервные черновики" : "Сақтық нобайлар табылды"} ·{" "}
            {controller.candidates.length}
          </summary>
          <p>
            {ru
              ? "Копии доступны в вашем аккаунте 7 дней после обновления. Восстановление откроет сравнение с текущим материалом."
              : "Көшірмелер жаңартылғаннан кейін 7 күн аккаунтыңызда қолжетімді. Қалпына келтіру ағымдағы материалмен салыстыруды ашады."}
          </p>
          {controller.candidates.map((row) => (
            <div className="version-row" key={row.id}>
              <span>{time(row.savedAt)}</span>
              <div className="actions">
                <button
                  className="button secondary"
                  disabled={busy || disabled}
                  onClick={async (event) => {
                    const source = event.currentTarget;
                    if (
                      dirty &&
                      !(await confirm(
                        ru
                          ? "Заменить правки в этой вкладке резервным черновиком? Текущие несохранённые изменения будут заменены."
                          : "Осы қойындыдағы өзгерістер сақтық нобаймен ауыстырылсын ба? Ағымдағы сақталмаған өзгерістер ауыстырылады.",
                      ))
                    )
                      return;
                    if (!source.isConnected || recovery.current) return;
                    const request = new AbortController();
                    recovery.current = request;
                    trigger.current = source;
                    setRestoring(true);
                    setBusy(true);
                    onBusyChange(true);
                    setError("");
                    try {
                      const value = await controller.restore(
                        row.id,
                        request.signal,
                      );
                      if (
                        !request.signal.aborted &&
                        recovery.current === request
                      )
                        onRestore(value);
                    } catch (e) {
                      if (
                        !request.signal.aborted &&
                        recovery.current === request
                      ) {
                        setError((e as Error).message);
                        returnRecoveryFocus(source);
                      }
                    } finally {
                      if (recovery.current === request) {
                        recovery.current = null;
                        setRestoring(false);
                        setBusy(false);
                        onBusyChange(false);
                      }
                    }
                  }}
                >
                  {ru ? "Восстановить черновик" : "Нобайды қалпына келтіру"}
                </button>
                <button
                  className="text-button danger"
                  disabled={busy || disabled}
                  onClick={async () => {
                    if (
                      !(await confirm(
                        ru
                          ? "Удалить эту резервную копию? Сохранённый материал и правки в редакторе останутся."
                          : "Осы сақтық көшірме жойылсын ба? Сақталған материал мен редактордағы өзгерістер қалады.",
                      ))
                    )
                      return;
                    setBusy(true);
                    onBusyChange(true);
                    setError("");
                    try {
                      await controller.remove(row);
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                      onBusyChange(false);
                    }
                  }}
                >
                  {ru ? "Удалить копию" : "Көшірмені жою"}
                </button>
              </div>
            </div>
          ))}
        </details>
      )}
    </section>
  );
}
