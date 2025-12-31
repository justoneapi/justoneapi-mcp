> **Raw JSON by design.**

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

### kuaishou_search_video_v2

Search Kuaishou videos by keyword.

Input:
- keyword (string, required)
- page (number, optional, default: 1)

Output:
- Returns the original raw JSON response from upstream
- Includes metadata such as code, message, recordTime, and query info

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

Authentication is handled via JustOneAPI token.

Set environment variable:

    JUSTONEAPI_TOKEN=your_token_here

The token is passed as a query parameter and is never logged in plaintext.

---

## Quick Start (Claude Desktop)

### 1) Build

```bash
npm install
npm run build
```

### 2) Local Development (Optional)

You can create a `.env` file in the root directory for local testing:

```env
JUSTONEAPI_TOKEN=your_token_here
JUSTONEAPI_DEBUG=true
```

### 3) Configure Claude Desktop (macOS)

Create or edit the file:

    ~/Library/Application Support/Claude/claude_desktop_config.json

Add the following JSON (replace path and token):

    {
      "mcpServers": {
        "justoneapi": {
          "command": "/usr/local/bin/node",
          "args": [
            "/Users/YOUR_USERNAME/project/justoneapi-mcp/dist/index.js"
          ],
          "env": {
            "JUSTONEAPI_BASE_URL": "https://api.justoneapi.com",
            "JUSTONEAPI_TOKEN": "your_token_here",
            "JUSTONEAPI_TIMEOUT_MS": "20000",
            "JUSTONEAPI_RETRY": "1",
            "JUSTONEAPI_DEBUG": "false"
          }
        }
      }
    }

### 3) Restart Claude Desktop

Quit Claude Desktop completely (Cmd + Q), then open it again.

### 4) Test

In Claude Desktop:

    Please list available tools.

Then:

    Use the tool kuaishou_search_video_v2 to search videos with keyword "dance".
    Return the raw JSON.

---

## Error Handling

Upstream errors are normalized into stable MCP error codes, including:

- INVALID_TOKEN
- RATE_LIMITED
- DAILY_QUOTA_EXCEEDED
- INSUFFICIENT_BALANCE
- VALIDATION_ERROR
- INTERNAL_ERROR

Each error includes an actionable message.

---

## Design Philosophy

Transport, not transformation.

This MCP prioritizes stability, transparency, and raw data fidelity over convenience.

---

## License

MIT
