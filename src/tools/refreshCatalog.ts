import { z } from "zod";
import { RuntimeContext } from "../common/runtime.js";
import { McpToolError } from "../common/errors.js";

export const RefreshCatalogInput = z.object({
  force: z
    .boolean()
    .default(false)
    .optional()
    .describe("Reserved for compatibility; refresh still skips writes when unchanged."),
});

export async function refreshCatalog(
  _input: z.infer<typeof RefreshCatalogInput>,
  ctx: RuntimeContext
) {
  if (!(await ctx.isAdmin())) {
    throw new McpToolError({
      code: "PERMISSION_DENIED",
      message: "refresh_catalog requires administrator permission.",
    });
  }

  return await ctx.catalogManager.refresh("manual");
}
