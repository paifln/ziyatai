import OpenAI from "openai";
import { env } from "../apps/web/lib/env";

const settings = env();
if (!settings.OPENAI_API_KEY || !settings.OPENAI_MODEL) {
  console.log(
    "OpenAI is not configured. Set OPENAI_API_KEY and OPENAI_MODEL in the server environment.",
  );
  process.exitCode = 2;
} else {
  const client = new OpenAI({
    apiKey: settings.OPENAI_API_KEY,
    maxRetries: 0,
    timeout: 30000,
  });
  try {
    const response = await client.responses.create({
      model: settings.OPENAI_MODEL,
      store: false,
      max_output_tokens: 64,
      input: 'Connection test only. Return {"ok":true}.',
      text: {
        format: {
          type: "json_schema",
          name: "connection_check",
          strict: true,
          schema: {
            type: "object",
            properties: { ok: { type: "boolean" } },
            required: ["ok"],
            additionalProperties: false,
          },
        },
      },
    });
    const ok =
      response.status === "completed" &&
      JSON.parse(response.output_text).ok === true;
    console.log(
      JSON.stringify({
        ok,
        model: response.model,
        status: response.status,
        usage: response.usage,
      }),
    );
    if (!ok) process.exitCode = 1;
  } catch (error) {
    // Never print the SDK error object, request headers or credentials.
    console.log(
      JSON.stringify({
        ok: false,
        status: error instanceof OpenAI.APIError ? error.status : null,
        code:
          error instanceof OpenAI.APIError ? error.code : "CONNECTION_FAILED",
      }),
    );
    process.exitCode = 1;
  }
}
