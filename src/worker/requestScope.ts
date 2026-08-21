import type { McpOAuthScope } from "../oauth/constants.js";
import { toolDefinitions } from "../server/toolRegistry.js";

const MAX_MCP_REQUEST_BODY_BYTES = 1024 * 1024;

const REMOTE_TOOL_SCOPES = new Map<string, McpOAuthScope>(
  toolDefinitions.flatMap((definition) =>
    definition.remote && definition.requiredScopes.length === 1
      ? [[definition.name, definition.requiredScopes[0]]]
      : []
  )
);

export type InspectedMcpRequest =
  | { kind: "ok"; parsedBody?: unknown; requiredScope?: McpOAuthScope }
  | { kind: "rejected"; response: Response };

/**
 * Parse a clone so the MCP adapter still owns the original request stream.
 * This gate only makes authorization decisions for an exact tools/call
 * envelope; malformed envelopes remain the protocol adapter's responsibility.
 */
export async function inspectMcpRequest(request: Request): Promise<InspectedMcpRequest> {
  if (request.method.toUpperCase() !== "POST") return { kind: "ok" };

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_MCP_REQUEST_BODY_BYTES) {
    return { kind: "rejected", response: requestTooLargeResponse() };
  }

  let text: string;
  try {
    text = await readBoundedText(request.clone().body, MAX_MCP_REQUEST_BODY_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return { kind: "rejected", response: requestTooLargeResponse() };
    }
    return { kind: "ok" };
  }
  if (!text.trim()) return { kind: "ok" };

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(text);
  } catch {
    return { kind: "ok" };
  }
  if (Array.isArray(parsedBody)) {
    return {
      kind: "rejected",
      response: jsonRpcErrorResponse(400, -32600, "JSON-RPC batches are not supported."),
    };
  }
  if (!isRecord(parsedBody)) return { kind: "ok", parsedBody };

  if (parsedBody.method !== "tools/call") return { kind: "ok", parsedBody };
  const params = parsedBody.params;
  if (!isRecord(params) || typeof params.name !== "string") {
    return { kind: "ok", parsedBody };
  }
  return {
    kind: "ok",
    parsedBody,
    requiredScope: REMOTE_TOOL_SCOPES.get(params.name),
  };
}

class RequestBodyTooLargeError extends Error {}

async function readBoundedText(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number
): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maximumBytes) {
      void reader.cancel().catch(() => {});
      throw new RequestBodyTooLargeError();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function requestTooLargeResponse(): Response {
  return jsonRpcErrorResponse(413, -32600, "MCP request body is too large.");
}

function jsonRpcErrorResponse(status: number, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
