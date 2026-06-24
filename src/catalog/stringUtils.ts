const CAMEL_BOUNDARY = /([a-z0-9])([A-Z])/g;
const ACRONYM_BOUNDARY = /([A-Z]+)([A-Z][a-z])/g;

export function toSnakeCase(value: string): string {
  return value
    .replace(ACRONYM_BOUNDARY, "$1_$2")
    .replace(CAMEL_BOUNDARY, "$1_$2")
    .replace(/[\s\-./]+/g, "_")
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function splitWords(value: string): string[] {
  const snake = toSnakeCase(value);
  return snake.split("_").filter(Boolean);
}

export function unique(values: Iterable<string>): string[] {
  return Array.from(new Set(Array.from(values).filter(Boolean)));
}

export function normalizePlatform(value: string): string {
  return toSnakeCase(value.replace(/-/g, "_"));
}
