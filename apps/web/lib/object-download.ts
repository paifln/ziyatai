import { objectMetadata, openObject } from "./storage";

function validRange(value: string) {
  if (value.length > 128) return false;
  const parts = /^bytes=(\d*)-(\d*)$/i.exec(value);
  if (!parts || (!parts[1] && !parts[2])) return false;
  const start = parts[1] ? Number(parts[1]) : null;
  const end = parts[2] ? Number(parts[2]) : null;
  if (
    [start, end].some((n) => n !== null && (!Number.isSafeInteger(n) || n < 0))
  )
    return false;
  return start === null ? end !== 0 : end === null || end >= start;
}
function matchesRange(value: string, etag?: string, modified?: Date) {
  if (value.startsWith('"')) return value === etag;
  if (value.startsWith("W/")) return false;
  const date = Date.parse(value);
  return (
    Number.isFinite(date) &&
    !!modified &&
    Math.floor(modified.getTime() / 1000) <= Math.floor(date / 1000)
  );
}
export async function objectDownload(
  req: Request,
  key: string,
  suppliedHeaders: HeadersInit,
) {
  const headers = new Headers(suppliedHeaders);
  headers.set("Cache-Control", "private, no-store");
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  let metadataPromise: ReturnType<typeof objectMetadata> | undefined;
  const metadata = () =>
    (metadataPromise ??= objectMetadata(
      key,
      AbortSignal.any([req.signal, AbortSignal.timeout(30000)]),
    ));
  const unavailableRange = async () => {
    const meta = await metadata();
    headers.set("Content-Range", `bytes */${meta.ContentLength ?? 0}`);
    headers.set("Content-Length", "0");
    return new Response(null, { status: 416, headers });
  };
  if (req.method === "HEAD") {
    const meta = await metadata();
    if (meta.ContentLength !== undefined)
      headers.set("Content-Length", String(meta.ContentLength));
    if (meta.ETag) headers.set("ETag", meta.ETag);
    if (meta.LastModified)
      headers.set("Last-Modified", meta.LastModified.toUTCString());
    return new Response(null, { headers });
  }
  let range = req.headers.get("range")?.trim();
  let ifMatch: string | undefined;
  const validator = req.headers.get("if-range");
  if (range !== undefined && validator) {
    const meta = await metadata();
    if (!matchesRange(validator, meta.ETag, meta.LastModified))
      range = undefined;
    else ifMatch = meta.ETag;
  }
  if (range !== undefined && !validRange(range)) return unavailableRange();
  let object;
  try {
    object = await openObject(key, { signal: req.signal, range, ifMatch });
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } })
      .$metadata?.httpStatusCode;
    if (status === 416 && range) return unavailableRange();
    // If the object changed after validating If-Range, send a complete new copy.
    if (status === 412 && ifMatch)
      object = await openObject(key, { signal: req.signal });
    else throw error;
  }
  if (object.length !== undefined)
    headers.set("Content-Length", String(object.length));
  if (object.range) headers.set("Content-Range", object.range);
  if (object.etag) headers.set("ETag", object.etag);
  if (object.modified)
    headers.set("Last-Modified", object.modified.toUTCString());
  return new Response(object.body, {
    status: object.range ? 206 : 200,
    headers,
  });
}
