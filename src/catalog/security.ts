const FORBIDDEN_KEYS = new Set([
  "actualapicode",
  "actualsupplier",
  "suppliercode",
  "supplierdomain",
  "routeref",
  "routeid",
  "internalroute",
  "candidateid",
  "functionid",
  "normalizerkey",
  "evidence",
  "fixture",
  "authheader",
  "authorization",
  "cookie",
  "session",
  "proxy",
  "internalip",
  "databaseid",
  "accesstoken",
  "secrettoken",
  "token",
  "apikey",
  "secret",
]);

const FORBIDDEN_TEXT = [
  /\bsupplier\s+(?:maps?|mapping|code|domain|route|endpoint|id)\b/i,
  /\b(?:sent|mapped?|maps?)\s+(?:to\s+)?(?:the\s+)?supplier\b/i,
  /\bupstream\s+(?:response|flow|endpoint|api|provider|supplier)\b/i,
  /\b(?:actual|internal|selected)\s+(?:api|supplier|route|candidate|function)\b/i,
  /\b(?:routeRef|functionId|actualApiCode|actualSupplier|normalizerKey)\b/i,
  /(?:上游响应|上游流程|供应商映射|发送给供应商|内部路由|函数\s*ID|认证头)/i,
  /\b(?:authorization|cookie)\s*:/i,
  /bearer\s+[a-z0-9._~-]{8,}/i,
  /sk_(?:live|test)_[a-z0-9_-]{8,}/i,
  /sk-(?:(?:proj|svcacct)-)?[a-z0-9_-]{12,}/i,
  /(?:ghp|github_pat)_[a-z0-9_-]{8,}/i,
  /xox[baprs]-[a-z0-9-]{10,}/i,
  /(?:AKIA|ASIA)[A-Z0-9]{16}/,
  /AIza[A-Za-z0-9_-]{35}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
];

const FORBIDDEN_TEXT_TOKEN_SEQUENCES = [
  ["supplier", "map"],
  ["supplier", "maps"],
  ["supplier", "mapping"],
  ["sent", "to", "supplier"],
  ["sent", "to", "the", "supplier"],
  ["mapped", "to", "supplier"],
  ["mapped", "to", "the", "supplier"],
  ["upstream", "response"],
  ["upstream", "flow"],
  ["upstream", "endpoint"],
  ["upstream", "api"],
  ["upstream", "provider"],
  ["upstream", "supplier"],
  ["actual", "api"],
  ["actual", "supplier"],
  ["internal", "supplier"],
  ["internal", "route"],
  ["selected", "supplier"],
  ["selected", "route"],
  ["route", "ref"],
  ["function", "id"],
  ["normalizer", "key"],
] as const;

const CREDENTIAL_PARAMETER_NAMES = new Set([
  "authorization",
  "auth",
  "token",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "secret",
  "clientsecret",
  "cookie",
  "credential",
  "password",
  "passwd",
  "passphrase",
  "signature",
]);

// `cookies_buffer` is a legacy public name for an opaque pagination cursor on
// these seven endpoints. It is not an authentication cookie, but it remains a
// credential-like name everywhere else. Keep this allowlist operation-scoped
// so a future endpoint cannot inherit the exception by naming a parameter the
// same way.
const LEGACY_PUBLIC_PAGINATION_OPERATIONS = new Set([
  "POST /api/weixin/search-article/v1",
  "POST /api/weixin/search-article/v2",
  "POST /api/weixin/search-miniprogram/v1",
  "POST /api/weixin/search-account/v2",
  "POST /api/weixin-channels/search-video/v1",
  "POST /api/weixin-channels/search-video/v2",
  "POST /api/weixin-channels/search-account/v1",
]);

type PublicOperationIdentity = {
  method: string;
  path: string;
};

type PublicParameterCandidate = {
  name?: unknown;
  api_name?: unknown;
  apiName?: unknown;
  in?: unknown;
  required?: unknown;
  type?: unknown;
  format?: unknown;
  default?: unknown;
  enum?: unknown;
  const?: unknown;
  example?: unknown;
  examples?: unknown;
  nullable?: unknown;
  minimum?: unknown;
  maximum?: unknown;
  min_length?: unknown;
  max_length?: unknown;
  description?: unknown;
  description_en?: unknown;
};

type SafetyScanMode = "strict" | "catalog";

const LEGACY_PUBLIC_PAGINATION_PARAMETER_KEYS = new Set([
  "name",
  "api_name",
  "apiName",
  "in",
  "required",
  "type",
  "format",
  "default",
  "enum",
  "const",
  "example",
  "examples",
  "nullable",
  "minimum",
  "maximum",
  "min_length",
  "max_length",
  "description",
  "description_en",
]);

const PUBLIC_HOST_SUFFIXES = [
  "justoneapi.com",
  "example.com",
  "example.org",
  "example.net",
  "kuaishou.com",
  "b23.tv",
  "amazon.com",
  "facebook.com",
  "douyin.com",
  "xhslink.com",
  "xiaohongshu.com",
  "weixin.qq.com",
  "bilibili.com",
  "youtube.com",
  "youtu.be",
  "tiktok.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "reddit.com",
  "jd.com",
  "taobao.com",
  "tmall.com",
  "1688.com",
];

const ABSOLUTE_URL_RE = /[a-z][a-z0-9+.-]*:\/\/[^\s<>`"'{}]+/gi;
const EMBEDDED_ABSOLUTE_SCHEME_RE = /([a-z][a-z0-9+.-]*):\/\//gi;
const URL_LIST_SEPARATOR_RE = /[,;]\s*(?=(?:[a-z][a-z0-9+.-]*:)?\/\/)/gi;
const SCHEME_RELATIVE_URL_RE = /\/\/[^\s<>`"'{}]+/gim;
const URI_SCHEME_RE = /(^|[^a-z0-9+.-])([a-z][a-z0-9+.-]*):(?=\S)/gim;
const DAYS_RANGE_FORMAT_RE = /\bdays:(?:min|\d*)-(?:max|\d*)(?=$|[^a-z0-9_-])/gi;
const CLOCK_FORMAT_RE = /\bhh:mm(?::ss)?\b/gi;
const PUBLIC_IDENTIFIER_TOKEN_RE = /[A-Z]+(?=[A-Z][a-z]|[^A-Za-z]|$)|[A-Z]?[a-z]+|[A-Z]+|[0-9]+/g;
const PRIVATE_IPV4_RE = /(?:^|[^0-9])((?:\d{1,3}\.){3}\d{1,3})(?=$|[^0-9])/g;
const PRIVATE_HOST_RE =
  /(?:^|[^a-z0-9.-])((?:[a-z0-9-]+\.)*(?:localhost|[a-z0-9-]+\.(?:internal|local)))(?:\.)?(?=$|[^a-z0-9.-])/gi;
const IP_LITERAL_CANDIDATE_RE = /(?:^|[^a-f0-9:.])([a-f0-9:.]*:[a-f0-9:.]+)(?=$|[^a-f0-9:.])/gi;
const SENSITIVE_QUERY_KEY_TOKENS = new Set([
  "auth",
  "authorization",
  "cookie",
  "credential",
  "credentials",
  "key",
  "password",
  "passwd",
  "passphrase",
  "secret",
  "session",
  "signature",
  "token",
]);
const SENSITIVE_QUERY_KEY_COMPACT = new Set([
  "accesskey",
  "apikey",
  "jwt",
  "secretkey",
  "session",
  "sessionid",
  "sig",
]);
const SENSITIVE_QUERY_KEY_COMPACT_RE =
  /^(?:x?api|access|secret|auth|refresh|bearer|session|credential|client)(?:key|token|secret|id)$/;

export function assertSafePublicValue(value: unknown, context = "catalog"): void {
  visit(value, context, new Map<object, number>(), "strict");
}

/**
 * Validate a public catalog projection while retaining the seven documented
 * legacy `cookies_buffer` pagination parameters. Generic public projections
 * remain strict through `assertSafePublicValue`.
 */
export function assertSafeCatalogValue(value: unknown, context = "catalog"): void {
  visit(value, context, new Map<object, number>(), "catalog");
}

export function isCredentialParameterName(value: string): boolean {
  const normalized = value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (CREDENTIAL_PARAMETER_NAMES.has(normalized)) return true;
  const tokens = identifierTokens(value);
  return (
    tokens.some((token) =>
      [
        "authorization",
        "credential",
        "credentials",
        "cookie",
        "cookies",
        "password",
        "passwd",
        "passphrase",
        "signature",
      ].includes(token)
    ) ||
    hasAnyTokenSequence(tokens, [
      ["access", "token"],
      ["refresh", "token"],
      ["secret", "token"],
      ["client", "secret"],
      ["api", "key"],
      ["api", "keys"],
      ["auth", "header"],
      ["auth", "token"],
    ]) ||
    tokens.includes("secret")
  );
}

export function isLegacyPublicPaginationOperation(operation: PublicOperationIdentity): boolean {
  return LEGACY_PUBLIC_PAGINATION_OPERATIONS.has(operationKey(operation));
}

export function isAllowedLegacyPaginationParameter(
  operation: PublicOperationIdentity,
  parameter: PublicParameterCandidate
): boolean {
  if (!isLegacyPublicPaginationOperation(operation)) return false;
  if (Object.keys(parameter).some((key) => !LEGACY_PUBLIC_PAGINATION_PARAMETER_KEYS.has(key))) {
    return false;
  }
  const names = [parameter.name, parameter.api_name, parameter.apiName].filter(
    (value): value is string => typeof value === "string"
  );
  if (!names.length || names.some((name) => name !== "cookies_buffer")) return false;
  if (parameter.in !== "query" && parameter.in !== "body") return false;
  if (parameter.required !== undefined && parameter.required !== false) return false;
  if (parameter.type !== undefined && parameter.type !== "string") return false;
  if (parameter.format !== undefined || parameter.nullable !== undefined) return false;
  if (
    parameter.minimum !== undefined ||
    parameter.maximum !== undefined ||
    parameter.min_length !== undefined ||
    parameter.max_length !== undefined
  ) {
    return false;
  }
  if (parameter.default !== undefined && parameter.default !== "") return false;
  if (
    parameter.enum !== undefined ||
    parameter.const !== undefined ||
    parameter.example !== undefined ||
    parameter.examples !== undefined
  ) {
    return false;
  }
  const description =
    typeof parameter.description_en === "string"
      ? parameter.description_en
      : typeof parameter.description === "string"
        ? parameter.description
        : "";
  return (
    /\bopaque pagination state\b/i.test(description) &&
    /\bprevious\b[^.]*\bresponse\b/i.test(description) &&
    /\bfirst page\b/i.test(description)
  );
}

export function assertNoCredentialParameterValues(
  name: string,
  schema: Record<string, unknown> | undefined,
  path: string
): void {
  if (!isCredentialParameterName(name) || !schema) return;
  for (const key of ["default", "enum", "const", "example", "examples"]) {
    if (schema[key] !== undefined) {
      throw new Error(`Credential value in public catalog at ${path}.${key}`);
    }
  }
}

function visit(
  value: unknown,
  path: string,
  seen: Map<object, number>,
  mode: SafetyScanMode,
  allowedCredentialParameter = false
): void {
  if (typeof value === "string") {
    assertSafeText(value, path, mode);
    return;
  }
  if (!value || typeof value !== "object") return;
  // The same object may be reachable once through the narrowly allowed
  // parameter position and once through a strict position. Track both visit
  // contexts independently so reference reuse cannot bypass the strict scan.
  const visitBit = allowedCredentialParameter ? 1 : 2;
  const visited = seen.get(value) ?? 0;
  if ((visited & visitBit) !== 0) return;
  seen.set(value, visited | visitBit);

  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`, seen, mode));
    return;
  }

  const record = value as Record<string, unknown>;
  const parameterName =
    typeof record.api_name === "string"
      ? record.api_name
      : typeof record.apiName === "string"
        ? record.apiName
        : typeof record.name === "string" &&
            (typeof record.in === "string" ||
              /(?:^|\.)parameters?(?:\[|\.|$)|(?:^|\.)params(?:\[|\.|$)/i.test(path))
          ? record.name
          : undefined;
  if (parameterName && isCredentialParameterName(parameterName) && !allowedCredentialParameter) {
    throw new Error(`Credential parameter in public catalog at ${path}`);
  }

  const operation = catalogOperationIdentity(record, mode);

  for (const [key, child] of Object.entries(value)) {
    if (isForbiddenPublicKey(key)) {
      throw new Error(`Unsafe public catalog key at ${path}`);
    }
    assertSafeText(key, `${path} key`, mode);
    if (key === "params" && operation && Array.isArray(child)) {
      child.forEach((item, index) => {
        const allowed = isRecord(item) && isAllowedLegacyPaginationParameter(operation, item);
        visit(item, `${path}.${key}[${index}]`, seen, mode, allowed);
      });
      continue;
    }
    visit(child, `${path}.${key}`, seen, mode);
  }
}

function catalogOperationIdentity(
  value: Record<string, unknown>,
  mode: SafetyScanMode
): PublicOperationIdentity | undefined {
  if (
    mode !== "catalog" ||
    typeof value.method !== "string" ||
    typeof value.path !== "string" ||
    !Array.isArray(value.params)
  ) {
    return undefined;
  }
  return { method: value.method, path: value.path };
}

function operationKey(operation: PublicOperationIdentity): string {
  return `${operation.method.toUpperCase()} ${operation.path}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSafeText(
  value: string,
  path: string,
  mode: SafetyScanMode,
  nestedUrlDepth = 0
): void {
  assertSafeDecodedComponent(value, path);
  const urlListSegments = value.split(URL_LIST_SEPARATOR_RE);
  if (urlListSegments.length > 1) {
    for (const [index, segment] of urlListSegments.entries()) {
      assertSafeText(segment, `${path} URL list item ${index}`, mode, nestedUrlDepth);
    }
    return;
  }

  // Preserve string offsets while removing the two exact compact formats
  // documented by public parameters. A bare `days:anything` or `hh:anything`
  // remains subject to URI checks.
  const uriScanValue = value
    .replace(DAYS_RANGE_FORMAT_RE, (match) => " ".repeat(match.length))
    .replace(CLOCK_FORMAT_RE, (match) => " ".repeat(match.length));
  const absoluteUrlMatches = [...uriScanValue.matchAll(ABSOLUTE_URL_RE)];

  for (const match of absoluteUrlMatches) {
    let url: URL;
    try {
      // Do not strip `]`: it may close a valid IPv6 host literal.
      url = new URL(match[0].replace(/[),.;}>]+$/, ""));
    } catch {
      throw new Error(`Malformed URL in public catalog at ${path}`);
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`Non-public URL protocol in public catalog at ${path}`);
    }
    if (url.username || url.password) {
      throw new Error(`Credential-bearing URL in public catalog at ${path}`);
    }

    const host = normalizeHostname(decodeUrlComponent(url.hostname, path));
    assertSafeDecodedComponent(host, `${path} URL host`);
    if (
      isPrivateHost(host) ||
      !PUBLIC_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
    ) {
      throw new Error(`Non-public URL in public catalog at ${path}`);
    }
    if (url.port) {
      throw new Error(`Non-public URL port in public catalog at ${path}`);
    }

    const decodedPath = decodeUrlComponent(url.pathname, path);
    const decodedHash = decodeUrlComponent(url.hash, path);
    assertSafeDecodedComponent(decodedPath, `${path} URL path`);
    assertSafeDecodedComponent(decodedHash, `${path} URL fragment`);
    assertSafeNestedUrlComponent(decodedPath, `${path} URL path`, mode, nestedUrlDepth);
    assertSafeNestedUrlComponent(decodedHash, `${path} URL fragment`, mode, nestedUrlDepth);

    for (const [rawKey, rawValue] of url.searchParams.entries()) {
      const key = decodeUrlComponent(rawKey, path);
      assertSafeDecodedComponent(key, `${path} query key`);
      if (isSensitiveQueryKey(key)) {
        throw new Error(`Credential-bearing URL in public catalog at ${path}`);
      }
      const decodedValue = decodeUrlComponent(rawValue, path);
      assertSafeDecodedComponent(decodedValue, `${path} query value`);
      if (nestedUrlDepth >= 3 && /[a-z][a-z0-9+.-]*:\/\//i.test(decodedValue)) {
        throw new Error(`Nested URL value in public catalog at ${path}`);
      }
      assertSafeText(decodedValue, `${path} query value`, mode, nestedUrlDepth + 1);
    }
  }

  // Once complete absolute URLs have been parsed, mask them before scanning
  // for standalone URI schemes. This avoids treating IPv6 groups or colons in
  // a valid URL path as a second protocol while still rejecting javascript:,
  // mailto:, malformed http:, and scheme-relative values outside that URL.
  const standaloneUriScanValue = maskMatches(uriScanValue, absoluteUrlMatches);
  for (const match of standaloneUriScanValue.matchAll(URI_SCHEME_RE)) {
    const scheme = match[2].toLowerCase();
    const colonOffset = match[0].lastIndexOf(":");
    const remainderOffset = (match.index ?? 0) + colonOffset + 1;
    if (
      (scheme === "http" || scheme === "https") &&
      !standaloneUriScanValue.slice(remainderOffset).startsWith("//")
    ) {
      throw new Error(`Malformed URL in public catalog at ${path}`);
    }
    if (scheme !== "http" && scheme !== "https") {
      throw new Error(`Non-public URL protocol in public catalog at ${path}`);
    }
  }
  if (SCHEME_RELATIVE_URL_RE.test(standaloneUriScanValue)) {
    SCHEME_RELATIVE_URL_RE.lastIndex = 0;
    throw new Error(`Scheme-relative URL in public catalog at ${path}`);
  }
  SCHEME_RELATIVE_URL_RE.lastIndex = 0;
}

function assertSafeDecodedComponent(value: string, path: string): void {
  const textTokens = identifierTokens(value);
  if (
    FORBIDDEN_TEXT.some((pattern) => pattern.test(value)) ||
    FORBIDDEN_TEXT_TOKEN_SEQUENCES.some((sequence) => hasTokenSequence(textTokens, sequence))
  ) {
    throw new Error(`Unsafe internal wording in public catalog at ${path}`);
  }
  for (const match of value.matchAll(EMBEDDED_ABSOLUTE_SCHEME_RE)) {
    const scheme = match[1].toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      throw new Error(`Non-public URL protocol in public catalog at ${path}`);
    }
  }
  assertNoBarePrivateHost(value, path);
}

function assertSafeNestedUrlComponent(
  value: string,
  path: string,
  mode: SafetyScanMode,
  nestedUrlDepth: number
): void {
  if (!/[a-z][a-z0-9+.-]*:\/\//i.test(value) && !/(?:^|[,;])\s*\/\//.test(value)) return;
  if (nestedUrlDepth >= 3) {
    throw new Error(`Nested URL value in public catalog at ${path}`);
  }
  assertSafeText(value, path, mode, nestedUrlDepth + 1);
}

function isForbiddenPublicKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (FORBIDDEN_KEYS.has(normalized) || isCredentialParameterName(key)) return true;
  const tokens = identifierTokens(key);
  if (
    hasAnyTokenSequence(tokens, [
      ["route", "ref"],
      ["route", "id"],
      ["function", "id"],
      ["candidate", "id"],
      ["normalizer", "key"],
    ])
  ) {
    return true;
  }
  const internalActors = new Set([
    "actual",
    "internal",
    "selected",
    "provider",
    "supplier",
    "backend",
    "upstream",
    "debug",
    "proxy",
    "database",
  ]);
  const internalSubjects = new Set([
    "api",
    "route",
    "candidate",
    "function",
    "code",
    "id",
    "domain",
    "host",
    "address",
    "ip",
    "proxy",
    "database",
    "normalizer",
    "endpoint",
  ]);
  return (
    tokens.some((token) => internalActors.has(token)) &&
    tokens.some((token) => internalSubjects.has(token))
  );
}

function identifierTokens(value: string): string[] {
  return (value.match(PUBLIC_IDENTIFIER_TOKEN_RE) ?? []).map((token) => token.toLowerCase());
}

function hasAnyTokenSequence(tokens: string[], sequences: readonly (readonly string[])[]): boolean {
  return sequences.some((sequence) => hasTokenSequence(tokens, sequence));
}

function hasTokenSequence(tokens: string[], sequence: readonly string[]): boolean {
  if (!sequence.length || sequence.length > tokens.length) return false;
  return tokens.some((_, index) =>
    sequence.every((token, offset) => tokens[index + offset] === token)
  );
}

function assertNoBarePrivateHost(value: string, path: string): void {
  for (const match of value.matchAll(PRIVATE_IPV4_RE)) {
    if (isPrivateHost(match[1])) {
      throw new Error(`Non-public URL or private network address in public catalog at ${path}`);
    }
  }
  if (PRIVATE_HOST_RE.test(value)) {
    PRIVATE_HOST_RE.lastIndex = 0;
    throw new Error(`Non-public URL or private network address in public catalog at ${path}`);
  }
  PRIVATE_HOST_RE.lastIndex = 0;
  for (const match of value.matchAll(IP_LITERAL_CANDIDATE_RE)) {
    const candidate = normalizeHostname(match[1]);
    if (parseIpv6(candidate) && isPrivateHost(candidate)) {
      throw new Error(`Non-public URL or private network address in public catalog at ${path}`);
    }
  }
}

function decodeUrlComponent(value: string, path: string): string {
  let decoded = value;
  try {
    for (let round = 0; round < 3; round += 1) {
      if (!/%[0-9a-f]{2}/i.test(decoded)) return decoded;
      // URLSearchParams has already decoded one layer and a valid `%25`
      // intentionally becomes a literal percent. Shield lone percent signs
      // while continuing to unwrap complete percent triplets.
      const decodable = decoded.replace(/%(?![0-9a-f]{2})/gi, "%25");
      const next = decodeURIComponent(decodable);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    throw new Error(`Malformed URL encoding in public catalog at ${path}`);
  }
  if (/%[0-9a-f]{2}/i.test(decoded)) {
    throw new Error(`Excessively encoded URL in public catalog at ${path}`);
  }
  return decoded;
}

function maskMatches(value: string, matches: RegExpMatchArray[]): string {
  const result = value.split("");
  for (const match of matches) {
    const start = match.index ?? 0;
    result.fill(" ", start, start + match[0].length);
  }
  return result.join("");
}

function isSensitiveQueryKey(value: string): boolean {
  const compact = value.replace(/[^a-z0-9]/gi, "").toLowerCase();
  return (
    CREDENTIAL_PARAMETER_NAMES.has(compact) ||
    SENSITIVE_QUERY_KEY_COMPACT.has(compact) ||
    SENSITIVE_QUERY_KEY_COMPACT_RE.test(compact) ||
    identifierTokens(value).some((token) => SENSITIVE_QUERY_KEY_TOKENS.has(token))
  );
}

function isPrivateHost(host: string): boolean {
  const normalized = normalizeHostname(host);
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  )
    return true;

  const ipv4 = parseIpv4(normalized);
  if (ipv4) return isNonPublicIpv4(ipv4);

  const ipv6 = parseIpv6(normalized);
  if (!ipv6) return !normalized.includes(".");
  if (ipv6.every((byte) => byte === 0)) return true;
  if (ipv6.slice(0, 15).every((byte) => byte === 0) && ipv6[15] === 1) return true;
  if ((ipv6[0] & 0xfe) === 0xfc) return true;
  if (ipv6[0] === 0xfe && (ipv6[1] & 0xc0) === 0x80) return true;
  if (ipv6[0] === 0xfe && (ipv6[1] & 0xc0) === 0xc0) return true;
  if (ipv6[0] === 0xff) return true;
  if (ipv6[0] === 0x20 && ipv6[1] === 0x01 && ipv6[2] === 0x0d && ipv6[3] === 0xb8) {
    return true;
  }

  const mappedPrefix = ipv6.slice(0, 10).every((byte) => byte === 0);
  if (mappedPrefix && ipv6[10] === 0xff && ipv6[11] === 0xff) {
    return isNonPublicIpv4(ipv6.slice(12));
  }
  const compatiblePrefix = ipv6.slice(0, 12).every((byte) => byte === 0);
  return compatiblePrefix && isNonPublicIpv4(ipv6.slice(12));
}

function normalizeHostname(host: string): string {
  return host
    .replace(/^\[|\]$/g, "")
    .replace(/\.+$/, "")
    .toLowerCase();
}

function parseIpv4(value: string): number[] | undefined {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return undefined;
  const octets = parts.map(Number);
  return octets.some((octet) => octet > 255) ? undefined : octets;
}

function isNonPublicIpv4(octets: number[]): boolean {
  const [first, second] = octets;
  return (
    first === 0 ||
    first === 10 ||
    (first === 100 && second >= 64 && second <= 127) ||
    first === 127 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 0 && (octets[2] === 0 || octets[2] === 2)) ||
    (first === 192 && second === 88 && octets[2] === 99) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    (first === 198 && second === 51 && octets[2] === 100) ||
    (first === 203 && second === 0 && octets[2] === 113) ||
    first >= 224
  );
}

function parseIpv6(value: string): number[] | undefined {
  if (!value.includes(":")) return undefined;
  let normalized = value.toLowerCase();
  const ipv4Suffix = normalized.match(/(?:^|:)((?:\d{1,3}\.){3}\d{1,3})$/);
  if (ipv4Suffix) {
    const ipv4 = parseIpv4(ipv4Suffix[1]);
    if (!ipv4) return undefined;
    const firstGroup = (ipv4[0] << 8) | ipv4[1];
    const secondGroup = (ipv4[2] << 8) | ipv4[3];
    normalized = `${normalized.slice(0, -ipv4Suffix[1].length)}${firstGroup.toString(16)}:${secondGroup.toString(16)}`;
  }

  const halves = normalized.split("::");
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if ([...left, ...right].some((group) => !/^[a-f0-9]{1,4}$/.test(group))) return undefined;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) {
    return undefined;
  }
  const groups = [...left, ...Array(missing).fill("0"), ...right].map((group) =>
    Number.parseInt(group, 16)
  );
  if (groups.length !== 8) return undefined;
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}
