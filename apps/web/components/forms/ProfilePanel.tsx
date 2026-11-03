"use client";
import { Styles } from "../../../../packages/contracts";
import type { AccountProfile } from "../../../../packages/contracts/workspace";
import { useState, useRef, useEffect } from "react";
import { Check } from "lucide-react";
import { useAccountClient } from "../../lib/account-client";
import type { Texts, UiLocale } from "../../lib/i18n";
import { subjects } from "../../../../packages/domain/subjects";
import { Form } from "../ui/Form";
import { useConfirm } from "../ui/ConfirmProvider";
import { useUnsavedChanges } from "../../lib/use-unsaved-changes";
import { AccountSecurity } from "./AccountSecurity";
export function ProfilePanel({
  t,
  locale,
  profile,
  onError,
  onSaved,
  setLocale,
  onDirtyChange,
}: {
  t: Texts;
  locale: UiLocale;
  profile: AccountProfile;
  onError: (s: string) => void;
  onSaved: () => void;
  setLocale: (l: UiLocale) => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { api, auth: accountAuth } = useAccountClient();
  const confirm = useConfirm();
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const [form, setForm] = useState({
      ...profile,
      styles: Styles.parse(profile.styles),
    }),
    [busy, setBusy] = useState(false);
  const baseline = useRef(JSON.stringify(form));
  const [savedForm, setSavedForm] = useState(baseline.current);
  const dirty = JSON.stringify(form) !== savedForm;
  const [securityDirty, setSecurityDirty] = useState(false);
  useUnsavedChanges(dirty || securityDirty, onDirtyChange);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t.profile}</h1>
        </div>
      </div>
      <section className="card profile-card">
        <Form
          locale={locale}
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await api("profile", "PATCH", form);
              if (!active.current) return;
              setSavedForm(JSON.stringify(form));
              setLocale(form.locale);
              onSaved();
            } catch (e) {
              if (active.current) onError((e as Error).message);
            } finally {
              if (active.current) setBusy(false);
            }
          }}
        >
          <fieldset className="editor-fields" disabled={busy}>
            <legend className="sr-only">{t.profile}</legend>
            <div className="form-grid">
              <h2 className="span-2 form-section-title">
                {locale === "ru" ? "О вас" : "Өзіңіз туралы"}
              </h2>
              <label>
                {t.name}
                <input
                  required
                  maxLength={100}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </label>
              <label>
                {t.email}
                <input value={form.email} disabled />
              </label>
              <label>
                {locale === "ru" ? "Ваш предмет" : "Сіздің пәніңіз"}
                <select
                  aria-label={
                    locale === "ru" ? "Ваш предмет" : "Сіздің пәніңіз"
                  }
                  value={
                    subjects.some((s) => s[0] === form.teachingSubject)
                      ? form.teachingSubject
                      : "other"
                  }
                  onChange={(e) =>
                    setForm({ ...form, teachingSubject: e.target.value })
                  }
                >
                  <option value="">—</option>
                  {subjects.map(([id, kk, ru]) => (
                    <option key={id} value={id}>
                      {locale === "ru" ? ru : kk}
                    </option>
                  ))}
                </select>
                {!subjects.some(
                  (s) => s[0] === form.teachingSubject && s[0] !== "other",
                ) && (
                  <input
                    aria-label={
                      locale === "ru" ? "Название предмета" : "Пән атауы"
                    }
                    maxLength={120}
                    value={
                      form.teachingSubject === "other"
                        ? ""
                        : form.teachingSubject || ""
                    }
                    onChange={(e) =>
                      setForm({ ...form, teachingSubject: e.target.value })
                    }
                  />
                )}
              </label>
              <label>
                {t.school}
                <input
                  maxLength={200}
                  value={form.school}
                  onChange={(e) => setForm({ ...form, school: e.target.value })}
                />
              </label>
              <label>
                {t.language}
                <select
                  value={form.locale}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      locale: e.target.value === "ru" ? "ru" : "kk",
                    })
                  }
                >
                  <option value="kk">Қазақша</option>
                  <option value="ru">Русский</option>
                </select>
              </label>
              <label className="span-2">
                {t.preferredGrades}
                <span className="chip-grid">
                  {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => (
                    <button
                      type="button"
                      key={n}
                      className={`grade-chip ${form.grades.includes(n) ? "active" : ""}`}
                      aria-pressed={form.grades.includes(n)}
                      onClick={() =>
                        setForm({
                          ...form,
                          grades: form.grades.includes(n)
                            ? form.grades.filter((g: number) => g !== n)
                            : [...form.grades, n],
                        })
                      }
                    >
                      {n}
                    </button>
                  ))}
                </span>
              </label>
              <label>
                {t.font}
                <select
                  value={form.styles.font}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      styles: {
                        ...form.styles,
                        font: Styles.shape.font.parse(e.target.value),
                      },
                    })
                  }
                >
                  {[
                    "Times New Roman",
                    "Arial",
                    "Calibri",
                    "Liberation Serif",
                    "Liberation Sans",
                    "Carlito",
                  ].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label>
                {t.fontSize}
                <input
                  type="number"
                  min={10}
                  max={18}
                  value={form.styles.size}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      styles: { ...form.styles, size: Number(e.target.value) },
                    })
                  }
                />
              </label>
            </div>
            <button className="button primary mt-20" disabled={busy}>
              <Check size={16} />
              {busy ? t.loading : t.save}
            </button>
          </fieldset>
        </Form>
        <div className="notice mt-20">{t.privacy}</div>
        <details className="mt-20">
          <summary className="danger">
            {locale === "ru" ? "Удаление аккаунта" : "Аккаунтты жою"}
          </summary>
          <p className="mt-20">
            {locale === "ru"
              ? "Все КТП, задания и документы станут недоступны сразу. Файлы будут удалены фоновой операцией. Копии в резервных архивах истекают через 30 дней."
              : "Барлық КТЖ, тапсырмалар және құжаттар бірден қолжетімсіз болады. Файлдар фондық операция арқылы жойылады. Резервтік көшірмелер 30 күннен кейін жойылады."}
          </p>
          <button
            className="button danger"
            onClick={async () => {
              if (
                !(await confirm(
                  locale === "ru"
                    ? "Удалить аккаунт и все ваши материалы? Восстановить их через интерфейс не получится."
                    : "Аккаунт пен барлық материалдарыңызды жою керек пе? Оларды интерфейс арқылы қалпына келтіру мүмкін болмайды.",
                  { destructive: true },
                ))
              )
                return;
              if (!active.current) return;
              try {
                await api("account", "DELETE");
                if (!active.current) return;
                try {
                  await accountAuth.signOut();
                } catch {
                  // Deletion already revoked the session; reload confirms its state.
                }
                if (active.current) window.location.reload();
              } catch (e) {
                if (active.current) onError((e as Error).message);
              }
            }}
          >
            {t.remove}
          </button>
        </details>
      </section>
      <AccountSecurity locale={locale} onDirtyChange={setSecurityDirty} />
    </>
  );
}
