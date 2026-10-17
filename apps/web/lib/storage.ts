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
import { env } from "./env";
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
export async function putObject(key: string, body: Uint8Array, type: string) {
  await storage().send(
    new PutObjectCommand({
      Bucket: env().STORAGE_BUCKET,
      Key: key,
      Body: body,
      ContentType: type,
    }),
  );
}
export async function getObject(key: string) {
  const r = await storage().send(
    new GetObjectCommand({ Bucket: env().STORAGE_BUCKET, Key: key }),
  );
  return Buffer.from(await r.Body!.transformToByteArray());
}
export async function deleteObject(key: string) {
  await storage().send(
    new DeleteObjectCommand({ Bucket: env().STORAGE_BUCKET, Key: key }),
  );
}
export async function storageReady() {
  await storage().send(new HeadBucketCommand({ Bucket: env().STORAGE_BUCKET }));
}
export async function listQuarantinePage(cursor?: string) {
  const page = await storage().send(
    new ListObjectsV2Command({
      Bucket: env().STORAGE_BUCKET,
      Prefix: "quarantine/",
      MaxKeys: 1000,
      ContinuationToken: cursor,
    }),
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
export async function objectMetadata(key: string) {
  return storage().send(
    new HeadObjectCommand({ Bucket: env().STORAGE_BUCKET, Key: key }),
  );
}
