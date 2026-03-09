import type { BrowserState } from '@page-agent/page-controller'

import type {
	DiffFrame,
	HotLayerConfig,
	LayerSyncStatus,
	MirrorSessionId,
	VisualFrame,
} from '../types'

// ---------------------------------------------------------------------------
// Hot Layer – Real-Time Visual State Sync
// ---------------------------------------------------------------------------
//
// The hot layer keeps the remote shadow browser's visual output synchronised
// with the local browser in near-real-time.  This is the fastest-moving layer
// and operates as a continuous stream.
//
// Responsibilities:
//   - Capture visual frames from the remote browser (screenshots / RFB stream)
//   - Stream the local browser's DOM mutations & viewport changes to the remote
//   - Provide a composited view the page-agent can reason over
//   - Relay user input events (keyboard, mouse, touch) to the remote when
//     the agent decides to act
//
// The hot layer is the primary feedback loop: the page-agent observes the
// remote browser through visual frames and BrowserState snapshots produced
// here, then issues actions that are forwarded back to the remote.
// ---------------------------------------------------------------------------

/** A DOM mutation observed in the local browser to be replayed on the remote */
export interface DomMutation {
	/** Target element selector (CSS or XPath) */
	target: string
	type: 'childList' | 'attributes' | 'characterData'
	/** For attribute changes */
	attributeName?: string
	attributeValue?: string | null
	/** Serialised HTML for childList additions */
	addedNodes?: string[]
	/** Selectors for childList removals */
	removedNodes?: string[]
	/** New text content for characterData */
	newValue?: string
	timestamp: string
}

/** Scroll position delta to replay on the remote */
export interface ScrollState {
	/** CSS selector of the scroll container (or "window" for the viewport) */
	container: string
	scrollX: number
	scrollY: number
	timestamp: string
}

/** Input event to forward to the remote browser */
export type RemoteInputEvent =
	| RemoteMouseEvent
	| RemoteKeyboardEvent
	| RemoteTouchEvent
	| RemoteWheelEvent

export interface RemoteMouseEvent {
	type: 'mousedown' | 'mouseup' | 'mousemove' | 'click' | 'dblclick' | 'contextmenu'
	x: number
	y: number
	button?: number
	timestamp: string
}

export interface RemoteKeyboardEvent {
	type: 'keydown' | 'keyup' | 'keypress'
	key: string
	code: string
	modifiers?: {
		ctrl?: boolean
		shift?: boolean
		alt?: boolean
		meta?: boolean
	}
	timestamp: string
}

export interface RemoteTouchEvent {
	type: 'touchstart' | 'touchmove' | 'touchend' | 'touchcancel'
	touches: Array<{ x: number; y: number; id: number }>
	timestamp: string
}

export interface RemoteWheelEvent {
	type: 'wheel'
	x: number
	y: number
	deltaX: number
	deltaY: number
	timestamp: string
}

/** Quality / performance metrics for the visual stream */
export interface HotLayerMetrics {
	/** Actual frames per second being delivered */
	currentFps: number
	/** Average frame latency in ms (capture → delivery) */
	avgLatencyMs: number
	/** Current bandwidth usage in kbps */
	bandwidthKbps: number
	/** Number of frames dropped due to bandwidth constraints */
	droppedFrames: number
	/** Total frames delivered since session start */
	totalFrames: number
	/** Whether differential encoding is active */
	differentialActive: boolean
}

// ---------------------------------------------------------------------------
// Hot Layer Interface
// ---------------------------------------------------------------------------

/**
 * The hot layer provides real-time visual synchronisation between the local
 * and remote browsers.
 *
 * It is the page-agent's eyes and hands on the remote environment:
 *   - **Eyes**: Visual frames and BrowserState snapshots flow from remote → local.
 *   - **Hands**: Input events and DOM mutations flow from local → remote.
 *
 * Lifecycle:
 *   1. `initialize()` – Establish the streaming connection to the remote.
 *   2. Subscribe to frames via `onFrame()`.
 *   3. Push local changes via `pushDomMutations()` / `pushScrollState()`.
 *   4. Forward agent actions via `sendInputEvent()`.
 *   5. `dispose()` – Tear down the stream.
 */
export interface IHotLayer {
	readonly status: LayerSyncStatus

	/**
	 * Establish the visual streaming connection to the remote shadow browser.
	 */
	initialize(
		sessionId: MirrorSessionId,
		config: HotLayerConfig
	): Promise<void>

	// -- Remote → Local (observation) ----------------------------------------

	/**
	 * Subscribe to visual frames arriving from the remote browser.
	 * Returns an unsubscribe function.
	 */
	onFrame(handler: (frame: VisualFrame | DiffFrame) => void): () => void

	/**
	 * Request the latest full (non-differential) frame on demand.
	 * Useful when the agent needs a fresh baseline.
	 */
	captureFrame(): Promise<VisualFrame>

	/**
	 * Get the latest BrowserState snapshot from the remote.
	 * This is the same structured state that PageController produces locally.
	 */
	getRemoteBrowserState(): Promise<BrowserState>

	// -- Local → Remote (action) --------------------------------------------

	/**
	 * Push observed DOM mutations from the local browser to the remote.
	 * The remote will attempt to replay them.
	 */
	pushDomMutations(mutations: DomMutation[]): Promise<void>

	/**
	 * Push scroll position changes from the local browser to the remote.
	 */
	pushScrollState(state: ScrollState): Promise<void>

	/**
	 * Forward an input event to the remote browser.
	 * This is how the page-agent "acts" on the remote.
	 */
	sendInputEvent(event: RemoteInputEvent): Promise<void>

	// -- Adaptive quality ---------------------------------------------------

	/**
	 * Dynamically adjust streaming parameters without reinitializing.
	 */
	updateConfig(config: Partial<HotLayerConfig>): Promise<void>

	/**
	 * Get current performance metrics for the visual stream.
	 */
	getMetrics(): HotLayerMetrics

	// -- Lifecycle ----------------------------------------------------------

	/**
	 * Pause the visual stream (e.g. when the tab is backgrounded).
	 * Frames stop being delivered but the connection stays open.
	 */
	pause(): void

	/**
	 * Resume a paused visual stream.
	 */
	resume(): void

	/**
	 * Tear down the streaming connection and release resources.
	 */
	dispose(): Promise<void>
}
