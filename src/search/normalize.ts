import { EndpointCatalogEntry } from "../catalog/types.js";
import { splitWords, toSnakeCase, unique } from "../catalog/stringUtils.js";
import { DOMAIN_TERMS, STOPWORDS } from "./dictionaries/domainTerms.js";
import { PLATFORM_DICTIONARY } from "./dictionaries/platforms.js";

export type NormalizedQuery = {
  original: string;
  platform?: string;
  terms: string[];
  aliases: string[];
  phrase: string;
  explicit_version?: string;
};

export function normalizeQuery(
  query: string,
  explicitPlatform?: string | null,
  extraPlatformAliases: string[] = [],
  allowAutomaticPlatformDetection = true,
  resolvedCanonicalPlatform?: string
): NormalizedQuery {
  const aliases: string[] = [];
  const platformMatch = detectPlatform(
    explicitPlatform
      ? `${explicitPlatform} ${query}`
      : allowAutomaticPlatformDetection
        ? query
        : "",
    aliases
  );
  const platform = resolvedCanonicalPlatform ?? platformMatch?.platform;
  if (resolvedCanonicalPlatform && !platformMatch) {
    aliases.push(
      `${explicitPlatform ?? resolvedCanonicalPlatform} -> ${resolvedCanonicalPlatform}`
    );
  }
  const explicitVersion = query.match(/(?:^|[^a-z0-9])(v\d+)(?:$|[^a-z0-9])/i)?.[1].toLowerCase();
  const withoutPlatform = stripPlatform(query, platform, extraPlatformAliases);
  const phrase = withoutPlatform
    .replace(/(?:^|[^a-z0-9])v\d+(?=$|[^a-z0-9])/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const terms = normalizeTerms(phrase, aliases);

  return {
    original: query,
    platform,
    terms,
    aliases,
    phrase,
    explicit_version: explicitVersion,
  };
}

export function endpointSearchText(endpoint: EndpointCatalogEntry): string {
  return [
    endpoint.endpoint_id,
    endpoint.platform,
    endpoint.platform_name,
    ...endpoint.platform_aliases,
    endpoint.method_name,
    endpoint.path,
    endpoint.title,
    endpoint.title_en,
    endpoint.description,
    endpoint.description_en,
    ...endpoint.tags,
    ...endpoint.tags_en,
    ...endpoint.search_tokens,
    ...endpoint.params.flatMap((param) => [
      param.name,
      param.api_name,
      param.description,
      param.description_en,
    ]),
  ]
    .join(" ")
    .toLowerCase();
}

function normalizeTerms(query: string, aliases: string[]): string[] {
  const values: string[] = [];
  const lower = query.toLowerCase();
  const snakeWords = splitWords(lower);
  values.push(...snakeWords);

  for (const [canonical, synonyms] of Object.entries(DOMAIN_TERMS)) {
    if (synonyms.some((synonym) => lower.includes(synonym.toLowerCase()))) {
      values.push(canonical);
      aliases.push(`${matchedSynonym(lower, synonyms)} -> ${canonical}`);
    }
  }

  const cjkChunks = lower.match(/[\u4e00-\u9fff]{1,12}/g) ?? [];
  values.push(...cjkChunks);

  return unique(
    values.filter((term) => term && !STOPWORDS.has(term) && isSpecificSearchTerm(term))
  );
}

function isSpecificSearchTerm(term: string): boolean {
  const cjkLength = (term.match(/[\u4e00-\u9fff]/g) ?? []).length;
  if (cjkLength > 0) return cjkLength >= 2;
  return term.replace(/[^a-z0-9]+/gi, "").length >= 3;
}

function detectPlatform(
  text: string,
  aliases: string[]
): { platform: string; alias: string } | undefined {
  const lower = text.toLowerCase();
  const normalized = toSnakeCase(lower);
  let best: { platform: string; score: number; alias: string } | null = null;

  for (const [platform, entry] of Object.entries(PLATFORM_DICTIONARY)) {
    for (const alias of [platform, entry.name, ...entry.aliases]) {
      const aliasLower = alias.toLowerCase();
      const aliasSnake = toSnakeCase(aliasLower);
      let score = 0;
      if (containsAlias(lower, aliasLower)) score = aliasLower.length + 20;
      else if (aliasSnake.length >= 3 && normalized.includes(aliasSnake)) {
        score = aliasSnake.length + 15;
      } else if (
        aliasLower.length >= 2 &&
        Math.abs(lower.trim().length - aliasLower.length) <= 1 &&
        editDistance(lower.trim(), aliasLower) <= 1
      )
        score = 10;
      else if (
        aliasSnake.length >= 3 &&
        Math.abs(normalized.length - aliasSnake.length) <= 1 &&
        editDistance(normalized, aliasSnake) <= 1
      )
        score = 8;

      if (score > (best?.score ?? 0)) {
        best = { platform, score, alias };
      }
    }
  }

  if (best) {
    aliases.push(`${best.alias} -> ${best.platform}`);
    return { platform: best.platform, alias: best.alias };
  }
  return undefined;
}

function stripPlatform(
  query: string,
  platform: string | undefined,
  extraPlatformAliases: string[]
): string {
  if (!platform) return query;
  const entry = PLATFORM_DICTIONARY[platform];
  let result = query;
  for (const alias of unique([
    platform,
    entry?.name ?? "",
    ...(entry?.aliases ?? []),
    ...extraPlatformAliases,
  ]).sort((a, b) => b.length - a.length)) {
    if (!alias) continue;
    if (/^[a-z0-9]+$/i.test(alias) && alias.length <= 2) {
      result = result.replace(
        new RegExp(`(^|[^a-z0-9])${escapeRegExp(alias)}($|[^a-z0-9])`, "gi"),
        "$1 $2"
      );
    } else {
      result = result.replace(new RegExp(escapeRegExp(alias), "gi"), " ");
    }
  }
  return result;
}

function containsAlias(text: string, alias: string): boolean {
  if (!/^[a-z0-9 ]+$/i.test(alias) || alias.length > 2) return text.includes(alias);
  return new RegExp(`(?:^|[^a-z0-9])${escapeRegExp(alias)}(?:$|[^a-z0-9])`, "i").test(text);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchedSynonym(lower: string, synonyms: string[]): string {
  return synonyms.find((synonym) => lower.includes(synonym.toLowerCase())) ?? synonyms[0];
}

function editDistance(a: string, b: string): number {
  if (!a || !b) return Math.max(a.length, b.length);
  if (Math.abs(a.length - b.length) > 2) return 99;

  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]) + 1;
    }
  }
  return dp[a.length][b.length];
}
