# Architecture & Performance Audit — maceip/page-agent Branch

**Scope:** +8,029 lines across 59 files on top of main
**Audit focus:** Overall architecture, performance on the hot path, interface narrowness
**Date:** 2026-03-11

---

## Executive Summary

The branch introduces a well-structured three-layer browser mirroring system
(`packages/mirror/`) alongside meaningful protocol hardening in the extension.
The architecture is sound: interfaces are narrow where they need to be, the
stable/internal API split is correct, and the typed message protocols eliminate
an entire class of runtime bugs. However, there are **seven concrete issues**
that must be addressed before this ships — five affect performance on the hot
path and two affect correctness under load.

### Verdict by area

| Area | Grade | Summary |
|------|-------|---------|
| Mirror three-layer design | **A** | Clean separation; cold/warm/hot responsibilities don't bleed |
| Protocol hardening (ext) | **A** | Discriminated unions + runtime validators = no more `any` payloads |
| Interface narrowness | **A-** | Layer interfaces minimal; MirrorController is large but justified |
| API boundary (stable/internal) | **A** | Correct split; re-export via namespace keeps consumers safe |
| Performance (hot path) | **C+** | Several allocation/backpressure issues on the frame and diff paths |
| Tests | **B-** | Contract + perf budget tests exist; edge cases and error paths missing |
| Docs/ADRs | **A** | Decisions recorded; budgets formalized |

---

## 1. Architecture Overview

```
┌────────────────────────────────────────────────────────────┐
│  MirrorController  (orchestrator)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────────┐ │
│  │ IColdLayer│  │IWarmLayer│  │ IHotLayer                │ │
│  │ profile   │  │ CDP bus  │  │ MoQ frames + MicroDOM    │ │
│  │ bootstrap │  │ identity │  │ spatial + input dispatch  │ │
│  │ (zstd)    │  │ replicator│ │ invisible UI projector   │ │
│  └──────────┘  └──────────┘  └──────────────────────────┘ │
│         │             │                │                   │
│         └─── QUIC ────┴───── QUIC ─────┘                   │
│                                                            │
│  MirrorSession ── RemotePageController ── PageAgentCore    │
│  CloudAgentClient (REST)                                   │
└────────────────────────────────────────────────────────────┘
```

The three layers map cleanly to three distinct cadences:

- **Cold** — once per session (profile bootstrap, ~seconds)
- **Warm** — on auth mutations (cookie/token sync, ~100ms cadence)
- **Hot** — every frame (pixel stream + spatial map, ~33ms at 30fps)

This layering is correct and avoids the common mistake of shoving everything
into a single WebSocket multiplexer with mixed priorities.

---

## 2. What's Right

### 2.1 Typed message protocols (extension)

`page-control-protocol.ts` and `tab-control-protocol.ts` replace the old
`{ action: string, payload?: any }` contract with compile-time discriminated
unions. The `satisfies Record<PageControlAction, string>` on `ACTION_TO_METHOD`
and per-action `PAGE_CONTROL_PAYLOAD_VALIDATORS` mean:

- Misspelling an action → type error
- Wrong argument shape → runtime rejection before dispatch
- Protocol evolution → compiler catches all callsites

This is the gold standard for cross-context messaging in extensions.

### 2.2 IPageController as the universal adapter

Both the extension's `RemotePageController` and the mirror's
`RemotePageController` implement `IPageController` without `as any` casts.
`PageAgentCore` is polymorphic over the controller — local DOM, extension
message passing, or QUIC mirror — with zero conditional branches.

### 2.3 Stable vs internal API surface

```typescript
// Consumer imports:
import { createMirrorController } from '@page-agent/mirror'

// Advanced/transport internals:
import { internal } from '@page-agent/mirror'
const hotLayer: internal.IHotLayer = ...
```

`stable.ts` exports 12 symbols. `internal.ts` exports ~60. The namespace
isolation means consumers can't accidentally depend on transport details, and
`internal` is clearly opt-in. The `index.ts` re-exports both — backward
compatible but explicit.

### 2.4 Layer interface minimalism

| Interface | Methods | Assessment |
|-----------|---------|------------|
| IColdLayer | 6 | Minimal. Bootstrap + sync + snapshot. |
| IWarmLayer | 9 | Focused. Auth events + credential ops + nav proxy. |
| IHotLayer | 18 | Justified. Frames + spatial + input + handoff + adaptive quality. |
| ICloudAgentClient | 11 | Thin REST mapping. No orchestration logic. |

The only potentially large surface is `IMirrorController` at ~25 methods, but
this is the facade over three layers + cloud agent + visual handoff + navigation
proxy. Each method group maps to a distinct capability. Collapsing them would
hurt discoverability without reducing complexity.

---

## 3. Performance Issues (Prioritized)

### P0: No backpressure on hot-layer frame and spatial push paths

**Location:** `MirrorController.ts:382-397`, `IHotLayer.onFrame()`,
`IHotLayer.onSpatialMapUpdate()`

**Problem:** Frame and spatial subscriptions are pure push with no flow control.
If the consumer (e.g. `MirrorSession.applyDiff()`) falls behind the 30fps
frame rate, callbacks queue unboundedly in the JS microtask queue.

```typescript
// MirrorController.ts:382 — every frame fans out to all handlers synchronously
this.layers.hot.onFrame((frame) => {
  if (!isVisualFrame(frame)) return
  for (const handler of this.frameHandlers) {
    handler(frame)  // If handler is slow → frames pile up
  }
})
```

**Impact:** Under load, memory grows linearly with frame rate × handler
latency. At 30fps with a 50ms handler, ~1.5 frames buffer per second. Over
minutes this causes GC pauses that further increase latency — a death spiral.

**Fix:** Add a `pause()`/`resume()` mechanism at the subscription level (not
just the MoQ stream). Drop-oldest semantics for frames (latest frame wins).
For spatial updates, coalesce: if a new update arrives before the previous
was consumed, replace it.

---

### P1: Object churn in `MirrorSession.applyDiff()`

**Location:** `MirrorSession.ts:189-241`

**Problem:** Every diff creates:
1. A new `Map<number, SpatialElement>` (line 189)
2. Spreads all values into a new array: `[...elementMap.values()]` (line 206)
3. A new `MicroDOMSnapshot` object (line 231-241)
4. `composeSimplifiedHTML()` creates a new `parts[]` array (line 143)

At 30fps with diffs arriving every ~33ms, that's 120 allocations/second
minimum, all in the hot path.

**Impact:** GC pressure. On low-end devices, this causes frame drops during
the spatial-map-to-HTML pipeline.

**Fix:**
- Maintain a single mutable `MicroDOMSnapshot` and mutate in place for diffs
- Use a pre-allocated `elements` array with `.length = 0` reset instead of
  spreading
- Build simplified HTML with string concatenation (or a shared buffer) instead
  of `parts.join('\n')`

---

### P2: `getBrowserState()` triggers `updateTree()` on every call

**Location:** `RemotePageController.ts:73-74`

```typescript
async getBrowserState(): Promise<BrowserState> {
  await this.updateTree()  // Always awaits, even if snapshot is fresh
  ...
}
```

**Problem:** `getBrowserState()` is called on every agent reasoning step.
`updateTree()` checks the hot layer for a newer snapshot and, if none is
available, subscribes and waits up to 2 seconds. This means every LLM turn
potentially blocks for 2s even if the spatial map hasn't changed.

**Impact:** Agent step latency increases by 0–2000ms unnecessarily when the
page is static.

**Fix:** Add a freshness check — skip `updateTree()` if
`Date.now() - this.lastUpdateTime < FRESHNESS_THRESHOLD_MS` (e.g. 500ms).
The snapshot is being pushed continuously; there's no need to pull on every
read.

---

### P3: Extension content script polls storage at 500ms in every tab

**Location:** `RemotePageController.content.ts:35-62`

**Problem:** `setInterval(500ms)` does 3 `chrome.storage.local.get()` calls
per tick per tab. With 5 open tabs, that's 30 IPC round-trips/second just for
mask visibility.

```typescript
intervalID = window.setInterval(async () => {
  const agentHeartbeat = (await chrome.storage.local.get('agentHeartbeat')).agentHeartbeat
  const isAgentRunning = (await chrome.storage.local.get('isAgentRunning')).isAgentRunning
  const currentTabId = (await chrome.storage.local.get('currentTabId')).currentTabId
  // ... decide mask visibility
}, 500)
```

**Impact:** Unnecessary IPC overhead. Each `storage.local.get()` crosses the
content-script ↔ service-worker boundary. On Chromium, this is a Mojo IPC
round-trip (~0.2ms each). With many tabs, this adds up.

**Fix:**
1. Batch the three `get()` calls into one:
   `chrome.storage.local.get(['agentHeartbeat', 'isAgentRunning', 'currentTabId'])`
2. Better: replace polling with `chrome.storage.onChanged` listener +
   one-shot `get()` on change. The mask state changes rarely (once per
   task start/stop, once per tab switch).

---

### P4: `new Date().toISOString()` in every input event

**Location:** `RemotePageController.ts:199` (`now()` helper), called from
`clickElement`, `inputText`, `selectOption`, `scroll`, `scrollHorizontally`

**Problem:** `new Date().toISOString()` allocates a Date object and a string
on every input dispatch. At typical interaction rates this is negligible, but
during rapid scroll events (wheel) it adds up.

**Fix:** Use `performance.now()` or a monotonic counter for timestamps in the
hot path. Reserve ISO-8601 for events that leave the process (wire format).
If ISO-8601 is required by the IHotLayer contract, cache the date string and
refresh it at most once per 16ms.

---

## 4. Correctness Issues

### C1: Dispose race in MirrorSession

**Location:** `MirrorSession.ts:86-98`, `MirrorSession.ts:118-131`

```typescript
// dispose():
this.disposed = true      // Step 1: set flag
this.unsubSpatial()       // Step 2: unsubscribe
```

Between step 1 and step 2, the hot layer may deliver a callback that passes
the `if (this.disposed) return` guard because JavaScript is single-threaded
— but it was already enqueued in the microtask queue before `disposed` was
set.

**Actual risk:** Low in practice because the `disposed` check at line 87
runs synchronously before any async work. The real risk is if
`onSpatialMapUpdate` delivers via `queueMicrotask()` — the callback would
have already captured `this.disposed === false` by the time it runs.

**Fix:** Defensive — call `unsubSpatial()` first, then set `disposed = true`.
The order matters: unsubscribe removes from the handler set, so no new
callbacks are dispatched. Setting the flag after is a belt-and-suspenders
guard for in-flight callbacks.

---

### C2: `isVisualFrame` type guard is fragile

**Location:** `MirrorController.ts:34-36`

```typescript
function isVisualFrame(frame: VisualFrame | DiffFrame): frame is VisualFrame {
  return 'format' in frame
}
```

`DiffFrame` has `patches[].format` but not a top-level `format`. This works
today, but if `DiffFrame` ever gains a `format` field (e.g. for compression
metadata), this guard silently breaks and frames get misrouted.

**Fix:** Check for a field unique to `VisualFrame`, e.g. `'data' in frame`
(VisualFrame has `data: ArrayBuffer`, DiffFrame has `patches`). Or add a
discriminant field: `kind: 'visual' | 'diff'`.

---

## 5. Interface Design Observations

### 5.1 MirrorController exposes `layers` directly

```typescript
readonly layers: {
  readonly cold: IColdLayer
  readonly warm: IWarmLayer
  readonly hot: IHotLayer
}
```

This is a conscious trade-off (documented in ADR 0001) that lets advanced
consumers bypass the orchestrator. The risk is that direct layer manipulation
can desync `MirrorState`. Mitigation: the `internal` namespace makes this
opt-in.

**Recommendation:** Keep as-is, but add a comment warning that direct layer
calls bypass state tracking.

### 5.2 Navigation proxy is split across warm and controller

Navigation interception flows through:
1. Warm layer emits `AuthEvent` of type `navigation-intercept`
2. MirrorController filters for this type, decorates with `flagged: false`
3. Consumer receives decorated intercept
4. Consumer calls `resolveIntercept()` which delegates to warm layer

The `flagged: false` default (line 405) means the cloud security analysis
result is not actually wired in — it's hardcoded. This is a stub that should
be called out in the ADR as "not yet implemented."

### 5.3 `executeJavascript()` always fails on mirror RemotePageController

```typescript
async executeJavascript(_script: string): Promise<ActionResult> {
  return {
    success: false,
    message: 'JavaScript execution not available in remote mode.',
  }
}
```

This is correct for the hot layer (no CDP Runtime access), but the warm layer
already has a CDP connection. Consider routing JS execution through the warm
layer's CDP `Runtime.evaluate` as a future enhancement. The interface is
already correct — just needs the plumbing.

---

## 6. Test Coverage Gaps

### What exists and works well

- **Contract tests** (`tests/contracts/page-controller.contract.test.ts`):
  Validates all three IPageController implementations against the same
  assertion set. Good.
- **Perf budget tests** (`tests/perf/mirror-latency.test.ts`): p95 < 8ms for
  diff materialization (200 iterations, 300 elements), p95 < 6ms for input
  dispatch (150 iterations). Budgets are realistic and enforced in CI.

### What's missing

| Gap | Risk | Suggested test |
|-----|------|---------------|
| No error-path tests for contract | Medium | Invalid element IDs, missing elements, scroll bounds |
| No seq-ordering test for diffs | Medium | Out-of-order or duplicate seq numbers |
| No concurrent-action test | Medium | Two clicks racing on the same element |
| No dispose-during-active-operation test | Low | Dispose while `updateTree()` is awaiting snapshot |
| No large-DOM perf test | Medium | 5000+ elements, verify budget still holds |
| Extension polling overhead not measured | Low | Count storage.get calls per second in multi-tab scenario |

---

## 7. Jungle-Gym Test Site (1090 lines)

Justified. It's a self-contained SPA with auth flows, multi-step forms,
conditional UI, and navigation — exactly the scenarios the agent needs to
exercise. 600 lines are CSS. Zero external dependencies. Deployed as the
public demo via GitHub Pages. Not used in unit tests (only e2e demo), so it
doesn't inflate the test suite.

---

## 8. Recommendations (Ordered by Impact)

1. **Add frame/spatial backpressure** (P0) — drop-oldest for frames, coalesce
   for spatial diffs. Without this, long sessions under load will OOM.

2. **Reduce allocation in `applyDiff`** (P1) — mutate in place, reuse arrays.
   This is the tightest loop in the system.

3. **Skip `updateTree()` when snapshot is fresh** (P2) — simple freshness
   check saves 0–2s per agent step on static pages.

4. **Batch/eliminate storage polling** (P3) — one `storage.onChanged` listener
   replaces 30 IPC calls/second.

5. **Add discriminant to frame types** (C2) — `kind: 'visual' | 'diff'`
   prevents future misrouting.

6. **Fix dispose ordering** (C1) — unsubscribe before setting flag.

7. **Add error-path and ordering tests** — close the gaps in section 6.

8. **Wire cloud security analysis** into navigation intercept (5.2) — the
   `flagged: false` stub should be documented or connected.
