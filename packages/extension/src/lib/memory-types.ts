/**
 * Web-Native Agent Memory — Type Definitions
 *
 * Memory is the universal context layer that survives page kills,
 * follows users across AI platforms, and syncs across devices.
 */

/** Where this memory was created */
export interface MemorySource {
	agent: string
	sessionId?: string
	url?: string
}

/** Bidirectional connection between memories */
export interface MemoryConnection {
	linkedTo: string
	relationship: string
}

/** A structured, portable unit of context */
export interface Memory {
	/** Deterministic ID: hash(content + scope + source.sessionId) */
	id: string
	/** What the agent learned / observed */
	content: string
	/** Structured tags for retrieval */
	tags: string[]
	/** Where this memory was created */
	source: MemorySource
	/** Semantic type */
	kind: 'observation' | 'task_result' | 'user_preference' | 'page_snapshot' | 'workflow_step'
	/** URL or context where this is relevant. '*' = global */
	scope: string
	/** ISO timestamp */
	createdAt: string
	/** Relevance decay — memories can expire (ms from creation) */
	ttl?: number

	// --- Durability fields (adapted from Google's always-on-memory-agent) ---

	/** 0-1 importance score, set at ingest, re-scored at consolidation */
	importance: number
	/** One-way latch: once consolidated, never re-consolidated */
	consolidated: boolean
	/** ID of the consolidation record that absorbed this memory */
	consolidatedInto?: string
	/** Bidirectional links to related memories */
	connections?: MemoryConnection[]
	/** Extracted entities (people, companies, concepts) */
	entities?: string[]
	/** Topic classification */
	topics?: string[]

	// --- Sync fields ---

	/** Last time this was pushed to chrome.storage.sync */
	syncedAt?: string
	/** Which device created this memory */
	deviceId?: string
	/** SHA-256 hash of content for dedup across devices */
	contentHash: string
}

/** Cross-memory synthesis record */
export interface Consolidation {
	id: string
	/** Memory IDs that were consolidated */
	sourceIds: string[]
	/** Synthesized summary */
	summary: string
	/** One key insight/pattern */
	insight: string
	/** Origin URL scope */
	scope: string
	/** ISO timestamp */
	createdAt: string
	/** Importance of the consolidated insight */
	importance: number
}

/** Query parameters for memory recall */
export interface RecallQuery {
	/** URL pattern match */
	scope?: string
	/** Tag intersection */
	tags?: string[]
	/** Filter by kind */
	kind?: Memory['kind']
	/** Max results */
	limit?: number
	/** Max age in ms */
	maxAge?: number
	/** Only consolidated memories */
	consolidated?: boolean
	/** Minimum importance threshold */
	minImportance?: number
	/** Full-text search in content */
	search?: string
}

/** Portable memory transfer format */
export interface MemoryTransferPacket {
	version: 1
	source: string
	exportedAt: string
	memories: {
		content: string
		tags: string[]
		kind: Memory['kind']
		scope: string
		source: MemorySource
		importance: number
		createdAt: string
	}[]
}
