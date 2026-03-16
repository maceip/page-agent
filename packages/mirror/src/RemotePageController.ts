/**
 * RemotePageController — Adapter that lets PageAgentCore operate on a remote
 * browser via the micro-DOM spatial map + hot layer input dispatch.
 *
 * Implements IPageController: the same interface as the local PageController
 * and the extension's RemotePageController. No `as any` casts needed.
 *
 * Instead of calling `document.querySelector()` and `element.click()` directly, it:
 *   1. Reads BrowserState from the latest MicroDOMSnapshot.simplifiedHTML
 *   2. Dispatches actions as RemoteInputEvents through the IHotLayer
 *   3. Maps element indices (stable micro-DOM IDs) to spatial coordinates
 *
 * Usage:
 *   const remote = new RemotePageController(hotLayer)
 *   const core = new PageAgentCore({ pageController: remote, ... })
 *   // PageAgentCore now drives the remote browser through the mirror
 */
import type {
	ActionResult,
	BrowserState,
	IPageController,
	StateSummary,
} from '@page-agent/page-controller'

import type {
	IHotLayer,
	RemoteFocusEvent,
	RemoteKeyboardEvent,
	RemoteSelectEvent,
	RemoteTypeEvent,
} from './layers/hot'
import type { MicroDOMSnapshot, SpatialElement } from './types'

// ---------------------------------------------------------------------------
// RemotePageController
// ---------------------------------------------------------------------------

/** Default timeout (ms) when waiting for the hot layer to push a fresh snapshot */
const SNAPSHOT_TIMEOUT_MS = 2_000

export class RemotePageController extends EventTarget implements IPageController {
	private hotLayer: IHotLayer
	private snapshot: MicroDOMSnapshot | null = null
	private lastUpdateTime = 0
	private disposed = false

	/** Map from stable element ID → SpatialElement (rebuilt on each snapshot) */
	private elementMap = new Map<number, SpatialElement>()

	constructor(hotLayer: IHotLayer) {
		super()
		this.hotLayer = hotLayer
	}

	/**
	 * Feed a new micro-DOM snapshot into the controller.
	 * Called by the mirror orchestration layer whenever onSpatialMapUpdate fires.
	 */
	applySnapshot(snapshot: MicroDOMSnapshot): void {
		this.snapshot = snapshot
		this.lastUpdateTime = Date.now()
		this.elementMap.clear()
		for (const el of snapshot.elements) {
			this.elementMap.set(el.id, el)
		}
		this.dispatchEvent(new Event('afterUpdate'))
	}

	// ======= State Queries =======

	async getCurrentUrl(): Promise<string> {
		return this.snapshot?.url ?? ''
	}

	async getLastUpdateTime(): Promise<number> {
		return this.lastUpdateTime
	}

	async getStateSummary(): Promise<StateSummary> {
		return {
			url: this.snapshot?.url ?? '',
			elementCount: this.elementMap.size,
		}
	}

	/**
	 * Get structured browser state for LLM consumption.
	 * Uses the simplifiedHTML from the latest micro-DOM snapshot.
	 */
	async getBrowserState(): Promise<BrowserState> {
		// Request a fresh scan from the remote
		await this.updateTree()

		const snap = this.snapshot
		if (!snap) {
			return {
				url: '',
				title: '',
				header: '[No snapshot available]',
				content: '<EMPTY>',
				footer: '[End of page]',
			}
		}

		const url = snap.url
		const title = snap.title
		const vpW = snap.viewport.w
		const vpH = snap.viewport.h
		const scrollY = snap.scroll.y

		// Approximate scroll info from viewport/scroll data
		// (We don't have full page height, but the element positions give us a lower bound)
		const maxElBottom = snap.elements.reduce((max, el) => {
			return Math.max(max, el.rect.y + el.rect.h + scrollY)
		}, vpH)
		const totalHeight = Math.max(maxElBottom, vpH)
		const pixelsAbove = Math.round(scrollY)
		const pixelsBelow = Math.max(0, Math.round(totalHeight - scrollY - vpH))

		const titleLine = `Current Page: [${title}](${url})`
		const pageInfoLine = `Page info: ${vpW}x${vpH}px viewport`
		const elementsLabel =
			'Interactive elements from top layer of the current page inside the viewport:'

		const scrollHintAbove =
			pixelsAbove > 4
				? `... ${pixelsAbove} pixels above - scroll to see more ...`
				: '[Start of page]'

		const header = `${titleLine}\n${pageInfoLine}\n\n${elementsLabel}\n\n${scrollHintAbove}`

		const content = snap.simplifiedHTML || '<EMPTY>'

		const footer =
			pixelsBelow > 4 ? `... ${pixelsBelow} pixels below - scroll to see more ...` : '[End of page]'

		return { url, title, header, content, footer }
	}

	// ======= DOM Tree Operations =======

	/**
	 * Refresh the spatial map from the hot layer.
	 *
	 * Strategy:
	 *  1. Always check the hot layer for a newer snapshot than what we hold.
	 *  2. If nothing newer is available, subscribe to the next
	 *     `onSpatialMapUpdate` push with a short timeout so the agent loop
	 *     never blocks indefinitely on a slow QUIC link.
	 *  3. If the timeout fires, return whatever we have (stale-but-present
	 *     beats hanging the agent loop).
	 */
	async updateTree(): Promise<string> {
		this.dispatchEvent(new Event('beforeUpdate'))

		// Always check the hot layer — it may have received a push since our
		// last applySnapshot() call.
		const latestSnap = this.hotLayer.getLatestSnapshot()
		if (latestSnap && (!this.snapshot || latestSnap.seq > this.snapshot.seq)) {
			this.applySnapshot(latestSnap)
		}

		// If we still have no snapshot at all, await the next push with a timeout.
		if (!this.snapshot) {
			await this.awaitNextSnapshot()
		}

		this.dispatchEvent(new Event('afterUpdate'))
		return this.snapshot?.simplifiedHTML ?? '<EMPTY>'
	}

	/**
	 * One-shot wait for the next spatial-map update from the hot layer.
	 * Resolves as soon as a snapshot (or diff) arrives, or after
	 * `SNAPSHOT_TIMEOUT_MS` — whichever comes first.
	 */
	private awaitNextSnapshot(): Promise<void> {
		return new Promise<void>((resolve) => {
			let settled = false
			const unsub = this.hotLayer.onSpatialMapUpdate((update) => {
				if (settled) return
				settled = true
				unsub()
				clearTimeout(timer)
				// The MirrorSession normally feeds snapshots to us, but if
				// RemotePageController is used standalone, apply directly.
				if ('elements' in update && 'simplifiedHTML' in update) {
					this.applySnapshot(update as MicroDOMSnapshot)
				}
				resolve()
			})

			const timer = setTimeout(() => {
				if (settled) return
				settled = true
				unsub()
				resolve()
			}, SNAPSHOT_TIMEOUT_MS)
		})
	}

	async cleanUpHighlights(): Promise<void> {
		// No-op: remote browser has no local highlights
	}

	// ======= Element Actions =======

	private getElement(index: number): SpatialElement {
		const el = this.elementMap.get(index)
		if (!el) {
			throw new Error(`Element with ID ${index} not found in spatial map`)
		}
		return el
	}

	private now(): string {
		return new Date().toISOString()
	}

	async clickElement(index: number): Promise<ActionResult> {
		try {
			const el = this.getElement(index)
			// Click at center of element
			const x = Math.round(el.rect.x + el.rect.w / 2)
			const y = Math.round(el.rect.y + el.rect.h / 2)
			await this.hotLayer.sendInputEvent({
				type: 'click',
				x,
				y,
				elementId: index,
				timestamp: this.now(),
			})
			const desc = el.label || el.tag
			return { success: true, message: `Clicked element [${index}] (${desc}).` }
		} catch (error) {
			return { success: false, message: `Failed to click element: ${error}` }
		}
	}

	async inputText(index: number, text: string): Promise<ActionResult> {
		try {
			const el = this.getElement(index)
			// Focus then type — construct properly typed events, no `as` casts
			const focusEvent: RemoteFocusEvent = {
				type: 'focus',
				elementId: index,
				timestamp: this.now(),
			}
			await this.hotLayer.sendInputEvent(focusEvent)

			const typeEvent: RemoteTypeEvent = {
				type: 'type',
				elementId: index,
				text,
				timestamp: this.now(),
			}
			await this.hotLayer.sendInputEvent(typeEvent)

			const desc = el.label || el.tag
			return {
				success: true,
				message: `Input text (${text}) into element [${index}] (${desc}).`,
			}
		} catch (error) {
			return { success: false, message: `Failed to input text: ${error}` }
		}
	}

	async selectOption(index: number, optionText: string): Promise<ActionResult> {
		try {
			this.getElement(index)
			const selectEvent: RemoteSelectEvent = {
				type: 'select',
				elementId: index,
				value: optionText,
				timestamp: this.now(),
			}
			await this.hotLayer.sendInputEvent(selectEvent)
			return {
				success: true,
				message: `Selected option (${optionText}) in element [${index}].`,
			}
		} catch (error) {
			return { success: false, message: `Failed to select option: ${error}` }
		}
	}

	async scroll(options: {
		down: boolean
		numPages: number
		pixels?: number
		index?: number
	}): Promise<ActionResult> {
		try {
			const { down, numPages, pixels, index } = options
			const vpH = this.snapshot?.viewport.h ?? 800
			const amount = pixels ?? numPages * vpH
			const deltaY = down ? amount : -amount

			const elementId = index ?? 0
			await this.hotLayer.sendInputEvent({
				type: 'wheel',
				x: (this.snapshot?.viewport.w ?? 1920) / 2,
				y: vpH / 2,
				deltaX: 0,
				deltaY,
				elementId,
				timestamp: this.now(),
			})
			return {
				success: true,
				message: `Scrolled ${down ? 'down' : 'up'} ${Math.abs(deltaY)}px.`,
			}
		} catch (error) {
			return { success: false, message: `Failed to scroll: ${error}` }
		}
	}

	async scrollHorizontally(options: {
		right: boolean
		pixels: number
		index?: number
	}): Promise<ActionResult> {
		try {
			const { right, pixels, index } = options
			const deltaX = right ? pixels : -pixels
			const vpH = this.snapshot?.viewport.h ?? 800

			const elementId = index ?? 0
			await this.hotLayer.sendInputEvent({
				type: 'wheel',
				x: (this.snapshot?.viewport.w ?? 1920) / 2,
				y: vpH / 2,
				deltaX,
				deltaY: 0,
				elementId,
				timestamp: this.now(),
			})
			return {
				success: true,
				message: `Scrolled ${right ? 'right' : 'left'} ${Math.abs(deltaX)}px.`,
			}
		} catch (error) {
			return { success: false, message: `Failed to scroll horizontally: ${error}` }
		}
	}

	async executeJavascript(_script: string): Promise<ActionResult> {
		// Remote JS execution is not supported through the hot layer.
		// The warm layer's CDP connection would be needed for Runtime.evaluate.
		return {
			success: false,
			message: 'JavaScript execution not available in remote mode. Use element actions instead.',
		}
	}

	async pressKey(key: string, modifiers?: string[]): Promise<ActionResult> {
		try {
			const modObj = modifiers?.length
				? {
						ctrl: modifiers.includes('Ctrl') || modifiers.includes('Control'),
						shift: modifiers.includes('Shift'),
						alt: modifiers.includes('Alt'),
						meta: modifiers.includes('Meta') || modifiers.includes('Command'),
					}
				: undefined

			// Map common key names to code values
			const codeMap: Record<string, string> = {
				Enter: 'Enter',
				Escape: 'Escape',
				Tab: 'Tab',
				Backspace: 'Backspace',
				Delete: 'Delete',
				Space: 'Space',
				' ': 'Space',
				ArrowDown: 'ArrowDown',
				ArrowUp: 'ArrowUp',
				ArrowLeft: 'ArrowLeft',
				ArrowRight: 'ArrowRight',
			}
			const code = codeMap[key] || (key.length === 1 ? `Key${key.toUpperCase()}` : key)

			const keyboardEvent: RemoteKeyboardEvent = {
				type: 'keydown',
				key,
				code,
				modifiers: modObj,
				timestamp: this.now(),
			}
			await this.hotLayer.sendInputEvent(keyboardEvent)

			const keyupEvent: RemoteKeyboardEvent = {
				type: 'keyup',
				key,
				code,
				modifiers: modObj,
				timestamp: this.now(),
			}
			await this.hotLayer.sendInputEvent(keyupEvent)

			const modStr = modifiers?.length ? ` with modifiers [${modifiers.join(', ')}]` : ''
			return { success: true, message: `Pressed key (${key})${modStr}.` }
		} catch (error) {
			return { success: false, message: `Failed to press key: ${error}` }
		}
	}

	async hoverElement(index: number): Promise<ActionResult> {
		try {
			const el = this.getElement(index)
			const x = Math.round(el.rect.x + el.rect.w / 2)
			const y = Math.round(el.rect.y + el.rect.h / 2)
			await this.hotLayer.sendInputEvent({
				type: 'mousemove',
				x,
				y,
				elementId: index,
				timestamp: this.now(),
			})
			const desc = el.label || el.tag
			return { success: true, message: `Hovered over element [${index}] (${desc}).` }
		} catch (error) {
			return { success: false, message: `Failed to hover element: ${error}` }
		}
	}

	async clearAndType(index: number, text: string): Promise<ActionResult> {
		try {
			const el = this.getElement(index)
			// Focus the element
			const focusEvent: RemoteFocusEvent = {
				type: 'focus',
				elementId: index,
				timestamp: this.now(),
			}
			await this.hotLayer.sendInputEvent(focusEvent)

			// Select all (Ctrl+A) then delete
			const selectAllDown: RemoteKeyboardEvent = {
				type: 'keydown',
				key: 'a',
				code: 'KeyA',
				modifiers: { ctrl: true },
				timestamp: this.now(),
			}
			await this.hotLayer.sendInputEvent(selectAllDown)

			const deleteKey: RemoteKeyboardEvent = {
				type: 'keydown',
				key: 'Backspace',
				code: 'Backspace',
				timestamp: this.now(),
			}
			await this.hotLayer.sendInputEvent(deleteKey)

			// Type new text
			const typeEvent: RemoteTypeEvent = {
				type: 'type',
				elementId: index,
				text,
				timestamp: this.now(),
			}
			await this.hotLayer.sendInputEvent(typeEvent)

			const desc = el.label || el.tag
			return {
				success: true,
				message: `Cleared and typed (${text}) into element [${index}] (${desc}).`,
			}
		} catch (error) {
			return { success: false, message: `Failed to clear and type: ${error}` }
		}
	}

	// ======= Mask Operations (no-ops for remote) =======

	async showMask(): Promise<void> {
		/* no-op */
	}
	async hideMask(): Promise<void> {
		/* no-op */
	}

	dispose(): void {
		this.disposed = true
		this.snapshot = null
		this.elementMap.clear()
	}
}
