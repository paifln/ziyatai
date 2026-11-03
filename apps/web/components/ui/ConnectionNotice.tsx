"use client";
import { useSyncExternalStore } from "react";
import type { UiLocale } from "../../lib/i18n";

function subscribe(changed: () => void) {
  window.addEventListener("online", changed);
  window.addEventListener("offline", changed);
  return () => {
    window.removeEventListener("online", changed);
    window.removeEventListener("offline", changed);
  };
}
const onlineSnapshot = () => navigator.onLine;
const serverSnapshot = () => true;

export function ConnectionNotice({ locale }: { locale: UiLocale }) {
  const online = useSyncExternalStore(
    subscribe,
    onlineSnapshot,
    serverSnapshot,
  );
  return (
    <div aria-live="polite" aria-atomic="true">
      {!online && (
        <div className="notice connection-notice">
          {locale === "ru"
            ? "Нет подключения к сети. Не закрывайте вкладку с правками. После восстановления связи повторите сохранение; изменения не отправляются автоматически."
            : "Желіге қосылым жоқ. Өзгерістер бар қойындыны жаппаңыз. Байланыс қалпына келгенде қайта сақтаңыз; өзгерістер автоматты түрде жіберілмейді."}
        </div>
      )}
    </div>
  );
}
