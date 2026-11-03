/** A stale worker may clean up only its own attempt, never a newer publication. */
export function exportObjectKey(
  owner: string,
  exportId: string,
  leaseToken: string,
  format: "pdf" | "docx",
) {
  return `${owner}/exports/${exportId}/${leaseToken}.${format}`;
}
