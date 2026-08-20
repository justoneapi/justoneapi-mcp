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

The public MCP surface contains five tools:

- `search_endpoints`: find endpoint candidates from natural language.
- `get_endpoint_schema`: return a full endpoint contract.
- `call_endpoint`: validate parameters and call the JustOneAPI backend.
- `list_platforms`: list platforms and endpoint counts.
- `refresh_catalog`: admin-only catalog refresh.

Legacy one-endpoint tools are removed in 2.0.

## Transports

The same core implementation supports two transports:

- stdio: local `npx justoneapi-mcp`, token from `JUSTONEAPI_TOKEN`.
- Streamable HTTP on Cloudflare Workers: token from `Authorization` header.

HTTP clients should use:

```text
Authorization: Bearer <justoneapi_token>
```

The server also accepts a bare token in `Authorization` for compatibility.

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

The incoming MCP token is converted to the backend API `token` parameter. GET
endpoints use query parameters. Form POST endpoints use
`application/x-www-form-urlencoded`.

Responses preserve the complete upstream data shape without intentional MCP-layer
truncation and are wrapped in MCP metadata. Pagination hints are returned through
`next_step`.

## Auth

All HTTP tools require a token to be present. The first version does not perform
remote token validation for search/schema/list operations; the backend API
validates token, quota, permissions, and billing during `call_endpoint`.

`refresh_catalog` is admin-only:

- stdio: allowed.
- Worker: requires `X-Admin-Token` matching `JUSTONEAPI_ADMIN_TOKEN`.

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
- stdio/HTTP auth extraction and admin checks.

Release checks:

```text
npm run lint
npm run build
npm test
```
