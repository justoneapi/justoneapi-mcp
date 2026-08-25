# JustOneAPI MCP Server

[简体中文](README.zh-CN.md) | English

Use JustOneAPI in MCP clients such as ChatGPT, Codex, Cursor, Hermes Agent, and
other AI assistant tools.

JustOneAPI MCP helps your assistant find the right JustOneAPI endpoint, inspect
the required parameters, and call APIs through your JustOneAPI authorization.

## Supported Clients

JustOneAPI MCP supports remote Streamable HTTP and local stdio. Current verified
and compatibility paths include:

- ChatGPT web Developer mode MCP connections: OAuth, verified.
- Codex CLI and the Codex IDE extension: OAuth, verified.
- Cursor, Hermes Agent, and other clients with custom headers: existing API
  Token compatibility method.
- Claude.ai, Claude Desktop, and Claude Code: OAuth remains under compatibility
  testing; Claude Code can use an existing API Token header.

Clients with a compatible OAuth registration flow can connect with only the
remote URL and complete authorization in the browser. Compatibility also
depends on client registration support and account or workspace policy. Clients
without OAuth can keep using a legacy API Token header or local stdio.

## Quick Start

### Remote HTTP with OAuth

OAuth is enabled on the production service. Add this URL as an MCP connection:

```text
https://mcp.justoneapi.com/mcp
```

Compatible clients discover the protected-resource metadata, redirect you to
`auth.justoneapi.com`, and ask for the MCP scopes shown on the consent page.
No JustOneAPI API Token needs to be pasted into the client. Entry points, OAuth
registration methods, and account restrictions vary by client, so the setup
below lists only verified OAuth paths.

#### Client setup

- **ChatGPT web:** open `Settings → Security and login`, enable `Developer mode`,
  open `Plugins`, and select `+`. Enter a name, description, and the `/mcp` URL
  above, then choose OAuth for Authentication. After creating the connection,
  ChatGPT discovers the authentication metadata and starts authorization during
  connection or when a protected tool is first invoked. Developer mode
  availability can depend on the ChatGPT account and workspace policy.
- **Codex CLI / IDE extension:** run the commands below. The currently
  recommended setup explicitly uses the verified DCR registration path:

```bash
codex mcp add justoneapi \
  --url https://mcp.justoneapi.com/mcp

codex mcp login justoneapi \
  --oauth-client-registration dcr
```

The ChatGPT desktop app, Codex CLI, and Codex IDE extension share MCP
configuration on the same Codex host. See the
[official OpenAI MCP documentation](https://developers.openai.com/codex/mcp/)
and [ChatGPT connection testing guide](https://developers.openai.com/plugins/deploy/connect-chatgpt)
for current entry points.

OAuth for Claude.ai, Claude Desktop, and Claude Code remains under compatibility
testing and is not yet offered as a generally supported OAuth connection.
Claude Code can use an existing API Token with
`--header "Authorization: Bearer your_token"`; do not treat the generic JSON
below as a Claude Code configuration.

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

As of 2026-08-25, npm `latest` is still the legacy `1.0.1` package, not the v2
implementation in this repository. If you require local stdio, pin the version
so the legacy CLI is not mistaken for the hosted v2 service:

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

Legacy `1.0.1` supports Node.js 18 or newer, and its tool layout is not the same as
the hosted v2 service. OAuth applies only to the remote Worker; stdio continues
to read `JUSTONEAPI_TOKEN` locally. Update this version guidance after v2 is
actually published to an npm dist-tag.

Catalog builds and dynamic releases use built-in public-safety validation and require no operator
security registry or secret. Runtime API and account calls return the upstream payload without
MCP-layer response truncation.

## Authentication and scopes

OAuth users select the API Token to link on the authorization page and do not
paste it into the client. The existing API Token remote compatibility method
uses:

```text
Authorization: Bearer your_token
```

or, for local stdio:

```text
JUSTONEAPI_TOKEN=your_token
```

Local stdio uses the environment variable above. Never commit a real Token to a
repository.

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

Production currently runs in `dual` mode. OAuth is additive and feature-flagged,
and these switches remain the deployment and rollback boundary:

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

npm 2.0 will first be published under the `next` dist-tag through OIDC trusted
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
