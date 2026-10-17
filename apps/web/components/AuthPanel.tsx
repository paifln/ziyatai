"use client";
import { useState, useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { ThemeToggle } from "./ui/ThemeToggle";
import { Form } from "./ui/Form";
import { PasswordField } from "./ui/PasswordField";
import { LessonPreview } from "./auth/LessonPreview";
import { subjects } from "../../../packages/domain/subjects";
import { api, authClient } from "../lib/client";
import type { Texts, UiLocale } from "../lib/i18n";
export default function AuthPanel({
  t,
  locale,
  setLocale,
  initialMode,
}: {
  t: Texts;
  locale: UiLocale;
  setLocale: (l: UiLocale) => void;
  initialMode?: "login" | "signup";
}) {
  const [mode, setMode] = useState<
    "login" | "signup" | "reset" | "new" | "verify"
  >(() =>
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).has("token")
      ? "new"
      : (initialMode ?? "login"),
  );
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const [subject, setSubject] = useState("");
  const [socialProviders, setSocialProviders] = useState({
    google: false,
    apple: false,
  });
  const [customSubject, setCustomSubject] = useState("");
  const [otp, setOtp] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const [localMailbox, setLocalMailbox] = useState(false);
  const [passwordResetAvailable, setPasswordResetAvailable] = useState(false);
  const [emailVerificationRequired, setEmailVerificationRequired] =
    useState(true);
  useEffect(() => {
    let active = true;
    void api("public-config")
      .then((config) => {
        if (active) {
          setSocialProviders({
            google: config.socialProviders?.google === true,
            apple: config.socialProviders?.apple === true,
          });
          if (new URLSearchParams(window.location.search).has("oauthError"))
            setError(
              locale === "ru"
                ? "Вход не завершён. Попробуйте снова или войдите по почте. Если аккаунт уже существует, используйте прежний способ входа."
                : "Кіру аяқталмады. Қайталап көріңіз немесе бұрынғы кіру тәсілін қолданыңыз.",
            );
          setLocalMailbox(
            config.localMailbox === true &&
              ["localhost", "127.0.0.1", "[::1]"].includes(
                window.location.hostname,
              ),
          );
          setPasswordResetAvailable(config.passwordResetAvailable === true);
          setEmailVerificationRequired(
            config.emailVerificationRequired !== false,
          );
        }
      })
      .catch(() => {
        /* Optional demo hint must not block sign-in. */
      });
    return () => {
      active = false;
    };
  }, [locale]);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function resend() {
    setBusy(true);
    setError("");
    try {
      const result = await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
      if (result.error) throw new Error();
      setCooldown(60);
      setMessage(
        locale === "ru"
          ? "Новый код отправлен. Используйте последнее письмо."
          : "Жаңа код жіберілді. Соңғы хаттағы кодты енгізіңіз.",
      );
    } catch {
      setError(
        locale === "ru"
          ? "Не удалось отправить код. Повторите позже."
          : "Код жіберілмеді. Кейінірек қайталаңыз.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function socialSignIn(provider: "google" | "apple") {
    setError("");
    if (!socialProviders[provider]) {
      setError(
        locale === "ru"
          ? `Вход через ${provider === "google" ? "Google" : "Apple"} пока не подключён. Войдите по почте.`
          : `${provider === "google" ? "Google" : "Apple"} арқылы кіру әлі қосылмаған. Пошта арқылы кіріңіз.`,
      );
      return;
    }
    setBusy(true);
    try {
      const result = await authClient.signIn.social({
        provider,
        callbackURL: "/",
        errorCallbackURL: "/login?oauthError=1",
      });
      if (result.error) throw new Error();
    } catch {
      setError(
        locale === "ru"
          ? "Не удалось начать вход. Попробуйте ещё раз."
          : "Кіру басталмады. Қайталап көріңіз.",
      );
    } finally {
      setBusy(false);
    }
  }
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
          teachingSubject: subject === "other" ? customSubject.trim() : subject,
          callbackURL: "/",
        });
        if (!result.error) {
          if (result.data?.token) {
            window.location.assign("/");
            return;
          }
          setMode("verify");
          setPassword("");
          setCooldown(60);
        }
      } else if (mode === "verify") {
        result = await authClient.emailOtp.verifyEmail({ email, otp });
        if (!result.error) window.location.assign("/");
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
          window.history.replaceState(null, "", window.location.pathname);
          setPassword("");
          setMessage(t.passwordChanged);
          setMode("login");
        }
      } else {
        result = await authClient.signIn.email({ email, password });
        if (!result.error) window.location.assign("/");
        else if (result.error.code === "EMAIL_NOT_VERIFIED") {
          setMode("verify");
          setPassword("");
          await resend();
          return;
        }
      }
      if (result.error)
        setError(
          result.error.status === 429
            ? t.tooManyAttempts
            : mode === "verify"
              ? locale === "ru"
                ? "Код неверный или истёк. Проверьте последнее письмо или запросите новый."
                : "Код қате немесе мерзімі өткен. Соңғы хатты тексеріңіз немесе жаңа код сұраңыз."
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
      <div className="auth-theme">
        <ThemeToggle locale={locale} />
      </div>
      <section className="auth-story">
        <a className="brand" href="/">
          <img src="/brand-owl.png" alt="" width="46" height="46" />
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
                Больше времени.
                <br />
                Для вашего класса.
              </>
            ) : (
              <>
                Сыныбыңызға
                <br />
                уақыт табыңыз.
              </>
            )}
          </h1>
          <p>
            {locale === "ru"
              ? "От учебного плана к заданиям для вашего класса. Просто, спокойно, по вашему предмету."
              : "Оқу жоспарынан сыныпқа арналған тапсырмаларға дейін. Қарапайым, ыңғайлы, өз пәніңіз бойынша."}
          </p>
          <LessonPreview locale={locale} />
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
            {mode === "verify"
              ? locale === "ru"
                ? "Проверьте почту"
                : "Поштаңызды тексеріңіз"
              : mode === "signup"
                ? t.signUp
                : mode === "reset"
                  ? t.reset
                  : mode === "new"
                    ? t.resetNew
                    : t.signIn}
          </h2>
          <p className="auth-caption">
            {mode === "verify"
              ? locale === "ru"
                ? `Введите 6-значный код из письма на ${email}. Код действует 10 минут.`
                : `${email} поштасына жіберілген 6 таңбалы кодты енгізіңіз. Код 10 минут жарамды.`
              : locale === "ru"
                ? "Ваши планы, задания и готовые материалы — в одном месте."
                : "Жоспарларыңыз, тапсырмалар мен дайын материалдар — бір жерде."}
          </p>
          {localMailbox && ["verify", "reset"].includes(mode) && (
            <p className="mail-preview-note">
              {locale === "ru"
                ? "В локальной демонстрации коды и ссылки попадают в тестовую почту этого ПК, а не во внешний ящик. "
                : "Жергілікті демода кодтар мен сілтемелер сыртқы поштаға емес, осы компьютердің сынақ поштасына түседі. "}
              <a
                href="http://localhost:8025"
                target="_blank"
                rel="noopener noreferrer"
              >
                {locale === "ru"
                  ? "Открыть тестовую почту"
                  : "Сынақ поштасын ашу"}
              </a>
            </p>
          )}
          {(mode === "login" || mode === "signup") && (
            <div
              className="social-auth"
              aria-label={
                locale === "ru"
                  ? "Другие способы входа"
                  : "Басқа кіру тәсілдері"
              }
            >
              {(["google", "apple"] as const).map((provider) => (
                <button
                  key={provider}
                  type="button"
                  disabled={busy}
                  onClick={() => void socialSignIn(provider)}
                >
                  <span aria-hidden="true" className="social-auth-mark">
                    {provider === "google" ? (
                      "G"
                    ) : (
                      <svg
                        viewBox="0 0 24 24"
                        width="20"
                        height="20"
                        fill="currentColor"
                      >
                        <path d="M17.1 12.5c0-2 1.6-3 1.7-3.1-1-1.5-2.5-1.7-3.1-1.7-1.3-.1-2.6.8-3.3.8s-1.7-.8-2.8-.7C8.2 7.8 7 8.5 6.3 9.7c-1.5 2.6-.4 6.5 1 8.6.7 1 1.5 2.1 2.6 2 1-.1 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.7s1.8-1 2.5-2c.8-1.2 1.1-2.4 1.1-2.4s-1.8-.7-1.8-3.4ZM15 6.3c.6-.8 1.1-1.9 1-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.7-1.2Z" />
                      </svg>
                    )}
                  </span>
                  {locale === "ru" ? "Продолжить с " : "Жалғастыру: "}
                  {provider === "google" ? "Google" : "Apple"}
                </button>
              ))}
              <p className="social-auth-divider">
                {locale === "ru"
                  ? "или по электронной почте"
                  : "немесе электрондық пошта арқылы"}
              </p>
            </div>
          )}
          <Form key={mode} locale={locale} onSubmit={submit}>
            <fieldset className="editor-fields auth-fields" disabled={busy}>
              <legend className="sr-only">
                {mode === "signup" ? t.signUp : t.signIn}
              </legend>
              {mode === "signup" && !emailVerificationRequired && (
                <p className="notice">
                  {locale === "ru"
                    ? "Подтверждение почты не требуется. Сохраните пароль для следующего входа."
                    : "Поштаны растау қажет емес. Келесі кіру үшін құпиясөзді сақтаңыз."}
                </p>
              )}
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
              {mode === "verify" && (
                <label>
                  {locale === "ru" ? "Код из письма" : "Хаттағы код"}
                  <input
                    className="otp-input"
                    value={otp}
                    onChange={(e) =>
                      setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))
                    }
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    minLength={6}
                    maxLength={6}
                    required
                    autoFocus
                  />
                </label>
              )}
              {mode !== "new" && mode !== "verify" && (
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
              {mode !== "reset" && mode !== "verify" && (
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
                  : mode === "verify"
                    ? locale === "ru"
                      ? "Подтвердить почту"
                      : "Поштаны растау"
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
          {mode === "verify" && (
            <button
              type="button"
              className="text-button resend-code"
              disabled={busy || cooldown > 0}
              onClick={resend}
            >
              {locale === "ru" ? "Отправить код ещё раз" : "Кодты қайта жіберу"}
              {cooldown > 0 ? ` · ${cooldown} с` : ""}
            </button>
          )}
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
            <a href="/privacy/">
              {locale === "ru" ? "Конфиденциальность" : "Құпиялық"}
            </a>
            {" · "}
            <a href="/terms/">
              {locale === "ru" ? "Условия использования" : "Пайдалану шарттары"}
            </a>
            <br />
            <a href="/lite/">
              {locale === "ru"
                ? "Слабый компьютер? Открыть лёгкую версию"
                : "Компьютер баяу ма? Жеңіл нұсқаны ашу"}
            </a>
            <br />
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
