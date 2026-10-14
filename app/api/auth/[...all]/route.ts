import { auth } from "../../../../apps/web/lib/auth";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return auth().handler(req);
}
export async function POST(req: Request) {
  return auth().handler(req);
}
