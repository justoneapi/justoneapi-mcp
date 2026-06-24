import { EndpointCatalogEntry } from "../catalog/types.js";

export type NextStep = {
  action: "call_endpoint";
  endpoint_id: string;
  params: Record<string, unknown>;
  hint: string;
} | null;

const RESPONSE_ALIASES: Record<string, string> = {
  nextCursor: "next_cursor",
  next_cursor: "next_cursor",
  cursor: "cursor",
  searchId: "search_id",
  search_id: "search_id",
  buffer: "buffer",
  last_buffer: "last_buffer",
};

export function inferNextStep(
  endpoint: EndpointCatalogEntry,
  inputParams: Record<string, unknown>,
  response: unknown
): NextStep {
  const found = findPaginationFields(response);
  const params: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(found)) {
    const normalized = RESPONSE_ALIASES[key] ?? key;
    if (value !== undefined && value !== null && value !== "") {
      params[normalized] = value;
    }
  }

  const pageParam = endpoint.pagination?.params.find((name) =>
    ["page", "page_no", "page_num", "current_page"].includes(name)
  );
  if (pageParam && inputParams[pageParam] !== undefined) {
    const nextPage = Number(inputParams[pageParam]) + 1;
    if (Number.isFinite(nextPage)) params[pageParam] = nextPage;
  } else if (pageParam && !Object.keys(params).length) {
    params[pageParam] = 2;
  }

  if (!Object.keys(params).length) return null;

  for (const [key, value] of Object.entries(inputParams)) {
    if (params[key] === undefined && shouldCarryParam(key)) {
      params[key] = value;
    }
  }

  return {
    action: "call_endpoint",
    endpoint_id: endpoint.endpoint_id,
    params,
    hint: "Use these params to fetch the next page or more results.",
  };
}

function shouldCarryParam(key: string): boolean {
  return ![
    "next_cursor",
    "cursor",
    "page",
    "page_no",
    "page_num",
    "current_page",
    "offset",
  ].includes(key);
}

function findPaginationFields(value: unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  visit(value, result, 0);
  return result;
}

function visit(value: unknown, result: Record<string, unknown>, depth: number) {
  if (!value || depth > 6 || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 3)) visit(item, result, depth + 1);
    return;
  }

  for (const [key, child] of Object.entries(value)) {
    if (Object.prototype.hasOwnProperty.call(RESPONSE_ALIASES, key)) {
      result[key] = child;
    }
    if (["hasMore", "has_more", "hasNext", "has_next"].includes(key) && child === false) {
      continue;
    }
    visit(child, result, depth + 1);
  }
}
