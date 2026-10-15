import {
  S3Client,
  PutBucketCorsCommand,
  PutBucketLifecycleConfigurationCommand,
  GetBucketLifecycleConfigurationCommand,
  type LifecycleRule,
} from "@aws-sdk/client-s3";
import { env } from "../apps/web/lib/env";
const e = env();
const client = new S3Client({
  endpoint: e.STORAGE_ENDPOINT,
  region: e.STORAGE_REGION,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: e.STORAGE_ACCESS_KEY,
    secretAccessKey: e.STORAGE_SECRET_KEY,
  },
});
await client.send(
  new PutBucketCorsCommand({
    Bucket: e.STORAGE_BUCKET,
    CORSConfiguration: {
      CORSRules: [
        {
          AllowedOrigins: [new URL(e.APP_URL).origin],
          AllowedMethods: ["PUT"],
          AllowedHeaders: ["content-type"],
          ExposeHeaders: ["ETag"],
          MaxAgeSeconds: 300,
        },
      ],
    },
  }),
);
console.log("Storage CORS configured for the exact application origin.");
if (e.APP_ENV === "production") {
  const ruleId = "expire-untrusted-upload-urls";
  let rules: LifecycleRule[];
  try {
    rules =
      (
        await client.send(
          new GetBucketLifecycleConfigurationCommand({
            Bucket: e.STORAGE_BUCKET,
          }),
        )
      ).Rules ?? [];
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.name !== "NoSuchLifecycleConfiguration"
    )
      throw error;
    rules = [];
  }
  await client.send(
    new PutBucketLifecycleConfigurationCommand({
      Bucket: e.STORAGE_BUCKET,
      LifecycleConfiguration: {
        Rules: [
          ...rules.filter((rule) => rule.ID !== ruleId),
          {
            ID: ruleId,
            Status: "Enabled",
            Filter: { Prefix: "quarantine/" },
            Expiration: { Days: 1 },
            NoncurrentVersionExpiration: { NoncurrentDays: 1 },
            AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
          },
        ],
      },
    }),
  );
  console.log(
    "Quarantine objects expire after one day. Verify the provider applies this policy.",
  );
}
