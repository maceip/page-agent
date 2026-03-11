# Mirror Runtime Integration Guide

_Last updated: 2026-03-11_

## Overview

Mirror now has a concrete runtime path:

- `createMirrorController(config)` returns an operational controller.
- `MirrorController` orchestrates cold/warm/hot layers.
- `CloudAgentClient` manages cloud agent lifecycle and follow-ups.
- `MirrorSession` wires hot-layer snapshots to `RemotePageController`.

## Minimal integration

```ts
import { createMirrorController } from '@page-agent/mirror'

const mirror = createMirrorController({
  apiKey: process.env.CLOUD_AGENT_KEY!,
  repository: 'https://github.com/your-org/your-repo',
  remoteCdpUrl: 'ws://remote-browser:9222/devtools/browser/<id>',
  quic: { remoteEndpoint: 'quic://mirror.example.com:4433' },
  context: {
    userSessionId: 'user-123',
    pageId: 'tab-7',
    origin: 'https://app.example.com',
  },
  dependencies: {
    coldLayer,
    warmLayer,
    hotLayer,
    // optional: cloudClient
  },
})

const { sessionId } = await mirror.startSession()
const state = await mirror.getRemoteBrowserState()
await mirror.sendInputToRemote({
  type: 'navigate',
  url: 'https://app.example.com/dashboard',
  timestamp: new Date().toISOString(),
})
await mirror.endSession()
```

## Required dependencies

`MirrorController` requires concrete layer dependencies:

- `IColdLayer` (profile/bootstrap lifecycle)
- `IWarmLayer` (auth/cookie/session replication)
- `IHotLayer` (input dispatch + micro-DOM observation)

If `cloudClient` is not supplied, the controller creates one using `apiKey` and
`apiBaseUrl`.

## Session identity context

Set `context` in `MirrorConfig` to keep identity explicit across layers:

- `userSessionId`
- `pageId`
- `origin`

This context is surfaced in `MirrorState.context` and should be treated as immutable
for a session.

## Event model

Use `onEvent()` to observe lifecycle and quality:

- `mirror:status-change`
- `mirror:layer-sync`
- `mirror:error`
- `mirror:cloud-agent`
- `mirror:navigation-intercept`
- `mirror:visual-handoff`

For hot-path interactions:

- `onRemoteFrame()`
- `onSpatialMapUpdate()`
- `onNavigationIntercept()`

## Performance-sensitive behavior

- `MirrorSession` now applies diffs incrementally and only rebuilds full HTML on
  large patch thresholds.
- `RemotePageController.updateTree()` only consumes strictly newer snapshots
  (`seq > current`), preventing stale rollback.

## Demo and verification

The mirror E2E demo now exercises the runtime controller path:

```bash
npm run demo:e2e:mirror
```

This command:

1. builds page-controller, llms, core, mirror packages,
2. runs a two-browser Puppeteer scenario,
3. drives remote actions through `MirrorController` APIs,
4. validates phase-2 transfer behavior.

## Safety and failure behavior

- `startSession()` transitions state: `initializing → cold-syncing → warm-syncing → live`.
- Any initialization failure emits `mirror:error`, transitions to `error`, and cleans up layers.
- `endSession()` tears down layers in deterministic order and handles cloud-agent stop/delete.
- `dispose()` is idempotent.
