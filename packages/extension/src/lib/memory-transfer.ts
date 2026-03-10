/**
 * Memory Transfer — Clipboard Bridge
 *
 * The universal interop layer. Export memories as human-readable text
 * that works in any chat interface, any clipboard, any note-taking app.
 * Import unstructured text and parse it back into structured memories.
 *
 * Supports three import tiers:
 *   1. Structured (JSON MemoryTransferPacket)
 *   2. Semi-structured (regex-parsed `- [kind] content [tags]` lines)
 *   3. LLM-assisted (optional) — extracts structured memories from arbitrary prose
 *   4. Fallback — entire text as a single observation
 */
import { recallMemories, saveMemory } from './memory-store'
import type { Memory, MemorySource, MemoryTransferPacket } from './memory-types'

// ---------------------------------------------------------------------------
// Import options
// ---------------------------------------------------------------------------

/**
 * Options for importFromText.
 *
 * When an `llmExtract` function is provided, unstructured text that doesn't
 * match the regex parser is sent to the LLM for structured extraction before
 * falling back to the single-observation import.
 */
export interface ImportOptions {
	/**
	 * LLM-backed extraction function.
	 * Called when the deterministic regex parser finds no structured memories
	 * but the input text is non-trivial (> 20 chars after header stripping).
	 *
	 * Receives the cleaned text, returns an array of extracted memory fields.
	 * The caller is responsible for constructing this function using whatever
	 * LLM client is available (e.g. @page-agent/llms).
	 */
	llmExtract?: (text: string) => Promise<ExtractedMemory[]>
}

/** Shape returned by the LLM extraction function */
export interface ExtractedMemory {
	content: string
	kind: Memory['kind']
	tags: string[]
}

// --- Export ---

/**
 * Export memories as a portable, human-readable text block.
 * Includes a machine-parseable header for structured import.
 */
export function exportAsText(memories: Memory[], sourceName = 'page-agent'): string {
	if (memories.length === 0) return ''

	const now = new Date().toISOString()
	const scopes = [...new Set(memories.map((m) => m.scope).filter((s) => s !== '*'))]
	const scopeStr = scopes.length > 0 ? scopes.join(', ') : 'various'

	let text = '--- Page Agent Memory Transfer ---\n'
	text += `Source: ${sourceName}\n`
	text += `Time: ${now}\n`
	text += `Scope: ${scopeStr}\n`
	text += `Count: ${memories.length}\n`
	text += '\nMemories:\n'

	for (const mem of memories) {
		const agentTag = mem.source.agent !== 'page-agent' ? ` (from ${mem.source.agent})` : ''
		const tags = mem.tags.length > 0 ? ` [${mem.tags.join(', ')}]` : ''
		text += `- [${mem.kind}]${agentTag} ${mem.content}${tags}\n`
	}

	text += '---\n'
	return text
}

/**
 * Export memories as JSON for structured import on another device.
 */
export function exportAsJSON(memories: Memory[]): string {
	const packet: MemoryTransferPacket = {
		version: 1,
		source: 'page-agent',
		exportedAt: new Date().toISOString(),
		memories: memories.map((m) => ({
			content: m.content,
			tags: m.tags,
			kind: m.kind,
			scope: m.scope,
			source: m.source,
			importance: m.importance,
			createdAt: m.createdAt,
		})),
	}
	return JSON.stringify(packet, null, 2)
}

// --- Import ---

/**
 * Import from the portable text format.
 * Parses the structured header + memory lines.
 *
 * Import pipeline:
 *   1. Try JSON (MemoryTransferPacket)
 *   2. Try regex (`- [kind] content [tags]`)
 *   3. If `options.llmExtract` provided and text is non-trivial → LLM extraction
 *   4. Fallback: entire cleaned text as a single observation
 */
export async function importFromText(text: string, options?: ImportOptions): Promise<Memory[]> {
	const imported: Memory[] = []

	// Tier 1: Try JSON first
	try {
		const parsed = JSON.parse(text)
		if (parsed.version === 1 && Array.isArray(parsed.memories)) {
			return await importFromPacket(parsed)
		}
	} catch {
		// Not JSON, try text format
	}

	// Tier 2: Parse text format (regex)
	const lines = text.split('\n')
	let source: MemorySource = { agent: 'user' }
	let scope = '*'

	for (const line of lines) {
		// Parse header
		if (line.startsWith('Source:')) {
			const agent = line.replace('Source:', '').trim()
			source = { agent: agent || 'user' }
		}
		if (line.startsWith('Scope:')) {
			scope = line.replace('Scope:', '').trim()
			if (scope === 'various') scope = '*'
		}

		// Parse memory lines: "- [kind] content [tags]"
		const memMatch = /^-\s+\[(\w+)\](?:\s+\(from\s+(\w[\w-]*)\))?\s+(.+)$/.exec(line)
		if (memMatch) {
			const [, kind, fromAgent, rest] = memMatch

			// Extract trailing tags: [tag1, tag2]
			const tagMatch = /^(.+?)\s+\[([^\]]+)\]$/.exec(rest)
			const content = tagMatch ? tagMatch[1].trim() : rest.trim()
			const tags = tagMatch ? tagMatch[2].split(',').map((t) => t.trim()) : []

			const memSource: MemorySource = fromAgent ? { ...source, agent: fromAgent } : source

			const validKinds = [
				'observation',
				'task_result',
				'user_preference',
				'page_snapshot',
				'workflow_step',
			] as const
			const memKind = validKinds.includes(kind as any) ? (kind as Memory['kind']) : 'observation'

			const saved = await saveMemory({
				content,
				tags,
				kind: memKind,
				scope,
				source: memSource,
			})
			imported.push(saved)
		}
	}

	// If regex found structured memories, return them
	if (imported.length > 0) {
		return imported
	}

	// Strip transport headers for downstream tiers
	const cleaned = text
		.replace(/^---.*---$/gm, '')
		.replace(/^Source:.*$/gm, '')
		.replace(/^Time:.*$/gm, '')
		.replace(/^Scope:.*$/gm, '')
		.replace(/^Count:.*$/gm, '')
		.replace(/^Memories:$/gm, '')
		.trim()

	if (cleaned.length === 0) {
		return imported
	}

	// Tier 3: LLM-assisted extraction (when available and text is non-trivial)
	if (options?.llmExtract && cleaned.length > 20) {
		try {
			const extracted = await options.llmExtract(cleaned)
			if (extracted.length > 0) {
				for (const mem of extracted) {
					const saved = await saveMemory({
						content: mem.content.slice(0, 2000),
						tags: mem.tags,
						kind: mem.kind,
						scope,
						source,
					})
					imported.push(saved)
				}
				return imported
			}
		} catch {
			// LLM extraction failed — fall through to raw fallback
		}
	}

	// Tier 4: Fallback — entire text as a single observation
	const saved = await saveMemory({
		content: cleaned.slice(0, 2000), // cap at 2k chars
		tags: ['imported'],
		kind: 'observation',
		scope: '*',
		source: { agent: 'user' },
	})
	imported.push(saved)

	return imported
}

/**
 * Import from a structured JSON packet.
 */
async function importFromPacket(packet: MemoryTransferPacket): Promise<Memory[]> {
	const imported: Memory[] = []

	for (const mem of packet.memories) {
		const saved = await saveMemory({
			content: mem.content,
			tags: mem.tags,
			kind: mem.kind,
			scope: mem.scope,
			source: mem.source,
			importance: mem.importance,
		})
		imported.push(saved)
	}

	return imported
}

/**
 * Export current memories for the given scope to clipboard.
 */
export async function exportToClipboard(
	scope?: string,
	format: 'text' | 'json' = 'text'
): Promise<string> {
	const memories = await recallMemories({
		scope,
		limit: 50,
	})

	const exported = format === 'json' ? exportAsJSON(memories) : exportAsText(memories)

	if (exported) {
		await navigator.clipboard.writeText(exported)
	}

	return exported
}

/**
 * Import memories from clipboard.
 */
export async function importFromClipboard(options?: ImportOptions): Promise<Memory[]> {
	const text = await navigator.clipboard.readText()
	if (!text.trim()) return []
	return importFromText(text, options)
}

// ---------------------------------------------------------------------------
// LLM-backed memory extraction
// ---------------------------------------------------------------------------

/**
 * System prompt for the LLM memory extractor.
 * Instructs the model to extract structured memories from arbitrary prose.
 */
const EXTRACT_SYSTEM_PROMPT = `You are a memory extraction assistant. Given unstructured text (notes, chat logs, articles, observations), extract distinct, actionable memories.

Each memory should be:
- A single, self-contained fact, preference, observation, or task outcome
- Concise (1-2 sentences max)
- Tagged with relevant keywords for later retrieval

Classify each memory as one of:
- observation: A fact or piece of information observed
- task_result: The outcome of a completed task
- user_preference: A user's stated preference or habit
- workflow_step: A step in a process or workflow

Extract as many distinct memories as the text supports. Do NOT fabricate information not present in the text.`

/**
 * Create an llmExtract function from an LLM client instance.
 *
 * This factory bridges the @page-agent/llms client to the ImportOptions.llmExtract
 * interface. It sends the unstructured text to the LLM with a tool that returns
 * an array of extracted memories.
 *
 * @example
 * ```ts
 * import { LLM } from '@page-agent/llms'
 * import { importFromText, createLLMMemoryExtractor } from './memory-transfer'
 *
 * const llm = new LLM({ baseURL: '...', apiKey: '...', model: 'gpt-4o-mini' })
 * const extractor = createLLMMemoryExtractor(llm)
 * const memories = await importFromText(messyText, { llmExtract: extractor })
 * ```
 */
export function createLLMMemoryExtractor(llm: {
	invoke: (
		messages: { role: string; content?: string | null }[],
		tools: Record<
			string,
			{ description?: string; inputSchema: any; execute: (args: any) => Promise<any> }
		>,
		abortSignal?: AbortSignal,
		options?: { toolChoiceName?: string }
	) => Promise<{ toolResult: any }>
}): (text: string) => Promise<ExtractedMemory[]> {
	// Lazy-load zod to avoid import cost when LLM extraction isn't used.
	// The extension already depends on zod via @page-agent/llms.
	return async (text: string): Promise<ExtractedMemory[]> => {
		const { z } = await import('zod/v4')

		const memorySchema = z.object({
			content: z.string().describe('The memory content (1-2 sentences)'),
			kind: z
				.enum(['observation', 'task_result', 'user_preference', 'workflow_step'])
				.describe('Semantic type of this memory'),
			tags: z.array(z.string()).describe('Keywords for retrieval (2-5 tags)'),
		})

		const extractTool = {
			description: 'Extract structured memories from the given text',
			inputSchema: z.object({
				memories: z.array(memorySchema).describe('Extracted memories'),
			}),
			execute: async (args: { memories: ExtractedMemory[] }) => args.memories,
		}

		const result = await llm.invoke(
			[
				{ role: 'system', content: EXTRACT_SYSTEM_PROMPT },
				{ role: 'user', content: `Extract memories from this text:\n\n${text}` },
			],
			{ ExtractMemories: extractTool },
			undefined,
			{ toolChoiceName: 'ExtractMemories' }
		)

		const memories = result.toolResult as ExtractedMemory[]
		if (!Array.isArray(memories)) return []

		// Validate each extracted memory has required fields
		return memories.filter(
			(m) =>
				typeof m.content === 'string' &&
				m.content.length > 0 &&
				typeof m.kind === 'string' &&
				Array.isArray(m.tags)
		)
	}
}
