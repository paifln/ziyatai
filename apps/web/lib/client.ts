"use client";
import { createAuthClient } from "better-auth/react";
import { kazakhMessages, messages } from "../../../packages/domain/errors";
export const authClient = createAuthClient();
export async function uploadFile(file: File, direct: boolean, onProgress?: (percent: number) => void) {
  if (!direct) {
    const form = new FormData(); form.append("file",file);
    return api("uploads","POST",form);
  }
  const init = await api("uploads/init","POST",{name:file.name,bytes:file.size});
  await new Promise<void>((resolve,reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT",init.url); xhr.timeout = 300000;
    xhr.setRequestHeader("Content-Type",init.contentType);
    xhr.upload.onprogress = (e) => { if(e.lengthComputable)onProgress?.(Math.round(e.loaded / e.total * 100)); };
    const failed = () => reject(new Error(document.documentElement.lang === "ru" ? "Не удалось загрузить файл в хранилище. Проверьте подключение и повторите." : "Файл қоймаға жүктелмеді. Байланысты тексеріп, қайталаңыз."));
    xhr.onerror = xhr.ontimeout = failed;
    xhr.onload = () => { if(xhr.status>=200 && xhr.status<300)resolve();else failed(); };
    xhr.send(file);
  });
  return api(`uploads/${init.id}/complete`,"POST",{});
}
export async function api(
  path: string,
  method = "GET",
  data?: unknown,
  idempotencyKey?: string,
) {
  let response: Response;
  const translated = document.documentElement.lang === "kk" ? kazakhMessages : messages;
  try { response = await fetch(`/api/${path}`, {
    method,
    headers:
      data instanceof FormData
        ? {}
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey ?? crypto.randomUUID(),
          },
    body:
      data === undefined
        ? undefined
        : data instanceof FormData
          ? data
          : JSON.stringify(data),
  }); } catch {
    throw new Error(document.documentElement.lang === "kk" ? "Сервермен байланыс үзілді. Өзгерістерді жоғалтпау үшін бетті жаппаңыз және қайта көріңіз." : "Нет связи с сервером. Не закрывайте страницу с правками и повторите действие после подключения.");
  }
  let value;
  try { value = await response.json(); } catch {
    throw new Error(response.status === 413 ? translated.FILE_SIZE : response.status === 429 ? translated.LIMIT : translated.INTERNAL);
  }
  if (value.error?.code)
    value.error.message = translated[value.error.code] ?? translated.INTERNAL;
  if (!response.ok)
    throw Object.assign(
      new Error(translated[value.code] ?? translated.INTERNAL),
      {
        code: value.code,
        status: response.status,
      },
    );
  return value;
}
