import { EndpointHighlight, HighlightKind } from "./types.js";
import { unique } from "./stringUtils.js";

const HIGHLIGHT_KINDS = new Set<HighlightKind>([
  "CAPABILITY",
  "LIMITATION",
  "CONDITION",
  "GUIDANCE",
]);
const HIGHLIGHT_TYPES = new Set<EndpointHighlight["type"]>(["INFO", "TIP", "WARNING", "DANGER"]);

export function normalizeHighlights(
  highlights: readonly unknown[] | null | undefined
): EndpointHighlight[] {
  return (highlights ?? []).map((item, index) => normalizeHighlight(item, index));
}

export function normalizeHighlight(item: unknown, index = 0): EndpointHighlight {
  if (typeof item === "string") {
    return {
      type: "INFO",
      content: item,
      kind: "GUIDANCE",
    };
  }

  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`x-highlights[${index}] must be a string or object`);
  }
  const raw = item as EndpointHighlight & {
    kind?: string;
    aliases?: unknown;
    fieldPaths?: unknown;
  };
  const kind = normalizeKind(raw.kind, index);
  const content = typeof raw.content === "string" ? raw.content.trim() : "";
  if (!content) throw new Error(`x-highlights[${index}] must have non-empty content`);

  const concept = typeof raw.concept === "string" ? raw.concept.trim() : undefined;
  const aliases = normalizeStringArray(raw.aliases);
  const fieldPaths = normalizeStringArray(raw.fieldPaths);
  if (kind !== "GUIDANCE" && (!concept || aliases.length === 0)) {
    throw new Error(
      `x-highlights[${index}] with kind ${kind} must define concept and at least one alias`
    );
  }
  if (concept && !/^[a-z][a-z0-9_]*$/.test(concept)) {
    throw new Error(`x-highlights[${index}].concept must be a stable snake_case identifier`);
  }
  for (const fieldPath of fieldPaths) {
    if (!/^\$\.data(?:\.[A-Za-z_][A-Za-z0-9_-]*|\[\*\])*$/.test(fieldPath)) {
      throw new Error(
        `x-highlights[${index}].fieldPaths must use the supported $.data JSONPath subset`
      );
    }
  }

  const typeValue = String(raw.type ?? "INFO").toUpperCase() as EndpointHighlight["type"];
  const title = typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : undefined;
  return {
    type: HIGHLIGHT_TYPES.has(typeValue) ? typeValue : "INFO",
    title,
    content,
    kind,
    concept,
    aliases: aliases.length ? aliases : undefined,
    fieldPaths: fieldPaths.length ? fieldPaths : undefined,
  };
}

function normalizeKind(value: string | undefined, index: number): HighlightKind {
  if (!value) return "GUIDANCE";
  const normalized = value.toUpperCase() as HighlightKind;
  if (!HIGHLIGHT_KINDS.has(normalized)) {
    throw new Error(`x-highlights[${index}].kind is invalid`);
  }
  return normalized;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return unique(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
  );
}
