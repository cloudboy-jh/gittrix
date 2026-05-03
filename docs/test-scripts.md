# Test Scripts

## Root-level test commands

- `bun run test` — run all workspace package tests
- `bun run typecheck` — run workspace typechecks
- `bun run build` — build all workspace packages

## Harness commands (root)

- `bun run testharness --` — run fast local harness tests
- `bun run testharness -- --integration` — run Cloudflare integration harness test (env-gated)
- `bun run testharness -- --all` — run all harness tests
- `bun run testharness -- --typecheck` — typecheck harness package

## Package-level test commands

- `bun run --cwd packages/core test`
- `bun run --cwd packages/adapter-local test`
- `bun run --cwd packages/adapter-cloudflare-artifacts test`
- `bun run --cwd packages/cli test`
- `bun run --cwd packages/harness test`

## Package-level typecheck commands

- `bun run --cwd packages/core typecheck`
- `bun run --cwd packages/adapter-local typecheck`
- `bun run --cwd packages/adapter-cloudflare-artifacts typecheck`
- `bun run --cwd packages/cli typecheck`
- `bun run --cwd packages/harness typecheck`

## Package-level build commands

- `bun run --cwd packages/core build`
- `bun run --cwd packages/adapter-local build`
- `bun run --cwd packages/adapter-cloudflare-artifacts build`
- `bun run --cwd packages/cli build`
- `bun run --cwd packages/harness build`

## Cloudflare integration env vars

Used by harness `--integration` mode:

- `CF_ACCOUNT_ID`
- `CF_API_TOKEN`
- `CF_ARTIFACTS_NAMESPACE`
- `CF_ARTIFACTS_REPO`
- `CF_ARTIFACTS_BRANCH` (optional, defaults to `main`)
