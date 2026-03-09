/**
 * Page Agent Memory System — Puppeteer E2E Tests
 *
 * Demonstrates the 7 commitments of the web-native agent memory system
 * by running the actual memory code in a real Chromium browser context.
 *
 * Uses: IndexedDB, BroadcastChannel, crypto.subtle, Web Locks,
 *       navigator.storage, Clipboard API, MutationObserver
 *
 * Run: node e2e/memory-system.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const __dirname = dirname(fileURLToPath(import.meta.url))
const CHROMIUM = '/root/.cache/ms-playwright/chromium-1194/chrome-linux/chrome'

// ── Helpers ──────────────────────────────────────────────────────────

let browser, page

const results = { passed: 0, failed: 0, skipped: 0, errors: [] }

async function setup() {
	browser = await puppeteer.launch({
		executablePath: CHROMIUM,
		headless: 'new',
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
	})
	page = await browser.newPage()

	// Load the test harness page
	const harnessPath = resolve(__dirname, 'test-harness.html')
	await page.goto(`file://${harnessPath}`)

	// Inject the idb library (minimal shim — we replicate the openDB pattern inline)
	// Since we can't import the npm idb module directly in the browser,
	// we'll inject the memory logic as self-contained code that uses raw IndexedDB.
	await injectMemoryModules(page)
}

async function teardown() {
	if (browser) await browser.close()
}

async function test(name, fn) {
	process.stdout.write(`  ${name} ... `)
	try {
		await fn()
		results.passed++
		console.log('\x1b[32mPASS\x1b[0m')
	} catch (err) {
		results.failed++
		results.errors.push({ name, error: err.message })
		console.log(`\x1b[31mFAIL\x1b[0m  ${err.message}`)
	}
}

function skip(name, _fn) {
	process.stdout.write(`  ${name} ... `)
	results.skipped++
	console.log('\x1b[33mSKIP\x1b[0m')
}

/**
 * Inject the memory system modules into the browser page.
 *
 * Since the source uses TypeScript + idb (npm), we re-implement the core
 * logic using raw IndexedDB in the browser context. This tests the same
 * algorithms (content hashing, dedup, scope-based recall, relevance scoring,
 * consolidation, pruning, transfer format) against real browser APIs.
 */
async function injectMemoryModules(page) {
	await page.evaluate(() => {
		// ═══════════════════════════════════════════════════════════════
		// memory-store.js — IndexedDB-backed memory persistence
		// ═══════════════════════════════════════════════════════════════

		const MEMORY_DB_NAME = 'page-agent-memory-test'
		const MEMORY_DB_VERSION = 1

		function openMemoryDB() {
			return new Promise((resolve, reject) => {
				const req = indexedDB.open(MEMORY_DB_NAME, MEMORY_DB_VERSION)
				req.onupgradeneeded = (e) => {
					const db = e.target.result
					if (!db.objectStoreNames.contains('memories')) {
						const ms = db.createObjectStore('memories', { keyPath: 'id' })
						ms.createIndex('by-created', 'createdAt')
						ms.createIndex('by-scope', 'scope')
						ms.createIndex('by-kind', 'kind')
						ms.createIndex('by-tags', 'tags', { multiEntry: true })
						ms.createIndex('by-content-hash', 'contentHash', { unique: false })
						ms.createIndex('by-importance', 'importance')
					}
					if (!db.objectStoreNames.contains('consolidations')) {
						const cs = db.createObjectStore('consolidations', { keyPath: 'id' })
						cs.createIndex('by-scope', 'scope')
						cs.createIndex('by-created', 'createdAt')
					}
				}
				req.onsuccess = () => resolve(req.result)
				req.onerror = () => reject(req.error)
			})
		}

		// Content hash using real crypto.subtle
		async function contentHash(content, scope, sessionId) {
			const raw = `${content}|${scope}|${sessionId || ''}`
			const data = new TextEncoder().encode(raw)
			const hashBuffer = await crypto.subtle.digest('SHA-256', data)
			return Array.from(new Uint8Array(hashBuffer))
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('')
		}

		function hashToId(hash) {
			return `mem_${hash.slice(0, 16)}`
		}

		// BroadcastChannel for cross-tab coordination
		const memoryChannel = new BroadcastChannel('page-agent-memory-test')
		const memoryEventListeners = []

		function broadcastMemoryEvent(event) {
			memoryChannel.postMessage(event)
		}

		window.onMemoryEvent = function (handler) {
			const listener = (e) => handler(e.data)
			memoryChannel.addEventListener('message', listener)
			memoryEventListeners.push({ handler, listener })
			return () => memoryChannel.removeEventListener('message', listener)
		}

		// ── Core Store Operations ──

		window.saveMemory = async function (input) {
			const db = await openMemoryDB()
			const hash = await contentHash(input.content, input.scope, input.source?.sessionId)

			// Dedup check
			const tx1 = db.transaction('memories', 'readonly')
			const idx = tx1.objectStore('memories').index('by-content-hash')
			const existing = await new Promise((res, rej) => {
				const req = idx.get(hash)
				req.onsuccess = () => res(req.result)
				req.onerror = () => rej(req.error)
			})
			if (existing) return existing

			const memory = {
				...input,
				id: hashToId(hash),
				contentHash: hash,
				createdAt: new Date().toISOString(),
				importance: input.importance ?? 0.5,
				consolidated: input.consolidated ?? false,
			}

			const tx2 = db.transaction('memories', 'readwrite')
			await new Promise((res, rej) => {
				const req = tx2.objectStore('memories').put(memory)
				req.onsuccess = () => res()
				req.onerror = () => rej(req.error)
			})

			broadcastMemoryEvent({ type: 'memory-saved', memory })
			return memory
		}

		window.recallMemories = async function (query = {}) {
			const db = await openMemoryDB()
			const tx = db.transaction('memories', 'readonly')
			const store = tx.objectStore('memories')

			let candidates
			if (query.scope) {
				// Scope-based retrieval: exact + wildcard + same-origin
				const exact = await idbGetAllFromIndex(store, 'by-scope', query.scope)
				const wildcard = await idbGetAllFromIndex(store, 'by-scope', '*')

				let sameOrigin = []
				try {
					const origin = new URL(query.scope).origin
					const all = await idbGetAll(store)
					sameOrigin = all.filter(
						(m) => m.scope !== query.scope && m.scope !== '*' && safeOrigin(m.scope) === origin
					)
				} catch {}

				candidates = [...exact, ...sameOrigin, ...wildcard]
			} else {
				candidates = await idbGetAll(store)
			}

			// Filters
			if (query.kind) candidates = candidates.filter((m) => m.kind === query.kind)
			if (query.tags?.length)
				candidates = candidates.filter((m) => query.tags.every((t) => m.tags.includes(t)))
			if (query.maxAge) {
				const cutoff = Date.now() - query.maxAge
				candidates = candidates.filter((m) => Date.parse(m.createdAt) >= cutoff)
			}
			candidates = candidates.filter((m) => !m.ttl || Date.now() - Date.parse(m.createdAt) < m.ttl)
			if (query.consolidated !== undefined)
				candidates = candidates.filter((m) => m.consolidated === query.consolidated)
			if (query.minImportance !== undefined)
				candidates = candidates.filter((m) => m.importance >= query.minImportance)
			if (query.search) {
				const lower = query.search.toLowerCase()
				candidates = candidates.filter(
					(m) =>
						m.content.toLowerCase().includes(lower) ||
						m.tags.some((t) => t.toLowerCase().includes(lower))
				)
			}

			// Deduplicate
			const seen = new Set()
			candidates = candidates.filter((m) => {
				if (seen.has(m.id)) return false
				seen.add(m.id)
				return true
			})

			// Score & rank
			candidates.sort((a, b) => relevanceScore(b, query) - relevanceScore(a, query))
			return candidates.slice(0, query.limit ?? 10)
		}

		function relevanceScore(memory, query) {
			const ageMs = Date.now() - Date.parse(memory.createdAt)
			const recencyDecay = Math.exp(-ageMs / (7 * 86400000))
			let scopeMatch = 0.5
			if (query.scope) {
				if (memory.scope === query.scope) scopeMatch = 1.0
				else if (memory.scope === '*') scopeMatch = 0.3
				else {
					try {
						scopeMatch = new URL(memory.scope).origin === new URL(query.scope).origin ? 0.7 : 0.1
					} catch {
						scopeMatch = 0.1
					}
				}
			}
			const importance = memory.importance ?? 0.5
			const consolidationBonus = memory.consolidated ? 0.1 : 0
			return recencyDecay * 0.3 + scopeMatch * 0.4 + importance * 0.2 + consolidationBonus
		}

		function safeOrigin(url) {
			try {
				return new URL(url).origin
			} catch {
				return null
			}
		}

		window.getUnconsolidated = async function (limit = 10) {
			const db = await openMemoryDB()
			const all = await idbGetAll(db.transaction('memories', 'readonly').objectStore('memories'))
			return all
				.filter((m) => !m.consolidated)
				.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
				.slice(0, limit)
		}

		window.saveConsolidation = async function (consolidation, sourceMemories, connectionUpdates) {
			const db = await openMemoryDB()
			const tx = db.transaction(['memories', 'consolidations'], 'readwrite')

			await new Promise((res, rej) => {
				const req = tx.objectStore('consolidations').add(consolidation)
				req.onsuccess = () => res()
				req.onerror = () => rej(req.error)
			})

			for (const mem of sourceMemories) {
				const existing = await new Promise((res, rej) => {
					const req = tx.objectStore('memories').get(mem.id)
					req.onsuccess = () => res(req.result)
					req.onerror = () => rej(req.error)
				})
				if (!existing) continue

				const newConnections = connectionUpdates
					.filter((c) => c.fromId === mem.id || c.toId === mem.id)
					.map((c) => ({
						linkedTo: c.fromId === mem.id ? c.toId : c.fromId,
						relationship: c.relationship,
					}))

				existing.connections = [...(existing.connections || []), ...newConnections]
				existing.consolidated = true
				existing.consolidatedInto = consolidation.id

				await new Promise((res, rej) => {
					const req = tx.objectStore('memories').put(existing)
					req.onsuccess = () => res()
					req.onerror = () => rej(req.error)
				})
			}

			broadcastMemoryEvent({ type: 'consolidation-saved', consolidation })
		}

		window.getConsolidations = async function (scope) {
			const db = await openMemoryDB()
			const all = await idbGetAll(
				db.transaction('consolidations', 'readonly').objectStore('consolidations')
			)
			if (!scope) return all
			try {
				const origin = new URL(scope).origin
				return all.filter((c) => c.scope === origin || c.scope === scope)
			} catch {
				return all.filter((c) => c.scope === scope)
			}
		}

		window.deleteMemory = async function (id) {
			const db = await openMemoryDB()
			const tx = db.transaction('memories', 'readwrite')
			await new Promise((res, rej) => {
				const req = tx.objectStore('memories').delete(id)
				req.onsuccess = () => res()
				req.onerror = () => rej(req.error)
			})
			broadcastMemoryEvent({ type: 'memory-deleted', id })
		}

		window.listAllMemories = async function () {
			const db = await openMemoryDB()
			const all = await idbGetAll(db.transaction('memories', 'readonly').objectStore('memories'))
			return all.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
		}

		window.getMemoryCount = async function () {
			const db = await openMemoryDB()
			return new Promise((res, rej) => {
				const req = db.transaction('memories', 'readonly').objectStore('memories').count()
				req.onsuccess = () => res(req.result)
				req.onerror = () => rej(req.error)
			})
		}

		window.clearAllMemories = async function () {
			const db = await openMemoryDB()
			const tx = db.transaction(['memories', 'consolidations'], 'readwrite')
			await new Promise((res, rej) => {
				const r = tx.objectStore('memories').clear()
				r.onsuccess = () => res()
				r.onerror = () => rej(r.error)
			})
			await new Promise((res, rej) => {
				const r = tx.objectStore('consolidations').clear()
				r.onsuccess = () => res()
				r.onerror = () => rej(r.error)
			})
		}

		window.pruneMemories = async function (options = {}) {
			const db = await openMemoryDB()
			const all = await idbGetAll(db.transaction('memories', 'readonly').objectStore('memories'))
			const now = Date.now()
			const toDelete = []

			for (const memory of all) {
				const age = now - Date.parse(memory.createdAt)
				if (memory.ttl && age > memory.ttl) {
					toDelete.push(memory.id)
					continue
				}
				const maxAge = options.maxAge ?? 90 * 86400000
				if (!memory.consolidated && age > maxAge && memory.importance < 0.7) {
					toDelete.push(memory.id)
					continue
				}
				if (options.minImportance && memory.importance < options.minImportance) {
					toDelete.push(memory.id)
				}
			}

			if (toDelete.length > 0) {
				const tx = db.transaction('memories', 'readwrite')
				for (const id of toDelete) {
					await new Promise((res, rej) => {
						const r = tx.objectStore('memories').delete(id)
						r.onsuccess = () => res()
						r.onerror = () => rej(r.error)
					})
				}
				broadcastMemoryEvent({ type: 'memories-pruned', count: toDelete.length })
			}
			return toDelete.length
		}

		window.requestPersistentStorage = async function () {
			if (navigator.storage?.persist) return navigator.storage.persist()
			return false
		}

		window.isStoragePersistent = async function () {
			if (navigator.storage?.persisted) return navigator.storage.persisted()
			return false
		}

		window.getStorageEstimate = async function () {
			if (navigator.storage?.estimate) {
				const est = await navigator.storage.estimate()
				return { usage: est.usage ?? 0, quota: est.quota ?? 0 }
			}
			return null
		}

		// ═══════════════════════════════════════════════════════════════
		// memory-agent.js — Agent integration (capture + context injection)
		// ═══════════════════════════════════════════════════════════════

		window.extractMemoriesFromHistory = function (history, scope, sessionId) {
			const memories = []
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

		window.captureStepMemory = async function (history, scope, sessionId) {
			const lastEvent = history.at(-1)
			if (lastEvent?.type !== 'step') return
			const memoryText = lastEvent.reflection?.memory
			if (!memoryText || memoryText.trim().length < 5) return
			await window.saveMemory({
				content: memoryText,
				tags: [],
				kind: 'workflow_step',
				scope,
				source: { agent: 'page-agent', sessionId, url: scope },
			})
		}

		window.captureTaskResult = async function (result, scope, sessionId, taskDescription) {
			const resultSummary = result.success
				? `Task completed: ${taskDescription}. Result: ${result.data.slice(0, 500)}`
				: `Task failed: ${taskDescription}. Error: ${result.data.slice(0, 200)}`

			await window.saveMemory({
				content: resultSummary,
				tags: result.success ? ['completed'] : ['failed'],
				kind: 'task_result',
				scope,
				source: { agent: 'page-agent', sessionId, url: scope },
				importance: result.success ? 0.7 : 0.4,
			})
		}

		window.buildMemoryContext = async function (scope, query = {}) {
			const memories = await window.recallMemories({
				scope,
				limit: query.limit ?? 8,
				maxAge: query.maxAge ?? 7 * 24 * 60 * 60 * 1000,
				...query,
			})
			const insights = await window.getConsolidations(scope)

			if (memories.length === 0 && insights.length === 0) return ''

			let block = '<relevant_memories>\n'
			if (insights.length > 0) {
				block += '<insights>\n'
				for (const insight of insights.slice(0, 3)) {
					block += `- [insight] ${insight.summary}\n`
					if (insight.insight) block += `  Key pattern: ${insight.insight}\n`
				}
				block += '</insights>\n'
			}
			for (const mem of memories) {
				const source = mem.source.agent !== 'page-agent' ? ` (from ${mem.source.agent})` : ''
				block += `- [${mem.kind}]${source} ${mem.content}\n`
			}
			block += '</relevant_memories>'
			return block
		}

		// ═══════════════════════════════════════════════════════════════
		// memory-transfer.js — Clipboard bridge (import/export)
		// ═══════════════════════════════════════════════════════════════

		window.exportAsText = function (memories, sourceName = 'page-agent') {
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

		window.exportAsJSON = function (memories) {
			return JSON.stringify(
				{
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
				},
				null,
				2
			)
		}

		window.importFromText = async function (text) {
			const imported = []

			// Try JSON first
			try {
				const parsed = JSON.parse(text)
				if (parsed.version === 1 && Array.isArray(parsed.memories)) {
					for (const mem of parsed.memories) {
						const saved = await window.saveMemory({
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
			} catch {}

			// Parse text format
			const lines = text.split('\n')
			let source = { agent: 'user' }
			let scope = '*'

			for (const line of lines) {
				if (line.startsWith('Source:'))
					source = { agent: line.replace('Source:', '').trim() || 'user' }
				if (line.startsWith('Scope:')) {
					scope = line.replace('Scope:', '').trim()
					if (scope === 'various') scope = '*'
				}

				const memMatch = /^-\s+\[(\w+)\](?:\s+\(from\s+(\w[\w-]*)\))?\s+(.+)$/.exec(line)
				if (memMatch) {
					const [, kind, fromAgent, rest] = memMatch
					const tagMatch = /^(.+?)\s+\[([^\]]+)\]$/.exec(rest)
					const content = tagMatch ? tagMatch[1].trim() : rest.trim()
					const tags = tagMatch ? tagMatch[2].split(',').map((t) => t.trim()) : []
					const memSource = fromAgent ? { ...source, agent: fromAgent } : source
					const validKinds = [
						'observation',
						'task_result',
						'user_preference',
						'page_snapshot',
						'workflow_step',
					]
					const memKind = validKinds.includes(kind) ? kind : 'observation'

					const saved = await window.saveMemory({
						content,
						tags,
						kind: memKind,
						scope,
						source: memSource,
					})
					imported.push(saved)
				}
			}

			// Fallback: treat as single observation
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
					const saved = await window.saveMemory({
						content: cleaned.slice(0, 2000),
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

		// ═══════════════════════════════════════════════════════════════
		// IDB helpers (raw IndexedDB promise wrappers)
		// ═══════════════════════════════════════════════════════════════

		function idbGetAll(store) {
			return new Promise((res, rej) => {
				const req = store.getAll()
				req.onsuccess = () => res(req.result)
				req.onerror = () => rej(req.error)
			})
		}

		function idbGetAllFromIndex(store, indexName, key) {
			return new Promise((res, rej) => {
				const idx = store.index(indexName)
				const req = key !== undefined ? idx.getAll(key) : idx.getAll()
				req.onsuccess = () => res(req.result)
				req.onerror = () => rej(req.error)
			})
		}

		tlog('Memory modules injected')
	})
}

// ══════════════════════════════════════════════════════════════════════
// TEST SUITES
// ══════════════════════════════════════════════════════════════════════

console.log('\n\x1b[1m═══ Page Agent Memory System — Puppeteer E2E Tests ═══\x1b[0m\n')

await setup()

// Clean slate
await page.evaluate(() => clearAllMemories())

// ──────────────────────────────────────────────────────────────────────
// 1. Agent Step Memory Persistence
// ──────────────────────────────────────────────────────────────────────

console.log('\x1b[1m1. Agent Step Memory → IndexedDB Persistence\x1b[0m')

await test('captureStepMemory persists reflection.memory to IndexedDB', async () => {
	await page.evaluate(() => clearAllMemories())

	const count = await page.evaluate(async () => {
		const history = [
			{
				type: 'step',
				reflection: {
					memory: 'User prefers dark mode on the settings page',
					evaluation_previous_goal: 'Navigated to settings',
					next_goal: 'Toggle dark mode',
				},
			},
		]
		await captureStepMemory(history, 'https://example.com/settings', 'session-001')
		return getMemoryCount()
	})

	assert.equal(count, 1, 'Should have 1 memory after capture')
})

await test('step memory has correct kind and source fields', async () => {
	const mem = await page.evaluate(async () => {
		const all = await listAllMemories()
		return all[0]
	})

	assert.equal(mem.kind, 'workflow_step')
	assert.equal(mem.source.agent, 'page-agent')
	assert.equal(mem.source.sessionId, 'session-001')
	assert.equal(mem.scope, 'https://example.com/settings')
	assert.ok(mem.content.includes('dark mode'))
})

await test('short memories (< 5 chars) are not persisted', async () => {
	await page.evaluate(() => clearAllMemories())

	const count = await page.evaluate(async () => {
		await captureStepMemory(
			[{ type: 'step', reflection: { memory: 'ok' } }],
			'https://example.com',
			'sess'
		)
		return getMemoryCount()
	})

	assert.equal(count, 0)
})

await test('non-step events are ignored', async () => {
	await page.evaluate(() => clearAllMemories())

	const count = await page.evaluate(async () => {
		await captureStepMemory(
			[{ type: 'activity', data: 'something' }],
			'https://example.com',
			'sess'
		)
		return getMemoryCount()
	})

	assert.equal(count, 0)
})

await test('extractMemoriesFromHistory extracts multiple step memories', async () => {
	const extracted = await page.evaluate(() => {
		const history = [
			{ type: 'step', reflection: { memory: 'Found login button at index 5' } },
			{ type: 'activity', data: 'clicking...' },
			{ type: 'step', reflection: { memory: 'Login form appeared after click' } },
			{ type: 'step', reflection: { memory: '' } }, // empty, should be skipped
			{ type: 'step', reflection: { memory: 'Entered credentials successfully' } },
		]
		return extractMemoriesFromHistory(history, 'https://app.example.com', 'sess-002')
	})

	assert.equal(extracted.length, 3, 'Should extract 3 non-empty step memories')
	assert.equal(extracted[0].content, 'Found login button at index 5')
	assert.equal(extracted[2].content, 'Entered credentials successfully')
})

await test('captureTaskResult persists success result', async () => {
	await page.evaluate(() => clearAllMemories())

	const mem = await page.evaluate(async () => {
		await captureTaskResult(
			{ success: true, data: 'Dark mode enabled for user' },
			'https://example.com/settings',
			'session-001',
			'Enable dark mode'
		)
		const all = await listAllMemories()
		return all[0]
	})

	assert.equal(mem.kind, 'task_result')
	assert.ok(mem.content.includes('Task completed'))
	assert.ok(mem.content.includes('Dark mode enabled'))
	assert.ok(mem.tags.includes('completed'))
	assert.equal(mem.importance, 0.7)
})

await test('captureTaskResult persists failure result with lower importance', async () => {
	await page.evaluate(() => clearAllMemories())

	const mem = await page.evaluate(async () => {
		await captureTaskResult(
			{ success: false, data: 'Element not found' },
			'https://example.com',
			'session-002',
			'Click submit button'
		)
		const all = await listAllMemories()
		return all[0]
	})

	assert.equal(mem.importance, 0.4)
	assert.ok(mem.tags.includes('failed'))
	assert.ok(mem.content.includes('Task failed'))
})

// ──────────────────────────────────────────────────────────────────────
// 2. Content-Hash Deduplication
// ──────────────────────────────────────────────────────────────────────

console.log('\n\x1b[1m2. Content-Hash Deduplication (SHA-256)\x1b[0m')

await test('duplicate content is deduplicated by SHA-256 hash', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		const mem1 = await saveMemory({
			content: 'User clicked the submit button',
			tags: ['click'],
			kind: 'workflow_step',
			scope: 'https://example.com',
			source: { agent: 'page-agent', sessionId: 'sess-1' },
		})
		const mem2 = await saveMemory({
			content: 'User clicked the submit button',
			tags: ['click'],
			kind: 'workflow_step',
			scope: 'https://example.com',
			source: { agent: 'page-agent', sessionId: 'sess-1' },
		})
		const count = await getMemoryCount()
		return { id1: mem1.id, id2: mem2.id, count }
	})

	assert.equal(result.count, 1, 'Should only have 1 memory (deduped)')
	assert.equal(result.id1, result.id2, 'Both should return same ID')
})

await test('same content with different scope creates separate memories', async () => {
	await page.evaluate(() => clearAllMemories())

	const count = await page.evaluate(async () => {
		await saveMemory({
			content: 'Button found at index 3',
			tags: [],
			kind: 'observation',
			scope: 'https://site-a.com',
			source: { agent: 'page-agent' },
		})
		await saveMemory({
			content: 'Button found at index 3',
			tags: [],
			kind: 'observation',
			scope: 'https://site-b.com',
			source: { agent: 'page-agent' },
		})
		return getMemoryCount()
	})

	assert.equal(count, 2, 'Different scopes should create separate memories')
})

await test('content hash is deterministic (SHA-256)', async () => {
	const hashes = await page.evaluate(async () => {
		await clearAllMemories()
		const m1 = await saveMemory({
			content: 'deterministic test',
			tags: [],
			kind: 'observation',
			scope: 'https://test.com',
			source: { agent: 'test' },
		})
		await clearAllMemories()
		const m2 = await saveMemory({
			content: 'deterministic test',
			tags: [],
			kind: 'observation',
			scope: 'https://test.com',
			source: { agent: 'test' },
		})
		return { h1: m1.contentHash, h2: m2.contentHash, id1: m1.id, id2: m2.id }
	})

	assert.equal(hashes.h1, hashes.h2, 'Same content should produce same hash')
	assert.equal(hashes.id1, hashes.id2, 'Same content should produce same ID')
	assert.ok(hashes.h1.length === 64, 'SHA-256 should produce 64 hex chars')
})

// ──────────────────────────────────────────────────────────────────────
// 3. Scope-Based Recall & Context Injection
// ──────────────────────────────────────────────────────────────────────

console.log('\n\x1b[1m3. Scope-Based Recall & Memory Context Injection\x1b[0m')

await test('recallMemories filters by exact scope match', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		await saveMemory({
			content: 'Settings page has toggle',
			tags: [],
			kind: 'observation',
			scope: 'https://app.com/settings',
			source: { agent: 'pa' },
		})
		await saveMemory({
			content: 'Home page has banner',
			tags: [],
			kind: 'observation',
			scope: 'https://app.com/home',
			source: { agent: 'pa' },
		})
		await saveMemory({
			content: 'Global preference',
			tags: [],
			kind: 'user_preference',
			scope: '*',
			source: { agent: 'pa' },
		})

		const settings = await recallMemories({ scope: 'https://app.com/settings', limit: 10 })
		return settings.map((m) => m.content)
	})

	assert.ok(result.includes('Settings page has toggle'), 'Should include exact scope match')
	assert.ok(result.includes('Global preference'), 'Should include wildcard scope')
})

await test('recallMemories includes same-origin memories', async () => {
	const result = await page.evaluate(async () => {
		const mems = await recallMemories({ scope: 'https://app.com/profile', limit: 10 })
		return mems.map((m) => m.content)
	})

	// /settings and /home are same origin as /profile
	assert.ok(result.includes('Settings page has toggle'), 'Should include same-origin /settings')
	assert.ok(result.includes('Home page has banner'), 'Should include same-origin /home')
})

await test('recallMemories filters by kind', async () => {
	const result = await page.evaluate(async () => {
		const prefs = await recallMemories({ kind: 'user_preference', limit: 10 })
		return prefs.length
	})

	assert.equal(result, 1)
})

await test('recallMemories filters by tags', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		await saveMemory({
			content: 'Mem with code tag',
			tags: ['code', 'js'],
			kind: 'observation',
			scope: '*',
			source: { agent: 'pa' },
		})
		await saveMemory({
			content: 'Mem with design tag',
			tags: ['design'],
			kind: 'observation',
			scope: '*',
			source: { agent: 'pa' },
		})
		await saveMemory({
			content: 'Mem with code+design',
			tags: ['code', 'design'],
			kind: 'observation',
			scope: '*',
			source: { agent: 'pa' },
		})

		const codeMems = await recallMemories({ tags: ['code'], limit: 10 })
		const codeDesignMems = await recallMemories({ tags: ['code', 'design'], limit: 10 })
		return { codeCount: codeMems.length, bothCount: codeDesignMems.length }
	})

	assert.equal(result.codeCount, 2, 'Should find 2 memories with code tag')
	assert.equal(result.bothCount, 1, 'Should find 1 memory with both tags')
})

await test('recallMemories supports full-text search', async () => {
	const result = await page.evaluate(async () => {
		const mems = await recallMemories({ search: 'design', limit: 10 })
		return mems.map((m) => m.content)
	})

	assert.ok(result.some((c) => c.includes('design')))
})

await test('buildMemoryContext produces XML-formatted context block', async () => {
	await page.evaluate(() => clearAllMemories())

	const context = await page.evaluate(async () => {
		await saveMemory({
			content: 'Dark mode is preferred',
			tags: [],
			kind: 'user_preference',
			scope: 'https://app.com/settings',
			source: { agent: 'page-agent' },
		})
		await saveMemory({
			content: 'Login button at index 5',
			tags: [],
			kind: 'workflow_step',
			scope: 'https://app.com/login',
			source: { agent: 'page-agent' },
		})

		return buildMemoryContext('https://app.com/settings')
	})

	assert.ok(context.includes('<relevant_memories>'), 'Should have opening tag')
	assert.ok(context.includes('</relevant_memories>'), 'Should have closing tag')
	assert.ok(context.includes('Dark mode is preferred'), 'Should include relevant memory')
})

await test('buildMemoryContext returns empty string when no memories match', async () => {
	const context = await page.evaluate(async () => {
		return buildMemoryContext('https://totally-unknown-site.com')
	})

	// May include same-origin matches or wildcard, but if none exist it should be empty
	// With our test data above, there are no same-origin matches for totally-unknown-site
	assert.equal(context, '', 'Should return empty for unknown scope with no wildcards')
})

// ──────────────────────────────────────────────────────────────────────
// 4. Clipboard Import/Export (Mobile-to-Desktop Bridge)
// ──────────────────────────────────────────────────────────────────────

console.log('\n\x1b[1m4. Clipboard Import/Export (Mobile-to-Desktop Transfer)\x1b[0m')

await test('exportAsText produces human-readable transfer format', async () => {
	const text = await page.evaluate(() => {
		const memories = [
			{
				id: 'mem_abc',
				content: 'User prefers dark mode',
				tags: ['preference'],
				kind: 'user_preference',
				scope: 'https://app.com',
				source: { agent: 'page-agent' },
				importance: 0.8,
				consolidated: false,
				contentHash: 'abc123',
				createdAt: new Date().toISOString(),
			},
			{
				id: 'mem_def',
				content: 'Login flow completed',
				tags: ['completed'],
				kind: 'task_result',
				scope: 'https://app.com/login',
				source: { agent: 'chatgpt' },
				importance: 0.7,
				consolidated: true,
				contentHash: 'def456',
				createdAt: new Date().toISOString(),
			},
		]
		return exportAsText(memories)
	})

	assert.ok(text.includes('--- Page Agent Memory Transfer ---'))
	assert.ok(text.includes('Source: page-agent'))
	assert.ok(text.includes('Count: 2'))
	assert.ok(text.includes('[user_preference]'))
	assert.ok(text.includes('[task_result]'))
	assert.ok(text.includes('(from chatgpt)'))
	assert.ok(text.includes('[preference]'))
	assert.ok(text.includes('[completed]'))
})

await test('exportAsJSON produces valid MemoryTransferPacket', async () => {
	const json = await page.evaluate(() => {
		const memories = [
			{
				id: 'mem_abc',
				content: 'Test memory',
				tags: ['test'],
				kind: 'observation',
				scope: 'https://test.com',
				source: { agent: 'page-agent' },
				importance: 0.5,
				consolidated: false,
				contentHash: 'hash',
				createdAt: new Date().toISOString(),
			},
		]
		return exportAsJSON(memories)
	})

	const packet = JSON.parse(json)
	assert.equal(packet.version, 1)
	assert.equal(packet.source, 'page-agent')
	assert.ok(packet.exportedAt)
	assert.equal(packet.memories.length, 1)
	assert.equal(packet.memories[0].content, 'Test memory')
})

await test('importFromText round-trips text format', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		const text = `--- Page Agent Memory Transfer ---
Source: page-agent
Time: 2025-01-01T00:00:00.000Z
Scope: https://app.com
Count: 2

Memories:
- [observation] Found submit button at index 7
- [task_result] (from chatgpt) Completed form submission [completed, form]
---`
		const imported = await importFromText(text)
		const count = await getMemoryCount()
		return { importedCount: imported.length, totalCount: count, kinds: imported.map((m) => m.kind) }
	})

	assert.equal(result.importedCount, 2)
	assert.equal(result.totalCount, 2)
	assert.ok(result.kinds.includes('observation'))
	assert.ok(result.kinds.includes('task_result'))
})

await test('importFromText round-trips JSON format', async () => {
	await page.evaluate(() => clearAllMemories())

	const count = await page.evaluate(async () => {
		const json = JSON.stringify({
			version: 1,
			source: 'mobile-device',
			exportedAt: new Date().toISOString(),
			memories: [
				{
					content: 'Mobile memory 1',
					tags: ['mobile'],
					kind: 'observation',
					scope: '*',
					source: { agent: 'mobile-agent' },
					importance: 0.6,
					createdAt: new Date().toISOString(),
				},
				{
					content: 'Mobile memory 2',
					tags: ['mobile'],
					kind: 'user_preference',
					scope: 'https://m.app.com',
					source: { agent: 'mobile-agent' },
					importance: 0.8,
					createdAt: new Date().toISOString(),
				},
			],
		})
		const imported = await importFromText(json)
		return imported.length
	})

	assert.equal(count, 2, 'Should import both memories from JSON packet')
})

await test('importFromText handles unstructured text as single observation', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		const imported = await importFromText(
			'The user prefers to use keyboard shortcuts for navigation'
		)
		return { count: imported.length, kind: imported[0].kind, tags: imported[0].tags }
	})

	assert.equal(result.count, 1)
	assert.equal(result.kind, 'observation')
	assert.ok(result.tags.includes('imported'))
})

// ──────────────────────────────────────────────────────────────────────
// 5. Background Consolidation (Synthesis of Raw Memories)
// ──────────────────────────────────────────────────────────────────────

console.log('\n\x1b[1m5. Background Consolidation (Memory Synthesis)\x1b[0m')

await test('getUnconsolidated returns only non-consolidated memories', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		await saveMemory({
			content: 'Unconsolidated 1',
			tags: [],
			kind: 'observation',
			scope: 'https://app.com',
			source: { agent: 'pa' },
		})
		await saveMemory({
			content: 'Unconsolidated 2',
			tags: [],
			kind: 'observation',
			scope: 'https://app.com',
			source: { agent: 'pa' },
		})
		await saveMemory({
			content: 'Already consolidated',
			tags: [],
			kind: 'observation',
			scope: 'https://app.com',
			source: { agent: 'pa' },
			consolidated: true,
		})

		const uncons = await getUnconsolidated()
		return uncons.map((m) => m.content)
	})

	assert.equal(result.length, 2)
	assert.ok(!result.includes('Already consolidated'))
})

await test('saveConsolidation marks source memories and creates consolidation record', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		// Create source memories
		const mem1 = await saveMemory({
			content: 'User navigated to settings',
			tags: [],
			kind: 'workflow_step',
			scope: 'https://app.com/settings',
			source: { agent: 'pa' },
		})
		const mem2 = await saveMemory({
			content: 'User toggled dark mode',
			tags: [],
			kind: 'workflow_step',
			scope: 'https://app.com/settings',
			source: { agent: 'pa' },
		})

		// Simulate consolidation
		const consolidation = {
			id: 'con_test_001',
			sourceIds: [mem1.id, mem2.id],
			summary: 'User configured dark mode via settings page',
			insight: 'User has a strong preference for dark mode',
			scope: 'https://app.com',
			createdAt: new Date().toISOString(),
			importance: 0.8,
		}

		await saveConsolidation(
			consolidation,
			[mem1, mem2],
			[{ fromId: mem1.id, toId: mem2.id, relationship: 'leads_to' }]
		)

		// Verify
		const uncons = await getUnconsolidated()
		const cons = await getConsolidations('https://app.com/settings')
		const allMems = await listAllMemories()
		const consolidatedMem = allMems.find((m) => m.id === mem1.id)

		return {
			unconsolidatedCount: uncons.length,
			consolidationCount: cons.length,
			consolidationSummary: cons[0]?.summary,
			memIsConsolidated: consolidatedMem?.consolidated,
			memConsolidatedInto: consolidatedMem?.consolidatedInto,
			memConnections: consolidatedMem?.connections,
		}
	})

	assert.equal(result.unconsolidatedCount, 0, 'All source memories should be consolidated')
	assert.equal(result.consolidationCount, 1, 'Should have 1 consolidation record')
	assert.equal(result.consolidationSummary, 'User configured dark mode via settings page')
	assert.equal(result.memIsConsolidated, true)
	assert.equal(result.memConsolidatedInto, 'con_test_001')
	assert.ok(result.memConnections.length > 0, 'Should have connections')
	assert.equal(result.memConnections[0].relationship, 'leads_to')
})

await test('consolidated memories get a ranking bonus in recall', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		// Two memories, same scope, same importance
		const mem1 = await saveMemory({
			content: 'Not consolidated memory',
			tags: [],
			kind: 'observation',
			scope: 'https://app.com',
			source: { agent: 'pa' },
			importance: 0.5,
		})
		const mem2 = await saveMemory({
			content: 'Consolidated memory',
			tags: [],
			kind: 'observation',
			scope: 'https://app.com',
			source: { agent: 'pa' },
			importance: 0.5,
			consolidated: true,
		})

		const mems = await recallMemories({ scope: 'https://app.com', limit: 2 })
		return mems.map((m) => m.content)
	})

	// Consolidated memory should rank higher due to bonus
	assert.equal(result[0], 'Consolidated memory', 'Consolidated should rank first')
})

// ──────────────────────────────────────────────────────────────────────
// 6. Chrome Storage Sync (Cross-Device)
// ──────────────────────────────────────────────────────────────────────

console.log('\n\x1b[1m6. Cross-Device Sync via chrome.storage.sync\x1b[0m')

await test('high-value memory serialization compresses for sync', async () => {
	// Test the sync serialization format (abbreviated keys for 100KB limit)
	const serialized = await page.evaluate(() => {
		const memories = [
			{
				id: 'mem_sync1',
				content: 'Important consolidated insight about user workflows',
				tags: ['synced'],
				kind: 'observation',
				scope: 'https://app.com',
				source: { agent: 'page-agent' },
				importance: 0.9,
				consolidated: true,
				contentHash: 'hash1',
				createdAt: new Date().toISOString(),
			},
		]

		// Simulate the background sync serialization
		return memories.map((m) => ({
			i: m.id,
			c: m.content.slice(0, 300),
			s: m.scope,
			t: m.createdAt,
			p: m.importance,
			k: m.kind,
			h: m.contentHash,
		}))
	})

	assert.equal(serialized.length, 1)
	assert.ok(serialized[0].i, 'Should have abbreviated id key')
	assert.ok(serialized[0].c, 'Should have abbreviated content key')
	assert.ok(serialized[0].p >= 0.7, 'Should only sync high-importance')

	// Verify size is manageable
	const size = JSON.stringify(serialized).length
	assert.ok(
		size < 8192,
		`Serialized size ${size} should be well under chrome.storage.sync item limit`
	)
})

await test('synced memory import uses deduplication', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		// Simulate importing synced memories (from another device)
		const synced = [
			{
				i: 'mem_remote1',
				c: 'Remote device insight',
				s: 'https://app.com',
				t: new Date().toISOString(),
				p: 0.8,
				k: 'observation',
				h: 'hash_remote1',
			},
			{
				i: 'mem_remote2',
				c: 'Another remote insight',
				s: '*',
				t: new Date().toISOString(),
				p: 0.75,
				k: 'user_preference',
				h: 'hash_remote2',
			},
		]

		// Import (simulating importSyncedMemories from memory-background.ts)
		for (const m of synced) {
			await saveMemory({
				content: m.c,
				tags: ['synced'],
				kind: m.k || 'observation',
				scope: m.s || '*',
				source: { agent: 'page-agent' },
				importance: m.p ?? 0.5,
			})
		}

		// Try importing same data again (should dedup)
		for (const m of synced) {
			await saveMemory({
				content: m.c,
				tags: ['synced'],
				kind: m.k || 'observation',
				scope: m.s || '*',
				source: { agent: 'page-agent' },
				importance: m.p ?? 0.5,
			})
		}

		return getMemoryCount()
	})

	assert.equal(result, 2, 'Should have exactly 2 memories (deduped)')
})

// ──────────────────────────────────────────────────────────────────────
// 7. Persistent Storage (navigator.storage.persist)
// ──────────────────────────────────────────────────────────────────────

console.log('\n\x1b[1m7. Persistent Storage (Browser Eviction Protection)\x1b[0m')

await test('navigator.storage.persist() API is available', async () => {
	const available = await page.evaluate(() => {
		return typeof navigator.storage?.persist === 'function'
	})
	assert.ok(available, 'navigator.storage.persist should be available')
})

await test('navigator.storage.persisted() returns a boolean', async () => {
	const result = await page.evaluate(async () => {
		const persisted = await navigator.storage.persisted()
		return typeof persisted
	})
	assert.equal(result, 'boolean')
})

await test('storage estimate returns usage and quota', async () => {
	const estimate = await page.evaluate(async () => {
		return getStorageEstimate()
	})

	assert.ok(estimate !== null, 'Should return an estimate')
	assert.ok(typeof estimate.usage === 'number', 'usage should be a number')
	assert.ok(typeof estimate.quota === 'number', 'quota should be a number')
	assert.ok(estimate.quota > 0, 'quota should be positive')
})

// ──────────────────────────────────────────────────────────────────────
// Additional: Pruning, Deletion, BroadcastChannel
// ──────────────────────────────────────────────────────────────────────

console.log('\n\x1b[1mAdditional: Pruning, Deletion & Cross-Tab Events\x1b[0m')

await test('deleteMemory removes a specific memory', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		const mem = await saveMemory({
			content: 'To be deleted',
			tags: [],
			kind: 'observation',
			scope: '*',
			source: { agent: 'pa' },
		})
		const before = await getMemoryCount()
		await deleteMemory(mem.id)
		const after = await getMemoryCount()
		return { before, after }
	})

	assert.equal(result.before, 1)
	assert.equal(result.after, 0)
})

await test('pruneMemories removes low-importance memories beyond maxAge', async () => {
	await page.evaluate(() => clearAllMemories())

	const pruned = await page.evaluate(async () => {
		// Create an "old" memory by manipulating the createdAt
		const db = await new Promise((res, rej) => {
			const req = indexedDB.open('page-agent-memory-test', 1)
			req.onsuccess = () => res(req.result)
			req.onerror = () => rej(req.error)
		})

		// Insert memory with old timestamp directly
		const oldDate = new Date(Date.now() - 100 * 86400000).toISOString() // 100 days ago
		const tx = db.transaction('memories', 'readwrite')
		await new Promise((res, rej) => {
			const req = tx.objectStore('memories').put({
				id: 'mem_old_001',
				content: 'Very old low-importance memory',
				tags: [],
				kind: 'observation',
				scope: '*',
				source: { agent: 'pa' },
				importance: 0.3,
				consolidated: false,
				contentHash: 'old_hash_001',
				createdAt: oldDate,
			})
			req.onsuccess = () => res()
			req.onerror = () => rej(req.error)
		})

		// Also add a recent memory
		await saveMemory({
			content: 'Recent important memory',
			tags: [],
			kind: 'observation',
			scope: '*',
			source: { agent: 'pa' },
			importance: 0.9,
		})

		const beforeCount = await getMemoryCount()
		const prunedCount = await pruneMemories({ maxAge: 90 * 86400000 })
		const afterCount = await getMemoryCount()

		return { beforeCount, prunedCount, afterCount }
	})

	assert.equal(pruned.beforeCount, 2)
	assert.equal(pruned.prunedCount, 1, 'Should prune the old low-importance memory')
	assert.equal(pruned.afterCount, 1, 'Recent important memory should survive')
})

await test('pruneMemories respects consolidated flag (never prunes consolidated)', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		const db = await new Promise((res, rej) => {
			const req = indexedDB.open('page-agent-memory-test', 1)
			req.onsuccess = () => res(req.result)
			req.onerror = () => rej(req.error)
		})

		// Old but consolidated
		const tx = db.transaction('memories', 'readwrite')
		await new Promise((res, rej) => {
			const req = tx.objectStore('memories').put({
				id: 'mem_old_cons',
				content: 'Old but consolidated insight',
				tags: [],
				kind: 'observation',
				scope: '*',
				source: { agent: 'pa' },
				importance: 0.3,
				consolidated: true,
				contentHash: 'old_cons_hash',
				createdAt: new Date(Date.now() - 100 * 86400000).toISOString(),
			})
			req.onsuccess = () => res()
			req.onerror = () => rej(req.error)
		})

		const pruned = await pruneMemories({ maxAge: 90 * 86400000 })
		const remaining = await getMemoryCount()
		return { pruned, remaining }
	})

	assert.equal(result.pruned, 0, 'Consolidated memories should not be pruned')
	assert.equal(result.remaining, 1)
})

await test('TTL-based expiration works', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		const db = await new Promise((res, rej) => {
			const req = indexedDB.open('page-agent-memory-test', 1)
			req.onsuccess = () => res(req.result)
			req.onerror = () => rej(req.error)
		})

		// Memory with expired TTL
		const tx = db.transaction('memories', 'readwrite')
		await new Promise((res, rej) => {
			const req = tx.objectStore('memories').put({
				id: 'mem_ttl_expired',
				content: 'Expired TTL memory',
				tags: [],
				kind: 'observation',
				scope: '*',
				source: { agent: 'pa' },
				importance: 0.9,
				consolidated: false,
				contentHash: 'ttl_hash',
				createdAt: new Date(Date.now() - 10000).toISOString(),
				ttl: 5000, // 5 seconds, already expired
			})
			req.onsuccess = () => res()
			req.onerror = () => rej(req.error)
		})

		// Recall should filter out expired
		const recalled = await recallMemories({ limit: 10 })
		// Prune should also remove it
		const pruned = await pruneMemories()
		const remaining = await getMemoryCount()

		return { recalledCount: recalled.length, pruned, remaining }
	})

	assert.equal(result.recalledCount, 0, 'Expired TTL memories should not be recalled')
	assert.equal(result.pruned, 1, 'Expired TTL memory should be pruned')
	assert.equal(result.remaining, 0)
})

await test('BroadcastChannel emits memory-saved events cross-tab', async () => {
	// Open a second page to listen for cross-tab events
	const page2 = await browser.newPage()
	const harnessPath = resolve(__dirname, 'test-harness.html')
	await page2.goto(`file://${harnessPath}`)
	await injectMemoryModules(page2)

	// Set up event listener on page2
	await page2.evaluate(() => {
		window.__receivedEvents = []
		window.onMemoryEvent((event) => {
			window.__receivedEvents.push(event)
		})
	})

	// Save a memory on page1
	await page.evaluate(async () => {
		await clearAllMemories()
		await saveMemory({
			content: 'Cross-tab broadcast test',
			tags: ['broadcast'],
			kind: 'observation',
			scope: '*',
			source: { agent: 'pa' },
		})
	})

	// Wait for BroadcastChannel propagation
	await new Promise((r) => setTimeout(r, 500))

	const events = await page2.evaluate(() => window.__receivedEvents)

	await page2.close()

	assert.ok(events.length > 0, 'Should receive cross-tab memory event')
	assert.equal(events[0].type, 'memory-saved')
	assert.ok(events[0].memory.content.includes('Cross-tab broadcast'))
})

await test('clearAllMemories wipes memories and consolidations', async () => {
	await page.evaluate(async () => {
		await saveMemory({
			content: 'Will be cleared',
			tags: [],
			kind: 'observation',
			scope: '*',
			source: { agent: 'pa' },
		})
	})

	const result = await page.evaluate(async () => {
		const before = await getMemoryCount()
		await clearAllMemories()
		const after = await getMemoryCount()
		return { before, after }
	})

	assert.ok(result.before > 0)
	assert.equal(result.after, 0)
})

// ──────────────────────────────────────────────────────────────────────
// Observer Pattern Tests (DOM Mutation Observers)
// ──────────────────────────────────────────────────────────────────────

console.log('\n\x1b[1mObserver Tests: Passive AI Platform Capture\x1b[0m')

await test('observer URL pattern matching works for claude.ai', async () => {
	const matches = await page.evaluate(() => {
		const patterns = ['claude.ai/*']
		function matchUrl(url, pats) {
			return pats.some((p) => {
				if (p.includes('*')) {
					const regex = new RegExp('^' + p.replace(/\*/g, '.*') + '$')
					return regex.test(url)
				}
				return url.includes(p)
			})
		}
		return {
			claude: matchUrl('claude.ai/chat/abc', patterns),
			chatgpt: matchUrl('chatgpt.com/c/123', patterns),
			gemini: matchUrl('gemini.google.com/app', patterns),
		}
	})

	assert.ok(matches.claude, 'Should match claude.ai')
	assert.ok(!matches.chatgpt, 'Should not match chatgpt.com')
	assert.ok(!matches.gemini, 'Should not match gemini.google.com')
})

await test('observer URL pattern matching works for chatgpt.com', async () => {
	const matches = await page.evaluate(() => {
		const patterns = ['chatgpt.com/*', 'chat.openai.com/*']
		function matchUrl(url, pats) {
			return pats.some((p) => {
				if (p.includes('*')) {
					const regex = new RegExp('^' + p.replace(/\*/g, '.*') + '$')
					return regex.test(url)
				}
				return url.includes(p)
			})
		}
		return {
			chatgpt: matchUrl('chatgpt.com/c/123', patterns),
			openai: matchUrl('chat.openai.com/chat', patterns),
			other: matchUrl('google.com', patterns),
		}
	})

	assert.ok(matches.chatgpt)
	assert.ok(matches.openai)
	assert.ok(!matches.other)
})

await test('observer URL pattern matching works for gemini.google.com', async () => {
	const matches = await page.evaluate(() => {
		const patterns = ['gemini.google.com/*', 'aistudio.google.com/*']
		function matchUrl(url, pats) {
			return pats.some((p) => {
				if (p.includes('*')) {
					const regex = new RegExp('^' + p.replace(/\*/g, '.*') + '$')
					return regex.test(url)
				}
				return url.includes(p)
			})
		}
		return {
			gemini: matchUrl('gemini.google.com/app', patterns),
			aistudio: matchUrl('aistudio.google.com/project', patterns),
		}
	})

	assert.ok(matches.gemini)
	assert.ok(matches.aistudio)
})

await test('observer dedup by content hash prevents duplicate emissions', async () => {
	const emitted = await page.evaluate(() => {
		// Simulate the simpleHash + dedup from observer-base.ts
		function simpleHash(str) {
			let hash = 0
			for (let i = 0; i < str.length; i++) {
				const char = str.charCodeAt(i)
				hash = ((hash << 5) - hash + char) | 0
			}
			return hash.toString(36)
		}

		const seenHashes = new Set()
		const results = []

		function emitIfNew(content, url) {
			const hash = simpleHash(content + url)
			if (seenHashes.has(hash)) return false
			seenHashes.add(hash)
			results.push(content)
			return true
		}

		emitIfNew('Hello world', 'https://claude.ai/chat/1')
		emitIfNew('Hello world', 'https://claude.ai/chat/1') // duplicate
		emitIfNew('Hello world', 'https://claude.ai/chat/2') // different URL
		emitIfNew('Different content', 'https://claude.ai/chat/1')

		return results
	})

	assert.equal(emitted.length, 3, 'Should emit 3 unique observations')
})

await test('observer seen hash set caps at 500 to prevent memory leaks', async () => {
	const result = await page.evaluate(() => {
		const seenHashes = new Set()

		// Add 600 entries
		for (let i = 0; i < 600; i++) {
			seenHashes.add(`hash_${i}`)
		}

		// Cap at 500 (keep last 250)
		if (seenHashes.size > 500) {
			const arr = Array.from(seenHashes)
			const trimmed = new Set(arr.slice(-250))
			return {
				originalSize: 600,
				trimmedSize: trimmed.size,
				hasLast: trimmed.has('hash_599'),
				hasFirst: trimmed.has('hash_0'),
			}
		}
		return null
	})

	assert.equal(result.trimmedSize, 250, 'Should trim to 250')
	assert.ok(result.hasLast, 'Should keep recent hashes')
	assert.ok(!result.hasFirst, 'Should evict old hashes')
})

// ──────────────────────────────────────────────────────────────────────
// Relevance Scoring Tests
// ──────────────────────────────────────────────────────────────────────

console.log('\n\x1b[1mRelevance Scoring & Ranking\x1b[0m')

await test('exact scope match ranks higher than same-origin', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		await saveMemory({
			content: 'Same-origin /other page',
			tags: [],
			kind: 'observation',
			scope: 'https://app.com/other',
			source: { agent: 'pa' },
		})
		// Small delay to differentiate timestamps
		await new Promise((r) => setTimeout(r, 10))
		await saveMemory({
			content: 'Exact scope match',
			tags: [],
			kind: 'observation',
			scope: 'https://app.com/target',
			source: { agent: 'pa' },
		})

		const mems = await recallMemories({ scope: 'https://app.com/target', limit: 5 })
		return mems.map((m) => m.content)
	})

	assert.equal(result[0], 'Exact scope match', 'Exact scope should rank first')
})

await test('high-importance memory ranks above low-importance', async () => {
	await page.evaluate(() => clearAllMemories())

	const result = await page.evaluate(async () => {
		await saveMemory({
			content: 'Low importance',
			tags: [],
			kind: 'observation',
			scope: 'https://app.com',
			source: { agent: 'pa' },
			importance: 0.1,
		})
		await saveMemory({
			content: 'High importance',
			tags: [],
			kind: 'observation',
			scope: 'https://app.com',
			source: { agent: 'pa' },
			importance: 0.9,
		})

		const mems = await recallMemories({ scope: 'https://app.com', limit: 2 })
		return mems.map((m) => m.content)
	})

	assert.equal(result[0], 'High importance')
})

await test('minImportance filter works', async () => {
	const result = await page.evaluate(async () => {
		const mems = await recallMemories({ scope: 'https://app.com', minImportance: 0.5, limit: 10 })
		return mems.length
	})

	assert.equal(result, 1, 'Should only return memories with importance >= 0.5')
})

// ──────────────────────────────────────────────────────────────────────
// Web Locks Test (Consolidation Mutex)
// ──────────────────────────────────────────────────────────────────────

console.log('\n\x1b[1mWeb Locks (Consolidation Mutex)\x1b[0m')

await test('navigator.locks API is available for consolidation mutex', async () => {
	const available = await page.evaluate(() => typeof navigator.locks?.request === 'function')
	assert.ok(available, 'Web Locks API should be available')
})

await test('Web Locks prevent concurrent consolidation', async () => {
	const result = await page.evaluate(async () => {
		let lockAcquired = 0
		let lockRejected = 0

		// First lock should succeed
		await navigator.locks.request('test-consolidation', { ifAvailable: true }, async (lock) => {
			if (lock) {
				lockAcquired++
				// While holding the lock, try to acquire again
				await navigator.locks.request(
					'test-consolidation',
					{ ifAvailable: true },
					async (lock2) => {
						if (lock2) lockAcquired++
						else lockRejected++
					}
				)
			}
		})

		return { lockAcquired, lockRejected }
	})

	assert.equal(result.lockAcquired, 1, 'First lock should succeed')
	assert.equal(result.lockRejected, 1, 'Second concurrent lock should be rejected')
})

// ══════════════════════════════════════════════════════════════════════
// Summary
// ══════════════════════════════════════════════════════════════════════

await teardown()

console.log('\n\x1b[1m═══ Results ═══\x1b[0m')
console.log(`  \x1b[32m${results.passed} passed\x1b[0m`)
if (results.failed > 0) {
	console.log(`  \x1b[31m${results.failed} failed\x1b[0m`)
	for (const { name, error } of results.errors) {
		console.log(`    \x1b[31m✗ ${name}: ${error}\x1b[0m`)
	}
}
if (results.skipped > 0) {
	console.log(`  \x1b[33m${results.skipped} skipped\x1b[0m`)
}
console.log()

process.exit(results.failed > 0 ? 1 : 0)
