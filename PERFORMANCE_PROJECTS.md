# Page Agent Performance Projects

Roadmap of projects (S/M/L/XL) designed to give Page Agent a decisive, measurable performance edge over every other web-agent framework.

Performance here means: **fewer steps to complete tasks, higher task success rate, lower token cost per task, faster wall-clock time, and more robust handling of real-world web complexity.**

---

## Small Projects (1–3 days each)

### S1 — Smarter DOM Pruning: Viewport-Aware + Relevance Scoring

**Problem:** The current `flatTreeToString` sends *every* interactive element on the page to the LLM by default (`DEFAULT_VIEWPORT_EXPANSION = -1`). A viewport-aware mode exists (`viewportExpansion` config), but even with it enabled there is no relevance scoring or element capping—every in-viewport element is included regardless of relevance. On complex pages (dashboards, long forms, SPAs with hidden panels), this wastes 30–60% of the context window on elements the agent will never touch in the current step.

**Solution:**
- Enable viewport filtering by default (switch `DEFAULT_VIEWPORT_EXPANSION` from `-1` to a sensible value like `500px`).
- Score each interactive element by (a) viewport proximity, (b) semantic similarity to the current `next_goal`/user request (cheap BM25 or TF-IDF over element text + attributes), and (c) recency (`isNew` flag, which already exists and marks new elements with `*[index]`).
- Hard-cap the simplified HTML to the top-K elements (e.g. 80) plus all elements within the visible viewport.
- Include a `[... N more elements offscreen, scroll to reveal]` summary line so the LLM knows it can scroll.

**Impact:** 30–50% token reduction per step on complex pages → faster inference, cheaper cost, and less noise for the LLM to reason through → higher accuracy.

**Files:** `packages/page-controller/src/dom/index.ts` (flatTreeToString), `packages/core/src/PageAgentCore.ts` (#assembleUserPrompt)

---

### S2 — Adaptive Step Delay & Parallel Observation

**Problem:** Fixed 400ms inter-step delay + 300ms pointer animation + 200ms post-click wait = ~900ms overhead per step even when the page is static. Over 10 steps, that's 9 seconds of pure dead time.

**Solution:**
- Replace fixed delays with adaptive waits: monitor DOM mutation observer + network activity. If no mutations and no pending fetches after 50ms, proceed immediately.
- Overlap the DOM tree extraction (`getBrowserState`) with the tail end of the action execution wait—start observing while the click animation is still playing.
- Make `movePointerToElement` configurable (disable in headless/programmatic mode where no one is watching).

**Impact:** 40–70% reduction in wall-clock time per task. Directly visible in any speed benchmark.

**Files:** `packages/page-controller/src/actions.ts`, `packages/core/src/PageAgentCore.ts` (main loop timing)

---

### S3 — Action Result Enrichment

**Problem:** Current action results include basic confirmations with element text labels (e.g., `"✅ Clicked element (Submit Button)"`, `"✅ Input text (hello) into element (Search Box)"`), but provide zero feedback about *what actually happened on the page* after the action (did a modal open? did the URL change? did new elements appear? did a validation error fire?). This forces the LLM to waste a full step just re-observing.

**Solution:**
- After each action, compute a concise diff: "3 new interactive elements appeared", "Modal overlay detected", "URL changed to /checkout", "Form field now shows validation error: 'Email required'".
- Inject this as a structured `<action_effect>` block in the next step's history, *before* the full browser state.
- For `input_text`, include the actual value now in the field (confirms the input took effect).

**Impact:** Reduces unnecessary "observe-only" steps by 1–2 per task on average. That's 15–25% fewer total steps on multi-step tasks.

**Files:** `packages/core/src/tools/index.ts` (tool execute return values), `packages/page-controller/src/PageController.ts` (state diffing), `packages/core/src/PageAgentCore.ts` (#assembleUserPrompt)

---

### S4 — Streaming LLM Responses with Early Action Extraction

**Problem:** The agent waits for the entire LLM response (reflection + action) before executing anything. For large responses on slower models, this adds 2–5 seconds of pure latency per step.

**Solution:**
- Switch the OpenAI client to streaming mode.
- Parse the streamed JSON incrementally. As soon as the `action` field is complete (it's the last field in the macro tool schema), begin executing it while the reflection text is still being displayed.
- Emit the reflection fields to the UI as they stream in (gives users real-time feedback).

**Impact:** 1–3 second latency reduction per step. Over a 10-step task, saves 10–30 seconds. Users *feel* the difference immediately.

**Files:** `packages/llms/src/OpenAIClient.ts`, `packages/llms/src/index.ts` (invoke method), `packages/core/src/PageAgentCore.ts` (result handling)

---

### S5 — Loop Detection & Automatic Recovery

**Problem:** The prompt says "do not repeat one action for more than 3 times" but there's no *enforcement*. The LLM can and does get stuck in click→scroll→click loops, burning all remaining steps.

**Solution:**
- Track the last N actions as `(actionName, actionInput, simplifiedResultHash)` tuples.
- If the same (action, input) pair repeats 3 times with no meaningful state change (same DOM hash), inject a hard observation: `"⚠️ LOOP DETECTED: You have repeated {action} on element {index} 3 times with no effect. You MUST try a different approach."`.
- If it repeats a 4th time, auto-inject a different action (scroll, or ask_user).

**Impact:** Eliminates the #1 cause of max-step failures. Could improve success rate by 10–20% on tasks that currently time out.

**Files:** `packages/core/src/PageAgentCore.ts` (#handleObservations, main loop)

---

## Medium Projects (3–7 days each)

### M1 — Two-Phase Planning: Think-Then-Act with Sub-Goal Decomposition

**Problem:** The current single-step reflection (`evaluation_previous_goal`, `memory`, `next_goal`) is shallow. On complex multi-step tasks (e.g., "Fill out this 20-field form and submit"), the agent has no high-level plan and makes locally-greedy decisions that miss dependencies.

**Solution:**
- Add an explicit planning phase: before the first action, make a dedicated LLM call that produces a structured `<plan>` with numbered sub-goals.
- Each step's reflection references the current sub-goal index.
- When a sub-goal is completed (LLM signals it), advance to the next. If the plan needs revision (unexpected state), trigger a re-plan.
- Use the plan as a "scratchpad" in the prompt to keep the LLM aligned with the overall strategy.

**Impact:** 20–40% improvement in success rate on complex multi-step tasks. This is the single biggest differentiator against agents that only do step-level reasoning.

**Files:** `packages/core/src/PageAgentCore.ts` (new planning phase before main loop), `packages/core/src/prompts/` (new planning prompt), `packages/core/src/types.ts` (plan types)

---

### M2 — Semantic Element Targeting with Fuzzy Matching

**Problem:** Index-based targeting is fragile. If the DOM changes slightly between the LLM's observation and action execution (React re-render, async content load), the index may point to the wrong element. This is a common cause of "clicked wrong element" failures.

**Solution:**
- Alongside each index, compute a stable semantic signature: `{tagName, textContent, ariaLabel, role, nearestLabelText, parentContext}`.
- When executing an action, first try the index. If the element at that index doesn't match the semantic signature (fuzzy match with threshold), search the current DOM for the best match by semantic similarity.
- Log when a fallback match was used, so the LLM sees it in history.

**Impact:** Eliminates "stale index" failures on dynamic pages. Expect 10–15% success rate improvement on SPAs with frequent re-renders (React, Vue, Angular apps).

**Files:** `packages/page-controller/src/dom/index.ts` (signature computation), `packages/page-controller/src/actions.ts` (fuzzy match on execution), `packages/page-controller/src/PageController.ts`

---

### M3 — Context Window Compression: History Summarization

**Problem:** The `<agent_history>` grows linearly with steps. By step 15+, the history consumes most of the context window, leaving less room for the browser state. On 40-step tasks, the history alone can overflow many models.

**Solution:**
- Implement a sliding-window + summarization strategy:
  - Keep the last 3 steps in full detail.
  - Compress older steps into a running summary (1–2 sentences per group of 3 steps).
  - Always keep step 1 (initial plan context) in full.
- Use the same LLM (or a cheaper/faster one) to produce the summary, or use a deterministic template: `"Steps 4-6: Navigated to settings page, filled name field, encountered validation error on email."`.
- Track cumulative token usage and trigger compression when approaching 60% of the model's context limit.

**Impact:** Enables reliable 40+ step tasks. Prevents context overflow. Reduces prompt size by 40–60% on long tasks.

**Files:** `packages/core/src/PageAgentCore.ts` (#assembleUserPrompt, history management), new `packages/core/src/utils/historyCompressor.ts`

---

### M4 — Keyboard & Composite Action Primitives

**Problem:** The current action space is missing critical primitives: `press_key` (Enter, Escape, Tab, Arrow keys), `hover` (for tooltips/dropdowns), `drag_and_drop`, `right_click`, and composite actions like `clear_and_type`. Many real-world tasks require these (e.g., pressing Enter after typing in a search box is so common the TODO in the code already flags it).

**Solution:**
- Add new tools:
  - `press_key(key: string, modifiers?: string[])` — supports Enter, Escape, Tab, ArrowDown, etc.
  - `hover_element(index: number)` — trigger mouseenter/mouseover without click.
  - `clear_and_type(index: number, text: string)` — select all → delete → type (handles pre-filled fields).
  - `drag_and_drop(fromIndex: number, toIndex: number)` — for kanban boards, sortable lists.
- Update the system prompt to document when to use each.

**Impact:** Unlocks entire categories of tasks that currently fail (search submission, dropdown navigation, form clearing). Expect 15–25% improvement in success rate on form-heavy and interactive-widget tasks.

**Files:** `packages/core/src/tools/index.ts`, `packages/page-controller/src/actions.ts`, `packages/core/src/prompts/system_prompt.md`

---

### M5 — Intelligent Retry with Error Classification

**Problem:** The current retry logic (`maxRetries=2`, flat 100ms delay) already classifies errors as retryable vs. non-retryable (AUTH_ERROR, CONTEXT_LENGTH, CONTENT_FILTER fail fast), but has two gaps: (1) the backoff is a flat 100ms regardless of error type—no exponential backoff for rate limits, no jitter—and (2) it doesn't adapt the *agent strategy* after errors (e.g., compressing context on overflow, switching models on repeated failures).

**Solution:**
- For `rate_limit`: upgrade to exponential backoff with jitter (1s, 2s, 4s) instead of flat 100ms.
- For `context_overflow`: trigger history compression (M3) and retry with reduced context, instead of failing immediately.
- For `invalid_response`: increment auto-fixer aggressiveness (try more normalization strategies in `normalizeResponse`).
- Expose error classification to the agent loop so it can adapt strategy (e.g., switch to a fallback model via LLMRouter, reduce DOM payload on context overflow).

**Impact:** Dramatically improves reliability in production environments with rate limits and flaky networks. Turns ~30% of current hard failures into recoverable situations.

**Files:** `packages/llms/src/index.ts` (invoke, retry logic), new `packages/llms/src/errorClassifier.ts`, `packages/core/src/PageAgentCore.ts` (error handling in main loop)

---

## Large Projects (1–3 weeks each)

### L1 — Multi-Tab Orchestration with Shared Memory

**Problem:** The current architecture is strictly single-page. Real-world tasks often span multiple tabs/pages ("Compare prices across 3 sites", "Copy data from email to spreadsheet"). The chrome extension exists but has no coordinated multi-tab agent strategy.

**Solution:**
- Create an `OrchestratorAgent` that manages multiple `PageAgentCore` instances (one per tab).
- Shared memory store: key-value pairs accessible across all tab agents (e.g., `{price_amazon: "$29.99", price_walmart: "$31.50"}`).
- The orchestrator decomposes the user task into per-tab sub-tasks, dispatches them (potentially in parallel), and merges results.
- Communication protocol between orchestrator and tab agents via Chrome extension messaging.

**Impact:** Unlocks an entirely new class of tasks that no other in-page agent can handle. This is a category-defining feature.

**Files:** New `packages/orchestrator/`, extensions to `packages/extension/`, `packages/core/src/types.ts`

---

### L2 — Visual Grounding Hybrid Mode (Text + Screenshot)

**Problem:** Pure text-based DOM serialization misses visual layout information. The LLM can't tell that two buttons are side-by-side, that an element is hidden behind an overlay, or that a form field is visually grouped with a label that's in a different DOM subtree. This causes targeting errors on visually complex pages.

**Solution:**
- Add an optional "visual grounding" mode that captures a viewport screenshot, overlays bounding-box annotations with element indices, and sends it alongside the simplified HTML.
- Use the multimodal capabilities of modern LLMs (GPT-4o, Claude, Gemini) to cross-reference visual position with DOM structure.
- Make this configurable: text-only (fast/cheap), visual-only (accurate but expensive), hybrid (best of both—text for interaction, visual for disambiguation).
- On pages where the text representation is ambiguous, auto-escalate to hybrid mode.

**Impact:** 15–30% accuracy improvement on visually complex pages (dashboards, data-dense UIs, canvas-heavy apps). Matches or exceeds screenshot-only agents while keeping the cost low for simple pages.

**Files:** New `packages/page-controller/src/visualCapture.ts`, `packages/core/src/PageAgentCore.ts` (mode selection), `packages/core/src/prompts/` (visual prompt variant)

---

### L3 — Offline Trajectory Learning & Prompt Distillation

**Problem:** The system prompt and reasoning patterns are hand-crafted. There's no mechanism to learn from successful task completions or improve from failures. Every user starts from the same generic prompt.

**Solution:**
- Log all agent trajectories (task, steps, actions, success/failure) with user consent.
- Build an offline pipeline that:
  1. Clusters successful trajectories by task type (form filling, navigation, data extraction).
  2. Extracts the most efficient action sequences as "expert demonstrations."
  3. Distills these into task-type-specific prompt addenda (few-shot examples).
  4. Identifies common failure patterns and adds targeted recovery heuristics to the prompt.
- Ship optimized prompt variants per task category. A lightweight classifier routes tasks to the best prompt variant.

**Impact:** Continuous improvement loop. Each release gets measurably better. Expect 10–20% cumulative success rate improvement over 3 release cycles based on real-world usage data.

**Files:** New `packages/core/src/prompts/variants/`, new `scripts/trajectory-analysis/`, `packages/core/src/PageAgentCore.ts` (prompt routing)

---

## Extra-Large Projects (1–2 months each)

### XL1 — Speculative Execution with Rollback (Parallel Worlds)

**Problem:** The agent executes one action at a time, serially. If the first approach fails (wrong button, unexpected modal), it has already burned 3–5 steps before realizing the mistake. On tasks with tight step budgets, this is catastrophic.

**Solution:**
- Implement speculative execution: at decision points with uncertainty, fork into 2–3 parallel execution branches.
- Each branch gets its own DOM snapshot (via `structuredClone` of the FlatDomTree + state). Execute the action in each branch in isolated "shadow" mode (record the action but don't commit to the real DOM yet).
- After one LLM call per branch, evaluate which branch made the most progress (success signal from action result + DOM change magnitude).
- Commit the winning branch to the real DOM; discard the others.
- Limit forking to max 2 levels deep and max 3 branches to control cost.

**Implementation details:**
- Snapshot the full page controller state before the fork point.
- For each branch, create a lightweight `VirtualPageController` that records actions as a journal.
- Once a winner is selected, replay the winner's journal against the real page controller.
- On the LLM side, make parallel calls (Promise.all) for each branch — this costs more tokens but the wall-clock time is the same as a single call.

**Impact:** Converts the agent from a greedy search into a limited beam search. Expected 25–40% improvement on tasks where the optimal path isn't obvious from the first step. This is the kind of architecture that wins benchmarks.

**Files:** New `packages/core/src/speculative/`, `packages/page-controller/src/VirtualPageController.ts`, `packages/core/src/PageAgentCore.ts` (fork/join logic)

---

### XL2 — Self-Improving Agent with Online RL Micro-Updates

**Problem:** The agent has no learning signal during execution. It can't adjust its strategy mid-task based on what worked or failed in previous steps *of the same task*. The reflection fields (memory, evaluation) are good but are purely in-context—they don't update any weights or persistent policy.

**Solution:**
- Implement a lightweight "policy overlay" using a small, fine-tuned model or a prompt-based policy that runs alongside the main LLM:
  1. **Reward model**: After each step, score the outcome (0–1) based on: DOM change magnitude, progress toward goal (embedding similarity), step efficiency.
  2. **Strategy adapter**: Based on accumulated rewards, adjust the system prompt in real-time: increase/decrease exploration (temperature), add/remove specific heuristics, emphasize/de-emphasize certain action types.
  3. **Cross-task memory**: Maintain a persistent (per-origin) memory bank of successful strategies: "On site X, dropdowns require hover before click", "On site Y, search requires pressing Enter after input".
- Store cross-task memory in IndexedDB (no server needed, works offline).

**Impact:** The agent gets *smarter* the more you use it on a given site. After 5–10 tasks on the same site, expect 30–50% fewer steps and significantly higher success rates. No other in-page agent does this.

**Files:** New `packages/core/src/learning/`, new `packages/core/src/memory/siteMemory.ts`, `packages/core/src/PageAgentCore.ts` (integration points), `packages/llms/src/index.ts` (dynamic temperature/prompt adjustment)

---

### XL3 — Hierarchical Agent Architecture with Specialist Sub-Agents

**Problem:** One monolithic agent with one system prompt tries to handle everything: navigation, form filling, data extraction, error recovery, search. It's a jack of all trades, master of none. Different task types have fundamentally different optimal strategies.

**Solution:**
- Decompose into a hierarchy:
  - **Commander Agent**: Receives the user task, decomposes it into typed sub-tasks, dispatches to specialists, merges results.
  - **Navigator Agent**: Optimized for finding and reaching target pages (URL patterns, link following, search).
  - **Form Agent**: Optimized for form interactions (field detection, validation handling, multi-step forms).
  - **Extractor Agent**: Optimized for data extraction (table parsing, list enumeration, structured output).
  - **Recovery Agent**: Activated when any other agent gets stuck (alternative strategies, escalation to user).
- Each specialist has its own optimized system prompt, action preferences, and heuristics.
- Agents share state via a common memory bus (the existing history mechanism, extended).
- The Commander uses a lightweight classification model or rule-based routing to dispatch.

**Impact:** Each specialist can be independently optimized and benchmarked. Expect 20–35% improvement across all task types, with 40%+ improvement in the specialist's domain. This is the architecture that scales.

**Files:** New `packages/core/src/agents/` directory with `CommanderAgent`, `NavigatorAgent`, `FormAgent`, `ExtractorAgent`, `RecoveryAgent`, plus prompt variants for each

---

### XL4 — Predictive Pre-Fetching & Speculative DOM Pre-Processing

**Problem:** Every step has a sequential pipeline: action → wait → DOM extraction → serialization → LLM call → parse → next action. The DOM extraction and serialization are on the critical path and can take 100–500ms on complex pages.

**Solution:**
- **Predictive pre-fetching**: While the LLM is thinking, predict the most likely next actions (top 3 from the current state) and pre-compute the DOM state for each. When the LLM response arrives, if it matches a prediction, skip DOM extraction entirely.
- **Incremental DOM diffing**: Instead of re-extracting the full DOM tree each step, compute only the delta from the previous tree. Use MutationObserver to track changes between steps.
- **Background serialization**: Run `flatTreeToString` in a Web Worker so it doesn't block the main thread (important for the page's own UI responsiveness).
- **Pre-warmed context**: Start assembling the next prompt (history, instructions, static parts) while the current action is still executing. Only the browser_state section needs to wait.

**Impact:** 50–80% reduction in the "dead time" between steps. Combined with S2 (adaptive delays) and S4 (streaming), this could make Page Agent 3–5x faster in wall-clock time than any competitor.

**Files:** New `packages/page-controller/src/incrementalDom.ts`, `packages/page-controller/src/domWorker.ts`, `packages/core/src/PageAgentCore.ts` (pipelined execution)

---

## Priority Matrix

| Project | Level of Effort | Impact | Confidence: Will It Work? | Confidence: Meaningful Perf Impact? | Priority |
|---------|----------------|--------|--------------------------|-------------------------------------|----------|
| S1 — DOM Pruning | S (2–3 days) | High — 30–50% token reduction per step | **Very High** — viewport filtering already exists (opt-in); main work is relevance scoring + capping | **High** — proven technique in other agents (WebArena, SeeAct); direct token savings measurable immediately | P0 — Do first |
| S3 — Action Result Enrichment | S (2–3 days) | High — 15–25% fewer total steps | **Very High** — DOM diffing is deterministic; no LLM dependency for the diff itself | **High** — reduces wasted "observe-only" steps; effect scales with task complexity | P0 — Do first |
| S5 — Loop Detection | S (1–2 days) | High — eliminates #1 cause of max-step failures | **Very High** — simple heuristic (action+hash dedup), zero technical risk | **High** — directly prevents the most common failure mode; 10–20% success rate uplift on stuck tasks | P0 — Do first |
| S2 — Adaptive Delays | S (2–3 days) | Medium — 40–70% wall-clock reduction | **High** — MutationObserver + network idle detection are well-understood browser APIs | **Medium** — big latency win, but doesn't improve success rate or token cost; mainly UX | P1 |
| S4 — Streaming Responses | S (2–3 days) | Medium — 1–3s latency saved per step | **Medium** — incremental JSON parsing of tool-call responses is fiddly; edge cases with malformed streams | **Medium** — latency improvement only, no accuracy or token benefit; value depends on model speed | P1 |
| M1 — Two-Phase Planning | M (5–7 days) | Very High — 20–40% success rate on complex tasks | **Medium** — the planning prompt needs careful tuning; risk that plan becomes stale on dynamic pages | **High** — academic evidence (Inner Monologue, SayCan, ReAct-Plan) shows planning lifts success on multi-step tasks significantly | P0 — Do first |
| M4 — Keyboard Actions | M (3–5 days) | High — unlocks entire failing task categories | **Very High** — dispatching KeyboardEvents is well-understood; clear implementation path | **Very High** — "press Enter to submit search" is the single most common missing capability; immediate unblock | P0 — Do first |
| M2 — Semantic Targeting | M (5–7 days) | High — 10–15% success rate on SPAs | **High** — fuzzy matching on element signatures is proven (Playwright locators use similar); main risk is false-positive matches | **Medium-High** — helps on dynamic pages, but index staleness may not be the primary failure mode in practice; needs measurement | P1 |
| M3 — History Compression | M (5–7 days) | High — enables 40+ step tasks | **High** — sliding-window summarization is a known technique; template-based compression is low-risk | **Medium-High** — critical for long tasks, but most current tasks complete in <15 steps where history isn't the bottleneck | P1 |
| M5 — Intelligent Retry | M (3–5 days) | Medium — recovers ~30% of hard failures | **High** — error classification already exists (retryable vs non-retryable); main work is upgrading backoff + adding agent-level adaptation | **Medium** — most failures are agent logic errors, not LLM API errors; helps in production but doesn't move benchmarks | P2 |
| L2 — Visual Grounding | L (2–3 weeks) | Very High — 15–30% accuracy on complex pages | **Medium** — requires multimodal LLM; bounding-box overlay rendering + image encoding adds complexity; screenshot quality varies | **High** — strong evidence from vision-based agents (SeeAct, WebVoyager) that visual grounding closes the gap on layout-dependent tasks | P0 |
| L1 — Multi-Tab | L (2–3 weeks) | High — new task category | **Medium** — chrome extension messaging is fragile; coordinating multiple agent instances is architecturally complex; race conditions likely | **Medium** — unlocks new use cases but most benchmarks are single-page; competitive differentiator more than perf metric | P1 |
| L3 — Trajectory Learning | L (2–3 weeks) | High — continuous improvement | **Low-Medium** — requires trajectory collection pipeline, clustering, and prompt distillation; cold-start problem; quality depends on user volume | **Medium** — long-term compounding value, but initial iterations may show modest gains; 3+ release cycles to realize full benefit | P2 |
| XL1 — Speculative Execution | XL (4–6 weeks) | Very High — 25–40% on ambiguous tasks | **Low-Medium** — DOM snapshotting + rollback is hard to do perfectly in a live browser; shadow execution may have side effects (network requests, state mutations) that can't be undone | **Medium-High** — beam search is theoretically superior to greedy; but cost multiplier (2–3x tokens) may offset gains; needs careful branch-limit tuning | P0 |
| XL3 — Hierarchical Agents | XL (6–8 weeks) | Very High — 20–35% across all tasks | **Medium** — agent routing/dispatch is well-studied but per-specialist prompt engineering is a large surface area; coordination overhead may eat into gains | **Medium-High** — specialist agents outperform generalists in literature, but diminishing returns if the base agent is already well-tuned | P1 |
| XL4 — Predictive Pre-Fetch | XL (4–6 weeks) | High — 50–80% dead-time reduction | **Low-Medium** — action prediction accuracy will be low initially; cache invalidation on wrong predictions adds complexity; Web Worker DOM access has limitations | **Medium** — impressive latency wins if predictions are accurate, but prediction miss rate could make it net-negative; high implementation cost for uncertain payoff | P1 |
| XL2 — Online RL | XL (6–8 weeks) | High — 30–50% fewer steps after learning | **Low** — reward model design is an open research problem; online RL in production is notoriously unstable; prompt-based policy adaptation is fragile | **Low-Medium** — theoretical ceiling is high but practical realization is unproven in browser agent contexts; risk of reward hacking / degenerate strategies | P2 |

## Recommended Execution Order

1. **Week 1–2**: S1 + S3 + S5 (quick wins, immediate measurable gains)
2. **Week 2–3**: M1 + M4 (unlock planning and missing action primitives)
3. **Week 3–5**: S2 + S4 + M2 + M3 (speed + robustness stack)
4. **Week 5–8**: L2 (visual grounding — the competitive moat)
5. **Week 8–16**: XL1 or XL3 (pick based on benchmark priorities)

The S-tier projects alone should yield a **2x improvement** in task success rate and step efficiency. Combined with the M-tier, expect a **3–4x edge** over current competitors on standard web-agent benchmarks.
