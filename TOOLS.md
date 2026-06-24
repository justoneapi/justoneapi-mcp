# JustOneAPI MCP Tools

## Workflow

Use tools in this order:

```text
search_endpoints -> get_endpoint_schema -> call_endpoint
```

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
    "aliases": ["小红薯 -> xiaohongshu"]
  },
  "confidence": "high",
  "results": [
    {
      "endpoint_id": "xiaohongshu.get_note_comment_v4",
      "platform": "xiaohongshu",
      "title": "笔记评论",
      "title_en": "Note Comments",
      "version": "v4",
      "score": 180,
      "required_params": ["note_id"],
      "matched": ["platform:xiaohongshu", "endpoint:comment"]
    }
  ],
  "next_step": "Call get_endpoint_schema with the best endpoint_id before call_endpoint."
}
```

## get_endpoint_schema

Return the full schema for an endpoint.

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

Use `name` values in `call_endpoint.params`. The real upstream parameter is kept as `api_name`.

## call_endpoint

Validate params and call an endpoint.

Input:

```json
{
  "endpoint_id": "kuaishou.search_video_v2",
  "params": {
    "keyword": "美食",
    "page": 1
  },
  "max_items": 20
}
```

Fields:

| Field         | Required | Description                                                          |
| ------------- | -------- | -------------------------------------------------------------------- |
| `endpoint_id` | Yes      | Endpoint id from `search_endpoints`.                                 |
| `params`      | No       | Object keyed by schema `name`. Upstream `api_name` is also accepted. |
| `max_items`   | No       | Maximum array items retained per array, default 20, max 100.         |

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

Large arrays and long strings are truncated. When truncation happens, output contains:

```json
{
  "truncated": true,
  "truncation": {
    "max_items": 20,
    "paths": [
      {
        "path": "data.items",
        "original_length": 100,
        "kept": 20
      }
    ]
  }
}
```

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

Input:

```json
{
  "max_items": 100
}
```

Fields:

| Field       | Required | Description                                                   |
| ----------- | -------- | ------------------------------------------------------------- |
| `max_items` | No       | Maximum array items retained per array, default 100, max 100. |

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

Admin-only. Refresh the endpoint catalog from JustOneAPI OpenAPI documents.

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
