"use client";
import { createAuthClient } from "better-auth/react";
import {
  emailOTPClient,
  inferAdditionalFields,
} from "better-auth/client/plugins";
import { kazakhMessages, messages } from "../../../packages/domain/errors";
import { fetchWithWakeRetry } from "./wake-retry";
import { accountIntentHeader } from "../../../packages/contracts/account-intent";
export const authClient = createAuthClient({
  plugins: [
    emailOTPClient(),
    inferAdditionalFields({
      user: { teachingSubject: { type: "string", required: false } },
    }),
  ],
});
export async function uploadFile(
  file: File,
  direct: boolean,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
  request: typeof api = api,
) {
  if (!direct) {
    const form = new FormData();
    form.append("file", file);
    return request("uploads", "POST", form, undefined, signal);
  }
  const init = await request(
    "uploads/init",
    "POST",
    { name: file.name, bytes: file.size },
    undefined,
    signal,
  );
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const abort = () => xhr.abort();
    signal?.addEventListener("abort", abort, { once: true });
    xhr.onloadend = () => signal?.removeEventListener("abort", abort);
    xhr.onabort = () => reject(new DOMException("Aborted", "AbortError"));
    xhr.open("PUT", init.url);
    xhr.timeout = 300000;
    xhr.setRequestHeader("Content-Type", init.contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    const failed = () =>
      reject(
        new Error(
          document.documentElement.lang === "ru"
            ? "Не удалось загрузить файл в хранилище. Проверьте подключение и повторите."
            : "Файл қоймаға жүктелмеді. Байланысты тексеріп, қайталаңыз.",
        ),
      );
    xhr.onerror = xhr.ontimeout = failed;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else failed();
    };
    xhr.send(file);
  });
  return request(`uploads/${init.id}/complete`, "POST", {}, undefined, signal);
}
export async function api(
  path: string,
  method = "GET",
  data?: unknown,
  idempotencyKey?: string,
  signal?: AbortSignal,
  expectedOwner?: string,
) {
  let response: Response;
  const translated =
    document.documentElement.lang === "kk" ? kazakhMessages : messages;
  try {
    const headers = new Headers(
      data instanceof FormData
        ? undefined
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey ?? crypto.randomUUID(),
          },
    );
    if (expectedOwner !== undefined)
      headers.set(accountIntentHeader, expectedOwner);
    response = await fetchWithWakeRetry(`/api/${path}`, {
      method,
      signal,
      headers,
      body:
        data === undefined
          ? undefined
          : data instanceof FormData
            ? data
            : JSON.stringify(data),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      document.documentElement.lang === "kk"
        ? "Сервермен байланыс үзілді. Өзгерістерді жоғалтпау үшін бетті жаппаңыз және қайта көріңіз."
        : "Нет связи с сервером. Не закрывайте страницу с правками и повторите действие после подключения.",
    );
  }
  let value;
  try {
    value = await response.json();
  } catch {
    throw new Error(
      response.status === 413
        ? translated.FILE_SIZE
        : response.status === 429
          ? translated.LIMIT
          : translated.INTERNAL,
    );
  }
  if (value.error?.code)
    value.error.message = translated[value.error.code] ?? translated.INTERNAL;
  if (!response.ok)
    throw Object.assign(
      new Error(
        (translated[value.code] ?? translated.INTERNAL) +
          (value.code === "READ_LIMIT" &&
          Number.isInteger(value.retryAfter) &&
          value.retryAfter > 0 &&
          value.retryAfter <= 600
            ? document.documentElement.lang === "kk"
              ? ` ${value.retryAfter} секундтан кейін қайталаңыз.`
              : ` Повторите через ${value.retryAfter} с.`
            : ""),
      ),
      {
        code: value.code,
        status: response.status,
        retryAfter: value.retryAfter,
      },
    );
  return value;
}

/** Capture an owner once so delayed callbacks cannot adopt another account. */
export function createAccountClient(
  owner?: string,
  onSessionChanged?: () => void,
) {
  const authHeaders =
    owner === undefined ? undefined : { [accountIntentHeader]: owner };
  const observeNative = async <T extends { error?: { code?: string } | null }>(
    pending: Promise<T>,
  ) => {
    const result = await pending;
    if (result.error?.code === "SESSION_CHANGED") onSessionChanged?.();
    return result;
  };
  const scopedApi = async (
    path: string,
    method = "GET",
    data?: unknown,
    idempotencyKey?: string,
    signal?: AbortSignal,
  ) => {
    try {
      return await api(path, method, data, idempotencyKey, signal, owner);
    } catch (error) {
      if ((error as { code?: string }).code === "SESSION_CHANGED")
        onSessionChanged?.();
      throw error;
    }
  };
  return {
    api: scopedApi,
    auth: {
      signOut: () =>
        observeNative(
          authClient.signOut({ fetchOptions: { headers: authHeaders } }),
        ),
      revokeOtherSessions: () =>
        observeNative(
          authClient.revokeOtherSessions({
            fetchOptions: { headers: authHeaders },
          }),
        ),
      changePassword: (body: {
        currentPassword: string;
        newPassword: string;
        revokeOtherSessions?: boolean;
      }) =>
        observeNative(
          authClient.changePassword({
            ...body,
            fetchOptions: { headers: authHeaders },
          }),
        ),
    },
    uploadFile: (
      file: File,
      direct: boolean,
      onProgress?: (percent: number) => void,
      signal?: AbortSignal,
    ) => uploadFile(file, direct, onProgress, signal, scopedApi),
  };
}
