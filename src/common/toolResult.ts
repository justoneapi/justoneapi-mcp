import { McpToolError, errorResult } from "./errors.js";

export type ToolContentResult = {
  isError?: boolean;
  content: Array<{ type: "text"; text: string }>;
};

export function textJson(value: unknown, isError = false): ToolContentResult {
  return {
    isError,
    content: [{ type: "text", text: JSON.stringify(value, null, 2) }],
  };
}

export async function runTool(fn: () => Promise<unknown> | unknown): Promise<ToolContentResult> {
  try {
    const result = await fn();
    return textJson(result);
  } catch (error) {
    if (error instanceof McpToolError) {
      return textJson(errorResult(error.payload), true);
    }

    const message = error instanceof Error ? error.message : "Unknown error";
    return textJson(
      errorResult({
        code: "INTERNAL_ERROR",
        message,
      }),
      true
    );
  }
}
