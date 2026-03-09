import type { AgentConfig } from '@page-agent/core'
import type { BrowserState } from '@page-agent/page-controller'

import type { ICloudAgentClient } from './cloud-agent/client'
import type { CloudAgent } from './cloud-agent/types'
import type { IColdLayer, ProfileSnapshot } from './layers/cold'
import type { IHotLayer, RemoteInputEvent } from './layers/hot'
import type { IWarmLayer, WarmLayerSnapshot } from './layers/warm'
import type {
	MirrorConfig,
	MirrorEvent,
	MirrorSessionId,
	MirrorState,
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
 * module.  It coordinates the three sync layers:
 *
 *   **Cold**  → Chrome profile bootstrap (Rust launcher, large & slow)
 *   **Warm**  → Identity / auth / secrets / payment (event-driven, medium)
 *   **Hot**   → Visual state streaming (continuous, fast)
 *
 * It also manages the lifecycle of the remote cloud agent that provides the
 * actual headless browser environment.
 *
 * Typical usage:
 * ```ts
 * const mirror = createMirrorController(config)
 * const session = await mirror.startSession()
 *
 * // The remote browser is now mirroring the user's local state.
 * // The page-agent can observe it:
 * const frame = await mirror.captureRemoteFrame()
 * const state = await mirror.getRemoteBrowserState()
 *
 * // ... and act on it:
 * await mirror.sendInputToRemote({ type: 'click', x: 100, y: 200, timestamp: new Date().toISOString() })
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
	 *   2. Cold-sync the Chrome profile to the remote.
	 *   3. Warm-sync auth/identity state.
	 *   4. Establish the hot visual stream.
	 *
	 * @returns The session ID and the cloud agent backing it.
	 */
	startSession(): Promise<{
		sessionId: MirrorSessionId
		cloudAgent: CloudAgent
	}>

	/**
	 * Gracefully end the current session:
	 *   1. Tear down the hot stream.
	 *   2. Optionally sync profile changes back (cold bidirectional).
	 *   3. Stop (but don't delete) the cloud agent.
	 *
	 * @param options.deleteAgent - Delete the cloud agent entirely (default: false)
	 * @param options.syncBack - Pull remote profile changes to local (default: config.cold.bidirectional)
	 */
	endSession(options?: {
		deleteAgent?: boolean
		syncBack?: boolean
	}): Promise<void>

	/**
	 * Reconnect to an existing session after a disconnect.
	 * Skips cold-sync if the remote still has a valid profile snapshot.
	 */
	reconnect(sessionId: MirrorSessionId): Promise<void>

	// -- Observation (remote → local) ----------------------------------------

	/**
	 * Capture the latest visual frame from the remote browser.
	 */
	captureRemoteFrame(): Promise<VisualFrame>

	/**
	 * Get the structured BrowserState from the remote browser.
	 * Equivalent to what PageController.getBrowserState() returns locally.
	 */
	getRemoteBrowserState(): Promise<BrowserState>

	/**
	 * Subscribe to visual frames from the remote browser.
	 * Returns an unsubscribe function.
	 */
	onRemoteFrame(handler: (frame: VisualFrame) => void): () => void

	// -- Action (local → remote) ---------------------------------------------

	/**
	 * Send an input event (click, type, scroll, etc.) to the remote browser.
	 */
	sendInputToRemote(event: RemoteInputEvent): Promise<void>

	/**
	 * Navigate the remote browser to a URL.
	 * Convenience wrapper that issues a cloud-agent follow-up task.
	 */
	navigateRemote(url: string): Promise<void>

	/**
	 * Execute a free-form task on the remote browser via the cloud agent.
	 * The task is expressed as a natural-language prompt and may include images.
	 */
	executeRemoteTask(prompt: string, images?: Array<{
		data: string
		dimension: { width: number; height: number }
	}>): Promise<CloudAgent>

	// -- Sync control --------------------------------------------------------

	/**
	 * Force a full re-sync of a specific layer (or all layers).
	 */
	forceSync(layer?: 'cold' | 'warm' | 'hot'): Promise<void>

	/**
	 * Get the cold-layer profile snapshot.
	 */
	getProfileSnapshot(): ProfileSnapshot | null

	/**
	 * Get the warm-layer credential snapshot.
	 */
	getAuthSnapshot(): WarmLayerSnapshot | null

	// -- Events --------------------------------------------------------------

	/**
	 * Subscribe to mirror events (status changes, sync progress, errors).
	 * Returns an unsubscribe function.
	 */
	onEvent(handler: (event: MirrorEvent) => void): () => void

	// -- Lifecycle -----------------------------------------------------------

	/**
	 * Dispose of all resources, including stopping the cloud agent.
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
