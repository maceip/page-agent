# End-to-End Architecture Review

_Review date: 2026-03-10_

## What's Working Well

### 1. Clean package layering

The dependency graph is a proper DAG:

```
page-controller → (no deps)
llms → (no deps)
core → llms, page-controller
page-agent → core, ui
extension → core, llms
```

`page-controller` being LLM-free and `llms` being DOM-free is exactly right.

### 2. MacroTool pattern

Packing reflection + action into a single tool call (`#packMacroTool`) avoids multi-turn orchestration complexity. The LLM must reason before acting — enforced by schema, not by hope.

### 3. Two-stream event model

Separating persistent `history` events (fed back to LLM) from transient `activity` events (for UI only) prevents UI concerns from polluting agent reasoning.

---

## Architectural Problems

### Problem 1: E2E test re-implements production code instead of testing it

`e2e/memory-system.test.mjs` is a ~650-line re-implementation of the memory system using raw IndexedDB, injected via `page.evaluate()`. It doesn't import or test the actual source files (`memory-store.ts`, `memory-agent.ts`, `memory-transfer.ts`).

- Tests can pass while the real code is broken
- Every change to memory logic requires updating two copies
- The test verifies "does our algorithm work in a browser?" — but against a *different copy* of the algorithm

**Recommendation:** Build the actual TypeScript source into a bundle (via Vite library mode) and inject *that* into the Puppeteer page. The e2e test should exercise the compiled production code.

### Problem 2: `RemotePageController` has no shared interface with `PageController`

`RemotePageController` duck-types the `PageController` interface — same method names, but no shared type. Visible at `MultiPageAgent.ts:65`:

```typescript
pageController: pageController as any,  // <-- the smell
```

If `PageController` adds a method, `RemotePageController` silently won't have it.

**Recommendation:** Extract a `PageControllerInterface` in `@page-agent/page-controller` that both classes implement. `PageAgentCoreConfig` should reference the interface, not the concrete class.

### Problem 3: Messaging protocol is stringly-typed and ad-hoc

The extension's background↔content communication uses:

```typescript
{ type: 'PAGE_CONTROL', action: 'get_browser_state', targetTabId: number, payload?: any }
```

Every action is a string, every payload is `any`. No schema, no exhaustive handling, errors swallowed with `.catch(() => null)`.

**Recommendation:** Define a discriminated union:

```typescript
type PageControlMessage =
  | { type: 'PAGE_CONTROL'; action: 'get_browser_state'; targetTabId: number }
  | { type: 'PAGE_CONTROL'; action: 'click_element'; targetTabId: number; payload: [index: number] }
  | ...
```

Use a typed `sendMessage<T>` helper that maps message types to response types.

### Problem 4: Memory system lives in `extension` but has no clear boundary

The memory subsystem (`memory-store.ts`, `memory-agent.ts`, `memory-transfer.ts`, `memory-background.ts`, `memory-types.ts`) is 5 files / ~800 lines in `packages/extension/src/lib/`. It's self-contained with its own persistence, query language, and consolidation loop. Only one optional `chrome.storage.sync` bridge makes it extension-specific.

**Recommendation:** Extract to `packages/memory/` as an internal package:
- Unit testable independently (no Puppeteer needed — `fake-indexeddb` works)
- E2E test becomes a thin integration test of the *built package*
- Other consumers (bookmarklet, page-agent library) can use it

### Problem 5: Tool `execute` functions use `this: PageAgentCore` binding

Every tool's `execute` is bound to `PageAgentCore` via `.bind(this)` at call time. Tools access `this.pageController`, `this.onAskUser`, etc. directly. Every tool implicitly depends on all of `PageAgentCore`'s public surface.

**Recommendation:** Pass a narrow context object instead:

```typescript
interface ToolContext {
  pageController: PageControllerInterface
  pushObservation: (msg: string) => void
  onAskUser?: (question: string) => Promise<string>
}
```

Tools only see what they need. Adding a field to `PageAgentCore` can't accidentally break a tool.

### Problem 6: `withMemoryInstructions` has sync/async impedance mismatch

`getPageInstructions` is synchronous but memory recall is async (IndexedDB). The workaround (`memory-agent.ts:170-183`) is a stale-cache hack: return the previous result, fire-and-forget the real query. This means:
- First step of every task has no memory context
- URL changes cause a one-step lag

**Recommendation:** Make `getPageInstructions` async in `AgentConfig`. It's already called in an async context (`#getInstructions` is async). One-line interface change with a big correctness payoff.

---

## Lower-Priority Improvements

7. **`autoFixer.ts` normalization should be per-model.** Different LLMs produce different malformed outputs. The normalizer should be selected by model family.

8. **No test coverage for the core agent loop.** `tests/` covers utilities (chameleon, peekaboo, sanitize, dompurify). No tests for `PageAgentCore.execute()`, the step loop, history assembly, or prompt construction — the highest-value test targets.

9. **Observer pattern has good structure but is disconnected.** The observers all extend `ObserverBase` — good. But they're not tested and aren't wired into e2e tests.

---

## Prioritized Action Items

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| 1 | Extract `PageControllerInterface`, remove `as any` | Small | Prevents class of bugs at compile time |
| 2 | Make `getPageInstructions` async | Small | Fixes memory context one-step lag |
| 3 | Type the message protocol (discriminated union) | Medium | Catches message bugs at compile time |
| 4 | Extract memory system to `packages/memory/` | Medium | Enables proper unit testing, clean boundary |
| 5 | E2E tests: test compiled source, not reimplementation | Medium | Tests actually verify production code |
| 6 | Narrow tool context (replace `this` binding) | Medium | Decouples tools from agent internals |
| 7 | Add unit tests for `PageAgentCore.execute()` loop | Medium | Highest-value test coverage gap |

---

## Guiding Principle

**Narrow the interfaces, type the boundaries, test the real code.** The current architecture is good for its size — these changes are about making it stay good as it grows.
