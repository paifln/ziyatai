import type { UiLocale } from "./i18n";
const copy = {
  ru: {
    unavailable:
      "Сервис временно недоступен. Данные сохранены в форме. Попробуйте ещё раз позже.",
    credentials: "Не удалось войти. Проверьте email и пароль.",
    account:
      "Этот email уже используется. Войдите с паролем; для аккаунта прежней версии обратитесь в поддержку.",
    limit: "Слишком много попыток. Подождите минуту и повторите.",
    help: "Нужна помощь со входом?",
  },
  kk: {
    unavailable:
      "Сервис уақытша қолжетімсіз. Енгізілген деректер сақталды. Кейінірек қайталаңыз.",
    credentials: "Кіру мүмкін болмады. Email мен құпиясөзді тексеріңіз.",
    account:
      "Бұл email бұрын тіркелген. Құпиясөзбен кіріңіз; бұрынғы аккаунт үшін қолдау қызметіне хабарласыңыз.",
    limit: "Әрекеттер тым көп. Бір минут күтіп, қайталаңыз.",
    help: "Кіруге көмек керек пе?",
  },
};
export function authFailureMessage(
  error: { status?: number; code?: string },
  locale: UiLocale,
) {
  const t = copy[locale];
  if ((error.status ?? 0) >= 500 || error.code === "AUTH_UNAVAILABLE")
    return t.unavailable;
  if (error.status === 429) return t.limit;
  if (
    ["ACCOUNT_EXISTS", "ACCOUNT_MIGRATION_REQUIRED"].includes(error.code ?? "")
  )
    return t.account;
  return t.credentials;
}
export const authHelpLabel = (locale: UiLocale) => copy[locale].help;
