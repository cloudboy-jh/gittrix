Harness package for library-level checks.

Commands from repo root:

- `bun run testharness --` runs fast local harness tests
- `bun run testharness -- --integration` runs Cloudflare integration test (env-gated)
- `bun run testharness -- --all` runs all harness tests
- `bun run testharness -- --typecheck` typechecks harness

Integration env vars:

- `CF_ACCOUNT_ID`
- `CF_API_TOKEN`
- `CF_ARTIFACTS_NAMESPACE`
- `CF_ARTIFACTS_REPO`
- `CF_ARTIFACTS_BRANCH` (optional, default `main`)
