import { auth } from "../../../../apps/web/lib/auth";
import { trustedGatewayRequest } from "../../../../apps/web/lib/netlify-gateway";
import { AppError, messages } from "../../../../packages/domain/errors";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  try {
    const response = await auth().handler(trustedGatewayRequest(req));
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
