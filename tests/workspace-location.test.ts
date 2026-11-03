import { describe, expect, it } from "vitest";
import {
  readWorkspaceLocation,
  workspaceHref,
} from "../packages/domain/workspace-location";
describe("workspace locations", () => {
  const id = "eb13fd72-b460-416e-b23f-568fa34f6f4d";
  it("keeps legacy material links and rejects invalid identifiers", () => {
    expect(readWorkspaceLocation(`?generation=${id}`)).toEqual({
      view: "editor",
      id,
    });
    expect(readWorkspaceLocation("?view=editor&generation=invalid")).toEqual({
      view: "plans",
      id: "",
    });
    expect(readWorkspaceLocation("?view=unknown")).toEqual({
      view: "plans",
      id: "",
    });
  });
  it("round trips every navigable workspace section and material", () => {
    for (const view of [
      "plans",
      "history",
      "library",
      "profile",
      "upload",
      "create",
      "editor",
      "review",
    ] as const) {
      const location = {
        view,
        id: ["create", "editor", "review"].includes(view) ? id : "",
      };
      expect(
        readWorkspaceLocation(
          new URL(workspaceHref(location), "https://example.test").search,
        ),
      ).toEqual(location);
    }
  });
});
