/**
 * Memory Background Service — The Durability Hub
 *
 * The service worker is the backbone:
 * - Receives memory writes from content scripts and side panel
 * - Runs periodic consolidation via chrome.alarms
 * - Syncs high-value memories via chrome.storage.sync
 * - Prunes expired memories daily
 * - Requests persistent storage to prevent eviction
 *
 * All in-memory state is treated as ephemeral (service worker can die anytime).
 * IndexedDB is the source of truth, reopened per-operation.
 */
import {
	clearAllMemories,
	getMemoryCount,
	listAllMemories,
	pruneMemories,
	recallMemories,
	requestPersistentStorage,
	saveMemory,
} from './memory-store'
import type { Memory } from './memory-types'

// --- Alarm Names ---
const ALARM_CONSOLIDATE = 'page-agent-consolidate'
const ALARM_SYNC = 'page-agent-sync'
const ALARM_PRUNE = 'page-agent-prune'

/**
 * Initialize the memory durability hub.
 * Call this from the background service worker's defineBackground().
 */
export function initMemoryBackground(): void {
	// 1. Request persistent storage on install
	chrome.runtime.onInstalled.addListener(async () => {
		await requestPersistentStorage()
	})

	// 2. Set up periodic alarms (survive service worker restarts)
	chrome.runtime.onInstalled.addListener(() => {
		chrome.alarms.create(ALARM_CONSOLIDATE, { periodInMinutes: 30 })
		chrome.alarms.create(ALARM_SYNC, { periodInMinutes: 60 })
		chrome.alarms.create(ALARM_PRUNE, { periodInMinutes: 1440 }) // daily
	})

	// Also ensure alarms exist on startup (they persist, but be safe)
	chrome.alarms.get(ALARM_CONSOLIDATE, (alarm) => {
		if (!alarm) chrome.alarms.create(ALARM_CONSOLIDATE, { periodInMinutes: 30 })
	})

	// 3. Handle alarms
	chrome.alarms.onAlarm.addListener(async (alarm) => {
		switch (alarm.name) {
			case ALARM_CONSOLIDATE:
				await handleConsolidation()
				break
			case ALARM_SYNC:
				await syncHighValueMemories()
				break
			case ALARM_PRUNE:
				await pruneMemories()
				break
		}
	})

	// 4. Handle messages from content scripts and side panel
	chrome.runtime.onMessage.addListener(
		(
			message: any,
			_sender: chrome.runtime.MessageSender,
			sendResponse: (response?: any) => void
		): true | undefined => {
			if (message.type === 'MEMORY_WRITE') {
				saveMemory(message.payload)
					.then((memory) => sendResponse({ ok: true, memory }))
					.catch((err) => sendResponse({ ok: false, error: String(err) }))
				return true // keep channel open for async response
			}

			if (message.type === 'MEMORY_RECALL') {
				recallMemories(message.payload)
					.then((memories) => sendResponse({ memories }))
					.catch((err) => sendResponse({ memories: [], error: String(err) }))
				return true
			}

			if (message.type === 'MEMORY_LIST') {
				listAllMemories()
					.then((memories) => sendResponse({ memories }))
					.catch((err) => sendResponse({ memories: [], error: String(err) }))
				return true
			}

			if (message.type === 'MEMORY_COUNT') {
				getMemoryCount()
					.then((count) => sendResponse({ count }))
					.catch(() => sendResponse({ count: 0 }))
				return true
			}

			if (message.type === 'MEMORY_CLEAR') {
				clearAllMemories()
					.then(() => sendResponse({ ok: true }))
					.catch((err) => sendResponse({ ok: false, error: String(err) }))
				return true
			}

			// Not a memory message, don't handle
			return undefined
		}
	)

	// 5. Listen for chrome.storage.sync changes (cross-device sync)
	chrome.storage.onChanged.addListener((changes, area) => {
		if (area === 'sync' && changes.memories) {
			importSyncedMemories(changes.memories.newValue as any)
		}
	})

	console.log('[MemoryBackground] Durability hub initialized')
}

// --- Consolidation ---

async function handleConsolidation(): Promise<void> {
	// Use Web Locks to prevent concurrent consolidation across contexts
	if (navigator.locks) {
		await navigator.locks.request(
			'page-agent-consolidation',
			{ ifAvailable: true },
			async (lock) => {
				if (!lock) return
				// Consolidation requires an LLM — check if config is available
				const result = await chrome.storage.local.get('llmConfig')
				if (!result.llmConfig) return

				// For now, just log that consolidation would run.
				// Full consolidation requires importing the LLM module,
				// which is heavy for the service worker. Instead, we
				// trigger consolidation from the side panel when it's open.
				console.log('[MemoryBackground] Consolidation check — delegating to next side panel open')
			}
		)
	}
}

// --- Cross-Device Sync via chrome.storage.sync ---

/**
 * Sync high-value consolidated memories to chrome.storage.sync.
 * Aggressively compressed to fit within 100KB total limit.
 */
async function syncHighValueMemories(): Promise<void> {
	try {
		const memories = await recallMemories({
			consolidated: true,
			minImportance: 0.7,
			limit: 20,
		})

		if (memories.length === 0) return

		// Abbreviated keys to fit in 100KB total
		const serialized = memories.map((m) => ({
			i: m.id,
			c: m.content.slice(0, 300), // cap content
			s: m.scope,
			t: m.createdAt,
			p: m.importance,
			k: m.kind,
			h: m.contentHash,
		}))

		await chrome.storage.sync.set({ memories: serialized })
	} catch (err) {
		console.warn('[MemoryBackground] Sync failed:', err)
	}
}

/**
 * Import memories received from another device via chrome.storage.sync.
 */
async function importSyncedMemories(
	synced: { i: string; c: string; s: string; t: string; p: number; k: string; h: string }[]
): Promise<void> {
	if (!Array.isArray(synced)) return

	for (const m of synced) {
		try {
			await saveMemory({
				content: m.c,
				tags: ['synced'],
				kind: (m.k as Memory['kind']) || 'observation',
				scope: m.s || '*',
				source: { agent: 'page-agent' },
				importance: m.p ?? 0.5,
			})
		} catch {
			// Dedup will handle conflicts
		}
	}
}

// --- Page Lifecycle Durability ---

/**
 * Flush handler for visibilitychange events.
 * Call this from content scripts as a final save opportunity.
 */
export function setupVisibilityFlush(
	getBufferedMemories: () => Omit<
		Memory,
		'id' | 'createdAt' | 'contentHash' | 'consolidated' | 'importance'
	>[]
): void {
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') {
			const buffered = getBufferedMemories()
			for (const mem of buffered) {
				// Send to service worker (fire-and-forget)
				try {
					chrome.runtime.sendMessage({
						type: 'MEMORY_WRITE',
						payload: mem,
					})
				} catch {
					// Extension context may be invalid
				}
			}
		}
	})

	// Secondary safety net
	window.addEventListener('pagehide', () => {
		const buffered = getBufferedMemories()
		for (const mem of buffered) {
			try {
				chrome.runtime.sendMessage({
					type: 'MEMORY_WRITE',
					payload: mem,
				})
			} catch {
				// Extension context may be invalid
			}
		}
	})
}
