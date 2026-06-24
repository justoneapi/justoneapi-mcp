import { JsonValue } from "../catalog/types.js";

export type TruncationEntry =
  | { path: string; original_length: number; kept: number }
  | { path: string; original_chars: number; kept_chars: number };

export type TruncationResult = {
  value: unknown;
  truncated: boolean;
  paths: TruncationEntry[];
};

export function truncateJson(
  value: unknown,
  options: { maxItems: number; maxTextLength: number; maxDepth: number }
): TruncationResult {
  const paths: TruncationEntry[] = [];
  const truncated = visit(value, "$", 0, options, paths);
  return { value: truncated, truncated: paths.length > 0, paths };
}

function visit(
  value: unknown,
  path: string,
  depth: number,
  options: { maxItems: number; maxTextLength: number; maxDepth: number },
  paths: TruncationEntry[]
): unknown {
  if (depth > options.maxDepth) {
    paths.push({ path, original_chars: JSON.stringify(value).length, kept_chars: 0 });
    return "[Truncated: max depth exceeded]";
  }

  if (typeof value === "string") {
    if (value.length > options.maxTextLength) {
      paths.push({
        path,
        original_chars: value.length,
        kept_chars: options.maxTextLength,
      });
      return `${value.slice(0, options.maxTextLength)}...[truncated]`;
    }
    return value;
  }

  if (Array.isArray(value)) {
    const kept = value.slice(0, options.maxItems);
    if (value.length > options.maxItems) {
      paths.push({ path, original_length: value.length, kept: options.maxItems });
    }
    return kept.map((item, index) => visit(item, `${path}[${index}]`, depth + 1, options, paths));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      output[key] = visit(child, path === "$" ? key : `${path}.${key}`, depth + 1, options, paths);
    }
    return output;
  }

  return value as JsonValue;
}
