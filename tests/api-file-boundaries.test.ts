import { beforeEach, expect, it, vi } from "vitest";
import { AppError } from "../packages/domain/errors";

const fixture = vi.hoisted(() => ({
  query: vi.fn(),
  inspect: vi.fn(),
  renderer: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  importJob: undefined as undefined | Record<string, unknown>,
}));
vi.mock("../server/auth/server", () => ({
  readSupabaseSession: async () => ({
    user: { id: "teacher", emailVerified: true },
  }),
}));
vi.mock("../server/config/env", () => ({
  env: () => ({
    APP_URL: "http://app.test",
    MAX_UPLOAD_MB: 25,
    SCAN_REQUIRED: "true",
  }),
}));
vi.mock("../server/http/netlify-gateway", () => ({
  trustedGatewayRequest: (request: Request) => request,
}));
vi.mock("../server/infrastructure/database/db", () => ({
  db: () => ({ query: fixture.query }),
  transaction: (work: (connection: unknown) => unknown) =>
    work({ query: fixture.query }),
}));
vi.mock("../server/infrastructure/documents/files", () => ({ inspectFile: fixture.inspect }));
vi.mock("../server/infrastructure/documents/renderer", () => ({
  isolatedRequest: fixture.renderer,
}));
vi.mock("../server/infrastructure/storage/storage", () => ({
  getObject: fixture.get,
  putObject: fixture.put,
  deleteObject: fixture.remove,
  signedUpload: vi.fn(),
  objectMetadata: vi.fn(),
  storageReady: vi.fn(),
  listQuarantinePage: vi.fn(),
}));
import { handle } from "../server/http/api";

const plan = "b0f3e39e-36bd-4d5e-bd5f-6c938fdc81bc";
const upload = "65f3e39e-36bd-4d5e-bd5f-6c938fdc81bc";
const pdf = Buffer.from("%PDF-1.7");
const responseRows = (rows: unknown[]) => ({ rows, rowCount: rows.length });
beforeEach(() => {
  vi.clearAllMocks();
  fixture.importJob = undefined;
  fixture.get.mockResolvedValue(pdf);
  fixture.put.mockResolvedValue(undefined);
  fixture.remove.mockResolvedValue(undefined);
  fixture.renderer.mockResolvedValue(Buffer.from("synthetic PNG"));
  fixture.inspect.mockResolvedValue({ ext: "pdf", mime: "application/pdf" });
  fixture.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT deleted_at FROM profiles"))
      return responseRows([{ deleted_at: null }]);
    if (sql.startsWith("SELECT * FROM plans"))
      return responseRows([{ id: plan, file_id: upload }]);
    if (sql.startsWith("SELECT * FROM uploads"))
      return responseRows([
        {
          id: upload,
          object_key: "fixture.pdf",
          bytes: pdf.length,
          mime: "application/pdf",
          scan_status: "clean",
          status: "complete",
        },
      ]);
    if (sql.startsWith("SELECT COALESCE(sum(bytes)"))
      return responseRows([{ bytes: "0", count: 0 }]);
    if (sql.startsWith("INSERT INTO api_limits"))
      return responseRows([{ count: 1 }]);
    if (sql.startsWith("SELECT j.id,j.resource_id,j.kind,j.payload,p.locale"))
      return responseRows(fixture.importJob ? [fixture.importJob] : []);
    if (
      sql.startsWith("INSERT INTO api_read_budgets") ||
      sql.startsWith("SELECT 1 FROM uploads") ||
      sql.startsWith('SELECT 1 FROM "user"')
    )
      return responseRows([{}]);
    if (
      sql.startsWith("SELECT pg_advisory") ||
      sql.startsWith("INSERT INTO uploads")
    )
      return responseRows([]);
    throw new Error(`Unexpected synthetic query: ${sql}`);
  });
});

const previewRequest = () =>
  new Request(`http://app.test/api/ktp/${plan}/preview`);

it.each(["fixture.constructor", "fixture.__proto__"])(
  "rejects invalid signed-upload format %s before reserving storage",
  async (name) => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handle(
        new Request("http://app.test/api/uploads/init", {
          method: "POST",
          headers: {
            Origin: "http://app.test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name, bytes: 8 }),
        }),
        ["uploads", "init"],
      );
      expect(response.status).toBe(415);
      expect(
        fixture.query.mock.calls.some(([sql]) =>
          String(sql).startsWith("INSERT INTO uploads"),
        ),
      ).toBe(false);
    } finally {
      log.mockRestore();
    }
  },
);

it("attempts cleanup after an uncertain S3 PUT and preserves the primary failure if cleanup also fails", async () => {
  fixture.put.mockRejectedValue(new AppError("INTERNAL", 503));
  fixture.remove.mockRejectedValue(new Error("synthetic delete outage"));
  const form = new FormData();
  form.set("file", new File([pdf], "fixture.pdf"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const response = await handle(
      new Request("http://app.test/api/uploads", {
        method: "POST",
        headers: { Origin: "http://app.test" },
        body: form,
      }),
      ["uploads"],
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("INTERNAL");
    expect(fixture.remove).toHaveBeenCalledExactlyOnceWith(
      fixture.put.mock.calls[0][0],
    );
    expect(
      fixture.query.mock.calls.some(([sql]) =>
        String(sql).startsWith("INSERT INTO uploads"),
      ),
    ).toBe(false);
  } finally {
    log.mockRestore();
  }
});

it("shares file-buffer capacity between multipart uploads and PDF previews before reading another S3 object", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  fixture.inspect.mockImplementation(async () => {
    await pending;
    return { ext: "pdf", mime: "application/pdf" };
  });
  fixture.renderer.mockImplementation(async () => {
    await pending;
    return Buffer.from("synthetic PNG");
  });
  const form = new FormData();
  form.set("file", new File([pdf], "fixture.pdf"));
  const uploading = handle(
    new Request("http://app.test/api/uploads", {
      method: "POST",
      headers: { Origin: "http://app.test" },
      body: form,
    }),
    ["uploads"],
  );
  const previewing = handle(previewRequest(), ["ktp", plan, "preview"]);
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await vi.waitFor(() => {
      expect(fixture.inspect).toHaveBeenCalledTimes(1);
      expect(fixture.renderer).toHaveBeenCalledTimes(1);
    });
    const refused = await handle(previewRequest(), ["ktp", plan, "preview"]);
    expect(refused.status).toBe(429);
    expect((await refused.json()).code).toBe("LIMIT");
    expect(fixture.get).toHaveBeenCalledTimes(1);
  } finally {
    release();
    expect((await uploading).status).toBe(201);
    expect((await previewing).status).toBe(200);
    log.mockRestore();
  }
  expect(
    (await handle(previewRequest(), ["ktp", plan, "preview"])).status,
  ).toBe(200);
});

it.each([{ includeHidden: true }, { grade: 8 }, { locale: "kk" }])(
  "rejects an import replay with different settings: %j",
  async (change) => {
    fixture.importJob = {
      id: plan,
      resource_id: plan,
      kind: "import",
      payload: { uploadId: upload, includeHidden: false, grade: 7 },
      locale: "ru",
    };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await handle(
        new Request("http://app.test/api/ktp/imports", {
          method: "POST",
          headers: {
            Origin: "http://app.test",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            uploadId: upload,
            includeHidden: false,
            grade: 7,
            locale: "ru",
            ...change,
          }),
        }),
        ["ktp", "imports"],
      );
      expect(response.status).toBe(409);
      expect((await response.json()).code).toBe("CONFLICT");
    } finally {
      log.mockRestore();
    }
  },
);

it.each(["ru", "en"])(
  "reuses an import job when all original import settings match (%s)",
  async (locale) => {
    fixture.importJob = {
      id: plan,
      resource_id: plan,
      kind: "import",
      payload: { uploadId: upload, includeHidden: false, grade: 7 },
      locale,
    };
    const response = await handle(
      new Request("http://app.test/api/ktp/imports", {
        method: "POST",
        headers: {
          Origin: "http://app.test",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          uploadId: upload,
          includeHidden: false,
          grade: 7,
          locale,
        }),
      }),
      ["ktp", "imports"],
    );
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ id: plan, jobId: plan });
    expect(fixture.put).not.toHaveBeenCalled();
  },
);
