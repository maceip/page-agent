import type { AgentConfig } from '@page-agent/core'
import type { BrowserState } from '@page-agent/page-controller'

import type { ICloudAgentClient } from './cloud-agent/client'
import type { CloudAgent } from './cloud-agent/types'
import type { IColdLayer, ProfileSnapshot } from './layers/cold'
import type { IHotLayer, RemoteInputEvent, VisualHandoffRequest } from './layers/hot'
import type { IWarmLayer, WarmLayerSnapshot } from './layers/warm'
import type {
	FetchInterceptPayload,
	MirrorConfig,
	MirrorEvent,
	MirrorSessionId,
	MirrorState,
	SpatialElement,
	VisualFrame,
} from './types'

// ---------------------------------------------------------------------------
// MirrorController – Orchestrates all three sync layers
// ---------------------------------------------------------------------------

/**
 * Configuration for the MirrorController, combining mirror-specific settings
 * with the page-agent's AgentConfig so the controller can spin up agents
 * that operate the remote browser.
 */
export interface MirrorControllerConfig extends MirrorConfig {
	/**
	 * Agent configuration used when the mirror controller needs to issue
	 * tasks to the remote cloud agent (e.g. "navigate to X", "click Y").
	 */
	agentConfig?: Partial<AgentConfig>
}

/**
 * The MirrorController is the top-level orchestrator for the `@page-agent/mirror`
 * module.  It coordinates the three sync layers and the Tauri window manager:
 *
 *   **Cold**  → Tauri Ephemeral Bootstrapper + Chrome profile (zstd, QUIC)
 *   **Warm**  → CDP Event Bus + Identity Replicator + Navigation Proxy (CDP, QUIC)
 *   **Hot**   → MoQ Pipeline + WebCodecs + Invisible UI Projector (QUIC datagrams)
 *
 * Tauri holds two "strings" (CDP connections): one to the local Chrome, one
 * relayed to the cloud Chrome, orchestrating them as identical twins.
 *
 * Typical usage:
 * ```ts
 * const mirror = createMirrorController(config)
 * const session = await mirror.startSession()
 *
 * // The remote browser is now mirroring the user's local state.
 * const frame = await mirror.captureRemoteFrame()
 * const state = await mirror.getRemoteBrowserState()
 *
 * // Handle navigation intercepts (phishing detection, etc.)
 * mirror.onNavigationIntercept(async (intercept) => {
 *   if (intercept.flagged) {
 *     await mirror.resolveIntercept(intercept.requestId, 'fulfill', {
 *       body: '<h1>Blocked</h1>',
 *       statusCode: 403,
 *     })
 *   } else {
 *     await mirror.resolveIntercept(intercept.requestId, 'continue')
 *   }
 * })
 *
 * // Perform a visual handoff for cloud-driven flows
 * await mirror.initiateVisualHandoff({
 *   trigger: 'cloud-passkey-login',
 *   direction: 'local-to-cloud',
 * })
 *
 * // When done:
 * await mirror.endSession()
 * ```
 */
export interface IMirrorController {
	// -- State ---------------------------------------------------------------

	/** Current aggregate mirror state */
	readonly state: MirrorState

	/** Access to the underlying layer implementations (for advanced use) */
	readonly layers: {
		readonly cold: IColdLayer
		readonly warm: IWarmLayer
		readonly hot: IHotLayer
	}

	/** The cloud-agent client used to manage the remote environment */
	readonly cloudClient: ICloudAgentClient

	// -- Session lifecycle ---------------------------------------------------

	/**
	 * Start a new mirror session:
	 *   1. Launch (or reuse) a cloud agent with a running browser environment.
	 *   2. Cold-sync: Tauri fetches zstd payload, extracts, spawns local Chrome.
	 *   3. Warm-sync: CDP Event Bus connects, Identity Replicator starts,
	 *      Navigation Proxy (Fetch domain) begins intercepting.
	 *   4. Hot: MoQ pipeline opens, WebCodecs decoder initializes,
	 *      Micro-DOM Spatial Extractor starts, Invisible UI Projector ready.
	 *
	 * @returns The session ID and the cloud agent backing it.
	 */
	startSession(): Promise<{
		sessionId: MirrorSessionId
		cloudAgent: CloudAgent
	}>

	/**
	 * Gracefully end the current session:
	 *   1. Tear down the MoQ stream and canvas overlay.
	 *   2. Disable Fetch interception and close CDP connections.
	 *   3. Optionally sync profile changes back (cold bidirectional).
	 *   4. Tauri cleans up the ephemeral profile directory.
	 *   5. Stop (but don't delete) the cloud agent.
	 */
	endSession(options?: { deleteAgent?: boolean; syncBack?: boolean }): Promise<void>

	/**
	 * Reconnect to an existing session after a disconnect.
	 * Skips cold-sync if the remote still has a valid profile snapshot.
	 */
	reconnect(sessionId: MirrorSessionId): Promise<void>

	// -- Observation (remote → local) ----------------------------------------

	/** Capture the latest visual frame from the remote browser (forces MoQ keyframe). */
	captureRemoteFrame(): Promise<VisualFrame>

	/**
	 * Get the structured BrowserState from the remote browser.
	 * Equivalent to what PageController.getBrowserState() returns locally.
	 */
	getRemoteBrowserState(): Promise<BrowserState>

	/** Subscribe to visual frames from the remote browser. */
	onRemoteFrame(handler: (frame: VisualFrame) => void): () => void

	/** Get the latest Micro-DOM spatial map from the cloud browser. */
	getSpatialMap(): SpatialElement[]

	/** Subscribe to spatial map updates from the Micro-DOM extractor. */
	onSpatialMapUpdate(handler: (elements: SpatialElement[]) => void): () => void

	// -- Action (local → remote) ---------------------------------------------

	/**
	 * Send an input event (click, type, scroll, etc.) to the remote browser.
	 * Internally mapped to CDP Input.dispatchMouseEvent / Input.dispatchKeyEvent.
	 */
	sendInputToRemote(event: RemoteInputEvent): Promise<void>

	/**
	 * Navigate the remote browser to a URL.
	 * Convenience wrapper that issues a CDP Page.navigate on the remote.
	 */
	navigateRemote(url: string): Promise<void>

	/**
	 * Execute a free-form task on the remote browser via the cloud agent.
	 * The task is expressed as a natural-language prompt and may include images.
	 */
	executeRemoteTask(
		prompt: string,
		images?: {
			data: string
			dimension: { width: number; height: number }
		}[]
	): Promise<CloudAgent>

	// -- Visual Handoff (Tauri canvas overlay) --------------------------------

	/**
	 * Initiate a visual handoff between local and cloud browsers.
	 *
	 * Example: User clicks "Use Cloud Passkey" → local-to-cloud handoff →
	 * cloud logs in → cloud-to-local handoff when local Page.loadEventFired.
	 */
	initiateVisualHandoff(request: VisualHandoffRequest): Promise<void>

	// -- Navigation Proxy (Chaperone) ----------------------------------------

	/**
	 * Subscribe to navigation intercepts from the warm layer's Chaperone.
	 * These are Fetch.requestPaused events from the local browser.
	 */
	onNavigationIntercept(
		handler: (
			intercept: FetchInterceptPayload & {
				flagged: boolean
				flagReason?: string
			}
		) => void
	): () => void

	/**
	 * Resolve a navigation intercept (continue, fulfill with interstitial, or fail).
	 */
	resolveIntercept(
		requestId: string,
		resolution: FetchInterceptPayload['resolution'],
		fulfillOptions?: {
			body: string
			statusCode?: number
			headers?: Record<string, string>
		}
	): Promise<void>

	// -- Sync control --------------------------------------------------------

	/** Force a full re-sync of a specific layer (or all layers). */
	forceSync(layer?: 'cold' | 'warm' | 'hot'): Promise<void>

	/** Get the cold-layer profile snapshot. */
	getProfileSnapshot(): ProfileSnapshot | null

	/** Get the warm-layer credential snapshot. */
	getAuthSnapshot(): WarmLayerSnapshot | null

	// -- Events --------------------------------------------------------------

	/** Subscribe to mirror events (status changes, sync progress, errors). */
	onEvent(handler: (event: MirrorEvent) => void): () => void

	// -- Lifecycle -----------------------------------------------------------

	/**
	 * Dispose of all resources:
	 *   - Stop the MoQ pipeline and destroy the canvas
	 *   - Disable CDP Fetch interception and close WebSocket connections
	 *   - Clean up the ephemeral profile directory via Tauri
	 *   - Stop the cloud agent
	 */
	dispose(): Promise<void>
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Factory function type for creating a MirrorController.
 *
 * Implementation will be provided in a follow-up – this is the contract that
 * consumers can program against today.
 */
export type CreateMirrorController = (config: MirrorControllerConfig) => IMirrorController
