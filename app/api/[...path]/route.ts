import { handle } from "../../../apps/web/lib/api";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function route(
  req: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const response = await handle(req, (await params).path);
  return req.method === "HEAD"
    ? new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      })
    : response;
}
export {
  route as GET,
  route as HEAD,
  route as POST,
  route as PATCH,
  route as DELETE,
  route as PUT,
  route as OPTIONS,
};
