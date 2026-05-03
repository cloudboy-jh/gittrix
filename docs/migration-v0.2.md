# Migration v0.2

## Breaking change

`LocalSessionAdapter` is split into two interfaces:

- `DurableAdapter`
- `EphemeralAdapter`

`LocalSessionAdapter` is deprecated.

## Adapter class change

`LocalFsAdapter` is removed as the primary adapter. Use:

- `LocalDurableAdapter`
- `LocalEphemeralAdapter`

Deprecated compatibility export may exist temporarily, but new code should not use it.

## Before

```ts
import { GitTrix } from '@gittrix/core'
import { LocalFsAdapter } from '@gittrix/adapter-local'

const adapter = new LocalFsAdapter({ sessionsRootDir: '/tmp/gittrix' })
const gittrix = new GitTrix({ adapter })
```

## After

```ts
import { GitTrix } from '@gittrix/core'
import { LocalDurableAdapter, LocalEphemeralAdapter } from '@gittrix/adapter-local'

const durable = new LocalDurableAdapter({ path: '/path/to/repo', branch: 'main' })
const ephemeral = new LocalEphemeralAdapter({ sessionsRootDir: '/tmp/gittrix' })

const gittrix = new GitTrix({ durable, ephemeral })
```

## Diff behavior

`session.diff()` still returns a unified diff string.

Implementation moved from adapters into core in v0.2. Consumer-facing behavior is unchanged.
