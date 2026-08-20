import { describe, expect, it } from "vitest";
import { z } from "zod";
import { McpToolError, defaultMessage } from "../src/common/errors.js";
import { runTool, textJson } from "../src/common/toolResult.js";

describe("runTool public error boundary", () => {
  it.each([
    ["handler", () => Promise.reject(new Error("INTERNAL_ERROR_CANARY handler failure"))],
    ["URL", () => Promise.reject(new TypeError("Invalid URL INTERNAL_ERROR_CANARY"))],
    ["parser", () => JSON.parse('{"INTERNAL_ERROR_CANARY":')],
    ["store", () => Promise.reject(new Error("/internal/store/INTERNAL_ERROR_CANARY"))],
    ["Zod", () => z.object({ value: z.number() }).parse({ value: "INTERNAL_ERROR_CANARY" })],
  ])("does not reflect an unexpected %s exception", async (_name, invoke) => {
    const result = await runTool(invoke);
    const payload = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(payload).toEqual({
      success: false,
      error: { code: "INTERNAL_ERROR", message: defaultMessage("INTERNAL_ERROR") },
    });
    expect(result.content[0].text).not.toContain("INTERNAL_ERROR_CANARY");
  });

  it("preserves an explicitly public McpToolError", async () => {
    const result = await runTool(() => {
      throw new McpToolError({ code: "VALIDATION_ERROR", message: "Public validation message." });
    });
    expect(JSON.parse(result.content[0].text)).toEqual({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "Public validation message." },
    });
  });

  it("serializes multi-megabyte tool results without truncation", () => {
    const value = "x".repeat(3 * 1024 * 1024);

    const result = textJson({ data: value });

    expect(JSON.parse(result.content[0].text)).toEqual({ data: value });
    expect(result.content[0].text).not.toContain("...[truncated]");
  });
});
