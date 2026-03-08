/**
 * Web-Native Agent Memory Store
 *
 * IndexedDB-backed persistence with:
 * - Content-hash deduplication
 * - Scope-based indexing for fast recall
 * - Consolidation tracking (one-way latch)
 * - Cross-tab coordination via BroadcastChannel
 * - Eviction protection via navigator.storage.persist()
 */
import { type DBSchema, type IDBPDatabase, openDB } from 'idb'

import type { Consolidation, Memory, RecallQuery } from './memory-types'

const MEMORY_DB_NAME = 'page-agent-memory'
const MEMORY_DB_VERSION = 1

interface MemoryDB extends DBSchema {
	memories: {
		key: string
		value: Memory
		indexes: {
			'by-created': string
			'by-scope': string
			'by-kind': string
			'by-tags': string
			'by-source': string
			'by-consolidated': number
			'by-content-hash': string
			'by-importance': number
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

let dbPromise: Promise<IDBPDatabase<MemoryDB>> | null = null

function getMemoryDB(): Promise<IDBPDatabase<MemoryDB>> {
	if (!dbPromise) {
		dbPromise = openDB<MemoryDB>(MEMORY_DB_NAME, MEMORY_DB_VERSION, {
			upgrade(db) {
				// Memories store
				if (!db.objectStoreNames.contains('memories')) {
					const memStore = db.createObjectStore('memories', { keyPath: 'id' })
					memStore.createIndex('by-created', 'createdAt')
					memStore.createIndex('by-scope', 'scope')
					memStore.createIndex('by-kind', 'kind')
					memStore.createIndex('by-tags', 'tags', { multiEntry: true })
					memStore.createIndex('by-source', 'source.agent' as any)
					memStore.createIndex('by-consolidated', 'consolidated' as any)
					memStore.createIndex('by-content-hash', 'contentHash', { unique: false })
					memStore.createIndex('by-importance', 'importance')
				}

				// Consolidations store
				if (!db.objectStoreNames.contains('consolidations')) {
					const conStore = db.createObjectStore('consolidations', { keyPath: 'id' })
					conStore.createIndex('by-scope', 'scope')
					conStore.createIndex('by-created', 'createdAt')
				}
			},
		})
	}
	return dbPromise
}

/**
 * Generate a deterministic content hash for deduplication.
 * Uses SHA-256 truncated to hex string.
 */
export async function contentHash(
	content: string,
	scope: string,
	sessionId?: string
): Promise<string> {
	const raw = `${content}|${scope}|${sessionId || ''}`
	const encoder = new TextEncoder()
	const data = encoder.encode(raw)
	const hashBuffer = await crypto.subtle.digest('SHA-256', data)
	const hashArray = Array.from(new Uint8Array(hashBuffer))
	return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Generate a short deterministic ID from the content hash.
 */
function hashToId(hash: string): string {
	return `mem_${hash.slice(0, 16)}`
}

// --- BroadcastChannel for cross-tab cache invalidation ---

const memoryChannel =
	typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('page-agent-memory') : null

export type MemoryEvent =
	| { type: 'memory-saved'; memory: Memory }
	| { type: 'memory-deleted'; id: string }
	| { type: 'memories-pruned'; count: number }
	| { type: 'consolidation-saved'; consolidation: Consolidation }

function broadcastMemoryEvent(event: MemoryEvent) {
	memoryChannel?.postMessage(event)
}

/** Subscribe to memory events from other tabs */
export function onMemoryEvent(handler: (event: MemoryEvent) => void): () => void {
	if (!memoryChannel) return () => {}
	const listener = (e: MessageEvent) => handler(e.data)
	memoryChannel.addEventListener('message', listener)
	return () => memoryChannel.removeEventListener('message', listener)
}

// --- Core Store Operations ---

/**
 * Save a memory. Deduplicates by content hash.
 * Returns the saved memory (existing one if duplicate).
 */
export async function saveMemory(
	input: Omit<Memory, 'id' | 'createdAt' | 'contentHash' | 'consolidated' | 'importance'> & {
		importance?: number
		consolidated?: boolean
	}
): Promise<Memory> {
	const db = await getMemoryDB()
	const hash = await contentHash(input.content, input.scope, input.source.sessionId)

	// Dedup: check if memory with same content hash already exists
	const existing = await db.getFromIndex('memories', 'by-content-hash', hash)
	if (existing) {
		return existing
	}

	const memory: Memory = {
		...input,
		id: hashToId(hash),
		contentHash: hash,
		createdAt: new Date().toISOString(),
		importance: input.importance ?? 0.5,
		consolidated: input.consolidated ?? false,
	}

	await db.put('memories', memory)
	broadcastMemoryEvent({ type: 'memory-saved', memory })
	return memory
}

/**
 * Recall memories matching a query.
 * Uses scope-based indexing + relevance scoring (not brute-force).
 */
export async function recallMemories(query: RecallQuery = {}): Promise<Memory[]> {
	const db = await getMemoryDB()
	let candidates: Memory[]

	if (query.scope) {
		// Scope-based retrieval: exact match + same-origin + wildcard
		const exact = await db.getAllFromIndex('memories', 'by-scope', query.scope)
		const wildcard = await db.getAllFromIndex('memories', 'by-scope', '*')

		// Same-origin match
		let sameOrigin: Memory[] = []
		try {
			const origin = new URL(query.scope).origin
			const all = await db.getAllFromIndex('memories', 'by-scope')
			sameOrigin = all.filter(
				(m) => m.scope !== query.scope && m.scope !== '*' && safeOrigin(m.scope) === origin
			)
		} catch {
			// invalid URL, skip origin matching
		}

		candidates = [...exact, ...sameOrigin, ...wildcard]
	} else {
		candidates = await db.getAll('memories')
	}

	// Filter by kind
	if (query.kind) {
		candidates = candidates.filter((m) => m.kind === query.kind)
	}

	// Filter by tags (intersection)
	if (query.tags && query.tags.length > 0) {
		candidates = candidates.filter((m) => query.tags!.every((tag) => m.tags.includes(tag)))
	}

	// Filter by max age
	if (query.maxAge) {
		const cutoff = Date.now() - query.maxAge
		candidates = candidates.filter((m) => Date.parse(m.createdAt) >= cutoff)
	}

	// Filter expired (TTL)
	candidates = candidates.filter((m) => {
		if (!m.ttl) return true
		return Date.now() - Date.parse(m.createdAt) < m.ttl
	})

	// Filter by consolidated flag
	if (query.consolidated !== undefined) {
		candidates = candidates.filter((m) => m.consolidated === query.consolidated)
	}

	// Filter by minimum importance
	if (query.minImportance !== undefined) {
		candidates = candidates.filter((m) => m.importance >= query.minImportance!)
	}

	// Full-text search
	if (query.search) {
		const lower = query.search.toLowerCase()
		candidates = candidates.filter(
			(m) =>
				m.content.toLowerCase().includes(lower) ||
				m.tags.some((t) => t.toLowerCase().includes(lower))
		)
	}

	// Deduplicate by ID (from multi-index hits)
	const seen = new Set<string>()
	candidates = candidates.filter((m) => {
		if (seen.has(m.id)) return false
		seen.add(m.id)
		return true
	})

	// Score and rank
	candidates.sort((a, b) => relevanceScore(b, query) - relevanceScore(a, query))

	return candidates.slice(0, query.limit ?? 10)
}

/**
 * Relevance scoring function.
 * Combines recency decay, scope match, importance, and consolidation bonus.
 */
function relevanceScore(memory: Memory, query: RecallQuery): number {
	const ageMs = Date.now() - Date.parse(memory.createdAt)
	const recencyDecay = Math.exp(-ageMs / (7 * 86400000)) // 7-day half-life

	let scopeMatch = 0.5
	if (query.scope) {
		if (memory.scope === query.scope) {
			scopeMatch = 1.0
		} else if (memory.scope === '*') {
			scopeMatch = 0.3
		} else {
			try {
				if (new URL(memory.scope).origin === new URL(query.scope).origin) {
					scopeMatch = 0.7
				} else {
					scopeMatch = 0.1
				}
			} catch {
				scopeMatch = 0.1
			}
		}
	}

	const importance = memory.importance ?? 0.5
	const consolidationBonus = memory.consolidated ? 0.1 : 0

	return recencyDecay * 0.3 + scopeMatch * 0.4 + importance * 0.2 + consolidationBonus
}

function safeOrigin(url: string): string | null {
	try {
		return new URL(url).origin
	} catch {
		return null
	}
}

/** Get unconsolidated memories for the consolidation loop */
export async function getUnconsolidated(limit = 10): Promise<Memory[]> {
	const db = await getMemoryDB()
	// IDB boolean index: false = 0, we want consolidated === false
	const all = await db.getAll('memories')
	return all
		.filter((m) => !m.consolidated)
		.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
		.slice(0, limit)
}

/** Save a consolidation and mark source memories as consolidated (atomic) */
export async function saveConsolidation(
	consolidation: Consolidation,
	sourceMemories: Memory[],
	connectionUpdates: { fromId: string; toId: string; relationship: string }[]
): Promise<void> {
	const db = await getMemoryDB()
	const tx = db.transaction(['memories', 'consolidations'], 'readwrite')

	// Save consolidation record
	await tx.objectStore('consolidations').add(consolidation)

	// Update connections on source memories and mark consolidated
	for (const mem of sourceMemories) {
		const existing = await tx.objectStore('memories').get(mem.id)
		if (!existing) continue

		// Add connections
		const newConnections = connectionUpdates
			.filter((c) => c.fromId === mem.id || c.toId === mem.id)
			.map((c) => ({
				linkedTo: c.fromId === mem.id ? c.toId : c.fromId,
				relationship: c.relationship,
			}))

		existing.connections = [...(existing.connections || []), ...newConnections]
		existing.consolidated = true
		existing.consolidatedInto = consolidation.id

		await tx.objectStore('memories').put(existing)
	}

	await tx.done
	broadcastMemoryEvent({ type: 'consolidation-saved', consolidation })
}

/** Get consolidation insights for a scope */
export async function getConsolidations(scope?: string): Promise<Consolidation[]> {
	const db = await getMemoryDB()
	if (scope) {
		try {
			const origin = new URL(scope).origin
			const all = await db.getAll('consolidations')
			return all.filter((c) => c.scope === origin || c.scope === scope)
		} catch {
			return db.getAllFromIndex('consolidations', 'by-scope', scope)
		}
	}
	return db.getAll('consolidations')
}

/** Recall memories + consolidation insights together */
export async function recallWithInsights(query: RecallQuery) {
	const [memories, insights] = await Promise.all([
		recallMemories(query),
		getConsolidations(query.scope),
	])
	return { memories, insights }
}

/** Delete a memory by ID */
export async function deleteMemory(id: string): Promise<void> {
	const db = await getMemoryDB()
	await db.delete('memories', id)
	broadcastMemoryEvent({ type: 'memory-deleted', id })
}

/** Get a single memory by ID */
export async function getMemory(id: string): Promise<Memory | undefined> {
	const db = await getMemoryDB()
	return db.get('memories', id)
}

/** List all memories, newest first */
export async function listAllMemories(): Promise<Memory[]> {
	const db = await getMemoryDB()
	const all = await db.getAll('memories')
	return all.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}

/** Get total memory count */
export async function getMemoryCount(): Promise<number> {
	const db = await getMemoryDB()
	return db.count('memories')
}

/** Prune expired and low-importance memories */
export async function pruneMemories(options?: {
	maxAge?: number
	minImportance?: number
}): Promise<number> {
	const db = await getMemoryDB()
	const all = await db.getAll('memories')
	const now = Date.now()
	let pruned = 0

	const tx = db.transaction('memories', 'readwrite')

	for (const memory of all) {
		const age = now - Date.parse(memory.createdAt)

		// Prune by TTL
		if (memory.ttl && age > memory.ttl) {
			await tx.objectStore('memories').delete(memory.id)
			pruned++
			continue
		}

		// Prune by max age (default 90 days for non-consolidated)
		const maxAge = options?.maxAge ?? 90 * 86400000
		if (!memory.consolidated && age > maxAge && memory.importance < 0.7) {
			await tx.objectStore('memories').delete(memory.id)
			pruned++
			continue
		}

		// Prune by minimum importance
		if (options?.minImportance && memory.importance < options.minImportance) {
			await tx.objectStore('memories').delete(memory.id)
			pruned++
		}
	}

	await tx.done

	if (pruned > 0) {
		broadcastMemoryEvent({ type: 'memories-pruned', count: pruned })
	}

	return pruned
}

/** Clear all memories and consolidations */
export async function clearAllMemories(): Promise<void> {
	const db = await getMemoryDB()
	const tx = db.transaction(['memories', 'consolidations'], 'readwrite')
	await tx.objectStore('memories').clear()
	await tx.objectStore('consolidations').clear()
	await tx.done
}

/** Request persistent storage to prevent browser eviction */
export async function requestPersistentStorage(): Promise<boolean> {
	if (navigator.storage?.persist) {
		return navigator.storage.persist()
	}
	return false
}

/** Check if storage is persistent */
export async function isStoragePersistent(): Promise<boolean> {
	if (navigator.storage?.persisted) {
		return navigator.storage.persisted()
	}
	return false
}

/** Get storage estimate */
export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
	if (navigator.storage?.estimate) {
		const est = await navigator.storage.estimate()
		return { usage: est.usage ?? 0, quota: est.quota ?? 0 }
	}
	return null
}
