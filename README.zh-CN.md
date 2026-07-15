# JustOneAPI MCP Server

简体中文 | [English](README.md)

在 Codex、Claude Desktop、Cursor 等 MCP 客户端中使用 JustOneAPI。

JustOneAPI MCP 可以帮助你的 AI 助手查找合适的 JustOneAPI 接口、查看接口需要的参数，并使用你的
JustOneAPI Token 调用接口。

## 支持的客户端

只要你的 AI 客户端支持 MCP，就可以使用 JustOneAPI MCP。常见客户端包括：

- Codex
- Claude Desktop
- Cursor
- 其他支持 MCP 的 AI 助手

如果你使用 Codex，可以把 JustOneAPI 添加为远程 MCP 服务，并使用下面的远程 HTTP 地址和
Authorization 请求头。

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

出于安全考虑，本地 `call_endpoint` 仅在受信任的运维环境同时提供机密的
`JUSTONEAPI_PRIVATE_CATALOG_TERMS` 词表时启用。未配置时，接口检索和 Schema 查询只使用
发布阶段已扫描的内置 catalog；直接调用、动态刷新、晋级和回滚均会安全失败。请勿把该词表
写入会共享或公开的客户端配置。

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

更多示例：

```text
抖音有哪些接口可以获取视频详情？
```

```text
帮我调用小红书笔记评论接口，笔记 ID 是 xxxxx。
```

```text
列出微博搜索相关接口，并说明每个接口适合什么场景。
```

```text
继续获取下一页结果。
```

```text
帮我查一下 JustOneAPI 余额。
```

```text
帮我看一下最近的接口调用量和消费情况。
```

```text
接口返回 code 400，帮我看看可能是哪个参数错了。
```

```text
接口返回 code 601 或 602，分别是什么意思？
```

AI 助手会查找可用的 JustOneAPI 接口，说明必填参数，在你提供所需参数后调用对应接口，也可以帮助解释常见返回码。

## 许可证

MIT
