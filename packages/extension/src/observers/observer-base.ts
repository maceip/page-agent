/**
 * Base Page Observer
 *
 * Watches a page's DOM for meaningful changes (task completions,
 * code outputs, conversation turns) and extracts structured observations.
 *
 * Key design constraints:
 * - Never interfere with the target page
 * - Debounce observations (300ms default, à la Mem0)
 * - Graceful degradation — if selectors break, just stop observing
 * - Privacy: extract summaries, not raw content
 */
import type { ObserverConfig, PageObservation } from './types'

export abstract class PageObserver {
	readonly config: ObserverConfig
	protected observer: MutationObserver | null = null
	protected debounceTimer: number | null = null
	protected debounceMs: number
	protected seenHashes = new Set<string>()
	protected onObservation: (obs: PageObservation) => void

	constructor(
		config: ObserverConfig,
		onObservation: (obs: PageObservation) => void,
		debounceMs = 300
	) {
		this.config = config
		this.onObservation = onObservation
		this.debounceMs = debounceMs
	}

	/** Start observing the current page */
	start(): void {
		if (this.observer) return

		const target = this.getObservationTarget()
		if (!target) {
			console.warn(`[Observer:${this.config.name}] Target element not found, retrying...`)
			// Retry after DOM settles
			setTimeout(() => this.start(), 2000)
			return
		}

		this.observer = new MutationObserver((mutations) => {
			this.debouncedCheck(mutations)
		})

		this.observer.observe(target, {
			childList: true,
			subtree: true,
			characterData: true,
		})

		console.log(`[Observer:${this.config.name}] Started watching`)
	}

	/** Stop observing */
	stop(): void {
		if (this.observer) {
			this.observer.disconnect()
			this.observer = null
		}
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
			this.debounceTimer = null
		}
		console.log(`[Observer:${this.config.name}] Stopped`)
	}

	/** Check if this observer matches the current URL */
	matches(url: string): boolean {
		return this.config.patterns.some((pattern) => {
			if (pattern.includes('*')) {
				const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$')
				return regex.test(url)
			}
			return url.includes(pattern)
		})
	}

	private debouncedCheck(mutations: MutationRecord[]): void {
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer)
		}
		this.debounceTimer = window.setTimeout(() => {
			try {
				this.extractObservations(mutations)
			} catch (err) {
				console.warn(`[Observer:${this.config.name}] Extraction error:`, err)
			}
		}, this.debounceMs)
	}

	/** Dedup by content hash */
	protected emitIfNew(obs: PageObservation): void {
		const hash = simpleHash(obs.content + obs.url)
		if (this.seenHashes.has(hash)) return
		this.seenHashes.add(hash)

		// Cap seen hashes to prevent memory leak
		if (this.seenHashes.size > 500) {
			const arr = Array.from(this.seenHashes)
			this.seenHashes = new Set(arr.slice(-250))
		}

		this.onObservation(obs)
	}

	// --- Abstract methods for subclasses ---

	/** Get the DOM element to observe */
	protected abstract getObservationTarget(): Element | null

	/** Extract observations from DOM mutations */
	protected abstract extractObservations(mutations: MutationRecord[]): void
}

function simpleHash(str: string): string {
	let hash = 0
	for (let i = 0; i < str.length; i++) {
		const char = str.charCodeAt(i)
		hash = ((hash << 5) - hash + char) | 0
	}
	return hash.toString(36)
}
