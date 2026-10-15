"use client";
import { useState } from "react";
import { ArrowRight, Check, BookOpen, Layers, FileCheck } from "lucide-react";
import { authClient } from "../lib/client";
import type { Texts, UiLocale } from "../lib/i18n";
export default function AuthPanel({
  t,
  locale,
  setLocale,
}: {
  t: Texts;
  locale: UiLocale;
  setLocale: (l: UiLocale) => void;
}) {
  const [mode, setMode] = useState<"login" | "signup" | "reset" | "new">(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("token")
      ? "new"
      : "login",
  );
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      let result;
      if (mode === "signup") {
        result = await authClient.signUp.email({
          email,
          password,
          name,
          callbackURL: "/",
        });
        if (!result.error) setMessage(t.verifySent);
      } else if (mode === "reset") {
        result = await authClient.requestPasswordReset({
          email,
          redirectTo: window.location.origin + "/",
        });
        if (!result.error) setMessage(t.resetSent);
      } else if (mode === "new") {
        result = await authClient.resetPassword({
          newPassword: password,
          token: new URLSearchParams(window.location.search).get("token") ?? "",
        });
        if (!result.error) {
          setMessage(t.passwordChanged);
          setMode("login");
        }
      } else {
        result = await authClient.signIn.email({ email, password });
        if (!result.error) window.location.assign("/");
      }
      if (result.error)
        setError(
          result.error.code === "EMAIL_NOT_VERIFIED"
            ? t.verifySent
            : locale === "ru"
              ? "Не удалось выполнить действие. Проверьте введённые данные."
              : "Әрекет орындалмады. Енгізілген деректерді тексеріңіз.",
        );
    } catch {
      setError(
        locale === "ru"
          ? "Сервис недоступен. Попробуйте позже."
          : "Сервис қолжетімсіз. Кейінірек қайталаңыз.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <a className="brand" href="/">
          <img src="/brand-owl.png" alt="" width="46" height="46" />
          <span>
            Ziyat<span className="brand-ai">AI</span>
          </span>
        </a>
        <div className="auth-story-content">
          <span className="eyebrow">
            {locale === "ru"
              ? "ДЛЯ УЧИТЕЛЕЙ ИНФОРМАТИКИ"
              : "ИНФОРМАТИКА МҰҒАЛІМДЕРІНЕ"}
          </span>
          <h1>{t.authTitle}</h1>
          <p>{t.authSubtitle}</p>
          <div className="auth-features">
            {[
              [BookOpen, t.authFeature1],
              [Layers, t.authFeature2],
              [FileCheck, t.authFeature3],
            ].map(([Icon, label], i) => {
              const I = Icon as typeof BookOpen;
              return (
                <div key={i}>
                  <I size={21} />
                  <span>{label as string}</span>
                </div>
              );
            })}
          </div>
          <div className="paper-illustration" aria-hidden="true">
            <div className="paper-top">
              <span>ZiyatAI</span>
              <span>7 {t.grade.toLowerCase()}</span>
            </div>
            <div className="paper-title">
              {locale === "ru" ? "Линейные алгоритмы" : "Сызықтық алгоритмдер"}
            </div>
            {(locale === "ru" ? ["Базовый", "Средний", "Продвинутый"] : ["Жеңіл", "Орта", "Күрделі"]).map((level, i) => (
              <div className="paper-level" key={level}>
                <span className={`level-dot dot-${i}`} />
                {level}
                <div className="paper-lines">
                  <i />
                  <i />
                </div>
                <Check size={16} />
              </div>
            ))}
          </div>
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
            {locale === "ru" ? "Ваши планы, задания и готовые материалы — в одном месте." : "Жоспарларыңыз, тапсырмалар мен дайын материалдар — бір жерде."}
          </p>
          <form onSubmit={submit}>
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
            {mode !== "new" && (
              <label>
                {t.email}
                <input
                  type="email"
                  inputMode="email"
                  spellCheck={false}
                  value={email}
                  autoComplete="email"
                  required
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            )}
            {mode !== "reset" && (
              <label>
                {t.password}
                <input
                  type="password"
                  value={password}
                  required
                  minLength={mode === "login" ? 1 : 12}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  onChange={(e) => setPassword(e.target.value)}
                />
                {mode !== "login" && <small>{t.passwordHint}</small>}
              </label>
            )}
            {mode === "login" && (
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
            <button className="button primary wide" disabled={busy}>
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
          </form>
          <p className="auth-toggle">
            {mode === "login" ? t.noAccount : t.haveAccount}{" "}
            <button
              className="text-button"
              onClick={() => {
                setMode(mode === "login" ? "signup" : "login");
                setMessage("");
                setError("");
              }}
            >
              {mode === "login" ? t.signUp : t.signIn}
            </button>
          </p>
          <p className="auth-support"><a href="/lite/">{locale === "ru" ? "Слабый компьютер? Открыть лёгкую версию" : "Компьютер баяу ма? Жеңіл нұсқаны ашу"}</a><br/><a href="/help/">{locale === "ru" ? "Как пользоваться ZiyatAI" : "ZiyatAI қалай қолданылады"}</a></p>
        </div>
      </section>
    </main>
  );
}
