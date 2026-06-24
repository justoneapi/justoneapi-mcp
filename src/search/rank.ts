import { EndpointCatalogEntry } from "../catalog/types.js";
import { endpointSearchText, normalizeQuery, NormalizedQuery } from "./normalize.js";

export type SearchEndpointInput = {
  query: string;
  platform?: string;
  limit?: number;
  include_deprecated?: boolean;
  include_hidden?: boolean;
};

export type SearchEndpointResult = {
  endpoint_id: string;
  platform: string;
  title: string;
  title_en: string;
  description: string;
  version: string;
  deprecated: boolean;
  hidden: boolean;
  score: number;
  required_params: string[];
  matched: string[];
};

export type SearchEndpointOutput = {
  success: true;
  query: string;
  normalized: NormalizedQuery;
  confidence: "high" | "medium" | "low";
  results: SearchEndpointResult[];
  next_step: string;
  clarification?: string;
};

export function searchEndpoints(
  endpoints: EndpointCatalogEntry[],
  input: SearchEndpointInput
): SearchEndpointOutput {
  const normalized = normalizeQuery(input.query, input.platform);
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const pool = endpoints.filter((endpoint) => {
    if (!input.include_deprecated && endpoint.deprecated) return false;
    if (!input.include_hidden && endpoint.hidden) return false;
    if (normalized.platform && endpoint.platform !== normalized.platform) return false;
    return true;
  });

  const results = pool
    .map((endpoint) => scoreEndpoint(endpoint, normalized))
    .filter((result) => result.score > 0 || normalized.platform)
    .sort((a, b) => b.score - a.score || a.endpoint_id.localeCompare(b.endpoint_id))
    .slice(0, limit);

  const confidence = confidenceFor(results);
  return {
    success: true,
    query: input.query,
    normalized,
    confidence,
    results,
    next_step: "Call get_endpoint_schema with the best endpoint_id before call_endpoint.",
    clarification:
      confidence === "low"
        ? "请确认平台或数据类型，例如：抖音视频评论、小红书笔记详情、亚马逊商品评论。"
        : undefined,
  };
}

function scoreEndpoint(
  endpoint: EndpointCatalogEntry,
  query: NormalizedQuery
): SearchEndpointResult {
  let score = 0;
  const matched: string[] = [];
  const text = endpointSearchText(endpoint);

  if (query.platform && query.platform === endpoint.platform) {
    score += 100;
    matched.push(`platform:${endpoint.platform}`);
  }

  for (const term of query.terms) {
    const termLower = term.toLowerCase();
    if (!termLower) continue;

    if (endpoint.endpoint_id.includes(termLower) || endpoint.method_name.includes(termLower)) {
      score += 45;
      matched.push(`endpoint:${term}`);
      continue;
    }
    if (endpoint.path.toLowerCase().includes(termLower)) {
      score += 35;
      matched.push(`path:${term}`);
      continue;
    }
    if (
      endpoint.title.toLowerCase().includes(termLower) ||
      endpoint.title_en.toLowerCase().includes(termLower)
    ) {
      score += 35;
      matched.push(`title:${term}`);
      continue;
    }
    if (endpoint.search_tokens.includes(termLower)) {
      score += 12;
      matched.push(`token:${term}`);
      continue;
    }
    if (
      endpoint.params.some(
        (param) =>
          param.name.includes(termLower) || param.api_name.toLowerCase().includes(termLower)
      )
    ) {
      score += 10;
      matched.push(`param:${term}`);
      continue;
    }
    if (text.includes(termLower)) {
      score += 6;
      matched.push(`text:${term}`);
    }
  }

  if (endpoint.recommended) score += 10;
  if (endpoint.deprecated) score -= 100;
  if (endpoint.hidden) score -= 40;
  score += versionBonus(endpoint.version);

  return {
    endpoint_id: endpoint.endpoint_id,
    platform: endpoint.platform,
    title: endpoint.title,
    title_en: endpoint.title_en,
    description: endpoint.description,
    version: endpoint.version,
    deprecated: endpoint.deprecated,
    hidden: endpoint.hidden,
    score,
    required_params: endpoint.params.filter((param) => param.required).map((param) => param.name),
    matched,
  };
}

function versionBonus(version: string): number {
  const parsed = Number(version.replace(/^v/i, ""));
  return Number.isFinite(parsed) ? Math.min(parsed * 3, 30) : 0;
}

function confidenceFor(results: SearchEndpointResult[]): "high" | "medium" | "low" {
  if (!results.length) return "low";
  const [first, second] = results;
  if (first.score >= 120 && (!second || first.score - second.score >= 30)) return "high";
  if (first.score >= 60) return "medium";
  return "low";
}
