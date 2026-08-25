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

Clients that implement MCP OAuth discovery can connect with only the remote URL
and complete authorization in the browser. Clients without that flow can keep
using a legacy API Token header or local stdio.

## Quick Start

### Remote HTTP with OAuth

When OAuth is enabled on the production service, add this URL as a custom MCP
connector:

```text
https://mcp.justoneapi.com/mcp
```

The client discovers the protected-resource metadata, redirects you to
`auth.justoneapi.com`, and asks for the MCP scopes shown on the consent page.
No JustOneAPI API Token needs to be pasted into the client. This works with any
MCP client that implements the standard OAuth discovery flow; UI wording varies
by client.

#### Client setup

- **ChatGPT:** add a custom MCP tool or plugin connection and use the production
  URL above. ChatGPT discovers OAuth automatically and opens the JustOneAPI
  consent page.
- **Codex CLI / IDE / desktop:** run
  `codex mcp add justoneapi --url https://mcp.justoneapi.com/mcp`. If the
  authorization page does not open during setup, run `codex mcp login justoneapi`.
  Codex automatically chooses CIMD when available and otherwise falls back to
  DCR.
- **Claude.ai / Claude Desktop remote connector:** open **Customize →
  Connectors → Add custom connector**, enter the production URL, then connect
  your JustOneAPI account. These hosted surfaces use the same remote connector.
  On Team and Enterprise plans, an Owner or Admin adds the connector and members
  then connect their accounts.
- **Claude Code:** run
  `claude mcp add --transport http justoneapi https://mcp.justoneapi.com/mcp`.
  Then run `claude mcp login justoneapi`, or start Claude Code and use `/mcp`,
  to complete OAuth. The browser returns to Claude Code through a random
  localhost callback port.

The authorization page shows the requested scopes. An account owner selects an
existing API Token or creates a dedicated one; a Token Member can only use the
Token assigned to that member. Disconnecting the app later revokes only its
OAuth connection; it does not disable or delete the linked API Token.

### Remote HTTP with an existing API Token

The existing header-based connection remains supported for compatibility:

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

You can also run the MCP server locally with `npx`. Version 2 requires Node.js
20 or newer.

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

Node.js 18 users must keep the legacy `justoneapi-mcp@1.0.1` package until they
can upgrade Node.js. OAuth applies to the remote Worker; stdio continues to read
`JUSTONEAPI_TOKEN` locally.

The published CLI supports Node.js 20, 22, and 24. Wrangler's Worker build and
type-generation commands require Node.js 22 or newer.

Catalog builds and dynamic releases use built-in public-safety validation and require no operator
security registry or secret. Runtime API and account calls return the upstream payload without
MCP-layer response truncation.

## Authentication and scopes

Use your JustOneAPI token in one of these ways:

```text
Authorization: Bearer your_token
```

or, for local stdio:

```text
JUSTONEAPI_TOKEN=your_token
```

`Bearer your_token` is the recommended Authorization format.

OAuth access tokens use three least-privilege scopes:

- `mcp:catalog:read` — search endpoints, inspect schemas, and list platforms.
- `mcp:api:call` — call a JustOneAPI endpoint.
- `mcp:account:read` — view balance and usage.

`call_endpoint` may incur charges under the API Token linked during OAuth and
its current pricing, permissions, balance, and budget. It validates the
endpoint and parameters before obtaining a short-lived delegation token, then
makes exactly one upstream dispatch. It does not automatically retry an
uncertain timeout, network failure, or HTTP 502/503/504 result.

Legacy API Tokens are still sent to the JustOneAPI backend in the established
query/form format. OAuth access and delegation tokens are never put in backend
URLs or form bodies; delegation tokens are sent only as an Authorization Bearer
header.

## Operator rollout

OAuth is additive and feature-flagged:

- `JUSTONEAPI_OAUTH_MODE=off` keeps the remote service legacy-only and hides
  OAuth discovery metadata.
- `JUSTONEAPI_OAUTH_MODE=dual` accepts both existing API Tokens and standard
  OAuth on the exact `https://mcp.justoneapi.com` origin.
- Preview and `workers.dev` routes remain legacy-only, even if the variable is
  set to `dual`.

The Worker uses `private_key_jwt` for Authorization Server introspection and
RFC 8693 token exchange. Store the private JWK set and active `kid` as Worker
secrets; never commit `.dev.vars`, PEM files, or private JWK sets. Rotate keys by
publishing old and new public keys first, switching the active `kid` second, and
removing the retired key only after the overlap period.

npm 2.0 is first published under the `next` dist-tag through OIDC trusted
publishing. After the exact published artifact passes the Node.js 20, 22, and
24 smoke checks, an operator promotes it separately with npm 2FA using
`npm dist-tag add justoneapi-mcp@2.0.0 latest`. This is never automated with an
`NPM_TOKEN`. See [RELEASE.md](RELEASE.md).

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
Check my JustOneAPI balance.
```

```text
Show my recent API usage and spending.
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
