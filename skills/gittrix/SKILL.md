---
name: gittrix
description: Ephemeral workspaces and storage routing for AI coding agents. Run tasks in safe isolation, view changes, and promote to durable git history only when approved.
---

# GitTrix Skill

Gittrix routes agent writes away from durable repository history and into isolated workspaces.

## Trigger Phrase Guidance
Use this skill when the user asks you to:
- Spin up/start an agent session or ephemeral workspace.
- Write/update files safely without committing to long-term history.
- Inspect current diffs or promote/merge changes.

## Commands

### 1. Start a Session
```bash
gittrix session start "<task>" "/path/to/repo" <branch>
```
Saves the baseline commit states and creates an isolated worktree at `~/.gittrix/sessions/<session_id>/workspace`.

### 2. File Editing
Write files directly under the resolved `workspacePath` returned by the session start metadata.

### 3. Check Safe Diffs
```bash
gittrix session diff <session_id>
```

### 4. Promotion
When the user approves the edits, merge them back to the durable directory:
```bash
gittrix promote <session_id> -m "<commit message>"
```

### 5. Housekeeping
List active workspaces or manually evict:
```bash
gittrix session list
gittrix session evict <session_id>
```
