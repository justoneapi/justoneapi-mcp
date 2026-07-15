import { describe, expect, it } from "vitest";
import { z } from "zod";
import { McpToolError, defaultMessage } from "../src/common/errors.js";
import { runTool } from "../src/common/toolResult.js";

describe("runTool public error boundary", () => {
  it.each([
    ["handler", () => Promise.reject(new Error("PRIVATE_REGISTRY_CANARY handler failure"))],
    ["URL", () => Promise.reject(new TypeError("Invalid URL PRIVATE_REGISTRY_CANARY"))],
    ["parser", () => JSON.parse('{"PRIVATE_REGISTRY_CANARY":')],
    ["store", () => Promise.reject(new Error("/private/store/PRIVATE_REGISTRY_CANARY"))],
    ["Zod", () => z.object({ value: z.number() }).parse({ value: "PRIVATE_REGISTRY_CANARY" })],
  ])("does not reflect an unexpected %s exception", async (_name, invoke) => {
    const result = await runTool(invoke);
    const payload = JSON.parse(result.content[0].text);

    expect(result.isError).toBe(true);
    expect(payload).toEqual({
      success: false,
      error: { code: "INTERNAL_ERROR", message: defaultMessage("INTERNAL_ERROR") },
    });
    expect(result.content[0].text).not.toContain("PRIVATE_REGISTRY_CANARY");
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
});
