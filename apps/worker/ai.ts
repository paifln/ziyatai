import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { GenerationDoc, Task } from "../../packages/contracts";
import { validateDocument } from "../../packages/domain/validation";
import { SYSTEM_PROMPT, PROMPT_VERSION } from "../../packages/domain/prompts";
import { env } from "../web/lib/env";
import { AppError } from "../../packages/domain/errors";
export async function generate(
  snapshot: any,
  replacement?: { task: any },
  beforeCall?: () => Promise<void>,
) {
  const e = env();
  if (!e.OPENAI_API_KEY || !e.OPENAI_MODEL)
    throw new AppError("AI_UNAVAILABLE", 503);
  const client = new OpenAI({
    apiKey: e.OPENAI_API_KEY,
    maxRetries: 0,
    timeout: 120000,
  });
  let repair = "";
  let usage: any = {};
  let requestId: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (beforeCall) await beforeCall();
      const response = await client.responses.parse({
        model: e.OPENAI_MODEL,
        store: false,
        input: [
          {
            role: "system",
            content:
              SYSTEM_PROMPT +
              (replacement
                ? " Replace only the supplied task, preserving its id and level. Return a Task object."
                : ""),
          },
          {
            role: "user",
            content: JSON.stringify({
              snapshot,
              replace: replacement?.task ?? null,
              repair,
            }),
          },
        ],
        text: {
          format: replacement
            ? zodTextFormat(Task, "assignment_task")
            : zodTextFormat(GenerationDoc, "assignments"),
        },
        max_output_tokens: e.MAX_AI_TOKENS,
      });
      requestId = response._request_id ?? undefined;
      usage = {
        input_tokens:
          (usage.input_tokens ?? 0) + (response.usage?.input_tokens ?? 0),
        output_tokens:
          (usage.output_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
      };
      if (response.status !== "completed")
        throw new AppError("AI_INCOMPLETE", 422);
      if (
        response.output.some(
          (item) =>
            item.type === "message" &&
            item.content.some((c) => c.type === "refusal"),
        )
      )
        throw new AppError("AI_REFUSAL", 422);
      const parsed = response.output_parsed;
      if (!parsed) throw new AppError("AI_INVALID", 422);
      if (replacement) {
        const task = Task.parse(parsed);
        if (
          task.id !== replacement.task.id ||
          task.level !== replacement.task.level
        )
          throw new AppError("AI_INVALID", 422);
        return {
          task,
          usage,
          requestId,
          model: e.OPENAI_MODEL,
          promptVersion: PROMPT_VERSION,
        };
      }
      const report = validateDocument(parsed, snapshot);
      if (!report.issues.length)
        return {
          doc: report.doc,
          report: { ...report, doc: undefined },
          usage,
          requestId,
          model: e.OPENAI_MODEL,
          promptVersion: PROMPT_VERSION,
        };
      repair = `Previous response failed these checks: ${report.issues.join(", ")}. Correct these without changing the source facts.`;
      if (attempt === 2) throw new AppError("AI_INVALID", 422);
    } catch (error) {
      const annotate = (failure: AppError) =>
        Object.assign(failure, {
          providerUsage: usage,
          providerRequestId: requestId,
        });
      if (error instanceof AppError) throw annotate(error);
      if (error instanceof OpenAI.APIError) {
        if (error.status === 429)
          throw annotate(new AppError("AI_RATE_LIMIT", 429));
        if (error.status && error.status >= 500)
          throw annotate(new AppError("AI_TEMPORARY", 503));
        if (error.status === 401 || error.status === 403)
          throw annotate(new AppError("AI_UNAVAILABLE", 503));
      }
      if (error instanceof OpenAI.APIConnectionError)
        throw annotate(new AppError("AI_UNCERTAIN", 503));
      throw annotate(new AppError("AI_INVALID", 422));
    }
  }
  throw new AppError("AI_INVALID", 422);
}
