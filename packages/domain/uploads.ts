export const UPLOAD_EXTENSIONS = ["pdf", "docx", "xls", "xlsx"] as const;
export const DEFAULT_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Advisory browser validation. The server independently inspects bytes and structure. */
export function uploadSelectionError(
  file: { name: string; size: number },
  maximum = DEFAULT_UPLOAD_BYTES,
): "FILE_TYPE" | "FILE_SIZE" | null {
  const extension = file.name.toLowerCase().split(".").pop();
  if (!UPLOAD_EXTENSIONS.some((allowed) => allowed === extension))
    return "FILE_TYPE";
  if (!Number.isFinite(file.size) || file.size <= 0 || file.size > maximum)
    return "FILE_SIZE";
  return null;
}
