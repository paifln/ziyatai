import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../../config/env";
import { Readable } from "node:stream";
import { readBoundedBody } from "../../http/request-body";
let instance: S3Client;
function storage() {
  const e = env();
  return (instance ??= new S3Client({
    endpoint: e.STORAGE_ENDPOINT,
    region: e.STORAGE_REGION,
    forcePathStyle: e.STORAGE_FORCE_PATH_STYLE === "true",
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: e.STORAGE_ACCESS_KEY,
      secretAccessKey: e.STORAGE_SECRET_KEY,
    },
  }));
}
function storageDeadline(signal?: AbortSignal, milliseconds = 30000) {
  const deadline = AbortSignal.timeout(milliseconds);
  return signal ? AbortSignal.any([signal, deadline]) : deadline;
}
export async function putObject(
  key: string,
  body: Uint8Array,
  type: string,
  signal?: AbortSignal,
) {
  await storage().send(
    new PutObjectCommand({
      Bucket: env().STORAGE_BUCKET,
      Key: key,
      Body: body,
      ContentType: type,
    }),
    { abortSignal: storageDeadline(signal, 60000) },
  );
}
export async function getObject(
  key: string,
  options: {
    maximumBytes?: number;
    signal?: AbortSignal;
    maximumDurationMs?: number;
  } = {},
) {
  const object = await openObject(key, {
    ...options,
    maximumDurationMs: options.maximumDurationMs ?? 60000,
  });
  const headers = new Headers();
  if (object.length !== undefined)
    headers.set("content-length", String(object.length));
  // Bound both declared and actual bytes before materializing an internal upload.
  // Downloads for the browser use openObject directly and remain streamed.
  const bytes = await readBoundedBody(
    { headers, body: object.body },
    options.maximumBytes ?? env().MAX_UPLOAD_MB * 1024 * 1024,
  );
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
/** Public downloads use a byte-bounded bridge, never a whole-object collector.
 * SDK transforms may wrap the HTTP body; abort the request on early close too.
 */
export async function openObject(
  key: string,
  options: {
    signal?: AbortSignal;
    range?: string;
    ifMatch?: string;
    maximumDurationMs?: number;
    headersTimeoutMs?: number;
  } = {},
) {
  const abort = new AbortController();
  let source: Readable | undefined;
  let ended = false;
  const interrupt = () => {
    abort.abort();
    source?.destroy(new Error("File transfer interrupted"));
  };
  const duration = setTimeout(
    interrupt,
    Math.min(options.maximumDurationMs ?? 900000, 900000),
  );
  const headers = setTimeout(
    interrupt,
    Math.min(options.headersTimeoutMs ?? 30000, 30000),
  );
  duration.unref();
  headers.unref();
  const cleanup = () => {
    clearTimeout(duration);
    clearTimeout(headers);
    options.signal?.removeEventListener("abort", interrupt);
  };
  options.signal?.addEventListener("abort", interrupt, { once: true });
  if (options.signal?.aborted) interrupt();
  try {
    const result = await storage().send(
      new GetObjectCommand({
        Bucket: env().STORAGE_BUCKET,
        Key: key,
        Range: options.range,
        IfMatch: options.ifMatch,
      }),
      { abortSignal: abort.signal },
    );
    clearTimeout(headers);
    if (!(result.Body instanceof Readable))
      throw new Error("Expected a Node object stream");
    source = result.Body;
    source.once("end", () => {
      ended = true;
      cleanup();
    });
    source.once("close", () => {
      if (!ended) abort.abort();
      cleanup();
    });
    source.once("error", () => {
      abort.abort();
      cleanup();
    });
    if (abort.signal.aborted) interrupt();
    const body = Readable.toWeb(source, {
      strategy: { highWaterMark: 64 * 1024, size: (chunk) => chunk.byteLength },
    }) as ReadableStream<Uint8Array>;
    return {
      body,
      length: result.ContentLength,
      range: result.ContentRange,
      etag: result.ETag,
      modified: result.LastModified,
    };
  } catch (error) {
    cleanup();
    source?.destroy();
    throw error;
  }
}
export async function deleteObject(key: string, signal?: AbortSignal) {
  await storage().send(
    new DeleteObjectCommand({ Bucket: env().STORAGE_BUCKET, Key: key }),
    { abortSignal: storageDeadline(signal) },
  );
}
export async function storageReady(signal?: AbortSignal) {
  await storage().send(
    new HeadBucketCommand({ Bucket: env().STORAGE_BUCKET }),
    {
      abortSignal: storageDeadline(signal, 5000),
    },
  );
}
export async function listQuarantinePage(
  cursor?: string,
  signal?: AbortSignal,
) {
  const page = await storage().send(
    new ListObjectsV2Command({
      Bucket: env().STORAGE_BUCKET,
      Prefix: "quarantine/",
      MaxKeys: 1000,
      ContinuationToken: cursor,
    }),
    { abortSignal: storageDeadline(signal) },
  );
  return {
    objects: page.Contents ?? [],
    nextCursor: page.NextContinuationToken,
  };
}
export async function signedUpload(key: string, bytes: number, type: string) {
  const e = env();
  const client = e.STORAGE_PUBLIC_ENDPOINT
    ? new S3Client({
        endpoint: e.STORAGE_PUBLIC_ENDPOINT,
        region: e.STORAGE_REGION,
        forcePathStyle: e.STORAGE_FORCE_PATH_STYLE === "true",
        requestChecksumCalculation: "WHEN_REQUIRED",
        credentials: {
          accessKeyId: e.STORAGE_ACCESS_KEY,
          secretAccessKey: e.STORAGE_SECRET_KEY,
        },
      })
    : storage();
  const url = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: env().STORAGE_BUCKET,
      Key: key,
      ContentType: type,
      ContentLength: bytes,
    }),
    {
      expiresIn: 300,
      signableHeaders: new Set(["content-length", "content-type"]),
    },
  );
  // The signature must enforce the reserved size; never issue unbounded upload URLs.
  if (
    !new URL(url).searchParams
      .get("X-Amz-SignedHeaders")
      ?.split(";")
      .includes("content-length")
  )
    throw new Error("Object storage signer did not bind Content-Length");
  return url;
}
export async function objectMetadata(key: string, signal?: AbortSignal) {
  return storage().send(
    new HeadObjectCommand({ Bucket: env().STORAGE_BUCKET, Key: key }),
    { abortSignal: storageDeadline(signal) },
  );
}
