import { z } from "zod";
import { RuntimeContext } from "../common/runtime.js";
import { McpToolError } from "../common/errors.js";

export const RefreshCatalogInput = z.object({
  force: z
    .boolean()
    .default(false)
    .optional()
    .describe("Reserved for compatibility; refresh still skips writes when unchanged."),
  rollback: z
    .boolean()
    .default(false)
    .optional()
    .describe("Roll back active catalog to the previous validated release."),
});

export async function refreshCatalog(
  input: z.infer<typeof RefreshCatalogInput>,
  ctx: RuntimeContext
) {
  if (!(await ctx.isAdmin())) {
    throw new McpToolError({
      code: "PERMISSION_DENIED",
      message: "refresh_catalog requires administrator permission.",
    });
  }

  return input.rollback
    ? await ctx.catalogManager.rollback()
    : await ctx.catalogManager.refresh("manual");
}
