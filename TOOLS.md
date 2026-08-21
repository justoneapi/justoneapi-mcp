# JustOneAPI MCP Tools

## Workflow

Use tools in this order:

```text
search_endpoints -> get_endpoint_schema -> call_endpoint
```

## Authentication and scopes

Remote OAuth clients receive per-tool security descriptors. Catalog tools use
`mcp:catalog:read`, `call_endpoint` uses `mcp:api:call`, and both account tools
use `mcp:account:read`. A missing OAuth scope is returned as an HTTP 403 Bearer
challenge before dispatch and is also retained in the tool result metadata for
MCP clients that consume `mcp/www_authenticate` there.

Legacy remote API Tokens and local `JUSTONEAPI_TOKEN` remain supported. OAuth
is not used by stdio, and `refresh_catalog` is never exposed by the remote
Worker.

## search_endpoints

Find endpoint candidates from natural language.

Input:

```json
{
  "query": "小红书笔记评论",
  "platform": "xiaohongshu",
  "limit": 8,
  "include_deprecated": false,
  "include_hidden": false
}
```

Fields:

| Field                | Required | Description                                                                                     |
| -------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `query`              | Yes      | Natural-language endpoint request.                                                              |
| `platform`           | No       | Optional platform filter. Aliases such as `抖音`, `小红薯`, `rednote`, `kuaishou` are accepted. |
| `limit`              | No       | Number of candidates, default 8, max 20.                                                        |
| `include_deprecated` | No       | Include deprecated endpoints.                                                                   |
| `include_hidden`     | No       | Include hidden endpoints.                                                                       |

Output includes:

```json
{
  "success": true,
  "query": "小红书笔记评论",
  "normalized": {
    "platform": "xiaohongshu",
    "terms": ["note", "comment"],
    "aliases": ["小红薯 -> xiaohongshu"],
    "phrase": "笔记评论"
  },
  "ranking_version": "v2",
  "confidence": "high",
  "results": [
    {
      "endpoint_id": "xiaohongshu.get_note_comment_v4",
      "platform": "xiaohongshu",
      "title": "笔记评论",
      "title_en": "Note Comments",
      "version": "v4",
      "score": 100,
      "required_params": ["note_id"],
      "matched": ["platform:xiaohongshu", "capability:note comments"],
      "matched_capabilities": [],
      "relevant_limitations": [],
      "match_reasons": ["platform:xiaohongshu", "capability:note comments"],
      "alternatives": []
    }
  ],
  "next_step": "Call get_endpoint_schema with the best endpoint_id before call_endpoint."
}
```

## get_endpoint_schema

Return the request metadata needed to call an endpoint.

Input:

```json
{
  "endpoint_id": "kuaishou.search_video_v2"
}
```

Output includes:

```json
{
  "success": true,
  "endpoint_id": "kuaishou.search_video_v2",
  "platform": "kuaishou",
  "title": "视频搜索",
  "title_en": "Video Search",
  "method": "GET",
  "path": "/api/kuaishou/search-video/v2",
  "search_aliases": [],
  "use_cases": [],
  "highlights": [],
  "params": [
    {
      "name": "keyword",
      "api_name": "keyword",
      "in": "query",
      "required": true,
      "type": "string",
      "description": "关键词",
      "description_en": "The search keyword."
    }
  ],
  "example": {
    "endpoint_id": "kuaishou.search_video_v2",
    "params": {
      "keyword": "<string>"
    }
  }
}
```

Use `name` values in `call_endpoint.params`. The public API request parameter is kept as `api_name`.

Structured ranking is release-gated. It remains disabled unless the server operator sets
`JUSTONEAPI_SEARCH_V2_ENABLED=true`; this lets catalog compatibility ship before the V2 ranking is
enabled.

Catalog builds and candidate promotions use built-in public-safety validation; no operator security
registry or secret is required. Runtime endpoint and account calls return upstream payloads without
MCP-layer response truncation.

Catalog refreshes are staged as a candidate release, verified, and then promoted to `active` while
retaining `previous`. An administrator can invoke `refresh_catalog` with `{ "rollback": true }` to
swap back to the previous validated release.

During the one-time V2-to-V3 pointer migration, the first V3 release has no V3 `previous` release;
rollback becomes available after the next successful V3 promotion. The legacy V2 pointer remains
untouched for older server versions during the rollout.

## call_endpoint

Validate params and call an endpoint.

This operation may incur charges under the bound API Token's current pricing,
permissions, balance, and budget. It validates the endpoint and parameters
first and then makes exactly one backend dispatch. It does not retry an
uncertain timeout, network error, or HTTP 502/503/504 response. OAuth delegation
tokens are sent only in the Authorization header and never in a URL or form.

Input:

```json
{
  "endpoint_id": "kuaishou.search_video_v2",
  "params": {
    "keyword": "美食",
    "page": 1
  }
}
```

Fields:

| Field         | Required | Description                                                          |
| ------------- | -------- | -------------------------------------------------------------------- |
| `endpoint_id` | Yes      | Endpoint id from `search_endpoints`.                                 |
| `params`      | No       | Object keyed by schema `name`. Upstream `api_name` is also accepted. |

Successful output:

```json
{
  "success": true,
  "endpoint_id": "kuaishou.search_video_v2",
  "code": 0,
  "message": null,
  "data": {},
  "raw": {
    "code": 0,
    "message": null,
    "data": {}
  },
  "truncated": false,
  "next_step": null,
  "warnings": []
}
```

The MCP layer preserves upstream array lengths, string values, and nesting depth. The
`truncated` field remains `false` for backward compatibility.

If pagination can be inferred, output contains:

```json
{
  "next_step": {
    "action": "call_endpoint",
    "endpoint_id": "kuaishou.search_video_v2",
    "params": {
      "keyword": "美食",
      "page": 2
    },
    "hint": "Use these params to fetch the next page or more results."
  }
}
```

## get_account_balance

Check the current JustOneAPI token's available balance.

Input: none.

Output includes:

```json
{
  "success": true,
  "code": 0,
  "message": null,
  "data": {
    "balance": "100.0000",
    "currency": "CNY"
  }
}
```

## get_usage_summary

Review the current JustOneAPI token's recent API usage and spending trends.

Input: none. Legacy clients may still send `max_items`; it is ignored.

## list_platforms

List supported platforms and endpoint counts.

Input: none.

Output:

```json
{
  "success": true,
  "endpoint_count": 283,
  "platforms": [
    {
      "id": "douyin",
      "name": "抖音",
      "aliases": ["douyin", "tiktok china"],
      "endpoint_count": 8
    }
  ]
}
```

## refresh_catalog

Local stdio operator-only tool. Refresh the endpoint catalog from JustOneAPI
OpenAPI documents. It is hidden and unavailable on the remote Worker.

Input:

```json
{
  "force": false
}
```

Output:

```json
{
  "success": true,
  "changed": false,
  "structure_changed": false,
  "localization_changed": false,
  "endpoint_count": 283,
  "previous_endpoint_count": 283,
  "added": [],
  "removed": [],
  "modified": []
}
```

## Error Format

Tool errors use this shape:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Missing required parameter(s): keyword",
    "upstream_code": null,
    "http_status": null,
    "details": {}
  }
}
```

Upstream business code mapping:

| Upstream code | MCP code               |
| ------------- | ---------------------- |
| `100`         | `INVALID_TOKEN`        |
| `301`         | `COLLECT_FAILED`       |
| `302`         | `RATE_LIMITED`         |
| `303`         | `DAILY_QUOTA_EXCEEDED` |
| `400`         | `VALIDATION_ERROR`     |
| `500`         | `INTERNAL_ERROR`       |
| `600`         | `PERMISSION_DENIED`    |
| `601`         | `INSUFFICIENT_BALANCE` |
| `602`         | `TOKEN_LIMIT_EXCEEDED` |
