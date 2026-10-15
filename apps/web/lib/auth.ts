import { betterAuth } from "better-auth";
import nodemailer from "nodemailer";
import { db } from "./db";
import { env } from "./env";
let instance: ReturnType<typeof makeAuth> | undefined;
function makeAuth() {
  const e = env();
  const mail = nodemailer.createTransport({
    host: e.SMTP_HOST,
    port: e.SMTP_PORT,
    secure: e.SMTP_PORT === 465,
    requireTLS: e.APP_ENV === "production" && e.SMTP_PORT !== 465,
    auth: e.SMTP_USER
      ? { user: e.SMTP_USER, pass: e.SMTP_PASSWORD }
      : undefined,
  });
  const send = async (to: string, url: string, subject: string) => {
    await mail.sendMail({
      from: e.SMTP_FROM,
      to,
      subject,
      text: `ZiyatAI\n${subject}\n${url}\nЕсли вы не запрашивали это действие, проигнорируйте письмо.`,
    });
  };
  return betterAuth({
    logger: { disabled: true },
    appName: "ZiyatAI",
    baseURL: e.APP_URL,
    secret: e.AUTH_SECRET,
    database: db(),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      sendResetPassword: async ({ user, url }) =>
        send(
          user.email,
          url,
          "Восстановление пароля / Құпиясөзді қалпына келтіру",
        ),
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        send(user.email, url, "Подтверждение email / Email растау"),
    },
    advanced: {
      database: { generateId: "uuid" },
      useSecureCookies: e.APP_URL.startsWith("https://"),
    },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 30 },
    trustedOrigins: [e.APP_URL],
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 },
  });
}

export function auth() {
  return (instance ??= makeAuth());
}
