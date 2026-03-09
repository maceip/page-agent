import type { BrowserState } from '@page-agent/page-controller'

import type {
	DiffFrame,
	HotLayerConfig,
	LayerSyncStatus,
	MirrorSessionId,
	SpatialElement,
	TauriWindowState,
	VisualFrame,
} from '../types'

// ---------------------------------------------------------------------------
// Hot Layer – MoQ Pipeline + Micro-DOM Spatial Extractor + Invisible UI Projector
// ---------------------------------------------------------------------------
//
// The hot layer provides ultra-low latency pixel streaming and native OS
// input spoofing when the cloud drives the viewport.
//
// Architecture:
//   - **MoQ Pipeline**: The cloud captures its headless framebuffer,
//     hardware-encodes to AV1, and streams via Media over QUIC (unreliable
//     datagrams).  Tauri feeds these frames into a WebCodecs <canvas> that
//     perfectly overlays the local Chrome window.
//
//   - **Micro-DOM Spatial Extractor**: The cloud fires native CDP
//     DOMSnapshot.captureSnapshot to extract a spatial map — the exact
//     (x, y, width, height) coordinates of interactable elements.
//
//   - **Invisible UI Projector**: Tauri receives the spatial map via QUIC
//     and renders completely transparent native HTML <input> tags directly
//     over the video <canvas>.  This tricks the local OS, native cursors,
//     and password managers into functioning normally over a flat video stream.
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

/** Input event to forward to the remote browser via CDP Input domain */
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

/** Quality / performance metrics for the MoQ visual stream */
export interface HotLayerMetrics {
	/** Actual frames per second being delivered */
	currentFps: number
	/** Average frame latency in ms (capture → delivery) */
	avgLatencyMs: number
	/** Current bandwidth usage in kbps */
	bandwidthKbps: number
	/** Number of frames dropped (expected with unreliable datagrams) */
	droppedFrames: number
	/** Total frames delivered since session start */
	totalFrames: number
	/** Whether differential encoding is active */
	differentialActive: boolean
	/** Video codec currently in use */
	activeCodec: 'av1' | 'h264' | 'vp9'
	/** Whether the MoQ pipeline is using unreliable QUIC datagrams */
	unreliableDatagrams: boolean
	/** Number of spatial map updates received from the Micro-DOM extractor */
	spatialMapUpdates: number
	/** Number of invisible input elements currently projected */
	projectedInputCount: number
}

/**
 * Visual handoff control.
 *
 * During certain flows (e.g. cloud-passkey login), the hot layer
 * performs a "visual handoff": Tauri brings the WebCodecs <canvas>
 * to the front, obscuring the local browser.  The cloud browser
 * operates visually, and when done, the canvas is destroyed and
 * the local browser is revealed.
 */
export interface VisualHandoffRequest {
	/** Reason for the handoff (for logging / UX) */
	trigger: string
	/**
	 * Direction of the handoff:
	 *   - 'local-to-cloud': Cloud takes over the viewport
	 *   - 'cloud-to-local': Control returns to the local browser
	 */
	direction: 'local-to-cloud' | 'cloud-to-local'
	/**
	 * For 'cloud-to-local' handoffs, the CDP Page.loadEventFired event
	 * URL that must fire before the canvas is destroyed.
	 */
	awaitLocalLoad?: string
}

// ---------------------------------------------------------------------------
// Hot Layer Interface
// ---------------------------------------------------------------------------

/**
 * The hot layer provides real-time visual synchronisation between the local
 * and remote browsers via:
 *   - **MoQ Pipeline**: AV1-encoded frames over unreliable QUIC datagrams
 *   - **WebCodecs <canvas>**: Hardware-decoded frames overlaid on the local window
 *   - **Micro-DOM Spatial Extractor**: CDP DOMSnapshot.captureSnapshot spatial maps
 *   - **Invisible UI Projector**: Transparent native <input> elements over canvas
 *
 * It is the page-agent's eyes and hands on the remote environment:
 *   - **Eyes**: Visual frames and BrowserState snapshots flow from remote → local.
 *   - **Hands**: Input events and DOM mutations flow from local → remote.
 *
 * Lifecycle:
 *   1. `initialize()` – Open MoQ stream, set up WebCodecs decoder, start spatial extractor.
 *   2. Subscribe to frames via `onFrame()`.
 *   3. Push local changes via `pushDomMutations()` / `pushScrollState()`.
 *   4. Forward agent actions via `sendInputEvent()` (mapped to CDP Input domain).
 *   5. Perform visual handoffs for cloud-driven flows.
 *   6. `dispose()` – Tear down the MoQ stream, destroy canvas, remove projections.
 */
export interface IHotLayer {
	readonly status: LayerSyncStatus

	/**
	 * Establish the MoQ streaming pipeline:
	 *   1. Open a QUIC connection with unreliable datagram support.
	 *   2. Initialize the WebCodecs decoder for the configured codec (AV1/H264/VP9).
	 *   3. Start the Micro-DOM spatial extractor on the cloud side.
	 *   4. Optionally initialize the Invisible UI Projector.
	 */
	initialize(
		sessionId: MirrorSessionId,
		config: HotLayerConfig,
		remoteCdpUrl: string
	): Promise<void>

	// -- Remote → Local (observation) ----------------------------------------

	/**
	 * Subscribe to visual frames arriving from the remote browser via MoQ.
	 * Returns an unsubscribe function.
	 */
	onFrame(handler: (frame: VisualFrame | DiffFrame) => void): () => void

	/**
	 * Subscribe to spatial map updates from the Micro-DOM Spatial Extractor.
	 * These are extracted via CDP DOMSnapshot.captureSnapshot on the cloud.
	 */
	onSpatialMapUpdate(handler: (elements: SpatialElement[]) => void): () => void

	/**
	 * Request the latest full (non-differential) frame on demand.
	 * Forces a keyframe from the MoQ pipeline.
	 */
	captureFrame(): Promise<VisualFrame>

	/**
	 * Get the latest BrowserState snapshot from the remote.
	 * This is the same structured state that PageController produces locally.
	 */
	getRemoteBrowserState(): Promise<BrowserState>

	/**
	 * Get the latest spatial map from the Micro-DOM extractor.
	 */
	getSpatialMap(): SpatialElement[]

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
	 * Internally maps to CDP Input.dispatchMouseEvent / Input.dispatchKeyEvent / etc.
	 */
	sendInputEvent(event: RemoteInputEvent): Promise<void>

	// -- Visual Handoff (Tauri canvas overlay) --------------------------------

	/**
	 * Initiate a visual handoff between local and cloud browsers.
	 *
	 * 'local-to-cloud': Tauri brings the WebCodecs <canvas> to the front,
	 * overlaying the local Chrome window with the cloud's pixel stream.
	 *
	 * 'cloud-to-local': Tauri waits for the local Chrome's Page.loadEventFired,
	 * then destroys the canvas overlay, revealing the local browser.
	 */
	initiateHandoff(request: VisualHandoffRequest): Promise<void>

	/**
	 * Get the current Tauri window state (overlay, projection, etc.).
	 */
	getWindowState(): TauriWindowState

	// -- Invisible UI Projector ----------------------------------------------

	/**
	 * Force a refresh of the projected transparent input elements.
	 * Typically called after a spatial map update.
	 */
	refreshProjectedInputs(): Promise<void>

	// -- Adaptive quality ---------------------------------------------------

	/**
	 * Dynamically adjust streaming parameters without reinitializing.
	 * Can switch codecs, change FPS, toggle unreliable datagrams, etc.
	 */
	updateConfig(config: Partial<HotLayerConfig>): Promise<void>

	/**
	 * Get current performance metrics for the MoQ visual stream.
	 */
	getMetrics(): HotLayerMetrics

	// -- Lifecycle ----------------------------------------------------------

	/**
	 * Pause the MoQ stream (e.g. when the tab is backgrounded).
	 * Frames stop being delivered but the QUIC connection stays open.
	 */
	pause(): void

	/**
	 * Resume a paused MoQ stream.
	 */
	resume(): void

	/**
	 * Tear down the hot layer:
	 *   - Close the MoQ pipeline
	 *   - Destroy the WebCodecs decoder
	 *   - Remove the canvas overlay
	 *   - Remove all projected input elements
	 */
	dispose(): Promise<void>
}
