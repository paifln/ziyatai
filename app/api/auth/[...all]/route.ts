import { boundedRequest } from "../../../../server/http/request-body";
import { trustedGatewayRequest } from "../../../../server/http/netlify-gateway";
import { AppError, messages } from "../../../../packages/domain/errors";
import { handleSupabaseAuth } from "../../../../server/auth/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
async function handle(req: Request) {
  try {
    const trusted = trustedGatewayRequest(req);
    const bounded =
      req.method === "POST"
        ? await boundedRequest(trusted, 64 * 1024)
        : trusted;
    const handled = await handleSupabaseAuth(bounded);
    // Fetch redirect responses have immutable headers; clone before adding privacy headers.
    const response = new Response(handled.body, {
      status: handled.status,
      statusText: handled.statusText,
      headers: handled.headers,
    });
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.append("Vary", "Cookie");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError")
      return Response.json(
        { code: "INVALID_INPUT" },
        {
          status: 400,
          headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
        },
      );
    if (error instanceof AppError)
      return Response.json(
        {
          code: error.code,
          message: messages[error.code] ?? messages.INTERNAL,
        },
        {
          status: error.status,
          headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
        },
      );
    return Response.json(
      {
        code: "AUTH_UNAVAILABLE",
        message: "Authentication is temporarily unavailable",
      },
      {
        status: 503,
        headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
      },
    );
  }
}
export { handle as GET, handle as POST };
