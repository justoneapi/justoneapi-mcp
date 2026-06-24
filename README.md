# JustOneAPI MCP Server

[简体中文](README.zh-CN.md) | English

Use JustOneAPI in MCP clients such as Claude Desktop, Cursor, and other AI
assistant tools.

JustOneAPI MCP helps your assistant find the right JustOneAPI endpoint, inspect
the required parameters, and call the API with your JustOneAPI token.

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

## Example

Ask your MCP client naturally:

```text
Find the Xiaohongshu note comments API and tell me which parameters are required.
```

The assistant can then search the available JustOneAPI endpoints, explain the
required parameters, and call the selected API after you provide the needed
values.

## License

MIT
