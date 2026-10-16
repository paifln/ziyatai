import { boundedRequest } from "../../../../apps/web/lib/request-body";
import { auth } from "../../../../apps/web/lib/auth";
import { trustedGatewayRequest } from "../../../../apps/web/lib/netlify-gateway";
import { AppError, messages } from "../../../../packages/domain/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  try {
    const trusted = trustedGatewayRequest(req);
    const bounded =
      req.method === "POST"
        ? await boundedRequest(trusted, 64 * 1024)
        : trusted;
    const response = await auth().handler(bounded);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.append("Vary", "Cookie");
    return response;
  } catch (error) {
    if (error instanceof AppError)
      return Response.json(
        {
          code: error.code,
          message: messages[error.code] ?? messages.INTERNAL,
        },
        {
          status: error.status,
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    return Response.json(
      {
        code: "AUTH_UNAVAILABLE",
        message: "Authentication is temporarily unavailable",
      },
      { status: 503, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
export { handle as GET, handle as POST };
