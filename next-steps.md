# Gittrix agent access progress

## Completed

- Added core session accessors for agent integrations:
  - `session.info()`
  - `session.touchedFiles()`
  - `session.workspacePath()`
  - `SessionInfo`
  - `SessionAccessCapabilities`
- Expanded the CLI as a universal fallback integration layer:
  - `gittrix session info <session-id>`
  - `gittrix session read <session-id> <path>`
  - `gittrix session write <session-id> <path> < file`
  - `gittrix session delete <session-id> <path>`
  - `gittrix session list-files <session-id> [path]`
  - `gittrix session touched <session-id>`
- Added `@gittrix/mcp` package with local stdio MCP server.
- Added MCP tools:
  - `gittrix_start_session`
  - `gittrix_get_session`
  - `gittrix_list_sessions`
  - `gittrix_read_file`
  - `gittrix_write_file`
  - `gittrix_delete_file`
  - `gittrix_list_files`
  - `gittrix_touched_files`
  - `gittrix_diff`
  - `gittrix_request_promote`
  - `gittrix_discard_session`
- Made MCP output human-readable for inline agent chat:
  - session cards
  - compact tables
  - file/touched summaries
  - fenced diff blocks
  - copy-pastable human promotion command
- Kept promotion human-owned by default through `gittrix_request_promote`.
- Added large diff guard with `GITTRIX_MCP_MAX_DIFF_BYTES`.
- Smoke-tested MCP over stdio using the MCP SDK client.

## Current status

The MCP is good enough for alpha dogfooding with opencode, pi, or any local MCP-capable agent.

Do not call it stable v1 yet. It needs stronger output contracts, docs, tests, and path safety before freezing the tool surface.

## Next steps before stable v1

- Add docs:
  - `@gittrix/mcp` README
  - opencode MCP config snippet
  - environment variables
  - local durable path behavior
- Add structured MCP results alongside readable text when supported cleanly by the SDK/client.
- Add clean error cards for Gittrix errors instead of raw MCP failures.
- Add diff controls:
  - `files?: string[]`
  - `maxBytes?: number`
- Add committed MCP smoke tests.
- Add path guardrails:
  - reject absolute session file paths
  - reject `..` path escapes
  - normalize path separators
- Review and freeze MCP tool names before v1.
- Add import/export/patch tools after the basic MCP surface is stable.
