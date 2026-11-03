import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { migrationArguments, objectStore, settings } from "./migration-config";
import { supabaseCreateOnlyUploader } from "./create-only-upload";

const args = migrationArguments();
const source = await settings(args.source),
  target = await settings(args.target);
if (
  source.STORAGE_ENDPOINT === target.STORAGE_ENDPOINT &&
  source.STORAGE_BUCKET === target.STORAGE_BUCKET
)
  throw new Error("Source and destination buckets must differ");
const src = objectStore(source),
  dst = objectStore(target);
const uploadToSupabase =
  args.apply && !!target.SUPABASE_URL
    ? supabaseCreateOnlyUploader(target)
    : undefined;
async function bytes(client: S3Client, bucket: string, key: string) {
  const object = await client.send(
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { abortSignal: AbortSignal.timeout(120000) },
  );
  if (!object.Body) throw new Error("Missing object body");
  const reader = object.Body.transformToWebStream().getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > 64 * 1024 * 1024)
        throw new Error("Object exceeds migration memory budget");
      chunks.push(part.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  const body = Buffer.concat(chunks, length);
  return {
    body,
    contentType: object.ContentType,
    digest: createHash("sha256").update(body).digest("hex"),
  };
}
let cursor: string | undefined,
  copied = 0,
  verified = 0,
  objects = 0,
  totalBytes = 0;
try {
  do {
    const page = await src.send(
      new ListObjectsV2Command({
        Bucket: source.STORAGE_BUCKET,
        ContinuationToken: cursor,
        MaxKeys: 100,
      }),
      { abortSignal: AbortSignal.timeout(30000) },
    );
    const objectsInPage = page.Contents ?? [];
    let next = 0,
      stopped = false;
    const copyOne = async (object: (typeof objectsInPage)[number]) => {
      if (!object.Key) return;
      objects++;
      totalBytes += object.Size ?? 0;
      if (!args.apply) return;
      const original = await bytes(src, source.STORAGE_BUCKET, object.Key);
      let exists = true;
      try {
        await dst.send(
          new HeadObjectCommand({
            Bucket: target.STORAGE_BUCKET,
            Key: object.Key,
          }),
          { abortSignal: AbortSignal.timeout(30000) },
        );
      } catch (error) {
        if (
          (error as { $metadata?: { httpStatusCode?: number } }).$metadata
            ?.httpStatusCode === 404
        )
          exists = false;
        else throw error;
      }
      if (exists) {
        const existing = await bytes(dst, target.STORAGE_BUCKET, object.Key);
        if (existing.digest !== original.digest)
          throw new Error("Destination object differs; nothing overwritten");
      } else {
        if (uploadToSupabase)
          await uploadToSupabase(
            object.Key,
            original.body,
            original.contentType,
          );
        else
          await dst.send(
            new PutObjectCommand({
              Bucket: target.STORAGE_BUCKET,
              Key: object.Key,
              Body: original.body,
              ContentType: original.contentType,
              IfNoneMatch: "*",
            }),
            { abortSignal: AbortSignal.timeout(120000) },
          );
        copied++;
        const copy = await bytes(dst, target.STORAGE_BUCKET, object.Key);
        if (copy.digest !== original.digest)
          throw new Error("Copied object checksum mismatch");
      }
      verified++;
      if (verified % 25 === 0)
        console.log(JSON.stringify({ objects, copied, verified }));
    };
    const runners = Array.from({ length: 4 }, async () => {
      while (!stopped && next < objectsInPage.length) {
        const object = objectsInPage[next++];
        try {
          await copyOne(object);
        } catch (error) {
          stopped = true;
          throw error;
        }
      }
    });
    const results = await Promise.allSettled(runners);
    const failure = results.find((result) => result.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
    cursor = page.NextContinuationToken;
  } while (cursor);
  console.log(
    JSON.stringify({
      mode: args.apply ? "copied-and-verified" : "inventory",
      objects,
      totalBytes,
      copied,
      verified,
      sourcePreserved: true,
    }),
  );
} catch (error) {
  const known = error as {
    name?: string;
    status?: number;
    $metadata?: { httpStatusCode?: number };
    cause?: { status?: number; name?: string };
  };
  console.error(
    JSON.stringify({
      step: "file-transfer",
      code: known.cause?.name ?? known.name,
      status:
        known.cause?.status ?? known.status ?? known.$metadata?.httpStatusCode,
    }),
  );
  console.error(
    "File transfer failed; source preserved. Existing destination objects were not overwritten. Re-run to verify/resume.",
  );
  process.exitCode = 1;
} finally {
  src.destroy();
  dst.destroy();
}
