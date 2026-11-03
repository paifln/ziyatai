import { test, expect, vi, beforeEach } from "vitest";
import { AppError } from "../packages/domain/errors";
const fixtures = vi.hoisted(() => ({
  config: {
    APP_ENV: "local",
    SCAN_REQUIRED: "true",
    CLAMAV_HOST: "fixture",
    RENDERER_URL: "fixture",
  },
  scan: vi.fn(),
  inspect: vi.fn(),
}));
vi.mock("../server/config/env", () => ({ env: () => fixtures.config }));
vi.mock("../server/infrastructure/antivirus/antivirus", () => ({ scanStream: fixtures.scan }));
vi.mock("../server/infrastructure/documents/renderer", () => ({
  isolatedRequest: fixtures.inspect,
}));
import { inspectFile } from "../server/infrastructure/documents/files";
const bytes = Buffer.from("PK\x03\x04synthetic signature only");
beforeEach(() => {
  fixtures.config.APP_ENV = "local";
  fixtures.config.SCAN_REQUIRED = "true";
  fixtures.scan.mockReset().mockResolvedValue(undefined);
  fixtures.inspect.mockReset().mockResolvedValue(Buffer.alloc(0));
});
test("nonlocal inspection cannot silently disable scanning", async () => {
  fixtures.config.SCAN_REQUIRED = "false";
  for (const environment of ["staging", "production"]) {
    fixtures.config.APP_ENV = environment;
    await expect(inspectFile(bytes, "fixture.docx")).rejects.toMatchObject({
      code: "SCAN_UNAVAILABLE",
    });
  }
  expect(fixtures.inspect).not.toHaveBeenCalled();
  expect(fixtures.scan).not.toHaveBeenCalled();
});
test("scanner outage fails before document parsing", async () => {
  fixtures.scan.mockRejectedValue(new AppError("SCAN_UNAVAILABLE", 503));
  await expect(inspectFile(bytes, "fixture.docx")).rejects.toMatchObject({
    code: "SCAN_UNAVAILABLE",
  });
  expect(fixtures.inspect).not.toHaveBeenCalled();
});
test("a scanner rejection fails before document parsing", async () => {
  fixtures.scan.mockRejectedValue(new AppError("FILE_UNSAFE", 422));
  await expect(inspectFile(bytes, "fixture.docx")).rejects.toMatchObject({
    code: "FILE_UNSAFE",
  });
  expect(fixtures.inspect).not.toHaveBeenCalled();
});
test("successful scanning still requires isolated structural inspection", async () => {
  fixtures.inspect.mockRejectedValue(new AppError("FILE_INVALID", 422));
  await expect(inspectFile(bytes, "fixture.docx")).rejects.toMatchObject({
    code: "FILE_INVALID",
  });
  expect(fixtures.scan).toHaveBeenCalledWith(bytes);
  expect(fixtures.scan.mock.invocationCallOrder[0]).toBeLessThan(
    fixtures.inspect.mock.invocationCallOrder[0],
  );
});
test("explicit local development may omit scanning but retains structural inspection", async () => {
  fixtures.config.SCAN_REQUIRED = "false";
  expect((await inspectFile(bytes, "fixture.docx")).ext).toBe("docx");
  expect(fixtures.scan).not.toHaveBeenCalled();
  expect(fixtures.inspect).toHaveBeenCalledWith("inspect", bytes, "docx");
});
