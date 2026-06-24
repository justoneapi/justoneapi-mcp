# JustOneAPI MCP Server

简体中文 | [English](README.md)

在 Claude Desktop、Cursor 等 MCP 客户端中使用 JustOneAPI。

JustOneAPI MCP 可以帮助你的 AI 助手查找合适的 JustOneAPI 接口、查看接口需要的参数，并使用你的
JustOneAPI Token 调用接口。

## 快速接入

### 远程 HTTP

推荐使用远程 HTTP 方式接入。

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

### 本地 stdio

也可以使用 `npx` 在本地运行 MCP 服务。

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

## Token

使用你的 JustOneAPI Token：

```text
Authorization: Bearer your_token
```

本地 stdio 方式也可以使用：

```text
JUSTONEAPI_TOKEN=your_token
```

推荐使用 `Bearer your_token` 格式。

## 使用示例

你可以直接对 MCP 客户端说：

```text
帮我找小红书笔记评论接口，并告诉我需要哪些参数
```

AI 助手会查找可用的 JustOneAPI 接口，说明必填参数，并在你提供所需参数后调用对应接口。

## 许可证

MIT
