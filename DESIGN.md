# JustOneAPI MCP 2.0 Design

## Goals

JustOneAPI MCP 2.0 exposes the JustOneAPI platform as a small set of stable MCP
meta tools. It does not register one MCP tool per API endpoint. Instead, clients
discover endpoints, inspect schemas, and call endpoints dynamically.

The core workflow is:

```text
search_endpoints -> get_endpoint_schema -> call_endpoint
```

The OpenAPI documents published by JustOneAPI are the source of truth:

- English structure source: `https://docs.justoneapi.com/openapi.json`
- Chinese localization source: `https://docs.justoneapi.com/openapi-zh.json`

The English OpenAPI controls structure. The Chinese OpenAPI enriches titles,
descriptions, parameter descriptions, and search quality.

## Tools

The remote MCP surface contains six tools:

- `search_endpoints`: find endpoint candidates from natural language.
- `get_endpoint_schema`: return a full endpoint contract.
- `call_endpoint`: validate parameters and call the JustOneAPI backend.
- `get_account_balance`: return the linked API Token's balance.
- `get_usage_summary`: return usage and spending summary data.
- `list_platforms`: list platforms and endpoint counts.

The stdio server additionally exposes `refresh_catalog`. Remote clients cannot
discover or invoke that operator-only tool.

Legacy one-endpoint tools are removed in 2.0.

## Transports

The same v2 server factory supports two transports and both current protocol
eras:

- stdio: local `npx justoneapi-mcp`, token from `JUSTONEAPI_TOKEN`.
- stateless Streamable HTTP on Cloudflare Workers: a legacy API Token or an
  OAuth Bearer access token from `Authorization`.

HTTP clients should use:

```text
Authorization: Bearer <justoneapi_token>
```

The remote legacy lane accepts 8-, 16-, and 32-character alphanumeric API
Tokens from the established Bearer, raw Authorization, or
`X-JustOneAPI-Token` locations. Supplying more than one credential location is
always a `400 ambiguous_credentials`, including when both values are equal.
Reserved `joa_*` credentials fail closed and OAuth tokens are accepted only as
an Authorization Bearer value.

## Catalog

The runtime catalog is generated from OpenAPI into a compact `CatalogBundle`:

```json
{
  "catalog": {
    "endpoints": []
  },
  "meta": {
    "generated_at": "...",
    "endpoint_count": 283,
    "source": {
      "openapi_url": "...",
      "openapi_zh_url": "...",
      "openapi_sha256": "...",
      "openapi_zh_sha256": "..."
    }
  }
}
```

Endpoint IDs are generated from paths:

```text
/api/{platform}/{...action_segments}/{version}
-> {platform}.{action_segments_snake}_{version}
```

The platform segment is normalized by replacing hyphens with underscores.

Examples:

```text
/api/xiaohongshu/search-note/v2
-> xiaohongshu.search_note_v2

/api/douyin-xingtu/gw/api/author/get_author_base_info/v1
-> douyin_xingtu.gw_api_author_get_author_base_info_v1
```

The npm package includes a bundled generated catalog. Runtime refreshes write to
a cache store:

- stdio: local file cache.
- Worker: Cloudflare KV.

Load priority is memory cache, runtime store, bundled catalog.

## Search

`search_endpoints` does not depend on external search services. It uses:

- platform aliases.
- domain term normalization.
- typo-tolerant platform matching.
- weighted matching across endpoint ID, title, description, path, tags, params,
  and generated tokens.

Search returns candidates with normalized terms, confidence, and match reasons.

## Endpoint Calling

`call_endpoint` accepts only `endpoint_id` and `params`. It never accepts an
arbitrary URL or path.

Parameters exposed to MCP use `snake_case`; catalog entries preserve the real
API parameter name as `api_name`. `call_endpoint` accepts both names and maps
them back to `api_name`.

On the legacy lane, the incoming API Token keeps the established backend
contract: GET endpoints use a query `token`; form POST endpoints use an
`application/x-www-form-urlencoded` `token` field. On the OAuth lane, the
access token is exchanged for a two-minute, single-use delegation token. The
delegation token is sent only as `Authorization: Bearer`; neither OAuth token
type is placed in a backend URL or form body.

`call_endpoint` validates `endpoint_id` and parameters before token exchange.
After exchange it performs exactly one upstream dispatch for both legacy and
OAuth callers. It never retries network errors, timeouts, or HTTP 502/503/504,
because the outcome and billing state may be uncertain. OAuth account tools
also dispatch exactly once; legacy account tools keep their historical retry
behavior.

Responses preserve the complete upstream data shape without intentional MCP-layer
truncation and are wrapped in MCP metadata. Pagination hints are returned through
`next_step`.

## OAuth Resource Server

OAuth is an additive Resource Server mode, not a replacement for legacy API
Token validation or backend billing.

Fixed public identifiers:

```text
issuer                  https://auth.justoneapi.com
MCP resource            https://mcp.justoneapi.com/mcp
delegation resource     https://api.justoneapi.com
Worker client_id        justoneapi-mcp-worker
token endpoint          https://auth.justoneapi.com/oauth2/token
introspection endpoint  https://auth.justoneapi.com/oauth2/introspect
```

They are code constants and cannot be changed by environment variables. Only
secrets, feature mode, bounded timeout/cache values, and CORS origins are
environment-configurable.

The Worker publishes RFC 9728 Protected Resource Metadata at both the canonical
path and root alias when `JUSTONEAPI_OAUTH_MODE=dual`. OAuth is accepted only on
the exact `https://mcp.justoneapi.com` origin. Preview, localhost, alternate
ports, HTTP, and `workers.dev` remain legacy-only and do not publish PRM. The
canonical JWKS endpoint may be published while mode is `off` to prepare a safe
key overlap before OAuth activation.

The Worker authenticates to the Authorization Server with RS256
`private_key_jwt`. Assertions have an endpoint-specific audience, active `kid`,
fresh `jti`, and a 60-second lifetime. Private signing material is a bounded
JWK Set; the public endpoint strips every RSA private parameter.

Opaque access tokens are validated by introspection. Positive responses only
are cached by a full SHA-256 digest for at most 60 seconds, never beyond `exp`,
with in-flight deduplication and a bounded LRU. Inactive tokens, AS failures,
and invalid responses are never cached. Introspection requires the exact
issuer/resource audience, known nonempty MCP scopes, required `iat` and `exp`
timestamps, client, subject, and connection identifiers. `nbf` is validated
when present.

Tools use these scopes:

```text
mcp:catalog:read  search_endpoints, get_endpoint_schema, list_platforms
mcp:api:call      call_endpoint
mcp:account:read  get_account_balance, get_usage_summary
```

For API and account calls the Worker performs an RFC 8693 exchange immediately
before the one backend dispatch. Exchange memoization is request-local only.
The response must contain the exact requested scope, a Bearer delegation token,
an access-token issued type, and a lifetime no longer than 120 seconds; refresh
tokens are rejected.

Missing OAuth scope is enforced twice: the HTTP request layer returns `403`
with `WWW-Authenticate: ... insufficient_scope` before tool dispatch, while the
tool callback retains `_meta["mcp/www_authenticate"]` for protocol/client
compatibility. Authorization Server outages return a retryable `503` and do not
ask the user to relink a valid connection.

## Compatibility and billing boundary

- `off`: strict credential classification, legacy execution, no OAuth linking
  metadata.
- `dual`: legacy and OAuth credentials coexist; even legacy-authenticated tool
  descriptors advertise the standard OAuth schemes for future reconnects.
- stdio: no OAuth; tools advertise `noauth` at MCP level because the API Token
  is supplied to the local process environment.
- Billing, API permissions, balances, budgets, upstream business codes, and the
  existing API Token query/form behavior remain owned by the current backend.
- OAuth adds authorization and a short-lived delegation credential; it does not
  introduce a parallel charging path.

Signing-key rotation is overlap-first: publish old and new public keys, keep
signing with the old active `kid`, switch the active `kid`, then remove the old
key only after all assertions and caches from the overlap window have expired.

## Refresh

`refresh_catalog` and scheduled refreshes fetch both OpenAPI documents. English
OpenAPI failure prevents replacement. Chinese OpenAPI failure does not prevent a
structure update, but existing catalog data remains preferred when there is no
English structure change.

Refreshes are atomic:

1. Fetch OpenAPI.
2. Build and validate a new catalog bundle.
3. Save it to the runtime store.
4. Update memory cache.

Cloudflare Workers use KV keys:

- `catalog:bundle`
- `catalog:last-refresh`
- `catalog:refresh-lock`

Cron refresh runs hourly.

## Cloudflare Worker

The Worker uses Cloudflare Agents SDK `createMcpHandler` for Streamable HTTP.
Each request creates a fresh MCP server and request-scoped runtime context.
Request-scoped token data is never stored in module-level globals.

The Worker exposes:

- `/mcp`
- `/health`
- `/.well-known/oauth-protected-resource/mcp` (canonical dual mode only)
- `/.well-known/oauth-protected-resource` (canonical dual mode alias)
- `/.well-known/jwks.json` (canonical origin only)

No public `/catalog` or `/debug` endpoints are exposed.

## Error Codes

MCP errors use stable English codes with readable messages. Upstream business
codes are mapped as:

```text
100 -> INVALID_TOKEN
301 -> COLLECT_FAILED
302 -> RATE_LIMITED
303 -> DAILY_QUOTA_EXCEEDED
400 -> VALIDATION_ERROR
500 -> INTERNAL_ERROR
600 -> PERMISSION_DENIED
601 -> INSUFFICIENT_BALANCE
602 -> TOKEN_LIMIT_EXCEEDED
```

Token values, full URLs, stack traces, and raw internal exceptions are never
returned to MCP clients.

## Testing

Required coverage:

- catalog generation from OpenAPI fixtures.
- search ranking and platform/domain aliases.
- schema output shape.
- call validation, parameter mapping, upstream code mapping, complete response passthrough, and
  pagination hints.
- v2 stdio and Worker adapters for modern and legacy protocol eras.
- strict credential classification and dark-deploy/preview isolation.
- PRM, CORS, JWKS overlap, private-key stripping, and client assertions.
- introspection validation/cache/error behavior and RFC 8693 exchange.
- HTTP and tool-level scope challenges.
- zero OAuth credential leakage to backend URLs, forms, and logs.
- single-dispatch behavior for billable and single-use-token calls.

Release checks:

```text
npm run lint
npm run typecheck
npm test
npm run build:all
npm run verify:package
bash scripts/verify-packed-cli.sh
```

These checks are offline. Live OpenAPI catalog verification is intentionally a
separate manual/deploy gate so npm publishing and the Node-version CI matrix do
not depend on mutable external catalog state.
