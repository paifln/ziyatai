import { randomUUID } from "node:crypto";
import { z } from "zod";
import { readSupabaseSession } from "../auth/server";
import { db } from "../infrastructure/database/db";
import { env } from "../config/env";
import { trustedGatewayRequest } from "./netlify-gateway";
import { AppError, messages } from "../../packages/domain/errors";
import { admitRead, ReadBudgetError } from "./read-budgets";
import { readiness } from "./readiness";
import { assertApiRoute, ApiMethodError } from "./api-routes";
import { assertAccountIntent } from "../application/account-intent";
import { type ApiContext, json } from "./context";
import { handleDrafts } from "./routes/drafts";
import { handlePlans } from "./routes/plans";
import { handleAccount } from "./routes/account";
import { handleDemo } from "./routes/demo";
import { handleGenerationsDocument } from "./routes/generations/document";
import { handleUploads } from "./routes/uploads";
import { handleJobs } from "./routes/jobs";
import { handleGenerationsCollection } from "./routes/generations/collection";
import { handleGenerationsTasks } from "./routes/generations/tasks";
import { handleGenerationsReview } from "./routes/generations/review";
import { handleExports } from "./routes/exports";
import { handleHistory } from "./routes/history";
import { handleDeletions } from "./routes/deletions";
export async function handle(req: Request, path: string[]) {
  const requestId = randomUUID();
  try {
    const method = req.method,
      url = new URL(req.url);
    const [resource, id, action, child] = path;
    if (resource === "health") {
      if (path.length > 2 || (id && id !== "ready" && id !== "live"))
        return json({ status: "not_found" }, 404);
      if (method !== "GET" && method !== "HEAD")
        return Response.json(
          { status: "method_not_allowed" },
          {
            status: 405,
            headers: { Allow: "GET, HEAD", "Cache-Control": "no-store" },
          },
        );
      if (id === "ready" && !(await readiness()))
        return json({ status: "degraded" }, 503);
      return json({ status: "ok" });
    }
    req = trustedGatewayRequest(req);
    const allowed = assertApiRoute(path, method);
    if (method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: {
          Allow: [...allowed, "OPTIONS"].join(", "),
          "Cache-Control": "no-store",
        },
      });
    if (resource === "public-config" && path.length === 1 && method === "GET") {
      return json({
        authProvider: "supabase",
        authMode: "password",
        emailVerificationRequired: false,
        passwordResetAvailable: env().PASSWORD_RESET_ENABLED,
      });
    }
    const session = await readSupabaseSession();
    if (!session || !session.user.emailVerified)
      throw new AppError("UNAUTHORIZED", 401);
    const owner = session.user.id;
    assertAccountIntent(req.headers, owner);
    const p = await db().query(
      "SELECT deleted_at FROM profiles WHERE owner_id=$1",
      [owner],
    );
    if (p.rows[0]?.deleted_at) throw new AppError("UNAUTHORIZED", 401);
    if (["GET", "HEAD"].includes(method)) await admitRead(owner, path);
    if (!["GET", "HEAD"].includes(method)) {
      if (req.headers.get("origin") !== env().APP_URL)
        throw new AppError("CSRF", 403);
      const limit = await db().query(
        "INSERT INTO api_limits(key,window_start,count) VALUES($1,date_trunc('minute',now()),1) ON CONFLICT(key,window_start) DO UPDATE SET count=api_limits.count+1 RETURNING count",
        [owner],
      );
      if (limit.rows[0].count > 60) throw new AppError("LIMIT", 429);
    }
    const limit = Math.min(
      100,
      Math.max(1, Math.floor(Number(url.searchParams.get("limit"))) || 30),
    );
    const offset = z.coerce
      .number()
      .int()
      .min(0)
      .max(1000000)
      .parse(url.searchParams.get("offset") ?? "0");
    const context: ApiContext = {
      req,
      path,
      resource,
      id,
      action,
      child,
      method,
      url,
      owner,
      session,
      requestId,
      limit,
      offset,
    };
    for (const route of [
      handleDrafts,
      handlePlans,
      handleAccount,
      handleDemo,
      handleGenerationsDocument,
      handleUploads,
      handleJobs,
      handleGenerationsCollection,
      handleGenerationsTasks,
      handleGenerationsReview,
      handleExports,
      handleHistory,
      handleDeletions,
    ]) {
      const response = await route(context);
      if (response !== undefined) return response;
    }

    throw new AppError("NOT_FOUND", 404);
  } catch (e) {
    const error =
      e instanceof AppError
        ? e
        : e instanceof z.ZodError || e instanceof SyntaxError
          ? new AppError("FILE_INVALID", 422)
          : new AppError("INTERNAL", 500);
    console.error(
      JSON.stringify({ requestId, outcome: "failed", code: error.code }),
    );
    const response = json(
      {
        code: error.code,
        message: messages[error.code] ?? messages.INTERNAL,
        requestId,
        fieldErrors: error.fieldErrors,
        ...(error instanceof ReadBudgetError
          ? { retryAfter: error.retryAfter }
          : {}),
      },
      error.status,
    );
    if (error instanceof ReadBudgetError)
      response.headers.set("Retry-After", String(error.retryAfter));
    if (error instanceof ApiMethodError)
      response.headers.set("Allow", error.allow);
    return response;
  }
}
