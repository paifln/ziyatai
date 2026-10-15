import { auth } from "../../../../apps/web/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  try {
    const response=await auth().handler(req);
    response.headers.set("Cache-Control","private, no-store");
    response.headers.append("Vary","Cookie");
    return response;
  } catch {
    return Response.json({code:"AUTH_UNAVAILABLE",message:"Authentication is temporarily unavailable"},{status:503,headers:{"Cache-Control":"private, no-store"}});
  }
}
export {handle as GET,handle as POST};
