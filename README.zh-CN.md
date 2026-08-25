# JustOneAPI MCP Server

简体中文 | [English](README.md)

在 ChatGPT、Codex、Cursor、Hermes Agent 等 MCP 客户端中使用 JustOneAPI。

JustOneAPI MCP 可以帮助你的 AI 助手查找合适的 JustOneAPI 接口、查看接口需要的参数，并在完成
JustOneAPI 授权后调用接口。

## 支持的客户端

JustOneAPI MCP 支持远程 Streamable HTTP 和本地 stdio。当前已验证及兼容方式包括：

- ChatGPT Web Developer mode 自定义 MCP 连接：OAuth，已验证。
- Codex CLI 和 Codex IDE 扩展：OAuth，已验证。
- Cursor、Hermes Agent 及其他支持自定义请求头的客户端：现有 API Token 兼容方式。
- Claude.ai、Claude Desktop 和 Claude Code：OAuth 仍在兼容性测试中；Claude Code 可继续使用
  现有 API Token 请求头。

支持兼容 OAuth 注册流程的客户端，只需要填写远程地址，再在浏览器中完成授权。能否直接连接还
取决于客户端支持的注册方式及账号或工作区策略。暂不支持 OAuth 的客户端仍可继续使用原有 API
Token 请求头或本地 stdio。

## 快速接入

### 使用 OAuth 的远程 HTTP

生产服务已开启 OAuth，直接把下面的地址添加为 MCP 连接即可：

```text
https://mcp.justoneapi.com/mcp
```

兼容的客户端会发现受保护资源信息，跳转到 `auth.justoneapi.com`，并申请授权页展示的 MCP
权限。不需要把 JustOneAPI API Token 粘贴进客户端。具体入口、OAuth 注册方式和账号限制因
客户端而异，下面只列出已经验证的 OAuth 路径。

#### 各客户端接入方式

- **ChatGPT Web：**打开 `Settings → Security and login` 并启用 `Developer mode`，进入
  `Plugins` 页面后点击 `+`，填写名称、说明和上面的 `/mcp` 地址，Authentication 选择 OAuth。
  创建连接后，由 ChatGPT 自动发现认证信息，并在连接流程或首次调用需要授权的工具时进入授权
  流程。Developer mode 是否可见可能取决于 ChatGPT 账号和工作区策略。
- **Codex CLI / IDE 扩展：**执行下面的命令。当前推荐显式使用已经验证的 DCR 注册路径：

```bash
codex mcp add justoneapi \
  --url https://mcp.justoneapi.com/mcp

codex mcp login justoneapi \
  --oauth-client-registration dcr
```

ChatGPT 桌面端、Codex CLI 和 Codex IDE 扩展会读取同一台 Codex 主机上的 MCP 配置。ChatGPT
和 Codex 的当前入口可查看 [OpenAI MCP 官方文档](https://developers.openai.com/codex/mcp/)及
[ChatGPT 连接测试说明](https://developers.openai.com/plugins/deploy/connect-chatgpt)。

Claude.ai、Claude Desktop 和 Claude Code 的 OAuth 接入仍在兼容性测试中，暂不列为正式支持的
OAuth 连接方式。Claude Code 可以通过 `--header "Authorization: Bearer your_token"` 使用现有
API Token；不要把下面的通用 JSON 直接当作 Claude Code 配置。

授权页会展示申请的 scope。账户 Owner 可以选择已有 API Token 或创建专用 Token；Token
Member 只能使用分配给自己的固定 Token。后续断开应用只会撤销该 OAuth 连接，不会停用或
删除所绑定的 API Token。

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

截至 2026-08-25，npm 的 `latest` 仍是旧版 `1.0.1`，不是仓库中的 2.0 实现。如果必须在本地
使用 stdio，请固定版本，避免把旧 CLI 当作与线上 v2 服务完全相同的实现：

```json
{
  "mcpServers": {
    "justoneapi": {
      "command": "npx",
      "args": ["-y", "justoneapi-mcp@1.0.1"],
      "env": {
        "JUSTONEAPI_TOKEN": "your_token"
      }
    }
  }
}
```

旧版 `1.0.1` 支持 Node.js 18 或更高版本，其工具结构不等同于线上 v2。OAuth 只用于远程
Worker；stdio 仍从本地读取 `JUSTONEAPI_TOKEN`。2.0 发布到 npm 后，再按实际 dist-tag 更新
这里的版本说明。

## 认证与权限范围

OAuth 用户在授权页选择要绑定的 API Token，不需要把 Token 粘贴进客户端。现有 API Token 远程
兼容方式使用：

```text
Authorization: Bearer your_token
```

本地 stdio 方式也可以使用：

```text
JUSTONEAPI_TOKEN=your_token
```

本地 stdio 使用上面的环境变量；不要把真实 Token 提交到仓库。

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

生产环境当前使用 `dual` 模式。OAuth 是独立新增并由开关控制的能力，这些开关继续作为发布和
回滚边界：

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
