import { AppError } from "../../../packages/domain/errors";

// Direct S3 uploads bypass web memory. The demonstration's multipart fallback
// must still stay within the web container's memory budget under concurrency.
let active = 0;
const maximum = 2;
export async function withUploadCapacity<T>(
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
