# JustOneAPI MCP Server

在 Claude Desktop、Cursor 等 MCP 客户端中使用 JustOneAPI。

JustOneAPI MCP 不再为每个 API 接口注册一个 MCP 工具，而是通过一套稳定的接口发现流程使用整个平台：

```text
search_endpoints -> get_endpoint_schema -> call_endpoint
```

接口目录由 JustOneAPI 公开 OpenAPI 文档生成，并包含中英文接口说明。

## 工具

| 工具                  | 作用                                  |
| --------------------- | ------------------------------------- |
| `search_endpoints`    | 用自然语言查找 API 接口。             |
| `get_endpoint_schema` | 查看接口参数、枚举值、默认值和示例。  |
| `call_endpoint`       | 校验参数并调用选中的接口。            |
| `list_platforms`      | 列出支持的平台和接口数量。            |
| `refresh_catalog`     | 管理员工具，从 OpenAPI 刷新接口目录。 |

## 接入

### 本地 stdio

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

### 远程 HTTP

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

推荐使用 `Bearer your_token` 格式。

## 使用流程

你可以直接对 MCP 客户端说：

```text
帮我找小红书笔记评论接口，并告诉我需要哪些参数
```

客户端应该按这个顺序调用：

1. 使用 `search_endpoints` 查找候选接口。
2. 使用 `get_endpoint_schema` 查看最佳 `endpoint_id` 的参数契约。
3. 如果缺少必填参数，先向用户确认。
4. 使用 `call_endpoint` 调用接口。

`call_endpoint` 只接受 `endpoint_id` 和 `params`。参数名请使用
`get_endpoint_schema` 返回的 `snake_case` 名称。

## 鉴权

本地 stdio 读取：

```text
JUSTONEAPI_TOKEN=your_token
```

远程 HTTP 读取：

```text
Authorization: Bearer your_token
```

## 接口目录刷新

npm 包内置一份接口目录。运行时可从以下地址刷新：

- `https://docs.justoneapi.com/openapi.json`
- `https://docs.justoneapi.com/openapi-zh.json`

`refresh_catalog` 是管理员工具。本地 stdio 模式允许调用；远程 HTTP 模式需要服务端配置的
`X-Admin-Token`。

## 开发

```bash
npm install
npm run build:catalog
npm run build
npm test
```

运行本地 stdio：

```bash
JUSTONEAPI_TOKEN=your_token npm run dev:stdio
```

运行 Cloudflare Worker 本地开发：

```bash
npm run dev:worker
```

部署 Worker 前，先为 `JUSTONEAPI_MCP_CATALOG` 创建 KV namespace，更新
`wrangler.jsonc`，并设置管理员密钥：

```bash
npx wrangler secret put JUSTONEAPI_ADMIN_TOKEN
```

### Cloudflare 自动部署

在 Cloudflare Dashboard 中把 Worker 连接到 GitHub 仓库：

```text
Workers & Pages -> justoneapi-mcp -> Settings -> Builds -> Connect
```

生产分支使用 `main`。仓库通过 `.node-version` 固定 Node.js 22。
`JUSTONEAPI_ADMIN_TOKEN` 这类运行时密钥仍保存在 Cloudflare Worker Secrets 中，不放到
GitHub。

## 许可证

MIT
