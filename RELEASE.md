# Release checklist

Both production workflows use the protected GitHub `production` environment.
Configure that environment's deployment branch rule to allow only `main`; the
job-level ref condition and the retained shell guard enforce the same boundary
before production approval as defense in depth.

## npm 2.0 prerelease

The only authorized automated npm path is `.github/workflows/publish-next.yml`.
It is manually dispatched from `main`, uses the protected `production` GitHub
environment, authenticates through npm trusted publishing (OIDC), and publishes
with the `next` dist-tag. It must not use `NPM_TOKEN` or another long-lived
publish credential.

Before the first run, configure the npm package's trusted publisher with the
exact repository, workflow filename `publish-next.yml`, environment
`production`, and `npm publish` permission.

- Confirm `package.json` contains the intended new version. Published npm
  versions cannot be reused.
- Confirm Node.js 18 users can remain on `justoneapi-mcp@1.0.1`; 2.0 requires
  Node.js 20 or newer.
- Confirm the worktree contains no `.dev.vars`, PEM, private JWK Set, npm token,
  or generated secret file.
- Run `npm ci` with no `--force` or legacy-peer override.
- Run `npm run validate:offline`.
- Run `npx wrangler types worker-configuration.d.ts --include-runtime false --check`.
- On Node.js 22 or newer, run `npm run build:all` and confirm the Worker dry run
  succeeds without a deployment. The Node.js 20 CI lane validates the CLI and
  package only because current Wrangler requires Node.js 22.
- Run `npm run verify:package`.
- Run `bash scripts/verify-packed-cli.sh`. It creates a real tarball in a
  `mktemp` directory, installs it with `npm ci`, checks the production
  dependency tree and package contents, and completes stdio `initialize` plus
  `tools/list`. CI repeats this on Node.js 20, 22, and 24.
- Dispatch `Publish npm next` from `main` and approve the `production`
  environment gate.
- Verify npm shows version 2.0 under `next`, with trusted-publisher provenance;
  verify `latest` still points to the legacy release.

After the Node.js 20, 22, and 24 smoke checks pass for the exact published
`2.0.0` artifact, promote it manually from an operator terminal with npm 2FA:

```bash
npm dist-tag add justoneapi-mcp@2.0.0 latest
```

Verify both `next` and `latest` resolve to `2.0.0`. This promotion must remain a
separate manual operation: do not add it to `publish-next.yml`, and do not add
`NPM_TOKEN` or another long-lived npm credential for dist-tag automation.

## Worker rollout

npm publication does not deploy the Worker or enable OAuth. Handle the remote
rollout separately. The only automated production path is the manually
dispatched `.github/workflows/deploy-worker.yml` workflow on `main`, protected
by the `production` GitHub environment. Store its narrowly scoped
`CLOUDFLARE_API_TOKEN` in that environment; Worker OAuth private JWK material
remains in Cloudflare Secrets and must never be copied into GitHub.

The workflow runs offline validation, verifies the already committed catalog
against the mutable live source without regenerating files, checks generated
Worker types, and performs a dry-run bundle before the gated deploy step. Live
catalog validation failure stops deployment; catalog changes must be generated,
reviewed, and committed before the deployment window.

Roll out in this order:

1. Keep `JUSTONEAPI_OAUTH_MODE=off`; install the private JWK Set and active
   `kid` as Worker secrets.
2. Verify the canonical public JWKS returns 200 and contains only the intended
   overlapping public keys. This endpoint signs and verifies a local probe with
   the configured active key as a readiness check; a 503 blocks promotion.
   Preview and `workers.dev` routes must return 404 for JWKS/PRM.
3. Export only the public keys from the Worker JWK Set and inject that complete
   JSON document into datashop as `DATASHOP_OAUTH_WORKER_JWKS_JSON`. Datashop
   does not fetch a Worker `jwks_uri`; private fields remain only in the
   Cloudflare Secret.
4. Dispatch and approve `Deploy production Worker` while mode remains `off`;
   verify the dark deployment before changing the mode.
5. Confirm `wrangler secret list` contains both
   `JUSTONEAPI_OAUTH_WORKER_PRIVATE_JWKS` and
   `JUSTONEAPI_OAUTH_WORKER_ACTIVE_KID` (names only; never print values). Change
   the tracked `wrangler.jsonc` mode from `off` to `dual` in a reviewed commit,
   dispatch the protected workflow, and run legacy regression, OAuth discovery,
   scope challenge, billing, and no-token-leak checks. A later deployment must
   not silently restore `off` through an untracked dashboard override.
6. Roll back with a reviewed configuration change to `off` and redeploy; this
   hides OAuth discovery and returns
   traffic to the strict legacy lane without changing backend billing or API
   Token validation.

`JUSTONEAPI_MCP_ALLOWED_ORIGINS=*` is deliberate for the public, bearer-token
MCP endpoint: it does not use browser cookies, and exact canonical Host plus
OAuth audience validation remain mandatory. If this policy changes, replace it
with an explicit HTTPS origin list in the same reviewed configuration commit.

Live OpenAPI verification remains a separate manual/deploy gate because it
depends on mutable external catalog data; it is not part of npm prepublish.
