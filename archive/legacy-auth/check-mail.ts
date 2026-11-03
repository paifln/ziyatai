import nodemailer from "nodemailer";
const port = Number(process.env.SMTP_PORT || 587);
const smtp = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port,
  secure: port === 465,
  requireTLS: process.env.APP_ENV === "production" && port !== 465,
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
    : undefined,
});
try {
  await smtp.verify();
  console.log(
    "SMTP connection and authentication succeeded. No email was sent; inbox delivery still needs a registration test.",
  );
} catch {
  console.error(
    "SMTP connection failed. Check host, port, credentials and verified sender in the mail provider dashboard. Secrets were not printed.",
  );
  process.exitCode = 1;
} finally {
  smtp.close();
}
