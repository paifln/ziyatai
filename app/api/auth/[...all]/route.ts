import { boundedRequest } from "../../../../apps/web/lib/request-body";
import { auth } from "../../../../apps/web/lib/auth";
import { trustedGatewayRequest } from "../../../../apps/web/lib/netlify-gateway";
import { AppError, messages } from "../../../../packages/domain/errors";
import { env } from "../../../../apps/web/lib/env";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  try {
    const trusted = trustedGatewayRequest(req);
    if (
      !env().SMTP_HOST &&
      /\/(?:request-password-reset|forget-password|send-verification-email|email-otp\/send-verification-otp)$/.test(
        new URL(req.url).pathname,
      )
    )
      return Response.json(
        {
          code: "EMAIL_UNAVAILABLE",
          message: "Email delivery is not configured",
        },
        { status: 503, headers: { "Cache-Control": "private, no-store" } },
      );
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
