const uploadMimes = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
} as const;
export function uploadFormat(name: string) {
  const extension = name.toLowerCase().split(".").pop() ?? "";
  if (!Object.prototype.hasOwnProperty.call(uploadMimes, extension))
    return null;
  const ext = extension as keyof typeof uploadMimes;
  return { ext, mime: uploadMimes[ext] };
}
export const DEFAULT_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Advisory browser validation. The server independently inspects bytes and structure. */
export function uploadSelectionError(
  file: { name: string; size: number },
  maximum = DEFAULT_UPLOAD_BYTES,
): "FILE_TYPE" | "FILE_SIZE" | null {
  if (!uploadFormat(file.name)) return "FILE_TYPE";
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maximum)
    return "FILE_SIZE";
  return null;
}
