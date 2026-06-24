# JustOneAPI MCP Server

Use JustOneAPI from MCP clients such as Claude Desktop and Cursor.

JustOneAPI MCP exposes the API platform through a small discovery workflow
instead of registering one tool per API endpoint:

```text
search_endpoints -> get_endpoint_schema -> call_endpoint
```

The endpoint catalog is generated from the public JustOneAPI OpenAPI documents
and includes Chinese and English endpoint descriptions.

## Tools

| Tool                  | Purpose                                                       |
| --------------------- | ------------------------------------------------------------- |
| `search_endpoints`    | Find API endpoints from natural language.                     |
| `get_endpoint_schema` | Inspect endpoint params, enum values, defaults, and examples. |
| `call_endpoint`       | Validate params and call the selected endpoint.               |
| `list_platforms`      | List supported platforms and endpoint counts.                 |
| `refresh_catalog`     | Admin-only catalog refresh from OpenAPI.                      |

## Install

### Local stdio

```json
{
  "mcpServers": {
    "justoneapi": {
      "command": "npx",
      "args": ["-y", "justoneapi-mcp"],
      "env": {
        "JUSTONEAPI_TOKEN": "your_token"
      }
    }
  }
}
```

### Remote HTTP

```json
{
  "mcpServers": {
    "justoneapi": {
      "url": "https://mcp.justoneapi.com/mcp",
      "headers": {
        "Authorization": "Bearer your_token"
      }
    }
  }
}
```

`Bearer your_token` is the recommended Authorization format.

## Usage

Ask your MCP client naturally, for example:

```text
帮我找小红书笔记评论接口，并告诉我需要哪些参数
```

The client should:

1. Call `search_endpoints` with the natural-language request.
2. Call `get_endpoint_schema` for the best `endpoint_id`.
3. Ask for missing required params if needed.
4. Call `call_endpoint`.

`call_endpoint` accepts only `endpoint_id` and `params`. Use the `snake_case`
parameter names returned by `get_endpoint_schema`.

## Authentication

Local stdio reads:

```text
JUSTONEAPI_TOKEN=your_token
```

Remote HTTP reads:

```text
Authorization: Bearer your_token
```

## Catalog Refresh

The package includes a bundled endpoint catalog. The runtime can refresh it from:

- `https://docs.justoneapi.com/openapi.json`
- `https://docs.justoneapi.com/openapi-zh.json`

`refresh_catalog` is an admin tool. In local stdio mode it is allowed. In remote
HTTP mode it requires `X-Admin-Token` configured by the server operator.

## Development

```bash
npm install
npm run build:catalog
npm run build
npm test
```

Run local stdio:

```bash
JUSTONEAPI_TOKEN=your_token npm run dev:stdio
```

Run Cloudflare Worker locally:

```bash
npm run dev:worker
```

Before deploying the Worker, create a KV namespace for `JUSTONEAPI_MCP_CATALOG`,
update `wrangler.jsonc`, and set the admin secret:

```bash
npx wrangler secret put JUSTONEAPI_ADMIN_TOKEN
```

### Cloudflare automatic deploy

Connect the Worker to the GitHub repository from Cloudflare Dashboard:

```text
Workers & Pages -> justoneapi-mcp -> Settings -> Builds -> Connect
```

Use `main` as the production branch. The repository pins Node.js 22 with
`.node-version`. Runtime secrets such as `JUSTONEAPI_ADMIN_TOKEN` remain
Cloudflare Worker secrets and are not stored in GitHub.

## License

MIT
