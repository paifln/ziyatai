import { betterAuth } from "better-auth";
import { emailOTP } from "better-auth/plugins";
import { z } from "zod";
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
    user: {
      additionalFields: {
        teachingSubject: {
          type: "string",
          required: false,
          defaultValue: "",
          validator: { input: z.string().trim().max(120) },
        },
      },
    },
    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: "hashed",
        overrideDefaultEmailVerification: true,
        disableSignUp: true,
        rateLimit: { window: 60, max: 3 },
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== "email-verification")
            throw new Error("Only email verification codes are enabled");
          await mail.sendMail({
            from: e.SMTP_FROM,
            to: email,
            subject: "ZiyatAI — код подтверждения / растау коды",
            text: `ZiyatAI\n\nКод подтверждения / Растау коды: ${otp}\n\nКод действует 10 минут. Ешкімге бермеңіз / Никому не сообщайте код.\nЕсли вы не регистрировались, проигнорируйте письмо.`,
          });
        },
      }),
    ],
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
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
    },
    advanced: {
      ...(e.API_GATEWAY === "netlify"
        ? { ipAddress: { ipAddressHeaders: ["x-ziyatai-client-ip"] } }
        : {}),
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
