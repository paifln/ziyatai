-- Better Auth's rate-limit adapter inserts without an id; use database UUIDs.
ALTER TABLE "rateLimit" ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
