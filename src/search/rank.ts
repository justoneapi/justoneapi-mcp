import { EndpointCatalogEntry, EndpointHighlight } from "../catalog/types.js";
import { normalizeHighlights } from "../catalog/highlights.js";
import { splitWords, toSnakeCase, unique } from "../catalog/stringUtils.js";
import { endpointSearchText, normalizeQuery, NormalizedQuery } from "./normalize.js";

export type SearchEndpointInput = {
  query: string;
  platform?: string;
  limit?: number;
  include_deprecated?: boolean;
  include_hidden?: boolean;
};

export type SearchAlternative = {
  endpoint_id: string;
  version: string;
  recommended: boolean;
  compatible: boolean;
  compatibility: "compatible" | "incompatible" | "unknown";
  limitations: EndpointHighlight[];
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
  matched_capabilities?: EndpointHighlight[];
  relevant_limitations?: EndpointHighlight[];
  conditions?: EndpointHighlight[];
  match_reasons?: string[];
  alternatives?: SearchAlternative[];
  conditional?: boolean;
  exact_match?: boolean;
};

export type SearchEndpointOutput = {
  success: true;
  query: string;
  normalized: NormalizedQuery;
  ranking_version: "legacy" | "v2";
  confidence: "high" | "medium" | "low";
  results: SearchEndpointResult[];
  next_step: string;
  clarification?: string;
};

export type SearchOptions = {
  mode?: "legacy" | "v2";
};

type WeightedSource = {
  label: string;
  weight: number;
  values: string[];
};

export function searchEndpoints(
  endpoints: EndpointCatalogEntry[],
  input: SearchEndpointInput,
  options: SearchOptions = {}
): SearchEndpointOutput {
  return options.mode === "v2" ? searchV2(endpoints, input) : searchLegacy(endpoints, input);
}

function searchV2(
  endpoints: EndpointCatalogEntry[],
  input: SearchEndpointInput
): SearchEndpointOutput {
  const dynamicPlatform = resolvePlatform(endpoints, input.query, input.platform);
  const dynamicAliases = dynamicPlatform
    ? platformAliasesFromCatalog(endpoints, dynamicPlatform)
    : [];
  const normalized = normalizeQuery(
    input.query,
    dynamicPlatform ?? input.platform,
    dynamicAliases,
    false,
    dynamicPlatform
  );
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const pool = visiblePoolV2(endpoints, input, normalized);
  if (
    !normalized.terms.length &&
    !pool.some((endpoint) => isExactEndpointQuery(endpoint, input.query))
  ) {
    return outputFor(input.query, normalized, "v2", "low", []);
  }

  const scored = pool
    .map((endpoint) => scoreEndpointV2(endpoint, normalized))
    .filter((result): result is SearchEndpointResult => result !== null)
    .filter((result) => result.exact_match || result.score >= 40)
    .sort((a, b) => compareV2(a, b, normalized, pool));

  const familyBest = foldFamilies(scored, pool, normalized);
  const results = familyBest.slice(0, limit).map((result) => ({
    ...result,
    alternatives: alternativesFor(result, pool, normalized),
  }));
  const confidence = confidenceForV2(results);
  return outputFor(input.query, normalized, "v2", confidence, results);
}

function scoreEndpointV2(
  endpoint: EndpointCatalogEntry,
  query: NormalizedQuery
): SearchEndpointResult | null {
  const exactMatch = isExactEndpointQuery(endpoint, query.original);
  const highlights = uniqueHighlights(endpoint);
  const limitations = highlights.filter((highlight) => highlight.kind === "LIMITATION");
  const conflictingLimitations = limitations.filter((highlight) =>
    highlightMatchesIntent(highlight, query)
  );
  if (conflictingLimitations.length) return null;

  const sources = weightedSources(endpoint, highlights);
  const termMatches = query.terms.map((term) => bestSourceForTerm(term, sources));
  const matchedTerms = termMatches.filter(
    (match): match is { label: string; weight: number; value: string } => Boolean(match)
  );
  const coverage = query.terms.length ? matchedTerms.length / query.terms.length : 0;
  const matchQuality = matchedTerms.length
    ? matchedTerms.reduce((sum, match) => sum + match.weight, 0) / matchedTerms.length
    : 0;
  const phraseMatched =
    query.terms.length > 0 && query.phrase ? sourceContainsPhrase(query.phrase, sources) : false;
  const conditions = highlights.filter((highlight) => highlight.kind === "CONDITION");
  const conditionPenalty = conditions.length ? 15 : 0;
  const score = exactMatch
    ? 200
    : roundScore(70 * coverage + 20 * matchQuality + (phraseMatched ? 10 : 0) - conditionPenalty);

  const capabilities = highlights
    .filter((highlight) => highlight.kind === "CAPABILITY")
    .filter((highlight) => highlightMatchesTerms(highlight, query));
  const reasons = unique([
    ...(query.platform === endpoint.platform ? [`platform:${endpoint.platform}`] : []),
    ...(exactMatch ? ["exact endpoint identifier"] : []),
    ...matchedTerms.map((match) => `${match.label}:${match.value}`),
    ...(phraseMatched ? ["full phrase"] : []),
    ...conditions.map((condition) => `condition:${condition.concept ?? condition.content}`),
  ]);

  return baseResult(endpoint, score, reasons, {
    matched_capabilities: capabilities,
    // Conflicting limitations exclude the endpoint above. The remaining
    // limitations are still returned so callers see important boundaries
    // before selecting or invoking an otherwise compatible endpoint.
    relevant_limitations: limitations,
    conditions,
    match_reasons: reasons,
    conditional: conditions.length > 0,
    exact_match: exactMatch,
  });
}

function weightedSources(
  endpoint: EndpointCatalogEntry,
  highlights: EndpointHighlight[]
): WeightedSource[] {
  const capabilities = highlights.filter((highlight) => highlight.kind === "CAPABILITY");
  return [
    {
      label: "title/alias",
      weight: 1,
      values: [endpoint.title, endpoint.title_en, ...(endpoint.search_aliases ?? [])],
    },
    {
      label: "use-case",
      weight: 0.95,
      values: (endpoint.use_cases ?? []).flatMap((useCase) => [
        useCase.id ?? "",
        useCase.title ?? "",
        useCase.title_en ?? "",
        useCase.description ?? "",
        useCase.description_en ?? "",
        ...(useCase.aliases ?? []),
      ]),
    },
    {
      label: "capability",
      weight: 0.95,
      values: capabilities.flatMap(highlightValues),
    },
    {
      label: "parameter",
      weight: 0.65,
      values: endpoint.params.flatMap((param) => [
        param.name,
        param.api_name,
        param.description,
        param.description_en,
      ]),
    },
    {
      label: "description",
      weight: 0.45,
      values: [endpoint.description, endpoint.description_en],
    },
  ].map((source) => ({ ...source, values: source.values.filter(Boolean) }));
}

function bestSourceForTerm(
  term: string,
  sources: WeightedSource[]
): { label: string; weight: number; value: string } | null {
  for (const source of sources) {
    const value = source.values.find((candidate) => textMatches(term, candidate));
    if (value) return { label: source.label, weight: source.weight, value };
  }
  return null;
}

function sourceContainsPhrase(phrase: string, sources: WeightedSource[]): boolean {
  const normalizedPhrase = comparable(phrase);
  if (!normalizedPhrase) return false;
  return sources.some((source) =>
    source.values.some((value) => comparable(value).includes(normalizedPhrase))
  );
}

function compareV2(
  a: SearchEndpointResult,
  b: SearchEndpointResult,
  query: NormalizedQuery,
  endpoints: EndpointCatalogEntry[]
): number {
  if (a.exact_match !== b.exact_match) return a.exact_match ? -1 : 1;
  if (query.explicit_version) {
    const aVersion = a.version === query.explicit_version;
    const bVersion = b.version === query.explicit_version;
    if (aVersion !== bVersion) return aVersion ? -1 : 1;
  }
  if (a.score !== b.score) return b.score - a.score;

  const aEndpoint = endpoints.find((endpoint) => endpoint.endpoint_id === a.endpoint_id)!;
  const bEndpoint = endpoints.find((endpoint) => endpoint.endpoint_id === b.endpoint_id)!;
  if (
    familyOf(aEndpoint) === familyOf(bEndpoint) &&
    aEndpoint.recommended !== bEndpoint.recommended
  ) {
    return aEndpoint.recommended ? -1 : 1;
  }
  return a.endpoint_id.localeCompare(b.endpoint_id);
}

function alternativesFor(
  result: SearchEndpointResult,
  pool: EndpointCatalogEntry[],
  query: NormalizedQuery
): SearchAlternative[] {
  const endpoint = pool.find((candidate) => candidate.endpoint_id === result.endpoint_id);
  if (!endpoint) return [];
  const familyCandidates = pool.filter((candidate) => familyOf(candidate) === familyOf(endpoint));
  const requiresPositiveEvidence = familyCandidates.some((candidate) =>
    endpointHasStructuredIntent(candidate, query)
  );
  return familyCandidates
    .filter((candidate) => candidate.endpoint_id !== endpoint.endpoint_id)
    .map((candidate) => {
      const limitations = uniqueHighlights(candidate).filter(
        (highlight) => highlight.kind === "LIMITATION" && highlightMatchesIntent(highlight, query)
      );
      const hasPositiveEvidence = endpointHasPositiveIntentEvidence(candidate, query);
      const compatibility: SearchAlternative["compatibility"] = limitations.length
        ? "incompatible"
        : requiresPositiveEvidence && !hasPositiveEvidence
          ? "unknown"
          : "compatible";
      return {
        endpoint_id: candidate.endpoint_id,
        version: candidate.version,
        recommended: candidate.recommended,
        compatible: compatibility === "compatible",
        compatibility,
        limitations,
      };
    })
    .sort((a, b) => {
      if (query.explicit_version) {
        const aVersion = a.version === query.explicit_version;
        const bVersion = b.version === query.explicit_version;
        if (aVersion !== bVersion) return aVersion ? -1 : 1;
      }
      if (a.compatible !== b.compatible) return a.compatible ? -1 : 1;
      if (a.compatibility !== b.compatibility) {
        return a.compatibility === "unknown" ? -1 : 1;
      }
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      return a.endpoint_id.localeCompare(b.endpoint_id);
    });
}

function endpointHasStructuredIntent(
  endpoint: EndpointCatalogEntry,
  query: NormalizedQuery
): boolean {
  return uniqueHighlights(endpoint)
    .filter((highlight) => ["CAPABILITY", "LIMITATION"].includes(highlight.kind))
    .some((highlight) => highlightMatchesIntent(highlight, query));
}

function endpointHasPositiveIntentEvidence(
  endpoint: EndpointCatalogEntry,
  query: NormalizedQuery
): boolean {
  return uniqueHighlights(endpoint)
    .filter((highlight) => highlight.kind === "CAPABILITY")
    .some((highlight) => highlightMatchesIntent(highlight, query));
}

function searchLegacy(
  endpoints: EndpointCatalogEntry[],
  input: SearchEndpointInput
): SearchEndpointOutput {
  const normalized = normalizeQuery(input.query, input.platform);
  const limit = Math.min(Math.max(input.limit ?? 8, 1), 20);
  const pool = visiblePool(endpoints, input, normalized.platform);
  if (
    !normalized.terms.length &&
    !pool.some((endpoint) => isExactEndpointQuery(endpoint, input.query))
  ) {
    return outputFor(input.query, normalized, "legacy", "low", []);
  }
  const results = pool
    .map((endpoint) => scoreEndpointLegacy(endpoint, normalized))
    .filter(
      (result) =>
        result.exact_match || result.matched.some((reason) => !reason.startsWith("platform:"))
    )
    .sort((a, b) => b.score - a.score || a.endpoint_id.localeCompare(b.endpoint_id))
    .slice(0, limit);
  return outputFor(input.query, normalized, "legacy", confidenceForLegacy(results), results);
}

function scoreEndpointLegacy(
  endpoint: EndpointCatalogEntry,
  query: NormalizedQuery
): SearchEndpointResult {
  let score = 0;
  const matched: string[] = [];
  const text = endpointSearchText(endpoint);
  const exactMatch = isExactEndpointQuery(endpoint, query.original);

  if (exactMatch) {
    score += 200;
    matched.push("exact endpoint identifier");
  }

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
    } else if (endpoint.path.toLowerCase().includes(termLower)) {
      score += 35;
      matched.push(`path:${term}`);
    } else if (
      endpoint.title.toLowerCase().includes(termLower) ||
      endpoint.title_en.toLowerCase().includes(termLower)
    ) {
      score += 35;
      matched.push(`title:${term}`);
    } else if (endpoint.search_tokens.includes(termLower)) {
      score += 12;
      matched.push(`token:${term}`);
    } else if (
      endpoint.params.some(
        (param) =>
          param.name.includes(termLower) || param.api_name.toLowerCase().includes(termLower)
      )
    ) {
      score += 10;
      matched.push(`param:${term}`);
    } else if (text.includes(termLower)) {
      score += 6;
      matched.push(`text:${term}`);
    }
  }
  if (endpoint.recommended) score += 10;
  if (endpoint.deprecated) score -= 100;
  if (endpoint.hidden) score -= 40;
  score += legacyVersionBonus(endpoint.version);
  return baseResult(endpoint, score, matched, { exact_match: exactMatch });
}

function legacyVersionBonus(version: string): number {
  const parsed = Number(version.replace(/^v/i, ""));
  return Number.isFinite(parsed) ? Math.min(parsed * 3, 30) : 0;
}

function baseResult(
  endpoint: EndpointCatalogEntry,
  score: number,
  matched: string[],
  extra: Partial<SearchEndpointResult> = {}
): SearchEndpointResult {
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
    ...extra,
  };
}

function visiblePool(
  endpoints: EndpointCatalogEntry[],
  input: SearchEndpointInput,
  platform?: string
): EndpointCatalogEntry[] {
  return endpoints.filter((endpoint) => {
    if (!input.include_deprecated && endpoint.deprecated) return false;
    if (!input.include_hidden && endpoint.hidden) return false;
    if (platform && endpoint.platform !== platform) return false;
    return true;
  });
}

function visiblePoolV2(
  endpoints: EndpointCatalogEntry[],
  input: SearchEndpointInput,
  query: NormalizedQuery
): EndpointCatalogEntry[] {
  return endpoints.filter((endpoint) => {
    // Hidden operations are never part of the public V2 catalog surface.
    if (endpoint.hidden) return false;
    if (query.platform && endpoint.platform !== query.platform) return false;
    if (
      endpoint.deprecated &&
      !input.include_deprecated &&
      !isExactEndpointQuery(endpoint, query.original) &&
      endpoint.version !== query.explicit_version
    ) {
      return false;
    }
    return true;
  });
}

function outputFor(
  query: string,
  normalized: NormalizedQuery,
  rankingVersion: "legacy" | "v2",
  confidence: "high" | "medium" | "low",
  results: SearchEndpointResult[]
): SearchEndpointOutput {
  return {
    success: true,
    query,
    normalized,
    ranking_version: rankingVersion,
    confidence,
    results,
    next_step: "Call get_endpoint_schema with the best endpoint_id before call_endpoint.",
    clarification:
      confidence === "low"
        ? "请确认平台或数据类型，例如：抖音视频评论、小红书笔记详情、亚马逊商品评论。"
        : undefined,
  };
}

function confidenceForV2(results: SearchEndpointResult[]): "high" | "medium" | "low" {
  if (!results.length) return "low";
  const [first, second] = results;
  let confidence: "high" | "medium" | "low";
  if (first.exact_match || (first.score >= 80 && (!second || first.score - second.score >= 8))) {
    confidence = "high";
  } else if (first.score >= 55) {
    confidence = "medium";
  } else {
    confidence = "low";
  }
  return first.conditional && confidence === "high" ? "medium" : confidence;
}

function confidenceForLegacy(results: SearchEndpointResult[]): "high" | "medium" | "low" {
  if (!results.length) return "low";
  const [first, second] = results;
  if (first.score >= 120 && (!second || first.score - second.score >= 30)) return "high";
  if (first.score >= 60) return "medium";
  return "low";
}

function isExactEndpointQuery(endpoint: EndpointCatalogEntry, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  return [endpoint.endpoint_id, endpoint.operation_id, endpoint.path].some(
    (value) => value.toLowerCase() === normalized
  );
}

function uniqueHighlights(endpoint: EndpointCatalogEntry): EndpointHighlight[] {
  const merged = new Map<string, EndpointHighlight>();
  for (const highlight of [
    ...normalizeHighlights(endpoint.highlights),
    ...normalizeHighlights(endpoint.highlights_en),
  ]) {
    const key =
      highlight.kind !== "GUIDANCE" && highlight.concept
        ? `${highlight.kind}:${highlight.concept}`
        : `GUIDANCE:${highlight.content}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, highlight);
      continue;
    }
    merged.set(key, {
      ...existing,
      aliases: unique([...(existing.aliases ?? []), ...(highlight.aliases ?? [])]),
      fieldPaths: unique([...(existing.fieldPaths ?? []), ...(highlight.fieldPaths ?? [])]),
    });
  }
  return [...merged.values()];
}

function highlightValues(highlight: EndpointHighlight): string[] {
  return [
    highlight.concept ?? "",
    highlight.title ?? "",
    highlight.content,
    ...(highlight.aliases ?? []),
    ...(highlight.fieldPaths ?? []),
  ];
}

function highlightMatchesTerms(highlight: EndpointHighlight, query: NormalizedQuery): boolean {
  return valueListMatches(highlightValues(highlight), query);
}

function highlightMatchesIntent(highlight: EndpointHighlight, query: NormalizedQuery): boolean {
  const queryPhrase = comparable(query.phrase);
  if (
    queryPhrase &&
    (highlight.aliases ?? []).some((alias) => {
      const candidate = comparable(alias);
      if (/[\u4e00-\u9fff]/.test(alias)) {
        const cjkLength = (alias.match(/[\u4e00-\u9fff]/g) ?? []).length;
        return cjkLength >= 2 && queryPhrase.includes(candidate);
      }
      if (candidate.length < 3) {
        if (candidate.length < 2 || !/^[a-z0-9]+$/i.test(candidate)) return false;
        const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(query.phrase);
      }
      const aliasTerms = splitWords(alias);
      const queryTerms = new Set(splitWords(query.phrase));
      return aliasTerms.length > 0 && aliasTerms.every((term) => queryTerms.has(term));
    })
  ) {
    return true;
  }
  const concept = comparable(highlight.concept ?? "");
  return Boolean(concept && query.terms.some((term) => comparable(term) === concept));
}

function valueListMatches(values: string[], query: NormalizedQuery): boolean {
  return (
    query.terms.some((term) => values.some((value) => textMatches(term, value))) ||
    Boolean(query.phrase && values.some((value) => textMatches(query.phrase, value)))
  );
}

function textMatches(term: string, candidate: string): boolean {
  const normalizedTerm = comparable(term);
  const normalizedCandidate = comparable(candidate);
  return Boolean(normalizedTerm && normalizedCandidate.includes(normalizedTerm));
}

function comparable(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "");
}

function resolvePlatform(
  endpoints: EndpointCatalogEntry[],
  query: string,
  explicitPlatform?: string
): string | undefined {
  const aliasesByPlatform = new Map<string, string[]>();
  const detectionAliasesByPlatform = new Map<string, string[]>();
  for (const endpoint of endpoints) {
    const aliases = aliasesByPlatform.get(endpoint.platform) ?? [];
    aliasesByPlatform.set(endpoint.platform, unique([...aliases, ...endpoint.platform_aliases]));
    const detectionAliases = detectionAliasesByPlatform.get(endpoint.platform) ?? [];
    detectionAliasesByPlatform.set(
      endpoint.platform,
      unique([...detectionAliases, ...(endpoint.platform_detection_aliases ?? [])])
    );
  }
  const input = explicitPlatform ?? query;
  const exact = explicitPlatform
    ? [...aliasesByPlatform.entries()].find(
        ([platform, aliases]) =>
          toSnakeCase(platform) === toSnakeCase(input) ||
          aliases.some((alias) => comparable(alias) === comparable(input))
      )
    : undefined;
  if (exact) return exact[0];

  // A reviewed operation alias can be more specific than a platform alias.
  // For example, a query beginning with a broad platform name may still be an
  // exact alias for a creator-marketplace operation on a distinct platform.
  // Only use this shortcut when the complete normalized query identifies one
  // platform; ambiguous aliases continue through normal platform detection.
  if (!explicitPlatform) {
    const normalizedQuery = comparable(query);
    const exactAliasPlatforms = unique(
      endpoints
        .filter((endpoint) =>
          (endpoint.search_aliases ?? []).some((alias) => comparable(alias) === normalizedQuery)
        )
        .map((endpoint) => endpoint.platform)
    );
    if (exactAliasPlatforms.length === 1) return exactAliasPlatforms[0];
  }

  let best: { platform: string; length: number } | undefined;
  for (const [platform, aliases] of detectionAliasesByPlatform) {
    for (const alias of aliases) {
      if (!queryContainsAlias(input, alias)) continue;
      if (alias.length > (best?.length ?? 0)) best = { platform, length: alias.length };
    }
  }
  return best?.platform;
}

function foldFamilies(
  results: SearchEndpointResult[],
  endpoints: EndpointCatalogEntry[],
  query: NormalizedQuery
): SearchEndpointResult[] {
  const groups = new Map<string, SearchEndpointResult[]>();
  for (const result of results) {
    const endpoint = endpoints.find((candidate) => candidate.endpoint_id === result.endpoint_id);
    if (!endpoint) continue;
    const family = familyOf(endpoint);
    const values = groups.get(family) ?? [];
    values.push(result);
    groups.set(family, values);
  }
  return [...groups.values()]
    .map((values) => {
      const exact = values.find((result) => result.exact_match);
      if (exact) return exact;
      if (query.explicit_version) {
        const explicit = values.find((result) => result.version === query.explicit_version);
        if (explicit) return explicit;
      }
      const capabilityBacked = values.filter(
        (result) => (result.matched_capabilities?.length ?? 0) > 0
      );
      const eligible = capabilityBacked.length ? capabilityBacked : values;
      const recommended = eligible.find(
        (result) =>
          endpoints.find((endpoint) => endpoint.endpoint_id === result.endpoint_id)?.recommended
      );
      return recommended ?? eligible[0];
    })
    .sort((a, b) => compareV2(a, b, query, endpoints));
}

function queryContainsAlias(query: string, alias: string): boolean {
  if (!alias) return false;
  const lower = query.toLowerCase();
  const candidate = alias.toLowerCase();
  if (!/^[a-z0-9 ]+$/i.test(candidate) || candidate.length > 2) {
    return lower.includes(candidate);
  }
  const escaped = candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(lower);
}

function platformAliasesFromCatalog(endpoints: EndpointCatalogEntry[], platform: string): string[] {
  return unique(
    endpoints
      .filter((endpoint) => endpoint.platform === platform)
      .flatMap((endpoint) => [
        ...endpoint.platform_aliases,
        ...(endpoint.platform_detection_aliases ?? []),
      ])
  );
}

function familyOf(endpoint: EndpointCatalogEntry): string {
  return (
    endpoint.endpoint_family ?? `${endpoint.platform}:${endpoint.path.replace(/\/v\d+\/?$/i, "")}`
  );
}

function roundScore(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}
