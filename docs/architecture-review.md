# Architecture Review (Mirror + Performance)

_Last updated: 2026-03-11_

## Current status

The architecture now has a production-grade mirror orchestration path:

- `MirrorController` is implemented (not interface-only).
- `CloudAgentClient` is implemented with strict HTTP/error handling.
- `RemotePageController` and `MirrorSession` are integrated in real runtime flow.
- `PAGE_CONTROL` and `TAB_CONTROL` boundaries are strongly typed and runtime-validated.
- Mirror performance budgets and contract tests are in place.

## Stable API vs Internal API

### Stable API (consumer-facing)

Use these exports from `@page-agent/mirror`:

- `createMirrorController`
- `MirrorController` / `IMirrorController`
- `MirrorControllerConfig`
- `MirrorConfig`
- `MirrorSessionContext`
- `MirrorState`, `MirrorEvent`, `MirrorSessionStatus`

These APIs are designed for application integration and should change conservatively.

### Internal/advanced API (transport and engine details)

These are intentionally lower-level and should be treated as advanced integration points:

- Layer interfaces (`IColdLayer`, `IWarmLayer`, `IHotLayer`)
- CDP/QUIC/Tauri transport descriptors
- micro-DOM frame/diff payload details

They remain exported for power users and custom runtimes, but they are not the primary integration path.

## Mirror runtime state machine

```
disconnected
   │ startSession
   ▼
initializing
   ▼
cold-syncing
   ▼
warm-syncing
   ▼
live ──(layer issue)──► degraded
  │  └─ reconnect ─────► live
  │
  ├─ endSession/dispose ─► disconnected
  └─ fatal error ────────► error
```

### Transition guarantees

- `startSession()` only returns after cold/warm/hot are initialized.
- `endSession()` tears down hot → warm → cold and then handles cloud agent lifecycle.
- `dispose()` is idempotent and delegates to `endSession()`.

## Performance playbook

### Budgeted metrics

The repository now enforces mirror budgets via tests:

- **p95 diff materialization latency** (`MirrorSession`) < **8ms**
- **p95 input dispatch latency** (`RemotePageController`/hot path) < **6ms**

### Commands

```bash
npm run test:perf:mirror
```

### Key design choices

- Incremental HTML line cache in `MirrorSession` avoids full rebuild for small diffs.
- Extension click flow uses navigation probing instead of fixed 1-second sleeps.
- Runtime guard in mirror remote controller only applies strictly newer snapshots (`seq > current`).

## Test and typecheck guardrails

### Contract tests

- `tests/contracts/page-controller.contract.test.ts`
  - validates local `PageController`
  - validates extension `RemotePageController`
  - validates mirror `RemotePageController`

### Mirror runtime tests

- `tests/mirror/mirror-controller.test.ts`
- `tests/mirror/mirror-session.test.ts`

### Typecheck graph

CI and check now use:

```bash
npx tsc --build tsconfig.typecheck.json
```

This graph explicitly includes `core`, `mirror`, and extension typecheck config.

## Guiding principle

**Narrow public contracts, explicit internal ports, measurable performance budgets, and executable tests on real runtime code paths.**
