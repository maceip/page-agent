/**
 * Memory Transfer — Clipboard Bridge
 *
 * The universal interop layer. Export memories as human-readable text
 * that works in any chat interface, any clipboard, any note-taking app.
 * Import unstructured text and parse it back into structured memories.
 */
import { recallMemories, saveMemory } from './memory-store'
import type { Memory, MemorySource, MemoryTransferPacket } from './memory-types'

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
 */
export async function importFromText(text: string): Promise<Memory[]> {
	const imported: Memory[] = []

	// Try JSON first
	try {
		const parsed = JSON.parse(text)
		if (parsed.version === 1 && Array.isArray(parsed.memories)) {
			return await importFromPacket(parsed)
		}
	} catch {
		// Not JSON, try text format
	}

	// Parse text format
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

	// If no structured format found, treat entire text as a single observation
	if (imported.length === 0 && text.trim().length > 0) {
		const cleaned = text
			.replace(/^---.*---$/gm, '')
			.replace(/^Source:.*$/gm, '')
			.replace(/^Time:.*$/gm, '')
			.replace(/^Scope:.*$/gm, '')
			.replace(/^Count:.*$/gm, '')
			.replace(/^Memories:$/gm, '')
			.trim()

		if (cleaned.length > 0) {
			const saved = await saveMemory({
				content: cleaned.slice(0, 2000), // cap at 2k chars
				tags: ['imported'],
				kind: 'observation',
				scope: '*',
				source: { agent: 'user' },
			})
			imported.push(saved)
		}
	}

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
export async function importFromClipboard(): Promise<Memory[]> {
	const text = await navigator.clipboard.readText()
	if (!text.trim()) return []
	return importFromText(text)
}
