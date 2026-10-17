import { AppError } from "../../../packages/domain/errors";

// Exact business paths. Literal routes precede dynamic siblings (uploads/init).
const routes: readonly [string, readonly string[]][] = [
  ["public-config", ["GET"]],
  ["account", ["DELETE"]],
  ["demo", ["POST"]],
  ["profile", ["GET", "PATCH"]],
  ["uploads", ["POST"]],
  ["uploads/init", ["POST"]],
  ["uploads/:id/complete", ["POST"]],
  ["uploads/:id", ["GET", "HEAD"]],
  ["ktp", ["GET"]],
  ["ktp/imports", ["POST"]],
  ["ktp/collection", ["GET"]],
  ["ktp/:id", ["GET", "DELETE"]],
  ["ktp/:id/rows", ["PATCH", "POST"]],
  ["ktp/:id/confirm", ["PATCH", "POST"]],
  ["ktp/:id/preview", ["GET"]],
  ["ktp/:id/source", ["GET", "HEAD", "POST"]],
  ["jobs", ["GET"]],
  ["jobs/:id", ["GET"]],
  ["jobs/:id/retry", ["POST"]],
  ["jobs/:id/cancel", ["POST"]],
  ["generations", ["POST"]],
  ["generations/:id", ["GET", "DELETE"]],
  ["generations/:id/document", ["PATCH"]],
  ["generations/:id/versions", ["GET"]],
  ["generations/:id/approve", ["POST"]],
  ["generations/:id/validate", ["POST"]],
  ["generations/:id/tasks/:taskId", ["PATCH"]],
  ["generations/:id/tasks/:taskId/regenerate", ["POST"]],
  ["exports", ["POST"]],
  ["exports/:id", ["DELETE"]],
  ["exports/:id/download", ["GET", "HEAD"]],
  ["history", ["GET"]],
  ["library", ["GET"]],
  ["drafts", ["GET", "POST"]],
  ["drafts/:id", ["GET"]],
  ["drafts/:id/discard", ["POST"]],
];
const compiled = routes.map(([path, methods]) => ({
  parts: path.split("/"),
  methods,
}));
export class ApiMethodError extends AppError {
  readonly allow: string;
  constructor(methods: readonly string[]) {
    super("METHOD_NOT_ALLOWED", 405);
    this.allow = [...methods, "OPTIONS"].join(", ");
  }
}
export function assertApiRoute(path: string[], method: string) {
  const route = compiled.find(
    ({ parts }) =>
      parts.length === path.length &&
      parts.every((part, index) =>
        part.startsWith(":") ? path[index].length > 0 : part === path[index],
      ),
  );
  if (!route) throw new AppError("NOT_FOUND", 404);
  if (method !== "OPTIONS" && !route.methods.includes(method))
    throw new ApiMethodError(route.methods);
  return route.methods;
}
