[![npm version](https://badge.fury.io/js/justoneapi-mcp.svg)](https://www.npmjs.com/package/justoneapi-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[简体中文](README.zh-CN.md) | English

> **Raw JSON by design.** Unmodified upstream responses for maximum data fidelity.

# JustOneAPI MCP Server

Use JustOneAPI inside AI assistants via Model Context Protocol (MCP).

This MCP server is a thin transport layer that exposes JustOneAPI endpoints to AI agents and returns the original raw JSON response from upstream platforms.

---

## What This MCP Does

- Exposes JustOneAPI endpoints as MCP tools
- Handles authentication, retries, timeouts, and error normalization
- Returns raw upstream JSON without field parsing
- Designed for AI agents and developer workflows

---

## What This MCP Does NOT Do

- No field parsing or schema normalization
- No data restructuring
- No assumptions about upstream response structure

This design is intentional to preserve data fidelity and long-term compatibility.

---

## Available Tools

This MCP server provides multiple tools to interact with JustOneAPI endpoints. Each tool returns the original raw JSON response from upstream without field parsing.

### Featured Tool: Unified Search

**`unified_search_v1`** - Search across multiple Chinese social media and news platforms in one request.

Supports: Weibo, WeChat, Zhihu, Douyin, Xiaohongshu, Bilibili, Kuaishou, and News.

**How to use (Natural Language):**

Just ask Claude or your MCP host to use the tool with a natural language request:
- *"Search for AI discussions on Chinese social media from last week"*
- *"Find posts about deepseek on Weibo from January 1st to 5th"*
- *"Search for chatgpt OR 机器学习 on all platforms, exclude 广告"*

Claude will automatically:
- Convert your request to the correct API format
- Handle date formatting (UTC+8 timezone)
- Process pagination with nextCursor (just ask "show me more")
- Return and summarize results

**Search Syntax:**
- Single keyword: `deepseek`
- AND search: `deepseek chatgpt` (both must appear)
- OR search: `deepseek~chatgpt` (either can appear)
- NOT search: `deepseek -chatgpt` (exclude chatgpt)

**Platform Options:**
`ALL` (default), `NEWS`, `WEIBO`, `WEIXIN`, `ZHIHU`, `DOUYIN`, `XIAOHONGSHU`, `BILIBILI`, `KUAISHOU`

**Technical Parameters (for reference):**
```json
{
  "keyword": "AI",
  "source": "ALL",
  "start": "2025-01-01 00:00:00",
  "end": "2025-01-02 23:59:59"
}
```

### Discovering All Available Tools

To see all available tools in your MCP host (Claude Desktop, Cursor, etc.):

**In Claude Desktop:**
```
Please list all available tools from justoneapi-mcp
```

**In Cursor or other MCP hosts:**
Use your host's tool discovery feature to see all available tools and their parameters.

Each tool includes:
- ✅ Complete parameter descriptions
- ✅ Input validation with Zod schemas
- ✅ Detailed error messages
- ✅ Example values in parameter descriptions

### Tool Naming Convention

All tools follow this pattern:
- `unified_search_v1` - Unified search across platforms
- `kuaishou_search_video_v2` - Platform-specific video search
- `{platform}_{action}_{version}` - General pattern

### Complete Tool Documentation

For detailed documentation of all tools, parameters, and examples, see **[TOOLS.md](TOOLS.md)**.

---

## Output Contract

This MCP returns raw JSON from upstream APIs.

Example (simplified):

    {
      "code": 0,
      "message": null,
      "recordTime": "2025-12-31T14:55:21Z",
      "data": ...
    }

---

## Authentication

You need a JustOneAPI token to use this server.

**Get your token**: Visit [https://justoneapi.com](https://justoneapi.com) to sign up and obtain your API token.

---

## Installation

### Option 1: npx (Recommended)

Use directly with npx, no installation required.

**Configure Claude Desktop:**

Edit the configuration file for your operating system:
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
        "JUSTONEAPI_TOKEN": "your_actual_token_here"
      }
    }
  }
}
```

> 💡 **Get your token**: Sign up at [justoneapi.com](https://justoneapi.com)

### Option 2: Global Installation

```bash
npm install -g justoneapi-mcp
```

**Configure Claude Desktop:**

Edit the configuration file for your operating system:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "justoneapi": {
      "command": "justoneapi-mcp",
      "env": {
        "JUSTONEAPI_TOKEN": "your_actual_token_here"
      }
    }
  }
}
```

> 💡 **Get your token**: Sign up at [justoneapi.com](https://justoneapi.com)

### Option 3: Local Development

```bash
git clone <repository>
cd justoneapi-mcp
npm install
npm run build
```

**Configure Claude Desktop:**

Edit the configuration file for your operating system:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "justoneapi": {
      "command": "node",
      "args": ["/absolute/path/to/justoneapi-mcp/dist/index.js"],
      "env": {
        "JUSTONEAPI_TOKEN": "your_actual_token_here"
      }
    }
  }
}
```

> 💡 **Get your token**: Sign up at [justoneapi.com](https://justoneapi.com)

That's it! Only the token is required.

---

## Usage with Other MCP Hosts

This server follows the standard MCP protocol and is compatible with any MCP host (Cursor, Cline, custom agents, etc.).

Generic configuration:

```json
{
  "command": "npx",
  "args": ["-y", "justoneapi-mcp"],
  "env": {
    "JUSTONEAPI_TOKEN": "your_actual_token_here"
  }
}
```

Or if globally installed:

```json
{
  "command": "justoneapi-mcp",
  "env": {
    "JUSTONEAPI_TOKEN": "your_actual_token_here"
  }
}
```

> 💡 **Get your token**: Sign up at [justoneapi.com](https://justoneapi.com)

---

## Quick Start

### 1) Restart Your MCP Host

After configuring, restart Claude Desktop (Cmd + Q) or your MCP host.

### 2) Test the Connection

In Claude Desktop, ask:

```
Please list all available tools from justoneapi-mcp
```

You should see the available tools including `unified_search_v1` and `kuaishou_search_video_v2`.

### 3) Use the Unified Search

Try searching across multiple platforms:

```
Use the unified_search_v1 tool to search for "AI" across all platforms
from January 1st to January 2nd, 2025.
```

Claude will automatically format the request and return results from Weibo, WeChat, Zhihu, Douyin, Xiaohongshu, Bilibili, Kuaishou, and News.

**Example conversation:**

**You:** Search for recent discussions about "deepseek" on Chinese social media platforms from the last week.

**Claude:** I'll search for "deepseek" across multiple platforms using the unified search tool.

*[Claude uses unified_search_v1 with appropriate date range and returns aggregated results]*

### 4) Advanced Search Examples

**Platform-specific search:**
```
Search for "chatgpt" on Weibo only, from December 1st to January 2nd
```

**Complex search queries:**
```
Search for posts containing "AI" OR "机器学习" but NOT "广告" on Zhihu,
from the last 30 days
```

**Pagination (Getting more results):**

When search results have more pages, the response includes a `nextCursor` field. Simply ask Claude to continue:

```
Show me the next page of results
```
or
```
Get more results from the previous search
```
or
```
Continue with the next page
```

Claude will automatically:
- Extract the `nextCursor` from the previous response
- Use it to fetch the next page
- Continue until no more results are available

**Example conversation with pagination:**

**You:** Search for "AI" on all platforms from January 1-5, 2025

**Claude:** *[Returns first page of results with 10-20 items]*

**You:** Show me more results

**Claude:** *[Uses nextCursor to fetch page 2]*

**You:** Continue

**Claude:** *[Fetches page 3, and so on...]*

💡 **Note**: When using `nextCursor` for pagination, you don't need to provide `start`, `end`, or `source` again - the cursor already contains this information.

---

## Error Handling

All errors are normalized into stable MCP error codes with actionable messages.

### Error Codes

| Error Code | Description | Action                              |
|------------|-------------|-------------------------------------|
| `INVALID_TOKEN` | Token is invalid or inactive | Update your `JUSTONEAPI_TOKEN`      |
| `COLLECT_FAILED` | Data collection failed | Retry after a short delay           |
| `RATE_LIMITED` | Too many requests | Slow down and retry later           |
| `DAILY_QUOTA_EXCEEDED` | Daily usage limit reached | Wait until tomorrow or upgrade plan |
| `INSUFFICIENT_BALANCE` | Account balance too low | Top up your account                 |
| `PERMISSION_DENIED` | No access to this resource | Contact support                     |
| `VALIDATION_ERROR` | Invalid request parameters | Check input values                  |
| `INTERNAL_ERROR` | Server error | Retry later                         |
| `NETWORK_TIMEOUT` | Request timed out | Check network or retry              |
| `NETWORK_ERROR` | Network connection failed | Check internet connection           |
| `UPSTREAM_ERROR` | Unspecified upstream error | Retry or contact support            |

### Error Format

Errors are returned in this format:
```
ERROR[ERROR_CODE] (upstream=XXX): Human-readable message
```

Example:
```
ERROR[RATE_LIMITED] (upstream=302): Rate limit exceeded. Please slow down and retry later.
```

---

## Design Philosophy

Transport, not transformation.

This MCP prioritizes stability, transparency, and raw data fidelity over convenience.

---

## Advanced Configuration (Optional)

By default, the server works with sensible defaults. You only need to set `JUSTONEAPI_TOKEN`.

However, you can customize behavior with these optional environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `JUSTONEAPI_TOKEN` | *(required)* | Your JustOneAPI token |
| `JUSTONEAPI_BASE_URL` | `https://api.justoneapi.com` | API endpoint |
| `JUSTONEAPI_TIMEOUT_MS` | `20000` | Request timeout (milliseconds) |
| `JUSTONEAPI_RETRY` | `1` | Number of retries after first attempt |
| `JUSTONEAPI_DEBUG` | `false` | Enable debug logging to stderr |

Example with custom settings:

```json
{
  "mcpServers": {
    "justoneapi": {
      "command": "npx",
      "args": ["-y", "justoneapi-mcp"],
      "env": {
        "JUSTONEAPI_TOKEN": "your_token_here",
        "JUSTONEAPI_TIMEOUT_MS": "30000",
        "JUSTONEAPI_DEBUG": "true"
      }
    }
  }
}
```

---

## License

MIT
