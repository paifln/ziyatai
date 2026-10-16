"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { CircleAlert, X } from "lucide-react";
type Ask = (
  message: string,
  options?: { destructive?: boolean; locale?: "kk" | "ru" },
) => Promise<boolean>;
const Context = createContext<Ask | null>(null);
export function useConfirm() {
  const ask = useContext(Context);
  if (!ask) throw new Error("Confirmation provider is missing");
  return ask;
}
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<{
    message: string;
    destructive: boolean;
    locale: "kk" | "ru";
  } | null>(null);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const ask = useCallback<Ask>((message, options) => {
    resolve.current?.(false);
    trigger.current = document.activeElement as HTMLElement;
    return new Promise((done) => {
      resolve.current = done;
      setPending({
        message,
        destructive: options?.destructive ?? false,
        locale:
          options?.locale ??
          (document.documentElement.lang === "ru" ? "ru" : "kk"),
      });
    });
  }, []);
  function finish(value: boolean) {
    dialog.current?.close();
    resolve.current?.(value);
    resolve.current = null;
    setPending(null);
    trigger.current?.focus();
  }
  useEffect(() => {
    if (pending && !dialog.current?.open) dialog.current?.showModal();
  }, [pending]);
  useEffect(() => () => resolve.current?.(false), []);
  const ru = pending?.locale === "ru";
  return (
    <Context.Provider value={ask}>
      {children}
      <dialog
        ref={dialog}
        className="confirm-dialog"
        aria-labelledby="confirmation-title"
        aria-describedby="confirmation-description"
        onCancel={(event) => {
          event.preventDefault();
          finish(false);
        }}
      >
        {pending && (
          <>
            <button
              className="icon-button dialog-close"
              aria-label={ru ? "Закрыть" : "Жабу"}
              onClick={() => finish(false)}
            >
              <X size={18} />
            </button>
            <span
              className={`dialog-symbol ${pending.destructive ? "danger" : ""}`}
            >
              <CircleAlert size={24} />
            </span>
            <h2 id="confirmation-title">
              {pending.destructive
                ? ru
                  ? "Подтвердите удаление"
                  : "Жоюды растаңыз"
                : ru
                  ? "Продолжить действие?"
                  : "Әрекетті жалғастыру керек пе?"}
            </h2>
            <p id="confirmation-description">{pending.message}</p>
            <div className="dialog-actions">
              <button
                autoFocus
                className="button secondary"
                onClick={() => finish(false)}
              >
                {ru ? "Отмена" : "Бас тарту"}
              </button>
              <button
                className={`button ${pending.destructive ? "destructive" : "primary"}`}
                onClick={() => finish(true)}
              >
                {pending.destructive
                  ? ru
                    ? "Удалить"
                    : "Жою"
                  : ru
                    ? "Продолжить"
                    : "Жалғастыру"}
              </button>
            </div>
          </>
        )}
      </dialog>
    </Context.Provider>
  );
}
