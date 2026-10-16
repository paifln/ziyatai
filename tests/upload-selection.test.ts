import { expect, it } from "vitest";
import {
  DEFAULT_UPLOAD_BYTES,
  uploadSelectionError,
} from "../packages/domain/uploads";
it("accepts the supported formats case-insensitively and rejects disguised extensions", () => {
  for (const name of ["КТЖ.XLS", "plan.xlsx", "plan.PDF", "plan.docx"])
    expect(uploadSelectionError({ name, size: 1 })).toBeNull();
  for (const name of ["plan.doc", "plan.xls.exe", "plan", "plan.xlsm"])
    expect(uploadSelectionError({ name, size: 1 })).toBe("FILE_TYPE");
});
it("rejects empty and excessive files, including non-finite sizes", () => {
  for (const size of [0, -1, DEFAULT_UPLOAD_BYTES + 1, Infinity, NaN])
    expect(uploadSelectionError({ name: "plan.xls", size })).toBe("FILE_SIZE");
  expect(
    uploadSelectionError({ name: "plan.xls", size: DEFAULT_UPLOAD_BYTES }),
  ).toBeNull();
});
