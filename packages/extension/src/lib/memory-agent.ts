/**
 * Memory-Aware Agent Integration
 *
 * Wires memory into the agent loop:
 * 1. Auto-capture: Extract memories from each agent step's reflection.memory field
 * 2. Context injection: Recall relevant memories and inject into agent's instructions
 * 3. Consolidation: Background LLM synthesis of raw memories into insights
 *
 * The agent already generates `memory` strings at every step — we just persist them.
 */
import type { ExecutionResult, HistoricalEvent } from '@page-agent/core'

import {
	getUnconsolidated,
	recallMemories,
	recallWithInsights,
	saveConsolidation,
	saveMemory,
} from './memory-store'
import type { Memory, RecallQuery } from './memory-types'

// --- Auto-capture from Agent Steps ---

/**
 * Extract memories from the agent's step history.
 * Each step has a `reflection.memory` field that the LLM populates.
 */
export function extractMemoriesFromHistory(
	history: HistoricalEvent[],
	scope: string,
	sessionId: string
): Omit<Memory, 'id' | 'createdAt' | 'contentHash' | 'consolidated' | 'importance'>[] {
	const memories: Omit<
		Memory,
		'id' | 'createdAt' | 'contentHash' | 'consolidated' | 'importance'
	>[] = []

	for (const event of history) {
		if (event.type !== 'step') continue

		const memoryText = event.reflection?.memory
		if (!memoryText || memoryText.trim().length < 5) continue

		memories.push({
			content: memoryText,
			tags: [],
			kind: 'workflow_step',
			scope,
			source: { agent: 'page-agent', sessionId, url: scope },
		})
	}

	return memories
}

/**
 * Auto-capture hook: save memories after each step.
 * Wire this into onAfterStep in the agent config.
 */
export async function captureStepMemory(
	history: HistoricalEvent[],
	scope: string,
	sessionId: string
): Promise<void> {
	const lastEvent = history.at(-1)
	if (lastEvent?.type !== 'step') return

	const memoryText = lastEvent.reflection?.memory
	if (!memoryText || memoryText.trim().length < 5) return

	await saveMemory({
		content: memoryText,
		tags: [],
		kind: 'workflow_step',
		scope,
		source: { agent: 'page-agent', sessionId, url: scope },
	})
}

/**
 * Auto-capture hook: save task result after task completion.
 * Wire this into onAfterTask in the agent config.
 */
export async function captureTaskResult(
	result: ExecutionResult,
	scope: string,
	sessionId: string,
	taskDescription: string
): Promise<void> {
	// Save final task result
	const resultSummary = result.success
		? `Task completed: ${taskDescription}. Result: ${result.data.slice(0, 500)}`
		: `Task failed: ${taskDescription}. Error: ${result.data.slice(0, 200)}`

	await saveMemory({
		content: resultSummary,
		tags: result.success ? ['completed'] : ['failed'],
		kind: 'task_result',
		scope,
		source: { agent: 'page-agent', sessionId, url: scope },
		importance: result.success ? 0.7 : 0.4,
	})
}

// --- Context Injection ---

/**
 * Build a memory context block for injection into the agent's prompt.
 * Uses the existing instructions.getPageInstructions callback pattern.
 */
export async function buildMemoryContext(
	scope: string,
	query?: Partial<RecallQuery>
): Promise<string> {
	const { memories, insights } = await recallWithInsights({
		scope,
		limit: query?.limit ?? 8,
		maxAge: query?.maxAge ?? 7 * 24 * 60 * 60 * 1000, // 7 days default
		...query,
	})

	if (memories.length === 0 && insights.length === 0) return ''

	let block = '<relevant_memories>\n'

	// Insights first (consolidated, higher signal)
	if (insights.length > 0) {
		block += '<insights>\n'
		for (const insight of insights.slice(0, 3)) {
			block += `- [insight] ${insight.summary}\n`
			if (insight.insight) block += `  Key pattern: ${insight.insight}\n`
		}
		block += '</insights>\n'
	}

	// Individual memories
	if (memories.length > 0) {
		for (const mem of memories) {
			const age = timeSince(mem.createdAt)
			const source = mem.source.agent !== 'page-agent' ? ` (from ${mem.source.agent})` : ''
			block += `- [${mem.kind}]${source} ${mem.content} (${age})\n`
		}
	}

	block += '</relevant_memories>'
	return block
}

/**
 * Create a getPageInstructions callback that injects memory context.
 * Wraps an optional existing callback.
 */
export function withMemoryInstructions(
	existingCallback?: (url: string) => string | undefined | null
): (url: string) => string | undefined | null {
	// Cache to avoid redundant IDB reads within the same step
	let lastUrl = ''
	let lastResult = ''
	let lastTime = 0

	return (url: string) => {
		const existing = existingCallback?.(url) || ''

		// Return cached result if same URL and < 2s old
		if (url === lastUrl && Date.now() - lastTime < 2000) {
			return existing ? `${existing}\n\n${lastResult}` : lastResult || undefined
		}

		// Kick off async memory recall — but we need to return synchronously.
		// Solution: return the cached value now, update cache async for next call.
		buildMemoryContext(url).then((memoryBlock) => {
			lastUrl = url
			lastResult = memoryBlock
			lastTime = Date.now()
		})

		// First call returns only existing instructions
		if (lastResult && url === lastUrl) {
			return existing ? `${existing}\n\n${lastResult}` : lastResult || undefined
		}

		return existing || undefined
	}
}

// --- Consolidation ---

/**
 * Run memory consolidation.
 * Groups unconsolidated memories by scope, uses LLM to synthesize.
 *
 * @param llmInvoke - Function to call the LLM for synthesis
 */
export async function consolidateMemories(
	llmInvoke: (messages: { role: 'system' | 'user'; content: string }[]) => Promise<string>
): Promise<number> {
	// Use Web Locks to prevent concurrent consolidation
	if (typeof navigator !== 'undefined' && navigator.locks) {
		let consolidated = 0
		await navigator.locks.request(
			'page-agent-consolidation',
			{ ifAvailable: true },
			async (lock) => {
				if (!lock) return // another context is consolidating
				consolidated = await doConsolidation(llmInvoke)
			}
		)
		return consolidated
	}

	return doConsolidation(llmInvoke)
}

async function doConsolidation(
	llmInvoke: (messages: { role: 'system' | 'user'; content: string }[]) => Promise<string>
): Promise<number> {
	const unconsolidated = await getUnconsolidated(10)
	if (unconsolidated.length < 2) return 0

	// Group by scope origin
	const groups = new Map<string, Memory[]>()
	for (const mem of unconsolidated) {
		let origin: string
		try {
			origin = new URL(mem.scope).origin
		} catch {
			origin = mem.scope
		}
		const group = groups.get(origin) || []
		group.push(mem)
		groups.set(origin, group)
	}

	let totalConsolidated = 0

	for (const [origin, memories] of groups) {
		if (memories.length < 2) continue

		const prompt = memories
			.map((m) => `[Memory ${m.id}] (importance: ${m.importance}) ${m.content}`)
			.join('\n')

		try {
			const result = await llmInvoke([
				{
					role: 'system',
					content: `You are a Memory Consolidation Agent. Analyze these memories and:
1. Find connections and patterns across them
2. Create a synthesized summary (2-3 sentences)
3. Identify one key insight
4. List connections between memory pairs as {from_id, to_id, relationship}
5. Rate the consolidated importance from 0.0 to 1.0

Return ONLY valid JSON: { "summary": string, "insight": string, "connections": [{from_id, to_id, relationship}], "importance": number }`,
				},
				{ role: 'user', content: prompt },
			])

			// Parse LLM response
			const jsonMatch = /\{[\s\S]*\}/.exec(result)
			if (!jsonMatch) continue

			const parsed = JSON.parse(jsonMatch[0])

			const consolidation = {
				id: `con_${crypto.randomUUID().slice(0, 12)}`,
				sourceIds: memories.map((m) => m.id),
				summary: parsed.summary || 'No summary generated',
				insight: parsed.insight || '',
				scope: origin,
				createdAt: new Date().toISOString(),
				importance: parsed.importance ?? 0.6,
			}

			const connections = (parsed.connections || []).map(
				(c: { from_id: string; to_id: string; relationship: string }) => ({
					fromId: c.from_id,
					toId: c.to_id,
					relationship: c.relationship,
				})
			)

			await saveConsolidation(consolidation, memories, connections)
			totalConsolidated += memories.length
		} catch (err) {
			console.warn('[Consolidation] Failed for scope', origin, err)
			// Safe to continue — unconsolidated memories stay at consolidated=false
		}
	}

	return totalConsolidated
}

// --- Helpers ---

function timeSince(isoDate: string): string {
	const seconds = Math.floor((Date.now() - Date.parse(isoDate)) / 1000)

	if (seconds < 60) return 'just now'
	if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
	if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
	if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`
	return `${Math.floor(seconds / 604800)}w ago`
}
