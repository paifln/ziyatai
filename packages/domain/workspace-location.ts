const workspaceViews = [
  "plans",
  "create",
  "history",
  "library",
  "upload",
  "review",
  "editor",
  "profile",
] as const;
export type WorkspaceView = (typeof workspaceViews)[number];
export type WorkspaceLocation = { view: WorkspaceView; id: string };
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
export function readWorkspaceLocation(search: string): WorkspaceLocation {
  const params = new URLSearchParams(search);
  const generation = params.get("generation");
  const plan = params.get("plan");
  const requested = params.get("view");
  const view =
    workspaceViews.find((value) => value === requested) ??
    (generation ? "editor" : plan ? "review" : "plans");
  const id =
    (view === "editor"
      ? generation
      : view === "review" || view === "create"
        ? plan
        : "") ?? "";
  if ((view === "editor" || view === "review") && !uuid.test(id))
    return { view: "plans", id: "" };
  return { view, id: uuid.test(id) ? id : "" };
}
export function workspaceHref({ view, id }: WorkspaceLocation) {
  const params = new URLSearchParams();
  if (view !== "plans") params.set("view", view);
  if (id && uuid.test(id)) {
    if (view === "editor") params.set("generation", id);
    if (view === "review" || view === "create") params.set("plan", id);
  }
  return `/${params.size ? `?${params}` : ""}`;
}
