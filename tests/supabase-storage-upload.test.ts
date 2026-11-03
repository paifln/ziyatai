import { afterEach, expect, it, vi } from "vitest";
import { supabaseCreateOnlyUploader } from "../scripts/supabase/create-only-upload";
afterEach(() => vi.unstubAllGlobals());

it("uses a create-only Storage request and never falls back to an overwriting S3 PUT on conflict", async () => {
  const fetch = vi.fn(
    async (_input: RequestInfo | URL, options?: RequestInit) => {
      expect(new Headers(options?.headers).get("x-upsert")).toBe("false");
      return Response.json(
        {
          statusCode: "409",
          error: "Duplicate",
          message: "The resource already exists",
        },
        { status: 409 },
      );
    },
  );
  vi.stubGlobal("fetch", fetch);
  const upload = supabaseCreateOnlyUploader({
    SUPABASE_URL: "https://synthetic.supabase.co",
    SUPABASE_SECRET_KEY: "synthetic-secret-test-key",
    STORAGE_BUCKET: "private",
  });
  await expect(
    upload("owner/document.pdf", Buffer.from("synthetic"), "application/pdf"),
  ).rejects.toThrow("existing destination object preserved");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0][0])).toBe(
    "https://synthetic.supabase.co/storage/v1/object/private/owner/document.pdf",
  );
});
