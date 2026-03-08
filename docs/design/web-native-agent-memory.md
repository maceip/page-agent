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

*Inspired by [Google's Always-On Memory Agent](https://github.com/GoogleCloudPlatform/generative-ai/tree/main/gemini/agents/always-on-memory-agent) — adapted for the browser extension environment where pages can die at any time.*

### The Browser Durability Problem

Google's agent uses SQLite on a server — it runs 24/7, has ACID guarantees, and never gets killed mid-write. A browser extension faces harder constraints:

| Challenge | Server Agent | Browser Extension |
|---|---|---|
| Process lifetime | Runs forever | Service worker killed after ~30s idle |
| Storage | SQLite (ACID) | IndexedDB (async, per-origin) |
| Tab death | N/A | Page/tab can close mid-task |
| Cross-device | Single server | Multiple browsers, phones, desktops |
| Background work | Always available | Requires offscreen document or alarms |

### Three-Phase Memory Lifecycle (Adapted)

Borrowing Google's three-phase model (Ingest → Consolidate → Query) but adapted for browser constraints:

#### Phase 1: Ingest (Write-Ahead, Crash-Safe)

The key insight: **write memory before the action that might crash**.

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
    importance: 0.5,
    consolidated: false,
  })
}
```

**Why this works**: IndexedDB writes are durable once the transaction commits. Even if the tab crashes on the next step, the memory from the completed step is already persisted.

**Redundancy layer**: The service worker also receives a copy via `chrome.runtime.sendMessage`. Service workers survive tab closes (briefly), giving a second chance to flush.

```typescript
// Content script sends memory to service worker as backup
chrome.runtime.sendMessage({
  type: 'MEMORY_WRITE',
  payload: memory,
})

// Background service worker has its own IDB connection
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'MEMORY_WRITE') {
    // Write to extension's own IDB (separate from content script's)
    saveMemoryFromBackground(msg.payload)
  }
})
```

#### Phase 2: Consolidate (Background Processing)

Google's agent consolidates every 30 minutes. In a browser extension, use `chrome.alarms`:

```typescript
// background.ts
chrome.alarms.create('memory-consolidation', {
  periodInMinutes: 30,
})

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'memory-consolidation') {
    await consolidateMemories()
  }
})
```

**What consolidation does** (mirroring Google's approach):

1. **Find unconsolidated memories** — those with `consolidated: false`
2. **Group by scope/session** — cluster related memories together
3. **LLM-synthesize** — use a lightweight model call to:
   - Merge redundant memories ("navigated to signup" + "filled form" + "submitted" → "created account on example.com")
   - Extract cross-references between sessions
   - Assign importance scores (0-1) based on recency and relevance
4. **Mark as consolidated** — set `consolidated: true`, save synthesis as a new higher-level memory

```typescript
async function consolidateMemories() {
  const unconsolidated = await memoryManager.recall({
    consolidated: false,
    limit: 50,
  })

  if (unconsolidated.length < 3) return // not enough to consolidate

  // Group by scope (URL origin)
  const groups = groupBy(unconsolidated, m => new URL(m.scope).origin)

  for (const [origin, memories] of Object.entries(groups)) {
    // Use configured LLM to synthesize
    const synthesis = await llm.invoke([{
      role: 'user',
      content: `Consolidate these memories into 1-3 high-level summaries:\n${
        memories.map(m => `- ${m.content}`).join('\n')
      }`
    }])

    // Save consolidated memory
    await memoryManager.save({
      content: synthesis,
      kind: 'observation',
      scope: origin,
      source: { agent: 'page-agent-consolidator' },
      tags: ['consolidated'],
      importance: 0.8,
      consolidated: true,
    })

    // Mark originals as consolidated
    for (const m of memories) {
      await memoryManager.update(m.id, { consolidated: true })
    }
  }
}
```

**Cost control**: Use the cheapest available model (e.g., Haiku, Flash-Lite). Consolidation is not latency-sensitive. Can also be done fully locally if the user has a local model configured.

#### Phase 3: Query (Recall with Ranking)

When the agent needs memories, rank by:
1. **Scope match** — exact URL > same origin > wildcard
2. **Recency** — newer memories ranked higher (exponential decay)
3. **Importance** — consolidated summaries rank above raw step memories
4. **Consolidation status** — prefer consolidated over raw when both exist

```typescript
async recall(query: RecallQuery): Promise<Memory[]> {
  let candidates = await this.store.getByScope(query.scope)

  // Prefer consolidated memories over raw ones from same session
  candidates = deduplicateByConsolidation(candidates)

  // Score and rank
  candidates.sort((a, b) => {
    const scoreA = this.relevanceScore(a, query)
    const scoreB = this.relevanceScore(b, query)
    return scoreB - scoreA
  })

  return candidates.slice(0, query.limit ?? 10)
}

private relevanceScore(memory: Memory, query: RecallQuery): number {
  const recencyDecay = Math.exp(-(Date.now() - Date.parse(memory.createdAt)) / (7 * 86400000))
  const scopeMatch = memory.scope === query.scope ? 1.0
    : new URL(memory.scope).origin === new URL(query.scope).origin ? 0.7
    : memory.scope === '*' ? 0.3 : 0.1
  const importance = memory.importance ?? 0.5

  return (recencyDecay * 0.3) + (scopeMatch * 0.4) + (importance * 0.3)
}
```

### Cross-Tab Durability

Multiple tabs can be running page-agent simultaneously. Prevent conflicts:

```typescript
// Use BroadcastChannel for cross-tab coordination
const memoryChannel = new BroadcastChannel('page-agent-memory')

// When any tab saves a memory, broadcast to all tabs
memoryChannel.postMessage({ type: 'memory-saved', memory })

// Other tabs can update their in-memory cache
memoryChannel.addEventListener('message', (event) => {
  if (event.data.type === 'memory-saved') {
    localCache.invalidate(event.data.memory.scope)
  }
})
```

IndexedDB itself handles concurrent writes correctly (it's transactional), so the `BroadcastChannel` is just for cache invalidation, not write coordination.

### Cross-Device Sync

For memories to "follow the user around" across devices, offer tiered sync:

**Tier 0: Manual (clipboard)** — Export on device A, import on device B. Works today, zero infrastructure.

**Tier 1: Browser sync** — Use `chrome.storage.sync` for a small, curated set of high-importance memories (8KB limit per item, 100KB total). Only consolidated, high-importance memories qualify.

```typescript
// Only sync the most important consolidated memories
async function syncHighValueMemories() {
  const topMemories = await memoryManager.recall({
    consolidated: true,
    minImportance: 0.8,
    limit: 20,
  })

  // chrome.storage.sync has 100KB total limit — serialize carefully
  const serialized = topMemories.map(m => ({
    id: m.id,
    c: m.content,      // abbreviated keys to save space
    s: m.scope,
    t: m.createdAt,
  }))

  await chrome.storage.sync.set({ memories: serialized })
}

// On other devices, merge synced memories into local IDB
chrome.storage.sync.get('memories', (result) => {
  if (result.memories) {
    for (const m of result.memories) {
      memoryManager.importIfNew(m)
    }
  }
})
```

**Tier 2: User-owned cloud** — Optional integration with user's own storage:
- Google Drive (via `chrome.identity` + Drive API)
- iCloud (via CloudKit JS — Safari extension variant)
- A simple JSON file synced via Dropbox/OneDrive
- Self-hosted: user points to their own endpoint

**Tier 3: CRDTs** — For real-time multi-device sync without conflicts, use CRDTs (Conflict-free Replicated Data Types). Libraries like Yjs or Automerge can run in the browser. This is future work — the memory schema (append-only with consolidation) is naturally CRDT-friendly since memories are never mutated after creation, only marked as consolidated.

### Service Worker Persistence Strategy

The extension service worker is the most durable component — it survives tab closes and restarts on events. Use it as the memory system's backbone:

```typescript
// background.ts — the memory durability hub
export default defineBackground(() => {
  // 1. Receive memory writes from content scripts
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'MEMORY_WRITE') {
      saveMemory(msg.payload).then(() => sendResponse({ ok: true }))
      return true
    }
    if (msg.type === 'MEMORY_RECALL') {
      recallMemories(msg.payload).then((memories) => sendResponse({ memories }))
      return true
    }
  })

  // 2. Periodic consolidation via alarms
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

  // 3. On install/update, run initial consolidation
  chrome.runtime.onInstalled.addListener(() => {
    consolidateMemories()
  })
})
```

### Memory Schema (Updated with Durability Fields)

```typescript
interface Memory {
  id: string
  content: string
  tags: string[]
  source: MemorySource
  kind: 'observation' | 'task_result' | 'user_preference' | 'page_snapshot' | 'workflow_step'
  scope: string | '*'
  createdAt: string
  ttl?: number
  embedding?: number[]

  // Durability fields (inspired by Google's always-on-memory-agent)
  importance: number           // 0-1, affects recall ranking and sync eligibility
  consolidated: boolean        // has this been processed by consolidation?
  consolidatedInto?: string    // ID of the consolidated memory that absorbed this one
  syncedAt?: string            // last time this was pushed to chrome.storage.sync
  deviceId?: string            // which device created this memory
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
