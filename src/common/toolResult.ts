import { McpOAuthToolError, McpToolError, defaultMessage, errorResult } from "./errors.js";

export type ToolContentResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
  _meta?: Record<string, unknown>;
  structuredContent?: Record<string, unknown>;
};

export function textJson(value: unknown, isError = false): ToolContentResult {
  return {
    isError,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
    ...(isRecord(value) ? { structuredContent: value } : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function runTool(fn: () => Promise<unknown> | unknown): Promise<ToolContentResult> {
  try {
    const result = await fn();
    return textJson(result);
  } catch (error) {
    if (error instanceof McpOAuthToolError) {
      return {
        ...textJson(errorResult(error.payload), true),
        _meta: { "mcp/www_authenticate": [...error.challenges] },
      };
    }
    if (error instanceof McpToolError) {
      return textJson(errorResult(error.payload), true);
    }

    return textJson(
      errorResult({
        code: "INTERNAL_ERROR",
        message: defaultMessage("INTERNAL_ERROR"),
      }),
      true
    );
  }
}
