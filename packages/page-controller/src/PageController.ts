/**
 * Copyright (C) 2025 Alibaba Group Holding Limited
 * All rights reserved.
 *
 * PageController - Manages DOM operations and element interactions.
 * Designed to be independent of LLM and can be tested in unit tests.
 * All public methods are async for potential remote calling support.
 */
import {
	clearAndTypeElement,
	clickElement,
	getElementByIndex,
	hoverElementAction,
	inputTextElement,
	pressKeyAction,
	scrollHorizontally,
	scrollVertically,
	selectOptionElement,
} from './actions'
import * as dom from './dom'
import type { FlatDomTree, InteractiveElementDomNode } from './dom/dom_tree/type'
import { getPageInfo } from './dom/getPageInfo'
import { patchReact } from './patches/react'

/**
 * Configuration for PageController
 */
export interface PageControllerConfig extends dom.DomConfig {
	/** Enable visual mask overlay during operations (default: false) */
	enableMask?: boolean
	/** Maximum number of interactive elements to include in the LLM prompt.
	 *  When set, elements are prioritized by viewport membership, isNew flag, and DOM order.
	 *  The selectorMap is unaffected — all elements remain actionable.
	 *  undefined = no cap (backward compatible). */
	maxElements?: number
}

/**
 * Structured browser state for LLM consumption
 */
export interface BrowserState {
	url: string
	title: string
	/** Page info + scroll position hint (e.g. "Page info: 1920x1080px...\n[Start of page]") */
	header: string
	/** Simplified HTML of interactive elements */
	content: string
	/** Page footer hint (e.g. "... 300 pixels below ..." or "[End of page]") */
	footer: string
}

export interface ActionResult {
	success: boolean
	message: string
}

/**
 * Lightweight snapshot of page state for computing diffs after actions.
 * Designed to be very fast to capture (<5ms).
 */
export interface StateSummary {
	url: string
	elementCount: number
}

/**
 * Compare two state snapshots and return a human-readable description of changes.
 * Returns an empty string if nothing meaningful changed.
 */
export function diffState(before: StateSummary, after: StateSummary): string {
	const changes: string[] = []

	// URL change
	if (before.url !== after.url) {
		// Show just pathnames for brevity, fall back to full URL if parsing fails
		let beforeLabel = before.url
		let afterLabel = after.url
		try {
			const bUrl = new URL(before.url)
			const aUrl = new URL(after.url)
			if (bUrl.origin === aUrl.origin) {
				beforeLabel = bUrl.pathname + bUrl.search + bUrl.hash
				afterLabel = aUrl.pathname + aUrl.search + aUrl.hash
			}
		} catch {
			// keep full URLs
		}
		changes.push(`URL changed: ${beforeLabel} → ${afterLabel}`)
	}

	// Element count change
	const diff = after.elementCount - before.elementCount
	if (diff > 0) {
		changes.push(`${diff} new interactive element${diff === 1 ? '' : 's'} appeared`)
	} else if (diff < 0) {
		const removed = -diff
		changes.push(`${removed} element${removed === 1 ? '' : 's'} removed`)
	}

	return changes.join(', ')
}

/**
 * The contract that all page controller implementations must satisfy.
 *
 * Implemented by:
 * - `PageController` (local DOM, content script)
 * - `RemotePageController` (extension, proxies over chrome.runtime)
 * - `RemotePageController` (@page-agent/mirror, proxies over IHotLayer)
 */
export interface IPageController {
	// -- State Queries --
	getCurrentUrl(): Promise<string>
	getLastUpdateTime(): Promise<number>
	getBrowserState(): Promise<BrowserState>
	getStateSummary(): Promise<StateSummary>

	// -- DOM Tree --
	updateTree(): Promise<string>
	cleanUpHighlights(): Promise<void>

	// -- Element Actions --
	clickElement(index: number): Promise<ActionResult>
	inputText(index: number, text: string): Promise<ActionResult>
	selectOption(index: number, optionText: string): Promise<ActionResult>
	scroll(options: {
		down: boolean
		numPages: number
		pixels?: number
		index?: number
	}): Promise<ActionResult>
	scrollHorizontally(options: {
		right: boolean
		pixels: number
		index?: number
	}): Promise<ActionResult>
	executeJavascript(script: string): Promise<ActionResult>
	pressKey(key: string, modifiers?: string[]): Promise<ActionResult>
	hoverElement(index: number): Promise<ActionResult>
	clearAndType(index: number, text: string): Promise<ActionResult>

	// -- Mask --
	showMask(): Promise<void>
	hideMask(): Promise<void>

	// -- Lifecycle --
	dispose(): void
}

/**
 * PageController manages DOM state and element interactions.
 * It provides async methods for all DOM operations, keeping state isolated.
 *
 * @lifecycle
 * - beforeUpdate: Emitted before the DOM tree is updated.
 * - afterUpdate: Emitted after the DOM tree is updated.
 */
export class PageController extends EventTarget implements IPageController {
	private config: PageControllerConfig

	/** Corresponds to eval_page in browser-use */
	private flatTree: FlatDomTree | null = null

	/**
	 * All highlighted index-mapped interactive elements
	 * Corresponds to DOMState.selector_map in browser-use
	 */
	private selectorMap = new Map<number, InteractiveElementDomNode>()

	/** Index -> element text description mapping */
	private elementTextMap = new Map<number, string>()

	/**
	 * Simplified HTML for LLM consumption.
	 * Corresponds to clickable_elements_to_string in browser-use
	 */
	private simplifiedHTML = '<EMPTY>'

	/** last time the tree was updated */
	private lastTimeUpdate = 0

	/** Whether the tree has been indexed at least once */
	private isIndexed = false

	/** Visual mask overlay for blocking user interaction during automation */
	private mask: InstanceType<typeof import('./mask/SimulatorMask').SimulatorMask> | null = null
	private maskReady: Promise<void> | null = null

	constructor(config: PageControllerConfig = {}) {
		super()

		this.config = config

		patchReact(this)

		if (config.enableMask) this.initMask()
	}

	/**
	 * Initialize mask asynchronously (dynamic import to avoid CSS loading in Node)
	 */
	initMask() {
		if (this.maskReady !== null) return
		this.maskReady = (async () => {
			const { SimulatorMask } = await import('./mask/SimulatorMask')
			this.mask = new SimulatorMask()
		})()
	}
	// ======= State Queries =======

	/**
	 * Get current page URL
	 */
	async getCurrentUrl(): Promise<string> {
		return window.location.href
	}

	/**
	 * Get last tree update timestamp
	 */
	async getLastUpdateTime(): Promise<number> {
		return this.lastTimeUpdate
	}

	/**
	 * Get a lightweight state snapshot for diffing before/after actions.
	 * Fast (<5ms) — just reads current URL and selector map size.
	 */
	async getStateSummary(): Promise<StateSummary> {
		return {
			url: window.location.href,
			elementCount: this.selectorMap.size,
		}
	}

	/**
	 * Get structured browser state for LLM consumption.
	 * Automatically calls updateTree() to refresh the DOM state.
	 */
	async getBrowserState(): Promise<BrowserState> {
		const url = window.location.href
		const title = document.title
		const pi = getPageInfo()
		const viewportExpansion = dom.resolveViewportExpansion(this.config.viewportExpansion)

		await this.updateTree()

		const content = this.simplifiedHTML

		// Build header: page info + scroll position hint
		const titleLine = `Current Page: [${title}](${url})`

		const pageInfoLine = `Page info: ${pi.viewport_width}x${pi.viewport_height}px viewport, ${pi.page_width}x${pi.page_height}px total page size, ${pi.pages_above.toFixed(1)} pages above, ${pi.pages_below.toFixed(1)} pages below, ${pi.total_pages.toFixed(1)} total pages, at ${(pi.current_page_position * 100).toFixed(0)}% of page`

		const elementsLabel =
			viewportExpansion === -1
				? 'Interactive elements from top layer of the current page (full page):'
				: 'Interactive elements from top layer of the current page inside the viewport:'

		const hasContentAbove = pi.pixels_above > 4
		const scrollHintAbove =
			hasContentAbove && viewportExpansion !== -1
				? `... ${pi.pixels_above} pixels above (${pi.pages_above.toFixed(1)} pages) - scroll to see more ...`
				: '[Start of page]'

		const header = `${titleLine}\n${pageInfoLine}\n\n${elementsLabel}\n\n${scrollHintAbove}`

		// Build footer: scroll position hint
		const hasContentBelow = pi.pixels_below > 4
		const footer =
			hasContentBelow && viewportExpansion !== -1
				? `... ${pi.pixels_below} pixels below (${pi.pages_below.toFixed(1)} pages) - scroll to see more ...`
				: '[End of page]'

		return { url, title, header, content, footer }
	}

	// ======= DOM Tree Operations =======

	/**
	 * Update DOM tree, returns simplified HTML for LLM.
	 * This is the main method to refresh the page state.
	 * Automatically bypasses mask during DOM extraction if enabled.
	 */
	async updateTree(): Promise<string> {
		this.dispatchEvent(new Event('beforeUpdate'))

		this.lastTimeUpdate = Date.now()

		// Temporarily bypass mask to allow DOM extraction
		if (this.mask) {
			this.mask.wrapper.style.pointerEvents = 'none'
		}

		dom.cleanUpHighlights()

		const blacklist = [
			...(this.config.interactiveBlacklist || []),
			...document.querySelectorAll('[data-page-agent-not-interactive]').values(),
		]

		this.flatTree = dom.getFlatTree({
			...this.config,
			interactiveBlacklist: blacklist,
		})

		this.simplifiedHTML = dom.flatTreeToString(this.flatTree, this.config.includeAttributes, {
			maxElements: this.config.maxElements,
		})

		this.selectorMap.clear()
		this.selectorMap = dom.getSelectorMap(this.flatTree)

		this.elementTextMap.clear()
		this.elementTextMap = dom.getElementTextMap(this.simplifiedHTML)

		// Mark as indexed - now element actions are allowed
		this.isIndexed = true

		// Restore mask blocking
		if (this.mask) {
			this.mask.wrapper.style.pointerEvents = 'auto'
		}

		this.dispatchEvent(new Event('afterUpdate'))

		return this.simplifiedHTML
	}

	/**
	 * Clean up all element highlights
	 */
	async cleanUpHighlights(): Promise<void> {
		dom.cleanUpHighlights()
	}

	// ======= Element Actions =======

	/**
	 * Ensure the tree has been indexed before any index-based operation.
	 * Throws if updateTree() hasn't been called yet.
	 */
	private assertIndexed(): void {
		if (!this.isIndexed) {
			throw new Error('DOM tree not indexed yet. Can not perform actions on elements.')
		}
	}

	/**
	 * Click element by index
	 */
	async clickElement(index: number): Promise<ActionResult> {
		try {
			this.assertIndexed()
			const element = getElementByIndex(this.selectorMap, index)
			const elemText = this.elementTextMap.get(index)
			await clickElement(element)

			// Handle links that open in new tabs
			if (element instanceof HTMLAnchorElement && element.target === '_blank') {
				return {
					success: true,
					message: `✅ Clicked element (${elemText ?? index}). ⚠️ Link opened in a new tab.`,
				}
			}

			return {
				success: true,
				message: `✅ Clicked element (${elemText ?? index}).`,
			}
		} catch (error) {
			return {
				success: false,
				message: `❌ Failed to click element: ${error}`,
			}
		}
	}

	/**
	 * Input text into element by index
	 */
	async inputText(index: number, text: string): Promise<ActionResult> {
		try {
			this.assertIndexed()
			const element = getElementByIndex(this.selectorMap, index)
			const elemText = this.elementTextMap.get(index)
			await inputTextElement(element, text)

			return {
				success: true,
				message: `✅ Input text (${text}) into element (${elemText ?? index}).`,
			}
		} catch (error) {
			return {
				success: false,
				message: `❌ Failed to input text: ${error}`,
			}
		}
	}

	/**
	 * Select dropdown option by index and option text
	 */
	async selectOption(index: number, optionText: string): Promise<ActionResult> {
		try {
			this.assertIndexed()
			const element = getElementByIndex(this.selectorMap, index)
			const elemText = this.elementTextMap.get(index)
			await selectOptionElement(element as HTMLSelectElement, optionText)

			return {
				success: true,
				message: `✅ Selected option (${optionText}) in element (${elemText ?? index}).`,
			}
		} catch (error) {
			return {
				success: false,
				message: `❌ Failed to select option: ${error}`,
			}
		}
	}

	/**
	 * Scroll vertically
	 */
	async scroll(options: {
		down: boolean
		numPages: number
		pixels?: number
		index?: number
	}): Promise<ActionResult> {
		try {
			const { down, numPages, pixels, index } = options

			this.assertIndexed()

			const scrollAmount = pixels ?? numPages * (down ? 1 : -1) * window.innerHeight

			const element = index !== undefined ? getElementByIndex(this.selectorMap, index) : null

			const message = await scrollVertically(down, scrollAmount, element)

			return {
				success: true,
				message,
			}
		} catch (error) {
			return {
				success: false,
				message: `❌ Failed to scroll: ${error}`,
			}
		}
	}

	/**
	 * Scroll horizontally
	 */
	async scrollHorizontally(options: {
		right: boolean
		pixels: number
		index?: number
	}): Promise<ActionResult> {
		try {
			const { right, pixels, index } = options

			this.assertIndexed()

			const scrollAmount = pixels * (right ? 1 : -1)

			const element = index !== undefined ? getElementByIndex(this.selectorMap, index) : null

			const message = await scrollHorizontally(right, scrollAmount, element)

			return {
				success: true,
				message,
			}
		} catch (error) {
			return {
				success: false,
				message: `❌ Failed to scroll horizontally: ${error}`,
			}
		}
	}

	/**
	 * Execute arbitrary JavaScript on the page
	 */
	async executeJavascript(script: string): Promise<ActionResult> {
		try {
			// Wrap script in async function to support await
			const asyncFunction = eval(`(async () => { ${script} })`)
			const result = await asyncFunction()
			return {
				success: true,
				message: `✅ Executed JavaScript. Result: ${result}`,
			}
		} catch (error) {
			return {
				success: false,
				message: `❌ Error executing JavaScript: ${error}`,
			}
		}
	}

	/**
	 * Press a keyboard key, optionally with modifiers
	 */
	async pressKey(key: string, modifiers?: string[]): Promise<ActionResult> {
		try {
			await pressKeyAction(key, modifiers)
			const modStr = modifiers?.length ? ` with modifiers [${modifiers.join(', ')}]` : ''
			return {
				success: true,
				message: `✅ Pressed key (${key})${modStr}.`,
			}
		} catch (error) {
			return {
				success: false,
				message: `❌ Failed to press key: ${error}`,
			}
		}
	}

	/**
	 * Hover over an element by index
	 */
	async hoverElement(index: number): Promise<ActionResult> {
		try {
			this.assertIndexed()
			const element = getElementByIndex(this.selectorMap, index)
			const elemText = this.elementTextMap.get(index)
			await hoverElementAction(element)

			return {
				success: true,
				message: `✅ Hovered over element (${elemText ?? index}).`,
			}
		} catch (error) {
			return {
				success: false,
				message: `❌ Failed to hover element: ${error}`,
			}
		}
	}

	/**
	 * Clear existing text in a field and type new text
	 */
	async clearAndType(index: number, text: string): Promise<ActionResult> {
		try {
			this.assertIndexed()
			const element = getElementByIndex(this.selectorMap, index)
			const elemText = this.elementTextMap.get(index)
			await clearAndTypeElement(element, text)

			return {
				success: true,
				message: `✅ Cleared and typed (${text}) into element (${elemText ?? index}).`,
			}
		} catch (error) {
			return {
				success: false,
				message: `❌ Failed to clear and type: ${error}`,
			}
		}
	}

	// ======= Mask Operations =======

	/**
	 * Show the visual mask overlay.
	 * Only works after mask is setup.
	 */
	async showMask(): Promise<void> {
		await this.maskReady
		this.mask?.show()
	}

	/**
	 * Hide the visual mask overlay.
	 * Only works after mask is setup.
	 */
	async hideMask(): Promise<void> {
		await this.maskReady
		this.mask?.hide()
	}

	/**
	 * Dispose and clean up resources
	 */
	dispose(): void {
		dom.cleanUpHighlights()
		this.flatTree = null
		this.selectorMap.clear()
		this.elementTextMap.clear()
		this.simplifiedHTML = '<EMPTY>'
		this.isIndexed = false
		this.mask?.dispose()
		this.mask = null
	}
}
