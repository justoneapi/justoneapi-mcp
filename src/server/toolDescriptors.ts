import type { Tool } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { RuntimeContext } from "../common/runtime.js";
import type { McpOAuthScope } from "../oauth/constants.js";
import { toolDefinitionsFor } from "./toolRegistry.js";

type NoAuthSecurityScheme = { type: "noauth" };
type OAuthSecurityScheme = { type: "oauth2"; scopes: McpOAuthScope[] };
type SecurityScheme = NoAuthSecurityScheme | OAuthSecurityScheme;

export type CanonicalToolDescriptor = Tool & {
  securitySchemes?: SecurityScheme[];
};

export function createCanonicalToolDescriptors(ctx: RuntimeContext): CanonicalToolDescriptor[] {
  return toolDefinitionsFor(ctx).map((definition) => {
    const securitySchemes: SecurityScheme[] | undefined =
      ctx.transport === "worker" && ctx.oauthAdvertised
        ? [
            {
              type: "oauth2",
              scopes: [...definition.requiredScopes],
            },
          ]
        : ctx.transport === "stdio"
          ? [{ type: "noauth" }]
          : undefined;

    const inputSchema = toMcpInputSchema(definition.inputSchema);

    return {
      name: definition.name,
      title: definition.title,
      description: definition.description,
      inputSchema,
      outputSchema: toMcpOutputSchema(definition.outputSchema),
      annotations: definition.annotations,
      ...(securitySchemes
        ? {
            securitySchemes,
            _meta: {
              securitySchemes: securitySchemes.map((scheme) => ({
                ...scheme,
                ...(scheme.type === "oauth2" ? { scopes: [...scheme.scopes] } : {}),
              })),
            },
          }
        : {}),
    };
  });
}

function toMcpOutputSchema(schema: z.ZodObject<z.ZodRawShape>): Tool["outputSchema"] {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "output",
  });
  return jsonSchema as Tool["outputSchema"];
}

function toMcpInputSchema(schema: z.ZodObject<z.ZodRawShape>): Tool["inputSchema"] {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    io: "input",
  });
  if (jsonSchema.type !== "object") {
    throw new TypeError("MCP tool input schema must have an object root");
  }
  return jsonSchema as Tool["inputSchema"];
}
