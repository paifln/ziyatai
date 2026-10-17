"use client";
import { useEffect, useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { authClient } from "../../lib/client";
import { useAccountClient } from "../../lib/account-client";
import { messages, kazakhMessages } from "../../../../packages/domain/errors";
import type { UiLocale } from "../../lib/i18n";
import { Form } from "../ui/Form";

export function PasswordChangeForm({
  locale,
  onDirtyChange,
  busy,
  disabled,
  onBusyChange,
}: {
  locale: UiLocale;
  onDirtyChange: (dirty: boolean) => void;
  busy: boolean;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const { auth: accountAuth } = useAccountClient();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const ru = locale === "ru";
  const [values, setValues] = useState({ current: "", next: "", repeat: "" });
  const [visible, setVisible] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [feedback, setFeedback] = useState<{
    error: boolean;
    text: string;
  } | null>(null);
  const repeat = useRef<HTMLInputElement>(null);
  const dirty = !!(values.current || values.next || values.repeat);
  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);
  function update(key: keyof typeof values, value: string) {
    setValues((old) => ({ ...old, [key]: value }));
    setFeedback(null);
    setMismatch(false);
  }
  const uncertain = ru
    ? "Не удалось подтвердить смену. Проверьте соединение; при следующем входе может понадобиться новый пароль."
    : "Құпиясөздің ауысуы расталмады. Байланысты тексеріңіз; келесі кіруде жаңа құпиясөз қажет болуы мүмкін.";
  return (
    <div className="mt-20">
      <h3>{ru ? "Сменить пароль" : "Құпиясөзді ауыстыру"}</h3>
      <p className="muted">
        {ru
          ? "Нужен текущий пароль. После смены на других устройствах потребуется войти заново."
          : "Қазіргі құпиясөз қажет. Ауыстырғаннан кейін басқа құрылғыларда қайта кіру керек."}
      </p>
      <Form
        locale={locale}
        onSubmit={async (event) => {
          event.preventDefault();
          if (disabled) return;
          if (values.next !== values.repeat) {
            setMismatch(true);
            setFeedback({
              error: true,
              text: ru
                ? "Новые пароли не совпадают."
                : "Жаңа құпиясөздер сәйкес емес.",
            });
            repeat.current?.focus();
            return;
          }
          onBusyChange(true);
          setFeedback(null);
          try {
            const response = await accountAuth.changePassword({
              currentPassword: values.current,
              newPassword: values.next,
              revokeOtherSessions: true,
            });
            if (!active.current) return;
            if (response.error) {
              const code = response.error.code;
              setFeedback({
                error: true,
                text:
                  code === "SESSION_CHANGED"
                    ? (ru ? messages : kazakhMessages).SESSION_CHANGED
                    : code === "INVALID_PASSWORD"
                      ? ru
                        ? "Текущий пароль указан неверно."
                        : "Қазіргі құпиясөз дұрыс емес."
                      : response.error.status === 429
                        ? ru
                          ? "Слишком много попыток. Подождите минуту."
                          : "Әрекет тым көп. Бір минут күтіңіз."
                        : response.error.status === 401 ||
                            code === "SESSION_NOT_FRESH"
                          ? ru
                            ? "Войдите в аккаунт заново и повторите смену пароля."
                            : "Аккаунтқа қайта кіріп, құпиясөзді ауыстырыңыз."
                          : !response.error.status ||
                              response.error.status >= 500
                            ? uncertain
                            : ru
                              ? "Не удалось изменить пароль. Проверьте введённые данные."
                              : "Құпиясөз ауыстырылмады. Енгізілген деректерді тексеріңіз.",
              });
              return;
            }
            setValues({ current: "", next: "", repeat: "" });
            setVisible(false);
            setFeedback({
              error: false,
              text: ru
                ? "Пароль изменён. Другие сеансы завершены."
                : "Құпиясөз ауыстырылды. Басқа сеанстар аяқталды.",
            });
            void authClient.getSession().catch(() => undefined);
          } catch {
            if (active.current) setFeedback({ error: true, text: uncertain });
          } finally {
            if (active.current) onBusyChange(false);
          }
        }}
      >
        <fieldset className="editor-fields" disabled={disabled}>
          <legend className="sr-only">
            {ru ? "Смена пароля" : "Құпиясөзді ауыстыру"}
          </legend>
          <div className="form-grid">
            <label className="span-2">
              {ru ? "Текущий пароль" : "Қазіргі құпиясөз"}
              <input
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                required
                maxLength={128}
                spellCheck={false}
                value={values.current}
                onChange={(event) => update("current", event.target.value)}
              />
            </label>
            <label>
              {ru ? "Новый пароль" : "Жаңа құпиясөз"}
              <input
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                spellCheck={false}
                value={values.next}
                onChange={(event) => update("next", event.target.value)}
              />
            </label>
            <label>
              {ru ? "Повторите новый пароль" : "Жаңа құпиясөзді қайталаңыз"}
              <input
                ref={repeat}
                type={visible ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
                spellCheck={false}
                aria-invalid={mismatch || undefined}
                value={values.repeat}
                onChange={(event) => update("repeat", event.target.value)}
              />
            </label>
          </div>
          <p className="muted">
            {ru
              ? "От 12 до 128 символов. Можно использовать длинную фразу."
              : "12–128 таңба. Ұзын сөз тіркесін қолдануға болады."}
          </p>
          <div className="actions">
            <button
              type="button"
              className="button secondary"
              aria-pressed={visible}
              onClick={() => setVisible((old) => !old)}
            >
              {visible
                ? ru
                  ? "Скрыть пароли"
                  : "Құпиясөздерді жасыру"
                : ru
                  ? "Показать пароли"
                  : "Құпиясөздерді көрсету"}
            </button>
            <button className="button" type="submit" aria-busy={busy}>
              <LockKeyhole size={16} />
              {busy
                ? ru
                  ? "Меняем пароль…"
                  : "Құпиясөз ауыстырылуда…"
                : ru
                  ? "Изменить пароль"
                  : "Құпиясөзді өзгерту"}
            </button>
          </div>
        </fieldset>
        {feedback && (
          <p
            className={`notice ${feedback.error ? "error" : "success"}`}
            role={feedback.error ? "alert" : "status"}
          >
            {feedback.text}
          </p>
        )}
      </Form>
    </div>
  );
}
