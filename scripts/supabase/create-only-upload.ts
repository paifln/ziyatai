import { createClient } from "@supabase/supabase-js";

// Supabase S3 accepts PutObject If-None-Match but does not enforce it.
// Its Storage API with upsert:false atomically rejects an existing object.
export function supabaseCreateOnlyUploader(values: Record<string, string>) {
  if (
    !values.SUPABASE_SECRET_KEY ||
    /YOUR_|REPLACE_/.test(values.SUPABASE_SECRET_KEY)
  )
    throw new Error("Supabase file migration requires its server secret key");
  const client = createClient(values.SUPABASE_URL, values.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (url, options) =>
        fetch(url, { ...options, signal: AbortSignal.timeout(120000) }),
    },
  });
  let nextUploadAt = 0;
  return async (key: string, body: Buffer, contentType?: string) => {
    const slot = Math.max(Date.now(), nextUploadAt);
    nextUploadAt = slot + 500;
    if (slot > Date.now())
      await new Promise((resolve) => setTimeout(resolve, slot - Date.now()));
    for (let attempt = 0; attempt < 6; attempt++) {
      const { error } = await client.storage
        .from(values.STORAGE_BUCKET)
        .upload(key, body, {
          upsert: false,
          contentType: contentType ?? "application/octet-stream",
        });
      if (!error) return;
      if ((error as { status?: number }).status === 429 && attempt < 5) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(15000, 1000 * 2 ** attempt)),
        );
        continue;
      }
      throw Object.assign(
        new Error(
          "Supabase create-only upload failed; existing destination object preserved",
        ),
        { cause: error, status: (error as { status?: number }).status },
      );
    }
  };
}
