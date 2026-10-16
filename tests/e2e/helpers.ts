import { expect, type APIRequestContext } from "@playwright/test";
import { randomBytes } from "node:crypto";
export const origin = "http://localhost:3000";
export const headers = { Origin: origin };
export async function approveGeneration(
  request: APIRequestContext,
  id: string,
  revision: number,
) {
  const response = await request.post(`/api/generations/${id}/approve`, {
    headers,
    data: { revision, teacherReviewed: true },
  });
  expect(response.ok(), await response.text()).toBe(true);
}
async function authRequest<T extends { status: () => number }>(
  send: () => Promise<T>,
): Promise<T> {
  let response = await send();
  if (response.status() === 429)
    await expect
      .poll(
        async () => {
          response = await send();
          return response.status();
        },
        { timeout: 70000, intervals: [2000, 3000, 5000] },
      )
      .not.toBe(429);
  return response;
}
export async function emailLink(
  request: APIRequestContext,
  email: string,
  subject?: string,
) {
  let link = "";
  await expect
    .poll(
      async () => {
        const data = await (
          await request.get("http://127.0.0.1:8025/api/v1/messages")
        ).json();
        const msg = data.messages?.find(
          (m: any) =>
            (!subject || m.Subject.includes(subject)) &&
            m.To.some((to: any) => to.Address === email),
        );
        if (!msg) return false;
        const detail = await (
          await request.get(`http://127.0.0.1:8025/api/v1/message/${msg.ID}`)
        ).json();
        link = detail.Text.match(/https?:\/\/[^\s]+/)?.[0] ?? "";
        return !!link;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  return link;
}
export async function verifiedUser(
  request: APIRequestContext,
  name = "Synthetic Teacher",
) {
  const email = `teacher-${randomBytes(5).toString("hex")}@example.test`,
    password = randomBytes(16).toString("hex");
  const signup = await authRequest(() =>
    request.post("/api/auth/sign-up/email", {
      headers,
      data: { email, password, name, callbackURL: "/" },
    }),
  );
  expect(signup.ok(), await signup.text()).toBeTruthy();
  const otp = await emailCode(request, email);
  const verified = await authRequest(() =>
    request.post("/api/auth/email-otp/verify-email", {
      headers,
      data: { email, otp },
    }),
  );
  expect(verified.ok(), await verified.text()).toBeTruthy();
  const login = await authRequest(() =>
    request.post("/api/auth/sign-in/email", {
      headers,
      data: { email, password },
    }),
  );
  expect(login.ok(), await login.text()).toBeTruthy();
  return { email, password };
}
export async function emailCode(request: APIRequestContext, email: string) {
  let otp = "";
  await expect
    .poll(
      async () => {
        const data = await (
          await request.get("http://127.0.0.1:8025/api/v1/messages")
        ).json();
        const message = data.messages?.find((m: any) =>
          m.To.some((to: any) => to.Address === email),
        );
        if (!message) return false;
        const detail = await (
          await request.get(
            `http://127.0.0.1:8025/api/v1/message/${message.ID}`,
          )
        ).json();
        otp = detail.Text.match(/\b\d{6}\b/)?.[0] ?? "";
        return !!otp;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  return otp;
}
export async function jobDone(request: APIRequestContext, id: string) {
  let job: any;
  await expect
    .poll(
      async () => {
        job = await (await request.get(`/api/jobs/${id}`)).json();
        return job.status;
      },
      { timeout: 90000, intervals: [500, 1000, 2000] },
    )
    .toBe("succeeded");
  return job;
}
