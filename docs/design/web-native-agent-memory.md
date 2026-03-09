# Web-Native Agent Memory: Design Document

## Problem Statement

Page Agent today runs as a browser extension with ephemeral, session-scoped memory. Each task execution starts fresh — the agent has no recall of previous sessions, no way to share context across AI platforms, and no mechanism to "follow the user around" as they move between tools like ChatGPT, Claude Code on the web, Codex, or mobile LLMs.

The goal: make page-agent a **universal memory layer** that is web-native, UX-simple, and interoperable with the broader AI agent ecosystem.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Page Agent Extension                  │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ Side     │  │ Memory       │  │ Page Observer      │  │
│  │ Panel UI │  │ Store (IDB)  │  │ (content scripts)  │  │
│  └────┬─────┘  └──────┬───────┘  └────────┬──────────┘  │
│       │               │                    │             │
│       └───────┬───────┴────────────┬───────┘             │
│               │                    │                     │
│         ┌─────▼─────┐      ┌──────▼──────┐              │
│         │ Memory    │      │ Cross-Agent  │              │
│         │ Manager   │      │ Bridge       │              │
│         └─────┬─────┘      └──────┬───────┘              │
│               │                   │                      │
└───────────────┼───────────────────┼──────────────────────┘
                │                   │
         ┌──────▼──────┐    ┌──────▼──────┐
         │ Local-first │    │ Clipboard/  │
         │ Sync (CRDTs)│    │ Paste API   │
         └──────┬──────┘    └─────────────┘
                │
         ┌──────▼──────┐
         │ Optional:   │
         │ Remote Sync │
         │ (MCP/WebRTC)│
         └─────────────┘
```

---

## Core Concepts

### 1. Memory Units

A **Memory** is a structured, portable unit of context:

```typescript
interface Memory {
  id: string
  /** What the agent learned / observed */
  content: string
  /** Structured tags for retrieval */
  tags: string[]
  /** Where this memory was created */
  source: MemorySource
  /** Semantic type */
  kind: 'observation' | 'task_result' | 'user_preference' | 'page_snapshot' | 'workflow_step'
  /** URL or context where this is relevant */
  scope: string | '*'
  /** ISO timestamp */
  createdAt: string
  /** Relevance decay — memories can expire or fade */
  ttl?: number
  /** Embedding vector for semantic search (optional, computed lazily) */
  embedding?: number[]
}

interface MemorySource {
  agent: 'page-agent' | 'claude-code' | 'chatgpt' | 'codex' | 'openclaw' | 'user' | string
  sessionId?: string
  url?: string
}
```

### 2. Memory Store

Extend the existing `db.ts` IndexedDB schema to add a `memories` object store alongside `sessions`:

```typescript
interface PageAgentDB extends DBSchema {
  sessions: { /* existing */ }
  memories: {
    key: string
    value: Memory
    indexes: {
      'by-created': string     // createdAt
      'by-scope': string       // scope (URL pattern)
      'by-kind': string        // kind
      'by-tags': string        // multi-entry index on tags
      'by-source': string      // source.agent
    }
  }
}
```

**Why IndexedDB**: Already used by the extension. Local-first, works offline, no server dependency. Stays web-native.

### 3. Memory Manager

A service that sits between the agent core and the memory store:

```typescript
class MemoryManager {
  /** Save a memory from any source */
  async save(memory: Omit<Memory, 'id' | 'createdAt'>): Promise<Memory>

  /** Query memories relevant to a URL/task */
  async recall(query: {
    scope?: string        // URL pattern match
    tags?: string[]       // tag intersection
    kind?: Memory['kind']
    limit?: number
    maxAge?: number       // ms
  }): Promise<Memory[]>

  /** Export memories as portable JSON (for clipboard/paste) */
  async export(filter?: RecallQuery): Promise<string>

  /** Import memories from portable JSON */
  async import(json: string): Promise<number>

  /** Prune expired or low-relevance memories */
  async prune(): Promise<number>
}
```

---

## Integration Patterns

### Pattern A: Auto-capture from Page Agent sessions

Hook into the existing `onAfterTask` lifecycle to automatically extract and save memories:

```typescript
// In MultiPageAgent constructor or via config
onAfterTask: async (agent, result) => {
  const memories = extractMemories(result.history)
  for (const mem of memories) {
    await memoryManager.save(mem)
  }
}
```

The `extractMemories` function parses `AgentStepEvent.reflection.memory` fields from the history — these already contain the agent's self-reported memory strings. This is the lowest-friction path since the agent already generates memory at every step.

### Pattern B: Page Observer (passive monitoring)

A content script that watches specific pages (like `claude.ai/code`) and captures relevant context without interfering:

```typescript
// content script, runs on claude.ai/code
const observer = new MutationObserver((mutations) => {
  // Detect new output blocks, task completions, errors
  // Extract structured context
  // Save as memories via chrome.runtime.sendMessage
})
```

**How this works for Claude Code on the web:**
1. Extension's content script runs on `claude.ai/code/*`
2. Observer watches the DOM for task completions, code outputs, terminal results
3. Extracts structured summaries (not raw content — privacy-preserving)
4. Saves as memories with `source.agent = 'claude-code'` and `scope = currentURL`
5. These memories are available to page-agent when it later runs on the same or related pages

**Key UX constraint**: The observer is opt-in. The user enables it per-domain from the extension's settings panel. A small badge/indicator shows when observation is active.

### Pattern C: Clipboard Bridge (the universal interop)

For agents that page-agent can't directly observe (ChatGPT mobile, Codex desktop, etc.), use a **clipboard-based memory transfer**:

```
┌─────────────┐    clipboard     ┌─────────────┐
│  ChatGPT    │ ──── copy ────▶  │  Page Agent  │
│  (mobile)   │                  │  Extension   │
│             │ ◀── paste ─────  │              │
└─────────────┘                  └──────────────┘
```

**UX Flow — "Copy context from ChatGPT to Page Agent":**

1. User is in ChatGPT and asks it to create an account on a website
2. ChatGPT doesn't have browser access, so user copies the relevant chat context
3. User clicks page-agent extension icon → "Import Memory" button
4. Pastes the ChatGPT conversation text
5. Page-agent's LLM parses it into structured memories:
   - *"User wants to create account on example.com"*
   - *"ChatGPT suggested using email: user@example.com"*
   - *"Required fields: name, email, password, agree to ToS"*
6. User says "Continue the account creation task" → page-agent has full context

**UX Flow — "Export context back to ChatGPT":**

1. Page-agent completes the account creation
2. Result memories: *"Account created on example.com, username: user123, verification email sent"*
3. User clicks "Export Memory" → copies to clipboard as natural language
4. Pastes back into ChatGPT: "Here's what happened: [memory summary]"

**The format**: A simple, human-readable text block with a machine-parseable header:

```
--- Page Agent Memory Transfer ---
Source: page-agent @ example.com
Time: 2026-03-08T14:30:00Z
Task: Create account on example.com

Memories:
- [task_result] Account created successfully. Username: user123
- [observation] Site requires email verification within 24h
- [workflow_step] Navigated to /signup, filled form, clicked submit
---
```

This is intentionally plain text — it works in any chat interface, any clipboard, any note-taking app.

### Pattern D: MCP Memory Server (for agent-to-agent)

For agents that support MCP (Model Context Protocol) — like Claude Code, Cline, Cursor — expose page-agent's memory store as an MCP server:

```typescript
// MCP server exposed by the extension (or a companion local process)
const memoryServer = {
  tools: {
    'page_agent_recall': {
      description: 'Recall memories from the page agent browser extension',
      parameters: { scope: 'string?', tags: 'string[]?', kind: 'string?' },
      execute: async (params) => memoryManager.recall(params)
    },
    'page_agent_save': {
      description: 'Save a memory to the page agent browser extension',
      parameters: { content: 'string', tags: 'string[]', kind: 'string' },
      execute: async (params) => memoryManager.save(params)
    }
  }
}
```

**How Claude Code integration works:**
1. User configures `page-agent-memory` as an MCP server in their Claude Code settings
2. Claude Code can call `page_agent_recall` to query what the user did in the browser
3. Claude Code can call `page_agent_save` to share its coding context back
4. The bridge: a lightweight local HTTP server OR a WebSocket from the extension's service worker

**Practical constraint**: Browser extensions can't directly expose TCP servers. Two options:
- **Option 1**: Companion CLI (`npx page-agent-mcp`) that bridges between extension's IndexedDB (via native messaging) and MCP stdio
- **Option 2**: Extension exposes a WebSocket server via offscreen document; MCP clients connect over `ws://localhost:PORT`

### Pattern E: Web Page API (for website developers)

Extend the existing `PAGE_AGENT_EXT_REQUEST` / `PAGE_AGENT_EXT_RESPONSE` message channel to include memory operations:

```typescript
// From a web page (after auth token match)
window.postMessage({
  channel: 'PAGE_AGENT_EXT_REQUEST',
  action: 'memory_recall',
  payload: { scope: window.location.href, limit: 5 }
}, '*')

// Extension responds:
window.addEventListener('message', (e) => {
  if (e.data.channel === 'PAGE_AGENT_EXT_RESPONSE' && e.data.action === 'memory_recall_result') {
    const memories = e.data.payload
    // Use memories to pre-fill context, personalize, etc.
  }
})
```

This allows any website to request relevant memories (with user permission), enabling use cases like:
- A coding playground pre-loading context from a Claude Code session
- A project management tool pulling in task completion summaries
- An AI chat interface bootstrapping with cross-session context

---

## UX Design

### Side Panel Memory Tab

Add a **Memory** tab alongside the existing Chat, History, and Config views:

```
┌──────────────────────────────┐
│ Page Agent Ext        ● ⚙ 📋│
├──────────────────────────────┤
│ [Chat] [History] [Memory]    │
├──────────────────────────────┤
│                              │
│ 🔍 Search memories...        │
│                              │
│ ┌──────────────────────────┐ │
│ │ 📌 Account created on    │ │
│ │    example.com            │ │
│ │    #account #signup       │ │
│ │    2 hours ago            │ │
│ └──────────────────────────┘ │
│ ┌──────────────────────────┐ │
│ │ 💾 Claude Code completed │ │
│ │    API refactor on repo   │ │
│ │    #code #refactor        │ │
│ │    5 hours ago            │ │
│ └──────────────────────────┘ │
│                              │
├──────────────────────────────┤
│ [Import] [Export] [Clear]    │
└──────────────────────────────┘
```

### Minimal UX Additions

1. **Auto-save toggle**: In settings, "Save memories after each task" (on by default)
2. **Import button**: Opens a paste dialog for clipboard import
3. **Export button**: Copies selected memories to clipboard in portable format
4. **Page badge**: Small indicator when the observer is active on a page
5. **Context injection**: Before each task, automatically inject relevant memories into the agent's context (via `instructions.system` or a pre-task hook)

### Memory in the Agent Loop

The most natural integration point: inject recalled memories into the existing prompt structure:

```typescript
// In PageAgentCore.#assembleUserPrompt or via instructions callback
const relevantMemories = await memoryManager.recall({
  scope: currentURL,
  limit: 5,
  maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
})

if (relevantMemories.length > 0) {
  const memoryBlock = relevantMemories
    .map(m => `- [${m.source.agent}] ${m.content}`)
    .join('\n')

  // Inject as page instructions
  return `<relevant_memories>\n${memoryBlock}\n</relevant_memories>`
}
```

This uses the existing `instructions.getPageInstructions` callback — zero changes to the core agent loop.

---

## Concrete Scenarios

### Scenario 1: ChatGPT → Page Agent → ChatGPT

> "I'm using ChatGPT and I ask it to create an account on a website"

1. **In ChatGPT**: User asks "Create me an account on example.com". ChatGPT can't browse, so it gives instructions.
2. **Transfer**: User copies ChatGPT's response, opens Page Agent extension, clicks "Import Memory", pastes.
3. **Page Agent parses**: Extracts structured intent — "create account on example.com with these details"
4. **Page Agent executes**: User navigates to example.com, says "Continue this task". Agent has full context from ChatGPT, fills forms, creates account.
5. **Transfer back**: Agent saves result memory. User clicks "Export", copies summary back to ChatGPT: *"Done — account created as user123, verification email sent to user@example.com"*

**Why clipboard**: It's the only truly universal interface. Works on mobile (ChatGPT iOS) → desktop (Page Agent Chrome) → back to mobile. No APIs needed, no accounts, no sync servers.

### Scenario 2: Claude Code on Web → Page Agent

> "I'm using Claude Code on the web and it's doing some work"

1. **Observer active**: User has enabled page observation for `claude.ai` in Page Agent settings
2. **Passive capture**: Content script watches the Claude Code web UI, detects:
   - Task descriptions and completions
   - File paths mentioned
   - Error messages and resolutions
   - Terminal output summaries
3. **Auto-save**: Memories are saved with `source.agent = 'claude-code'`, scoped to the project/session
4. **Later use**: User is on GitHub reviewing a PR. Page Agent recalls: *"Claude Code completed API refactor — changed auth middleware to use JWT, updated 5 files"*
5. **Cross-context**: User asks Page Agent "Review this PR based on what Claude Code did" — the agent has the context

### Scenario 3: Desktop Codex → Page Agent (via MCP)

1. **MCP bridge running**: User started `npx page-agent-mcp` locally
2. **Codex configured**: Added `page-agent-memory` as an MCP server
3. **Codex queries**: During code generation, Codex calls `page_agent_recall({ tags: ['api', 'auth'] })`
4. **Gets context**: Receives memories about the API structure the user was working with in the browser
5. **Codex saves**: After completing work, calls `page_agent_save({ content: "Refactored auth to use OAuth2", tags: ["auth", "oauth"] })`
6. **Full circle**: Next time user opens the app in the browser, Page Agent knows about the refactor

---

## Implementation Plan

### Phase 1: Memory Store + Auto-capture (Minimal viable)

**Changes to existing code:**

1. **`packages/extension/src/lib/db.ts`** — Add `memories` object store to existing IDB schema (bump version to 2)
2. **`packages/extension/src/lib/memory.ts`** (new) — `MemoryManager` class
3. **`packages/extension/src/agent/useAgent.ts`** — Hook `onAfterTask` to auto-extract and save memories
4. **`packages/extension/src/entrypoints/sidepanel/App.tsx`** — Add Memory tab/view
5. **`packages/core/src/types.ts`** — No changes needed; `AgentReflection.memory` field already exists

**Key insight**: The agent already generates `memory` strings at every step (in `MacroToolInput.memory`). Phase 1 simply persists these.

### Phase 2: Clipboard Bridge + Import/Export

1. **`packages/extension/src/lib/memory-transfer.ts`** (new) — Serialize/deserialize portable format
2. **Side panel UI** — Import dialog (textarea), Export button
3. **LLM-powered import** — Use the configured LLM to parse unstructured clipboard text into memories

### Phase 3: Page Observer

1. **`packages/extension/src/observers/`** (new directory) — Per-site observer configs
2. **`packages/extension/src/observers/claude-code.ts`** — DOM observer for claude.ai/code
3. **`packages/extension/src/observers/chatgpt.ts`** — DOM observer for chatgpt.com
4. **Settings UI** — Enable/disable observers per domain

### Phase 4: Memory-Aware Agent Loop

1. **`packages/core/src/PageAgentCore.ts`** — Add optional `memoryProvider` config
2. **Use `instructions.getPageInstructions`** — Inject recalled memories before each task
3. **Add `save_memory` and `recall_memory` as custom tools** — Let the agent explicitly manage its own memory

### Phase 5: MCP Bridge

1. **`packages/mcp-server/`** (new package) — Standalone MCP server
2. **Native messaging host** — Bridge between MCP server and extension's IDB
3. **Documentation** — How to configure with Claude Code, Cursor, etc.

---

## Design Decisions

### Why local-first (not cloud sync)?

- **Privacy**: Browser history and agent actions are sensitive. Local-first means no data leaves the device unless the user explicitly exports.
- **Simplicity**: No accounts, no servers, no auth. Just install the extension.
- **Offline**: Works without internet (agent still needs LLM access, but memory doesn't).
- **Web-native**: IndexedDB is the browser's native storage. No external dependencies.

Cloud sync can be added later as an opt-in layer (e.g., encrypted sync via user's own storage).

### Why clipboard over a proprietary protocol?

- **Universal**: Works between any two applications on any platform
- **User-controlled**: The user decides what to share and when
- **No dependencies**: No APIs, no accounts, no server coordination
- **Inspectable**: Plain text format — user can read and edit before pasting
- **Mobile-friendly**: Copy-paste works on iOS/Android ChatGPT → desktop browser

### Why not a standalone memory server?

Page Agent's strength is being **web-native** — it lives in the browser, where the user already is. A standalone server adds setup friction. The MCP bridge (Phase 5) provides server-like capabilities when needed, but the core experience requires zero setup beyond installing the extension.

### Why observe rather than integrate?

Direct API integration with ChatGPT, Claude Code, etc. would be ideal but:
- These platforms don't expose APIs for extensions to read session data
- API access requires auth tokens the user may not want to share
- DOM observation is platform-agnostic and doesn't require cooperation from the target app

The tradeoff: DOM observation is fragile (UI changes break it). Mitigate with:
- Minimal, targeted selectors (completion events, not full content)
- Versioned observer configs that can be updated independently
- Graceful degradation — if observation fails, clipboard bridge still works

---

## Durability: Always-On Memory in the Browser

*Adapted from [Google's Always-On Memory Agent](https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/agents/always-on-memory-agent) — a 677-line Python/SQLite system with three-table schema, periodic consolidation, and an orchestrator that routes between ingest/consolidate/query sub-agents. We take Google's architecture and solve the hard problem of making it work in a browser where pages die without warning.*

### What Google Built (Reference Architecture)

Google's agent is a single `agent.py` file (677 lines) using Google ADK with Gemini, backed by SQLite. Three tables:

| Table | Purpose | Key Fields |
|---|---|---|
| `memories` | Raw ingested facts | `raw_text`, `summary`, `entities` (JSON), `topics` (JSON), `connections` (JSON), `importance` (0-1), `consolidated` (0/1) |
| `consolidations` | Cross-memory synthesis | `source_ids` (JSON), `summary`, `insight` |
| `processed_files` | Dedup for file watcher | `path` (PK), `processed_at` |

Three concurrent async tasks run in an event loop:
- **File watcher** (5s poll) — scans `./inbox/`, ingests new files (text truncated to 10K chars, media via multimodal `Part.from_bytes()`, files >20MB skipped)
- **Consolidation loop** (30 min) — reads up to 10 unconsolidated memories, LLM synthesizes cross-cutting patterns, writes connections back to both source memories atomically
- **HTTP server** — 7 REST endpoints on port 8888

**Key design choices we adopt:**
- Consolidation is **additive, never destructive** — originals are always preserved
- The `consolidated` flag is a **one-way latch** (0→1); memories are never re-consolidated
- Each `store_consolidation` is **atomic** — INSERT consolidation + UPDATE connections + SET consolidated=1 in one transaction
- Crash during consolidation is safe — unconsolidated memories stay at `consolidated=0` and are retried next cycle

**Key design choices we improve on:**
- Google has **no deduplication** — identical inputs create duplicate memories. We add content hashing.
- Google has **no importance re-scoring** — the initial LLM score is permanent. We allow consolidation to re-score.
- Google has **no decay/expiry** — memories persist forever. We add TTL + importance-based pruning.
- Google's retrieval is **brute-force top-50 by recency** with LLM filtering in-context. We add scope-based indexing + relevance scoring.
- Google uses **InMemorySessionService** — no conversation history between calls. We persist session context alongside memories.

### The Browser Durability Problem

Google's agent runs 24/7 on a server with SQLite ACID guarantees. A browser extension faces fundamentally different constraints:

| Challenge | Google's Server Agent | Browser Extension |
|---|---|---|
| Process lifetime | Runs forever (asyncio event loop) | Service worker killed after ~30s idle (Chrome web), ~5 min (Chrome extension MV3) |
| Storage | SQLite with rollback journal | IndexedDB (async, per-origin, "relaxed" durability by default) |
| Tab/page death | N/A | OS can kill tab without any event firing (mobile) |
| Background work | Always available (3 concurrent async tasks) | `chrome.alarms` (min 1-min interval), no guaranteed background execution |
| Cross-device | Single server instance | Multiple browsers, phones, desktops — each with independent storage |
| Crash recovery | Incomplete consolidation retried next cycle | Same — IndexedDB transactions are atomic, `consolidated=0` retried |
| Storage eviction | Disk-only limit | Browser can evict IndexedDB under storage pressure (unless `persist()` granted) |

### Browser Storage Primitives (Research Findings)

Before diving into the architecture, here are the actual durability guarantees we can rely on:

#### IndexedDB Durability Modes

IndexedDB provides **atomicity** (transactions fully commit or roll back) but durability depends on the mode:

- **`relaxed` (default since Chrome 121, Firefox 40)**: `complete` event fires once data reaches the OS buffer, before disk flush. Survives tab kills and browser crashes, but NOT power failures.
- **`strict`**: `complete` event fires only after disk flush. ~10x slower. Requested via `db.transaction(stores, 'readwrite', { durability: 'strict' })`.

**Practical implication**: Relaxed durability is fine for memory writes. Tab kills never corrupt data — in-flight transactions roll back cleanly. Only power failure (rare on battery devices) can lose committed-but-unflushed data.

#### `navigator.storage.persist()` — Preventing Eviction

By default, all browser storage is "best-effort" — the browser can silently evict IndexedDB data under storage pressure. This would destroy the agent's memory.

```typescript
// Request persistent storage — call after a user gesture for best results
const persisted = await navigator.storage.persist()
if (persisted) {
  // Storage can only be cleared by the user, not the browser
  console.log('Memory storage is persistent')
}
```

Browser-specific behavior:
- **Chrome/Edge**: Auto-grants based on heuristics (site engagement, bookmarked, notifications enabled). No prompt.
- **Firefox**: Shows a permission popup.
- **Safari**: Grants based on heuristics (e.g., added to Home Screen).

**Critical for the extension**: Call `persist()` on first memory save. Without it, a user's months of accumulated memories could vanish silently.

#### Page Lifecycle Events — Saving Before Death

The events available for "save state before page dies", in order of reliability:

| Event | Fires when | Reliability | Use |
|---|---|---|---|
| `visibilitychange` → hidden | Tab switch, minimize, app switch | **Most reliable** — last event you can count on | Primary save trigger |
| `pagehide` | Navigation away, tab close | Reliable on desktop | Secondary save trigger |
| `freeze` | Browser freezing background tab | Chrome only | Stop timers, save state |
| `beforeunload` | Before navigation/close | Unreliable on mobile, blocks bfcache | Avoid |
| `unload` | **Being deprecated** (Chrome 2025-2026) | DO NOT USE | — |

**Critical mobile behavior**: When a user swipes away from task switcher on iOS/Android, ONLY `visibilitychange` fires. No `pagehide`, no `unload`. On Android, even `visibilitychange` is not guaranteed.

**Design principle**: Write to IndexedDB on every meaningful mutation. Use `visibilitychange` as a final flush, not as the primary save mechanism.

#### OPFS + SQLite — The High-Performance Option

The **Origin Private File System (OPFS)** provides byte-level file access 3-4x faster than IndexedDB. Combined with SQLite compiled to WASM (via `wa-sqlite` or `sql.js`), it gives us a full relational database in the browser — directly mirroring Google's SQLite architecture.

```
OPFS + SQLite advantages:
- Full SQL queries (JOIN consolidations with memories, GROUP BY scope, etc.)
- 3-4x faster writes than IndexedDB
- Mirrors Google's exact schema — trivial to port their queries
- Supports WAL mode for concurrent reads during writes

OPFS + SQLite constraints:
- Synchronous FileSystemSyncAccessHandle only available in dedicated Workers (not main thread, not ServiceWorker)
- Same eviction rules as IndexedDB — still need navigator.storage.persist()
- ~200-500KB WASM bundle size for SQLite
- Exclusive file locks — no concurrent write access from multiple workers
```

**Recommendation**: Start with IndexedDB (zero bundle cost, works everywhere). Migrate to OPFS + SQLite when query complexity demands it (Phase 4+). The memory schema is designed to work with either backend.

### Three-Phase Memory Lifecycle

Adapting Google's Ingest → Consolidate → Query model for browser constraints:

#### Phase 1: Ingest (Write-Ahead, Crash-Safe)

The key insight: **write memory before the action that might crash**. This mirrors Google's pattern where `store_memory()` does `db.commit()` immediately after INSERT.

```typescript
// Write-ahead pattern: save memory BEFORE awaiting the next step
onAfterStep: async (agent, history) => {
  const lastStep = history.at(-1)
  if (lastStep?.type !== 'step') return

  // Immediately persist to IDB — this survives tab crashes
  await memoryManager.save({
    content: lastStep.reflection.memory,
    kind: 'workflow_step',
    scope: agent.pageController.currentURL,
    source: { agent: 'page-agent', sessionId: agent.taskId },
    tags: [],
    importance: 0.5,       // LLM scores importance at consolidation time
    consolidated: false,    // one-way latch, same as Google's schema
  })
}
```

**Why this works**: IndexedDB's `relaxed` durability mode (the default) persists data to the OS buffer on transaction commit. The OS buffer survives tab kills and browser crashes. Only a power failure before disk flush could lose data — and that's rare on battery-powered devices.

**Redundancy layer**: The service worker receives a copy as backup. Extension service workers survive tab closes (up to 5 minutes with activity in MV3) and have their own IDB connection.

```typescript
// Content script sends memory to service worker as backup
chrome.runtime.sendMessage({
  type: 'MEMORY_WRITE',
  payload: memory,
})

// Service worker writes to extension-origin IDB (separate from page-origin)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'MEMORY_WRITE') {
    saveMemoryFromBackground(msg.payload)
  }
})
```

**Final flush on page death** — `visibilitychange` is the last reliable event:

```typescript
// Save any buffered state when page becomes hidden
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    // Flush any in-memory buffer to IDB
    // Use navigator.sendBeacon() for any server sync
    memoryManager.flush()
  }
})
```

**Deduplication** (improvement over Google): Hash `content + scope + source.sessionId` to generate a deterministic ID. If a memory with the same hash already exists, skip the write. This prevents the duplicate-on-crash problem Google has (where crash between ingest and recording in `processed_files` creates duplicates).

#### Phase 2: Consolidate (Background Processing)

Google consolidates every 30 minutes via an async task. In a browser extension, we use `chrome.alarms` (minimum 1-minute interval) combined with **leader election** so only one tab does the work:

```typescript
// background.ts — service worker
chrome.alarms.create('memory-consolidation', {
  periodInMinutes: 30,
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'memory-consolidation') {
    await consolidateMemories()
  }
})
```

**Leader election with Web Locks API** — prevents multiple tabs from consolidating simultaneously:

```typescript
async function consolidateMemories() {
  // Only one context (tab/worker) can hold this lock at a time
  // Others skip silently — they'll get the next alarm cycle
  await navigator.locks.request(
    'page-agent-consolidation',
    { ifAvailable: true },
    async (lock) => {
      if (!lock) return // another context is consolidating

      await doConsolidation()
    }
  )
}
```

**What consolidation does** (mirroring Google's three-step atomic pattern):

1. **Read unconsolidated** — `SELECT * FROM memories WHERE consolidated = 0 ORDER BY created_at DESC LIMIT 10` (Google's exact batch size)
2. **LLM synthesize** — extract cross-cutting patterns, generate summary + key insight
3. **Atomic commit** — in a single IDB transaction:
   - Save new consolidation record (summary, insight, source_ids)
   - Update connections on source memories (bidirectional, same as Google)
   - Set `consolidated = 1` on all source memories

```typescript
async function doConsolidation() {
  const unconsolidated = await memoryStore.getUnconsolidated({ limit: 10 })
  if (unconsolidated.length < 2) return // Google's threshold

  // Group by scope (URL origin) for targeted synthesis
  const groups = groupBy(unconsolidated, m => new URL(m.scope).origin)

  for (const [origin, memories] of Object.entries(groups)) {
    // Use the consolidation agent prompt (adapted from Google's)
    const result = await llm.invoke([{
      role: 'system',
      content: `You are a Memory Consolidation Agent. Analyze these memories and:
1. Find connections and patterns across them
2. Create a synthesized summary (2-3 sentences)
3. Identify one key insight
4. List connections between memory pairs as {from_id, to_id, relationship}
5. Rate the consolidated importance from 0.0 to 1.0

Return JSON: { summary, insight, connections, importance }`
    }, {
      role: 'user',
      content: memories.map(m =>
        `[Memory ${m.id}] (importance: ${m.importance}) ${m.content}`
      ).join('\n')
    }])

    // Atomic write — all or nothing, same as Google's single db.commit()
    const tx = db.transaction(['memories', 'consolidations'], 'readwrite')

    tx.objectStore('consolidations').add({
      id: crypto.randomUUID(),
      sourceIds: memories.map(m => m.id),
      summary: result.summary,
      insight: result.insight,
      scope: origin,
      createdAt: new Date().toISOString(),
    })

    // Update connections on source memories (bidirectional)
    for (const conn of result.connections) {
      const fromMem = await tx.objectStore('memories').get(conn.from_id)
      const toMem = await tx.objectStore('memories').get(conn.to_id)
      if (fromMem) {
        fromMem.connections = [...(fromMem.connections || []),
          { linkedTo: conn.to_id, relationship: conn.relationship }]
        tx.objectStore('memories').put(fromMem)
      }
      if (toMem) {
        toMem.connections = [...(toMem.connections || []),
          { linkedTo: conn.from_id, relationship: conn.relationship }]
        tx.objectStore('memories').put(toMem)
      }
    }

    // Mark as consolidated (one-way latch)
    for (const m of memories) {
      m.consolidated = true
      m.importance = result.importance // Re-score (improvement over Google)
      tx.objectStore('memories').put(m)
    }

    await tx.done
  }
}
```

**Cost control**: Use the cheapest available model (Haiku, Flash-Lite). Consolidation is not latency-sensitive. Can also run fully locally if the user has a local model configured. Google uses `gemini-3.1-flash-lite-preview` — the cheapest Gemini model.

**Crash safety**: Same as Google's. If the service worker dies between reading unconsolidated memories and committing the transaction, those memories stay at `consolidated=0` and are retried next cycle. The IDB transaction either fully commits or fully rolls back.

#### Phase 3: Query (Recall with Ranking)

Google's retrieval is brute-force: `SELECT * FROM memories ORDER BY created_at DESC LIMIT 50`, then the LLM filters in-context. This means memories older than the 50th are permanently unreachable. We improve on this with scope-based indexing and a relevance scoring function:

```typescript
async recall(query: RecallQuery): Promise<Memory[]> {
  let candidates: Memory[] = []

  // Use IDB indexes instead of brute-force scan
  if (query.scope) {
    // Exact URL match first, then same-origin, then wildcard
    candidates = [
      ...await this.store.index('by-scope').getAll(query.scope),
      ...await this.store.index('by-scope').getAll(new URL(query.scope).origin + '/*'),
      ...await this.store.index('by-scope').getAll('*'),
    ]
  } else {
    candidates = await this.store.index('by-created').getAll()
  }

  // Prefer consolidated memories over raw ones from same session
  candidates = deduplicateByConsolidation(candidates)

  // Score and rank
  candidates.sort((a, b) => this.relevanceScore(b, query) - this.relevanceScore(a, query))

  return candidates.slice(0, query.limit ?? 10)
}

private relevanceScore(memory: Memory, query: RecallQuery): number {
  const ageMs = Date.now() - Date.parse(memory.createdAt)
  const recencyDecay = Math.exp(-ageMs / (7 * 86400000)) // 7-day half-life

  const scopeMatch = !query.scope ? 0.5
    : memory.scope === query.scope ? 1.0
    : new URL(memory.scope).origin === new URL(query.scope).origin ? 0.7
    : memory.scope === '*' ? 0.3 : 0.1

  const importance = memory.importance ?? 0.5
  const consolidationBonus = memory.consolidated ? 0.1 : 0

  return (recencyDecay * 0.3) + (scopeMatch * 0.4) + (importance * 0.2) + consolidationBonus
}
```

**Also load consolidation insights** (same as Google's `read_consolidation_history`):

```typescript
async recallWithInsights(query: RecallQuery): Promise<{
  memories: Memory[]
  insights: Consolidation[]
}> {
  const memories = await this.recall(query)
  const insights = await this.store.consolidations
    .index('by-scope').getAll(query.scope ? new URL(query.scope).origin : undefined)

  return { memories, insights }
}
```

### Cross-Tab Durability

Multiple tabs can run page-agent simultaneously. Use **BroadcastChannel** for event notification and **Web Locks** for coordination:

```typescript
// BroadcastChannel for cache invalidation (lightweight, universal support)
const memoryChannel = new BroadcastChannel('page-agent-memory')

// When any tab saves a memory, broadcast to all tabs
memoryChannel.postMessage({ type: 'memory-saved', memory })

// Other tabs invalidate their in-memory cache
memoryChannel.addEventListener('message', (event) => {
  if (event.data.type === 'memory-saved') {
    localCache.invalidate(event.data.memory.scope)
  }
})

// Web Locks for exclusive operations (consolidation, sync, prune)
// Prevents two tabs from consolidating simultaneously
await navigator.locks.request('page-agent-consolidation', { ifAvailable: true }, async (lock) => {
  if (!lock) return // another tab is doing it
  await doConsolidation()
})
```

IndexedDB handles concurrent writes correctly (it's transactional). The `BroadcastChannel` is for cache invalidation; the `Web Locks` are for deduplicating expensive operations.

**SharedWorker option** (additive, not required): A SharedWorker could serve as an in-memory coordination hub across tabs, maintaining a shared cache hydrated from IndexedDB. However, SharedWorkers are terminated when the last tab closes (losing all state), and are **not supported on Chrome Android**. Use as an optimization only, never as a durability mechanism.

### Cross-Device Sync

For memories to "follow the user around" across devices, offer tiered sync:

#### Tier 0: Manual (clipboard)

Export on device A, import on device B. Works today, zero infrastructure. The portable text format (defined in Pattern C above) is designed for this.

#### Tier 1: `chrome.storage.sync` for high-value memories

`chrome.storage.sync` syncs via Google's servers when signed into Chrome. Severely limited:

| Limit | Value |
|---|---|
| Total storage | 100 KB |
| Per item | 8 KB (key + JSON) |
| Max items | 512 |
| Writes/hour | 1,800 |
| Writes/minute | 120 |

Only consolidated, high-importance memories qualify. Serialize aggressively:

```typescript
async function syncHighValueMemories() {
  const topMemories = await memoryManager.recall({
    consolidated: true,
    minImportance: 0.8,
    limit: 20,
  })

  // Abbreviated keys to fit in 100KB total
  const serialized = topMemories.map(m => ({
    i: m.id,
    c: m.content,
    s: m.scope,
    t: m.createdAt,
    p: m.importance,
  }))

  await chrome.storage.sync.set({ memories: serialized })
}

// On other devices, merge synced memories into local IDB
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.memories) {
    for (const m of changes.memories.newValue) {
      memoryManager.importIfNew(m) // dedup by content hash
    }
  }
})
```

**Firefox note**: `browser.storage.sync` exists but requires `browser_specific_settings` in manifest. Firefox for Android does NOT sync. Desktop Firefox requires user to enable Add-ons sync.

#### Tier 2: User-owned cloud (the password manager pattern)

Password managers like Bitwarden don't use `storage.sync`. They encrypt locally and sync encrypted blobs to their own cloud. We adopt this pattern with the user's own storage:

- **Google Drive** (via `chrome.identity` + Drive API) — user's own storage, no server
- **Self-hosted endpoint** — user provides a URL, we POST/GET encrypted memory JSON
- **Background Sync API** — defer sync until connectivity (Chromium only; fallback to `online` event for Firefox/Safari)

```typescript
// Background Sync — fires when connectivity is available (Chromium only)
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-memories') {
    event.waitUntil(pushMemoriesToCloud())
  }
})

// Fallback for Firefox/Safari — sync on online event
window.addEventListener('online', () => {
  pushMemoriesToCloud()
})
```

#### Tier 3: CRDTs for conflict-free merge

For real-time multi-device sync without conflicts, model memories as a **Yjs document**:

| Library | Bundle Size | Performance | Approach |
|---|---|---|---|
| **Yjs** | ~15 KB | Fastest | Custom CRDT, delta sync |
| **Automerge** | ~500 KB+ | Slower | Rust+WASM |
| **Loro** | Medium | Very fast | Rust+WASM, newer |

**Why CRDTs work well for agent memory**: The memory schema is naturally CRDT-friendly:
- Memories are **append-only** — never mutated after creation (only `consolidated` flag changes, which is a one-way latch)
- Consolidations are **additive** — new synthesis is added, originals preserved
- The only concurrent conflict scenario is two devices consolidating the same memories — resolved by accepting both consolidations (idempotent by design)

```typescript
// Model memories as a Yjs document
import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'

const ydoc = new Y.Doc()
const ymemories = ydoc.getMap('memories')

// Persist to IndexedDB automatically
const persistence = new IndexeddbPersistence('page-agent-memory', ydoc)

// When devices connect, exchange Yjs sync messages
// Works over any transport: WebSocket, WebRTC, custom server
```

**Recommendation**: Start with Tier 0 + Tier 1 (clipboard + storage.sync). Add Tier 2 when users request it. CRDTs (Tier 3) only if multi-device concurrent editing becomes a real use case — the complexity cost is significant and most users will have one primary device.

### Service Worker as Durability Hub

The extension service worker is the backbone — it survives tab closes, restarts on events, and coordinates all background work:

```typescript
// background.ts — the memory durability hub
export default defineBackground(() => {
  // 1. Request persistent storage on install
  chrome.runtime.onInstalled.addListener(async () => {
    await navigator.storage.persist()
    await consolidateMemories() // initial consolidation
  })

  // 2. Receive memory writes from content scripts
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'MEMORY_WRITE') {
      saveMemory(msg.payload).then(() => sendResponse({ ok: true }))
      return true // keep message channel open for async response
    }
    if (msg.type === 'MEMORY_RECALL') {
      recallMemories(msg.payload).then((memories) => sendResponse({ memories }))
      return true
    }
  })

  // 3. Periodic background tasks via alarms
  chrome.alarms.create('consolidate', { periodInMinutes: 30 })
  chrome.alarms.create('sync', { periodInMinutes: 60 })
  chrome.alarms.create('prune', { periodInMinutes: 1440 }) // daily

  chrome.alarms.onAlarm.addListener(async (alarm) => {
    switch (alarm.name) {
      case 'consolidate': return consolidateMemories()
      case 'sync': return syncHighValueMemories()
      case 'prune': return pruneExpiredMemories()
    }
  })
})
```

**Service worker lifetime considerations**:
- Chrome extension MV3: 5-minute timeout, reset by extension API calls
- Service worker can be killed and restarted at any time — all in-memory state is lost
- `chrome.alarms` persist across service worker restarts (they're stored by the browser)
- IndexedDB connections must be reopened on each activation (open-per-operation pattern, same as Google's `get_db()`)

### Memory Schema (Updated with Durability Fields)

```typescript
interface Memory {
  id: string                    // deterministic: hash(content + scope + source.sessionId)
  content: string
  tags: string[]
  source: MemorySource
  kind: 'observation' | 'task_result' | 'user_preference' | 'page_snapshot' | 'workflow_step'
  scope: string | '*'
  createdAt: string
  ttl?: number
  embedding?: number[]

  // Durability fields (adapted from Google's always-on-memory-agent schema)
  importance: number           // 0-1, set by ingest LLM, re-scored at consolidation
  consolidated: boolean        // one-way latch (0→1), same as Google's schema
  consolidatedInto?: string    // ID of the consolidation record that absorbed this one
  connections?: Array<{        // bidirectional links, same as Google's connections JSON
    linkedTo: string
    relationship: string
  }>
  entities?: string[]          // extracted entities (people, companies, concepts) — mirrors Google's schema
  topics?: string[]            // topic tags — mirrors Google's schema

  // Sync fields
  syncedAt?: string            // last time this was pushed to chrome.storage.sync
  deviceId?: string            // which device created this memory
  contentHash?: string         // for deduplication across devices
}

interface Consolidation {
  id: string
  sourceIds: string[]          // memory IDs that were consolidated
  summary: string              // cross-memory synthesis
  insight: string              // one key pattern (from Google's schema)
  scope: string                // origin URL
  createdAt: string
}

// IndexedDB schema
interface PageAgentDB extends DBSchema {
  memories: {
    key: string
    value: Memory
    indexes: {
      'by-created': string
      'by-scope': string
      'by-kind': string
      'by-tags': string        // multi-entry index
      'by-source': string
      'by-consolidated': number // 0 or 1, for consolidation queries
      'by-content-hash': string // for deduplication
    }
  }
  consolidations: {
    key: string
    value: Consolidation
    indexes: {
      'by-scope': string
      'by-created': string
    }
  }
}
```

---

## Competitive Landscape & Prior Art

### Existing Solutions

| Project | Approach | Limitations for Page Agent |
|---|---|---|
| **[Mem0 OpenMemory Chrome Extension](https://github.com/mem0ai/mem0-chrome-extension)** | Content scripts injected into 8 AI platforms (ChatGPT, Claude, Gemini, etc.). Reads last messages, searches `api.mem0.ai` for relevant memories, injects them back into chat input. | **Cloud-dependent** — all memory goes through `api.mem0.ai`. No local-first option. No browser automation capability. Read-only observation, can't act. |
| **[Mem0/OpenMemory MCP Server](https://mem0.ai/openmemory)** | Local MCP server exposing `add_memories`, `search_memory`, `list_memories`. Works with Cursor, VS Code, Claude Desktop, etc. 41K+ GitHub stars. | **Desktop-only** — runs as a local process, not in browser. No web-native story. No page observation or automation. |
| **[@modelcontextprotocol/server-memory](https://github.com/modelcontextprotocol/servers/tree/main/src/memory)** | Official MCP memory server using knowledge graph (entities, relations, observations) in JSONL file. | **File-based, server-side** — not designed for browser context. No consolidation, no importance scoring, no cross-device sync. |
| **[HARPA AI](https://harpa.ai/)** | Browser extension that monitors pages, runs 100+ automations, connects to ChatGPT/Claude/Gemini. | **Closed source**, proprietary. Different architecture — not an SDK/library. |
| **[Fellou](https://fellou.ai/)** | "Agentic AI browser" with built-in memory that learns from browsing history. | **Separate browser** — not a library/extension. Vendor lock-in. |
| **Claude in Chrome** | Anthropic's official extension (side panel, can see/click/type/navigate pages). | **Closed ecosystem** — only works with Claude. Not extensible as a memory layer for other agents. |

### Page Agent's Differentiation

1. **Local-first + web-native**: Memory stays in IndexedDB, no cloud calls. Works offline. No account needed.
2. **Bidirectional**: Not just observation — the agent can act on memories (fill forms, click, navigate).
3. **SDK-first**: Any developer can embed page-agent with memory into their web app via `customTools` and lifecycle hooks.
4. **Agent-agnostic**: Clipboard bridge works with *any* AI tool. MCP bridge works with any MCP client. Not locked to one vendor.
5. **Consolidation**: Inspired by Google's always-on-memory-agent — active memory processing, not just passive storage.

### Standards Trajectory

The [Agentic AI Foundation (AAIF)](https://en.wikipedia.org/wiki/Model_Context_Protocol), co-founded by Anthropic, Block, and OpenAI under the Linux Foundation, is expected to formalize agent memory as a first-class MCP primitive in 2026. Key signals:

- MCP already has 97M+ monthly SDK downloads (as of early 2026)
- [Google's A2A protocol](https://google.github.io/A2A/) complements MCP for agent-to-agent communication
- Anthropic's [Agent Skills](https://docs.anthropic.com/en/docs/agents/agent-skills) standard addresses portable procedural knowledge
- Academic work on ["Memory as a Service" (MaaS)](https://arxiv.org/html/2506.22815v1) frames contextual memory as service-oriented modules

**Implication for page-agent**: Design the memory schema to be forward-compatible with MCP's expected memory primitives (entities, relations, observations). The `Memory` interface should be trivially mappable to MCP knowledge graph format.

### Key Lesson from Mem0 Chrome Extension

The Mem0 extension's architecture ([source](https://github.com/mem0ai/mem0-chrome-extension)) reveals the practical pattern for injecting memories into AI chat interfaces:

1. **Per-platform content scripts** — each AI platform (ChatGPT, Claude, Gemini) needs its own DOM selectors
2. **300ms debounced observation** — watch for new messages, avoid excessive API calls
3. **Memory injection into chat input** — prepend relevant memories as system context before the user's message
4. **Manual activation option** — Claude integration uses button/Ctrl+M rather than auto-inject (respects user control)

Page-agent should adopt this pattern for Phase 3 (Page Observer) but with local-first storage instead of cloud API calls. The per-platform content scripts are the fragile part — but graceful degradation to clipboard bridge means this is additive, not critical path.

---

## Security & Privacy

1. **Memory is local-only** by default. No network calls for memory operations.
2. **Export requires user action** — no automatic sharing.
3. **Observer is opt-in** per domain, with visible indicator.
4. **Auth token matching** — existing `PageAgentExtUserAuthToken` mechanism ensures only authorized pages can access memories via the Web Page API.
5. **Memory content filtering** — `transformPageContent` pattern applied to memory saves; no raw passwords, tokens, or PII stored unless user explicitly includes them.
6. **TTL enforcement** — memories expire, preventing indefinite accumulation of stale context.
7. **Scoped access** — memories recalled by URL scope, so unrelated sites can't access each other's context.
