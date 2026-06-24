# JustOneAPI MCP Server

[简体中文](README.zh-CN.md) | English

Use JustOneAPI in MCP clients such as Codex, Claude Desktop, Cursor, and other
AI assistant tools.

JustOneAPI MCP helps your assistant find the right JustOneAPI endpoint, inspect
the required parameters, and call the API with your JustOneAPI token.

## Supported Clients

You can use JustOneAPI MCP with any MCP-compatible client that supports remote
HTTP or local stdio servers, including:

- Codex
- Claude Desktop
- Cursor
- Other MCP-compatible AI assistants

For Codex, add JustOneAPI as a remote MCP server and use the Remote HTTP URL and
Authorization header below.

## Quick Start

### Remote HTTP

Remote HTTP is the recommended way to use JustOneAPI MCP.

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

### Local stdio

You can also run the MCP server locally with `npx`.

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

Use your JustOneAPI token in one of these ways:

```text
Authorization: Bearer your_token
```

or, for local stdio:

```text
JUSTONEAPI_TOKEN=your_token
```

`Bearer your_token` is the recommended Authorization format.

## Things You Can Ask

Ask your MCP client naturally:

```text
Find the Xiaohongshu note comments API and tell me which parameters are required.
```

More examples:

```text
Which Douyin APIs can get video details?
```

```text
Call the Xiaohongshu note comments API with this note ID: xxxxx.
```

```text
List the Weibo search-related APIs and explain when to use each one.
```

```text
Continue to the next page of results.
```

```text
The API returned code 400. Help me check which parameter might be wrong.
```

```text
The API returned code 601 or 602. What does it mean?
```

The assistant can search available JustOneAPI endpoints, explain required
parameters, call the selected API after you provide the needed values, and help
interpret common response codes.

## License

MIT
