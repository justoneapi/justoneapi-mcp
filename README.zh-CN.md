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

支持 MCP OAuth 自动发现的客户端，只需要填写远程地址，再在浏览器中完成授权即可。暂不支持
这套授权流程的客户端，仍可继续使用原有 API Token 请求头或本地 stdio。

## 快速接入

### 使用 OAuth 的远程 HTTP

生产服务开启 OAuth 后，把下面的地址添加为自定义 MCP 连接器：

```text
https://mcp.justoneapi.com/mcp
```

客户端会自动发现受保护资源信息，跳转到 `auth.justoneapi.com`，并申请当前工具所需的权限。
不需要把 JustOneAPI API Token 粘贴进客户端。凡是实现标准 MCP OAuth 发现流程的客户端都可以
使用，具体入口名称可能因客户端而异。

### 使用现有 API Token 的远程 HTTP

原有的请求头接入方式继续兼容：

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

Catalog 构建和动态发布使用内置的公开安全校验，不需要运维侧额外配置安全词表或 Secret。
接口调用和账户工具完整返回上游响应，不会被 MCP 层截断。

### 本地 stdio

也可以使用 `npx` 在本地运行 MCP 服务。2.0 版本要求 Node.js 20 或更高版本。

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

仍在使用 Node.js 18 的用户，需要暂时固定使用旧版 `justoneapi-mcp@1.0.1`，升级 Node.js 后再
使用 2.0。OAuth 只用于远程 Worker；stdio 仍从本地读取 `JUSTONEAPI_TOKEN`。

发布后的 CLI 支持 Node.js 20、22、24；Wrangler 的 Worker 构建与类型生成命令要求 Node.js
22 或更高版本。

## 认证与权限范围

使用你的 JustOneAPI Token：

```text
Authorization: Bearer your_token
```

本地 stdio 方式也可以使用：

```text
JUSTONEAPI_TOKEN=your_token
```

推荐使用 `Bearer your_token` 格式。

OAuth 按最小权限拆为三个 scope：

- `mcp:catalog:read`：搜索接口、查看接口结构、列出平台。
- `mcp:api:call`：调用 JustOneAPI 接口。
- `mcp:account:read`：查看余额和用量。

`call_endpoint` 可能按 OAuth 绑定的 API Token 当前价格、权限、余额及预算产生费用。它会先校验
接口和参数，再换取短时委托 Token，随后只向上游发起一次请求。对于超时、网络异常或 HTTP
502/503/504 这种结果不确定的情况，不会自动重试。

原有 API Token 仍按既有 query/form 方式传给 JustOneAPI 后端。OAuth Access Token 和委托
Token 不会写入后端 URL 或表单；委托 Token 只通过 Authorization Bearer 请求头发送。

## 运维发布方式

OAuth 是独立新增并由开关控制的能力：

- `JUSTONEAPI_OAUTH_MODE=off`：远程服务保持原有模式，并隐藏 OAuth 发现信息。
- `JUSTONEAPI_OAUTH_MODE=dual`：只在准确的 `https://mcp.justoneapi.com` origin 上同时接受原有
  API Token 和标准 OAuth。
- 预览地址和 `workers.dev` 即使配置为 `dual`，也始终只按 legacy 模式运行。

Worker 使用 `private_key_jwt` 调用授权服务器的 introspection 和 RFC 8693 token exchange。
私有 JWK Set 与 active `kid` 必须保存在 Worker Secret 中，禁止提交 `.dev.vars`、PEM 或私钥
JWK。轮换时先同时发布新旧公钥，再切换 active `kid`，经过重叠期后再删除旧密钥。

npm 2.0 会先通过 OIDC trusted publishing 发布到 `next` dist-tag。该版本的 Node.js 20、22、
24 smoke 检查全部通过后，由操作人员使用 npm 2FA 独立执行
`npm dist-tag add justoneapi-mcp@2.0.0 latest`。此步骤不使用 `NPM_TOKEN` 自动化。完整清单见
[RELEASE.md](RELEASE.md)。

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
