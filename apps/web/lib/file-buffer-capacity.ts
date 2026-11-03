import { AppError } from "../../../packages/domain/errors";

// Multipart validation and PDF preview conversion both buffer source files.
// Share one process budget instead of letting preview bursts bypass uploads' cap.
let active = 0;
const maximum = 2;
export async function withFileBufferCapacity<T>(
  operation: () => Promise<T>,
): Promise<T> {
  if (active >= maximum) throw new AppError("LIMIT", 429);
  active++;
  try {
    return await operation();
  } finally {
    active--;
  }
}
