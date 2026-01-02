[![npm version](https://badge.fury.io/js/justoneapi-mcp.svg)](https://www.npmjs.com/package/justoneapi-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[English](README.md) | 简体中文

> **原始 JSON 设计。** 返回未经修改的上游响应，确保最大数据保真度。

# JustOneAPI MCP 服务器

在 AI 助手中通过模型上下文协议 (MCP) 使用 JustOneAPI。

这是一个轻量级的 MCP 服务器，将 JustOneAPI 接口暴露给 AI 代理，并返回来自上游平台的原始 JSON 响应。

---

## 功能特性

- 将 JustOneAPI 接口暴露为 MCP 工具
- 处理认证、重试、超时和错误标准化
- 返回原始的上游 JSON，不解析字段
- 专为 AI 代理和开发者工作流设计

---

## 不做什么

- 不解析或标准化字段
- 不重构数据结构
- 不假设上游响应结构

这样的设计是有意为之，以保持数据保真度和长期兼容性。

---

## 可用工具

本 MCP 服务器提供多个工具来与 JustOneAPI 接口交互。每个工具都返回未经解析的原始上游 JSON 响应。

### 特色工具：统一搜索

**`unified_search_v1`** - 一次请求搜索多个中文社交媒体和新闻平台。

支持平台：微博、微信、知乎、抖音、小红书、哔哩哔哩、快手和新闻。

**使用方法（自然语言）：**

直接用自然语言向 Claude 或你的 MCP 客户端提问：
- *"搜索最近一周中文社交媒体上关于 AI 的讨论"*
- *"搜索微博上 1 月 1 日到 5 日关于 deepseek 的帖子"*
- *"在所有平台搜索 chatgpt 或 机器学习，排除 广告"*

Claude 会自动：
- 将你的请求转换为正确的 API 格式
- 处理日期格式化（UTC+8 时区）
- 使用 nextCursor 处理翻页（只需说"显示更多"）
- 返回并总结结果

**搜索语法：**
- 单关键词：`deepseek`
- AND 搜索：`deepseek chatgpt`（两个词都必须出现）
- OR 搜索：`deepseek~chatgpt`（任一词出现即可）
- NOT 搜索：`deepseek -chatgpt`（排除 chatgpt）

**平台选项：**
`ALL`（默认，全部平台）、`NEWS`（新闻）、`WEIBO`（微博）、`WEIXIN`（微信）、`ZHIHU`（知乎）、`DOUYIN`（抖音）、`XIAOHONGSHU`（小红书）、`BILIBILI`（B站）、`KUAISHOU`（快手）

**技术参数（供参考）：**
```json
{
  "keyword": "AI",
  "source": "ALL",
  "start": "2025-01-01 00:00:00",
  "end": "2025-01-02 23:59:59"
}
```

### 发现所有可用工具

在你的 MCP 客户端（Claude Desktop、Cursor 等）中查看所有可用工具：

**在 Claude Desktop 中：**
```
请列出 justoneapi-mcp 的所有可用工具
```

**在 Cursor 或其他 MCP 客户端：**
使用客户端的工具发现功能查看所有可用工具及其参数。

每个工具都包含：
- ✅ 完整的参数说明
- ✅ 使用 Zod 进行输入验证
- ✅ 详细的错误消息
- ✅ 参数说明中的示例值

### 工具命名规范

所有工具遵循此模式：
- `unified_search_v1` - 跨平台统一搜索
- `kuaishou_search_video_v2` - 平台特定的视频搜索
- `{平台}_{操作}_{版本}` - 通用模式

### 完整工具文档

详细的工具文档、参数和示例请参见 **[TOOLS.md](TOOLS.md)**。

---

## 输出约定

此 MCP 返回来自上游 API 的原始 JSON。

示例（简化）：

```json
{
  "code": 0,
  "message": null,
  "recordTime": "2025-12-31T14:55:21Z",
  "data": ...
}
```

---

## 认证

你需要一个 JustOneAPI token 才能使用此服务器。

**获取你的 token**：访问 [https://justoneapi.com](https://justoneapi.com) 注册并获取 API token。

获得 token 后，在 MCP 客户端的环境变量中配置：

```
JUSTONEAPI_TOKEN=你的实际token
```

🔒 **安全性**：token 作为查询参数传递给上游 API，绝不会以明文形式记录。所有 URL 在记录前都会脱敏处理。

---

## 安装

### 方式 1：npx（推荐）

直接使用 npx，无需安装。

**配置 Claude Desktop：**

编辑你的操作系统对应的配置文件：
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "justoneapi": {
      "command": "npx",
      "args": ["-y", "justoneapi-mcp"],
      "env": {
        "JUSTONEAPI_TOKEN": "你的实际token"
      }
    }
  }
}
```

> 💡 **获取你的 token**：在 [justoneapi.com](https://justoneapi.com) 注册

### 方式 2：全局安装

```bash
npm install -g justoneapi-mcp
```

**配置 Claude Desktop：**

编辑你的操作系统对应的配置文件：
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "justoneapi": {
      "command": "justoneapi-mcp",
      "env": {
        "JUSTONEAPI_TOKEN": "你的实际token"
      }
    }
  }
}
```

> 💡 **获取你的 token**：在 [justoneapi.com](https://justoneapi.com) 注册

### 方式 3：本地开发

```bash
git clone <repository>
cd justoneapi-mcp
npm install
npm run build
```

**配置 Claude Desktop：**

编辑你的操作系统对应的配置文件：
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "justoneapi": {
      "command": "node",
      "args": ["/绝对路径/justoneapi-mcp/dist/index.js"],
      "env": {
        "JUSTONEAPI_TOKEN": "你的实际token"
      }
    }
  }
}
```

> 💡 **获取你的 token**：在 [justoneapi.com](https://justoneapi.com) 注册

就这么简单！只需要配置 token。

---

## 在其他 MCP 客户端中使用

此服务器遵循标准 MCP 协议，与任何 MCP 客户端兼容（Cursor、Cline、自定义代理等）。

通用配置：

```json
{
  "command": "npx",
  "args": ["-y", "justoneapi-mcp"],
  "env": {
    "JUSTONEAPI_TOKEN": "你的实际token"
  }
}
```

或如果已全局安装：

```json
{
  "command": "justoneapi-mcp",
  "env": {
    "JUSTONEAPI_TOKEN": "你的实际token"
  }
}
```

> 💡 **获取你的 token**：在 [justoneapi.com](https://justoneapi.com) 注册

---

## 快速开始

### 1) 重启 MCP 客户端

配置完成后，重启 Claude Desktop（Cmd + Q）或你的 MCP 客户端。

### 2) 测试连接

在 Claude Desktop 中提问：

```
请列出 justoneapi-mcp 的所有可用工具
```

你应该能看到可用工具，包括 `unified_search_v1` 和 `kuaishou_search_video_v2`。

### 3) 使用统一搜索

尝试跨平台搜索：

```
使用 unified_search_v1 工具搜索 2025 年 1 月 1 日到 2 日所有平台上关于 "AI" 的内容
```

Claude 会自动格式化请求，并返回来自微博、微信、知乎、抖音、小红书、B站、快手和新闻的结果。

**示例对话：**

**你：** 搜索最近一周中文社交媒体平台上关于 "deepseek" 的讨论

**Claude：** 我将使用统一搜索工具搜索 "deepseek"。

*[Claude 使用 unified_search_v1 并适当的日期范围返回聚合结果]*

### 4) 高级搜索示例

**平台特定搜索：**
```
搜索 12 月 1 日到 1 月 2 日期间微博上关于 "chatgpt" 的内容
```

**复杂搜索查询：**
```
在知乎搜索包含 "AI" 或 "机器学习" 但不包含 "广告" 的帖子，
时间范围为最近 30 天
```

**翻页（获取更多结果）：**

当搜索结果有更多页时，响应中会包含 `nextCursor` 字段。只需让 Claude 继续：

```
显示下一页结果
```
或
```
获取更多结果
```
或
```
继续下一页
```

Claude 会自动：
- 从上一个响应中提取 `nextCursor`
- 使用它获取下一页
- 持续直到没有更多结果

**翻页对话示例：**

**你：** 搜索 2025 年 1 月 1-5 日所有平台上关于 "AI" 的内容

**Claude：** *[返回第 1 页结果，包含 10-20 条]*

**你：** 显示更多结果

**Claude：** *[使用 nextCursor 获取第 2 页]*

**你：** 继续

**Claude：** *[获取第 3 页，依此类推...]*

💡 **注意**：使用 `nextCursor` 翻页时，不需要再次提供 `start`、`end` 或 `source` - 游标已包含这些信息。

---

## 错误处理

所有错误都标准化为稳定的 MCP 错误代码，并附带可操作的消息。

### 错误代码

| 错误代码 | 说明 | 解决方案 |
|---------|------|---------|
| `INVALID_TOKEN` | Token 无效或未激活 | 更新你的 `JUSTONEAPI_TOKEN` |
| `COLLECT_FAILED` | 数据采集失败 | 稍后重试 |
| `RATE_LIMITED` | 请求过多 | 降低请求频率，稍后重试 |
| `DAILY_QUOTA_EXCEEDED` | 达到每日使用限额 | 等到明天或升级套餐 |
| `INSUFFICIENT_BALANCE` | 账户余额不足 | 充值你的账户 |
| `PERMISSION_DENIED` | 无权访问此资源 | 验证账户权限 |
| `VALIDATION_ERROR` | 请求参数无效 | 检查输入值 |
| `INTERNAL_ERROR` | 服务器错误 | 稍后重试 |
| `NETWORK_TIMEOUT` | 请求超时 | 检查网络或重试 |
| `NETWORK_ERROR` | 网络连接失败 | 检查互联网连接 |
| `UPSTREAM_ERROR` | 未指定的上游错误 | 重试或联系支持 |

### 错误格式

错误以此格式返回：
```
ERROR[错误代码] (upstream=XXX): 人类可读的消息
```

示例：
```
ERROR[RATE_LIMITED] (upstream=302): 超出速率限制。请降低速度并稍后重试。
```

---

## 设计理念

传输，而非转换。

此 MCP 优先考虑稳定性、透明度和原始数据保真度，而非便利性。

---

## 高级配置（可选）

默认情况下，服务器使用合理的默认值。你只需要设置 `JUSTONEAPI_TOKEN`。

但是，你可以使用这些可选环境变量自定义行为：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `JUSTONEAPI_TOKEN` | *（必需）* | 你的 JustOneAPI token |
| `JUSTONEAPI_BASE_URL` | `https://api.justoneapi.com` | API 端点 |
| `JUSTONEAPI_TIMEOUT_MS` | `20000` | 请求超时（毫秒）|
| `JUSTONEAPI_RETRY` | `1` | 首次尝试后的重试次数 |
| `JUSTONEAPI_DEBUG` | `false` | 启用调试日志到 stderr |

自定义设置示例：

```json
{
  "mcpServers": {
    "justoneapi": {
      "command": "npx",
      "args": ["-y", "justoneapi-mcp"],
      "env": {
        "JUSTONEAPI_TOKEN": "你的实际token",
        "JUSTONEAPI_TIMEOUT_MS": "30000",
        "JUSTONEAPI_DEBUG": "true"
      }
    }
  }
}
```

---

## 许可证

MIT
