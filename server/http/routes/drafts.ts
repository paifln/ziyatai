import { editorDrafts } from "../../application/editor-drafts";
import { type ApiContext } from "../context";
export async function handleDrafts(
  context: ApiContext,
): Promise<Response | undefined> {
  const { req, path, resource, owner } = context;
  if (resource === "drafts") return await editorDrafts(req, path, owner);
}
