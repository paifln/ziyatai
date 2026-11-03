"use client";
import { useState, useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { ThemeToggle } from "./ui/ThemeToggle";
import { Form } from "./ui/Form";
import { PasswordField } from "./ui/PasswordField";
import { LessonPreview } from "./auth/LessonPreview";
import { subjects } from "../../../packages/domain/subjects";
import { api, authClient } from "../lib/client";
import type { Texts, UiLocale } from "../lib/i18n";
import { authFailureMessage, authHelpLabel } from "../lib/auth-feedback";
import {
  readWorkspaceLocation,
  workspaceHref,
} from "../../../packages/domain/workspace-location";
import { siteCopy } from "../../../packages/domain/site-copy";

type AuthPanelProps = {
  t: Texts;
  locale: UiLocale;
  setLocale: (locale: UiLocale) => void;
  initialMode?: "login" | "signup";
};
export default function AuthPanel({
  t,
  locale,
  setLocale,
  initialMode,
}: AuthPanelProps) {
  const [mode, setMode] = useState<"login" | "signup" | "reset" | "new">(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("auth") === "recovery"
      ? "new"
      : (initialMode ?? "login"),
  );
  const [email, setEmail] = useState("");
  useEffect(() => {
    document.title = siteCopy[locale][mode === "signup" ? "signup" : "login"];
  }, [locale, mode]);
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [customSubject, setCustomSubject] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [passwordResetAvailable, setPasswordResetAvailable] = useState(false);
  const [supportEmail, setSupportEmail] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    void api("public-config", "GET", undefined, undefined, controller.signal)
      .then((config) => {
        if (!controller.signal.aborted) {
          setPasswordResetAvailable(config.passwordResetAvailable === true);
          setSupportEmail(
            typeof config.supportEmail === "string" ? config.supportEmail : "",
          );
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result =
        mode === "signup"
          ? await authClient.signUp.email({
              email,
              password,
              name,
              teachingSubject:
                subject === "other" ? customSubject.trim() : subject,
            })
          : mode === "reset"
            ? await authClient.requestPasswordReset({ email })
            : mode === "new"
              ? await authClient.resetPassword({ newPassword: password })
              : await authClient.signIn.email({ email, password });
      if (result.error) {
        setError(authFailureMessage(result.error, locale));
      } else if (mode === "reset") setMessage(t.resetSent);
      else
        window.location.assign(
          workspaceHref(readWorkspaceLocation(window.location.search)),
        );
    } catch {
      setError(authFailureMessage({ code: "AUTH_UNAVAILABLE" }, locale));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  return (
    <main
      className={`auth-page${mode === "signup" ? " auth-page--signup" : ""}`}
    >
      <div className="auth-theme">
        <ThemeToggle locale={locale} />
      </div>
      <section className="auth-story">
        <a className="brand" href="/">
          <span>
            Ziyat<span className="brand-ai">AI</span>
          </span>
        </a>
        <div className="auth-story-content">
          <span className="auth-kicker">
            ZiyatAI /{" "}
            {locale === "ru"
              ? "Для учителей Казахстана"
              : "Қазақстан мұғалімдеріне"}
          </span>
          <h1>
            {locale === "ru" ? (
              <>
                Материалы
                <br />
                для ваших уроков.
              </>
            ) : (
              <>
                Сабаққа арналған
                <br />
                материалдар.
              </>
            )}
          </h1>
          <p>
            {locale === "ru"
              ? "От учебного плана к заданиям для вашего класса. Просто, спокойно, по вашему предмету."
              : "Оқу жоспарынан сыныпқа арналған тапсырмаларға дейін. Қарапайым, ыңғайлы, өз пәніңіз бойынша."}
          </p>
          {mode !== "signup" && <LessonPreview locale={locale} />}
        </div>
        <p className="auth-foot">{t.policy}</p>
      </section>
      <section className="auth-form-area">
        <div className="language-switch auth-language">
          <button
            className={locale === "kk" ? "active" : ""}
            onClick={() => setLocale("kk")}
          >
            ҚАЗ
          </button>
          <button
            className={locale === "ru" ? "active" : ""}
            onClick={() => setLocale("ru")}
          >
            РУС
          </button>
        </div>
        <div className="auth-form-card">
          <span className="small-label">ZiyatAI</span>
          <h2>
            {mode === "signup"
              ? t.signUp
              : mode === "reset"
                ? t.reset
                : mode === "new"
                  ? t.resetNew
                  : t.signIn}
          </h2>
          <p className="auth-caption">
            {locale === "ru"
              ? "Ваши планы, задания и готовые материалы — в одном месте."
              : "Жоспарлар, тапсырмалар және дайын материалдар — бір жерде."}
          </p>
          <Form key={mode} locale={locale} onSubmit={submit}>
            <fieldset className="editor-fields auth-fields" disabled={busy}>
              <legend className="sr-only">
                {mode === "signup" ? t.signUp : t.signIn}
              </legend>
              {mode === "signup" && (
                <label>
                  {t.name}
                  <input
                    value={name}
                    autoComplete="name"
                    required
                    maxLength={100}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
              )}
              {mode === "signup" && (
                <>
                  <label>
                    {locale === "ru" ? "Ваш предмет" : "Сіздің пәніңіз"}
                    <select
                      aria-label={
                        locale === "ru" ? "Ваш предмет" : "Сіздің пәніңіз"
                      }
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      required
                    >
                      <option value="">
                        {locale === "ru"
                          ? "Выберите предмет"
                          : "Пәнді таңдаңыз"}
                      </option>
                      {subjects.map(([id, kk, ru]) => (
                        <option key={id} value={id}>
                          {locale === "ru" ? ru : kk}
                        </option>
                      ))}
                    </select>
                  </label>
                  {subject === "other" && (
                    <label>
                      {locale === "ru" ? "Название предмета" : "Пән атауы"}
                      <input
                        required
                        maxLength={120}
                        value={customSubject}
                        onChange={(e) => setCustomSubject(e.target.value)}
                      />
                    </label>
                  )}
                </>
              )}
              {mode !== "new" && (
                <label>
                  {t.email}
                  <input
                    type="email"
                    inputMode="email"
                    spellCheck={false}
                    value={email}
                    placeholder="name@school.kz"
                    autoComplete="email"
                    required
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </label>
              )}
              {mode !== "reset" && (
                <PasswordField
                  label={t.password}
                  locale={locale}
                  aria-label={t.password}
                  value={password}
                  required
                  minLength={mode === "login" ? 1 : 12}
                  maxLength={128}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  hint={mode === "login" ? undefined : t.passwordHint}
                  onChange={(e) => setPassword(e.target.value)}
                />
              )}
              {mode === "login" && passwordResetAvailable && (
                <button
                  className="text-button forgot"
                  type="button"
                  onClick={() => {
                    setMode("reset");
                    setMessage("");
                    setError("");
                  }}
                >
                  {t.forgot}
                </button>
              )}
              {mode === "signup" && (
                <label className="checkbox consent">
                  <input type="checkbox" required />
                  <span>
                    {locale === "ru" ? "Я принимаю" : "Мен қабылдаймын:"}{" "}
                    <a href="/terms/" target="_blank" rel="noreferrer">
                      {locale === "ru"
                        ? "условия использования"
                        : "пайдалану шарттарын"}
                    </a>{" "}
                    {locale === "ru" ? "и ознакомился с" : "және таныстым:"}{" "}
                    <a href="/privacy/" target="_blank" rel="noreferrer">
                      {locale === "ru"
                        ? "политикой конфиденциальности"
                        : "құпиялық саясатымен"}
                    </a>
                    .
                  </span>
                </label>
              )}
              {error && (
                <div className="notice error" role="alert">
                  {error}
                </div>
              )}
              {message && (
                <div className="notice success" role="status">
                  {message}
                </div>
              )}
              <button
                className="button primary wide"
                disabled={busy}
                aria-busy={busy}
              >
                {busy
                  ? t.loading
                  : mode === "signup"
                    ? t.signUp
                    : mode === "reset"
                      ? t.reset
                      : mode === "new"
                        ? t.save
                        : t.signIn}
                <ArrowRight size={17} />
              </button>
            </fieldset>
          </Form>
          <p className="auth-toggle">
            {mode === "login" ? t.noAccount : t.haveAccount}{" "}
            <button
              className="text-button"
              disabled={busy}
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setMessage("");
                setError("");
              }}
            >
              {mode === "login" ? t.signUp : t.signIn}
            </button>
          </p>
          <p className="auth-support">
            <a
              href={
                supportEmail
                  ? `mailto:${supportEmail}`
                  : "/help/#account-access"
              }
            >
              {authHelpLabel(locale)}
            </a>
            <a href="/privacy/">
              {locale === "ru" ? "Конфиденциальность" : "Құпиялық"}
            </a>
            <a href="/terms/">
              {locale === "ru" ? "Условия использования" : "Пайдалану шарттары"}
            </a>
            <a href="/lite/">
              {locale === "ru"
                ? "Слабый компьютер? Открыть лёгкую версию"
                : "Компьютер баяу ма? Жеңіл нұсқаны ашу"}
            </a>
            <a href="/help/">
              {locale === "ru"
                ? "Как пользоваться ZiyatAI"
                : "ZiyatAI қалай қолданылады"}
            </a>
          </p>
        </div>
      </section>
    </main>
  );
}
