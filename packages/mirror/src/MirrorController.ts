import type { AgentConfig } from '@page-agent/core'
import type { BrowserState } from '@page-agent/page-controller'

import { MirrorSession } from './MirrorSession'
import { createCloudAgentClient } from './cloud-agent/CloudAgentClient'
import type { ICloudAgentClient } from './cloud-agent/client'
import type { CloudAgent } from './cloud-agent/types'
import type { IColdLayer, ProfileSnapshot } from './layers/cold'
import type { IHotLayer, RemoteInputEvent, VisualHandoffRequest } from './layers/hot'
import type { IWarmLayer, WarmLayerSnapshot } from './layers/warm'
import type {
	DiffFrame,
	FetchInterceptPayload,
	MirrorConfig,
	MirrorEvent,
	MirrorSessionId,
	MirrorState,
	SpatialElement,
	VisualFrame,
} from './types'

function createSessionId(): MirrorSessionId {
	const raw =
		typeof globalThis.crypto?.randomUUID === 'function'
			? globalThis.crypto.randomUUID()
			: `mirror_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
	return raw as MirrorSessionId
}

function nowIso(): string {
	return new Date().toISOString()
}

function isVisualFrame(frame: VisualFrame | DiffFrame): frame is VisualFrame {
	return 'format' in frame
}

function isSnapshotLike(update: unknown): update is { elements: SpatialElement[] } {
	return (
		typeof update === 'object' &&
		update !== null &&
		Array.isArray((update as { elements?: unknown }).elements)
	)
}

// ---------------------------------------------------------------------------
// MirrorController – Orchestrates all three sync layers
// ---------------------------------------------------------------------------

export interface MirrorControllerDependencies {
	coldLayer: IColdLayer
	warmLayer: IWarmLayer
	hotLayer: IHotLayer
	cloudClient?: ICloudAgentClient
}

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

	/** Concrete runtime dependencies required by the orchestrator. */
	dependencies: MirrorControllerDependencies
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
 */
export type CreateMirrorController = (config: MirrorControllerConfig) => IMirrorController

export class MirrorController implements IMirrorController {
	readonly layers: { readonly cold: IColdLayer; readonly warm: IWarmLayer; readonly hot: IHotLayer }
	readonly cloudClient: ICloudAgentClient
	readonly config: MirrorControllerConfig

	state: MirrorState

	private activeCloudAgent: CloudAgent | null = null
	private mirrorSession: MirrorSession | null = null
	private disposed = false
	private layerUnsubscribers: (() => void)[] = []

	private eventHandlers = new Set<(event: MirrorEvent) => void>()
	private frameHandlers = new Set<(frame: VisualFrame) => void>()
	private spatialHandlers = new Set<(elements: SpatialElement[]) => void>()
	private navigationHandlers = new Set<
		(
			intercept: FetchInterceptPayload & {
				flagged: boolean
				flagReason?: string
			}
		) => void
	>()

	constructor(config: MirrorControllerConfig) {
		this.config = config
		this.layers = {
			cold: config.dependencies.coldLayer,
			warm: config.dependencies.warmLayer,
			hot: config.dependencies.hotLayer,
		}
		this.cloudClient =
			config.dependencies.cloudClient ??
			createCloudAgentClient({
				apiKey: config.apiKey,
				baseUrl: config.apiBaseUrl,
			})

		this.state = {
			sessionId: createSessionId(),
			status: 'disconnected',
			cold: 'idle',
			warm: 'idle',
			hot: 'idle',
			context: config.context ?? null,
			lastFullSync: null,
			cloudAgentId: null,
			localCdpEndpoint: null,
			remoteCdpEndpoint: null,
		}
	}

	private assertUsable(): void {
		if (this.disposed) {
			throw new Error('MirrorController has been disposed.')
		}
	}

	private emitEvent(event: MirrorEvent): void {
		for (const handler of this.eventHandlers) {
			handler(event)
		}
	}

	private setStatus(status: MirrorState['status']): void {
		if (this.state.status === status) return
		const previous = this.state.status
		this.state = { ...this.state, status }
		this.emitEvent({ type: 'mirror:status-change', previous, current: status })
	}

	private setLayerStatus(
		layer: 'cold' | 'warm' | 'hot',
		status: MirrorState['cold'],
		durationMs?: number
	): void {
		this.state = { ...this.state, [layer]: status }
		this.emitEvent({
			type: 'mirror:layer-sync',
			layer,
			status,
			durationMs,
		})
	}

	private resetLayerSubscriptions(): void {
		for (const unsub of this.layerUnsubscribers) {
			unsub()
		}
		this.layerUnsubscribers = []
	}

	private bindLayerSubscriptions(): void {
		this.resetLayerSubscriptions()

		this.layerUnsubscribers.push(
			this.layers.hot.onFrame((frame) => {
				if (!isVisualFrame(frame)) return
				for (const handler of this.frameHandlers) {
					handler(frame)
				}
			})
		)

		this.layerUnsubscribers.push(
			this.layers.hot.onSpatialMapUpdate((update) => {
				const elements = isSnapshotLike(update) ? update.elements : this.layers.hot.getSpatialMap()
				for (const handler of this.spatialHandlers) {
					handler(elements)
				}
			})
		)

		this.layerUnsubscribers.push(
			this.layers.warm.onAuthEvent((event) => {
				if (event.type !== 'navigation-intercept') return

				const decorated = {
					...event.intercept,
					flagged: false,
				}

				for (const handler of this.navigationHandlers) {
					handler(decorated)
				}

				this.emitEvent({
					type: 'mirror:navigation-intercept',
					requestedUrl: event.intercept.url,
					requestId: event.intercept.requestId,
					flagged: false,
				})
			})
		)
	}

	private async cleanupLayers(syncBack: boolean): Promise<void> {
		this.resetLayerSubscriptions()
		this.mirrorSession?.dispose()
		this.mirrorSession = null

		await this.layers.hot.dispose()
		await this.layers.warm.dispose()

		if (syncBack && this.config.cold?.bidirectional) {
			await this.layers.cold.syncFromRemote()
		}
		await this.layers.cold.dispose()

		this.setLayerStatus('hot', 'idle')
		this.setLayerStatus('warm', 'idle')
		this.setLayerStatus('cold', 'idle')
	}

	async startSession(): Promise<{ sessionId: MirrorSessionId; cloudAgent: CloudAgent }> {
		this.assertUsable()
		if (this.state.status === 'live') {
			throw new Error('Mirror session is already running.')
		}

		const sessionId = createSessionId()
		this.state = {
			...this.state,
			sessionId,
			cold: 'idle',
			warm: 'idle',
			hot: 'idle',
		}

		this.setStatus('initializing')

		try {
			const cloudAgent = await this.cloudClient.launchAgent({
				prompt: {
					text: `Initialize browser mirror session ${sessionId}. Keep a running browser environment ready for CDP-driven mirroring.`,
				},
				model: this.config.agentConfig?.model,
				source: {
					repository: this.config.repository,
					ref: this.config.ref,
				},
				webhook: this.config.webhookUrl
					? {
							url: this.config.webhookUrl,
							secret: this.config.webhookSecret,
						}
					: undefined,
			})

			this.activeCloudAgent = cloudAgent
			const remoteCdpEndpoint = this.config.remoteCdpUrl ?? cloudAgent.target.url ?? null
			if (!remoteCdpEndpoint) {
				throw new Error(
					'Remote CDP endpoint is missing. Provide config.remoteCdpUrl or cloud agent target.url.'
				)
			}

			this.state = {
				...this.state,
				cloudAgentId: cloudAgent.id,
				remoteCdpEndpoint,
			}
			this.emitEvent({
				type: 'mirror:cloud-agent',
				agentId: cloudAgent.id,
				agentStatus: cloudAgent.status,
			})

			const coldStarted = Date.now()
			this.setStatus('cold-syncing')
			this.setLayerStatus('cold', 'syncing')
			const coldResult = await this.layers.cold.initialize(
				sessionId,
				this.config.cold ?? {},
				this.config.quic
			)
			this.state = {
				...this.state,
				localCdpEndpoint: coldResult.cdpConnection.webSocketDebuggerUrl,
			}
			this.setLayerStatus('cold', 'synced', Date.now() - coldStarted)

			const warmStarted = Date.now()
			this.setStatus('warm-syncing')
			this.setLayerStatus('warm', 'syncing')
			await this.layers.warm.initialize(
				sessionId,
				this.config.warm ?? {},
				coldResult.cdpConnection.webSocketDebuggerUrl,
				remoteCdpEndpoint
			)
			this.setLayerStatus('warm', 'synced', Date.now() - warmStarted)

			const hotStarted = Date.now()
			this.setLayerStatus('hot', 'syncing')
			await this.layers.hot.initialize(sessionId, this.config.hot ?? {}, remoteCdpEndpoint)
			this.setLayerStatus('hot', 'synced', Date.now() - hotStarted)

			this.bindLayerSubscriptions()
			this.mirrorSession = new MirrorSession(this.layers.hot)
			this.mirrorSession.start()

			this.state = {
				...this.state,
				lastFullSync: nowIso(),
			}
			this.setStatus('live')

			return { sessionId, cloudAgent }
		} catch (cause) {
			this.setStatus('error')
			this.emitEvent({
				type: 'mirror:error',
				layer: 'controller',
				message: 'Failed to start mirror session.',
				cause,
			})
			await this.cleanupLayers(false).catch(() => undefined)
			throw cause
		}
	}

	async endSession(options?: { deleteAgent?: boolean; syncBack?: boolean }): Promise<void> {
		if (this.disposed) return

		const deleteAgent = options?.deleteAgent ?? false
		const syncBack = options?.syncBack ?? true

		await this.cleanupLayers(syncBack)

		if (this.activeCloudAgent) {
			const active = this.activeCloudAgent
			this.activeCloudAgent = null
			if (deleteAgent) {
				await this.cloudClient.deleteAgent(active.id)
			} else {
				await this.cloudClient.stopAgent(active.id)
			}
		}

		this.state = {
			...this.state,
			cloudAgentId: null,
			localCdpEndpoint: null,
			remoteCdpEndpoint: null,
		}
		this.setStatus('disconnected')
	}

	async reconnect(sessionId: MirrorSessionId): Promise<void> {
		this.assertUsable()
		if (this.state.sessionId !== sessionId) {
			throw new Error(`Can not reconnect to unknown session: ${sessionId}`)
		}
		if (!this.state.localCdpEndpoint || !this.state.remoteCdpEndpoint) {
			throw new Error('Reconnect requires existing local and remote CDP endpoints.')
		}
		this.setStatus('initializing')

		await this.layers.warm.initialize(
			sessionId,
			this.config.warm ?? {},
			this.state.localCdpEndpoint,
			this.state.remoteCdpEndpoint
		)
		await this.layers.hot.initialize(sessionId, this.config.hot ?? {}, this.state.remoteCdpEndpoint)
		this.bindLayerSubscriptions()
		this.mirrorSession?.dispose()
		this.mirrorSession = new MirrorSession(this.layers.hot)
		this.mirrorSession.start()
		this.setLayerStatus('warm', 'synced')
		this.setLayerStatus('hot', 'synced')
		this.setStatus('live')
	}

	captureRemoteFrame(): Promise<VisualFrame> {
		this.assertUsable()
		return this.layers.hot.captureFrame()
	}

	async getRemoteBrowserState(): Promise<BrowserState> {
		this.assertUsable()
		if (!this.mirrorSession) {
			throw new Error('Mirror session is not started.')
		}
		return this.mirrorSession.controller.getBrowserState()
	}

	onRemoteFrame(handler: (frame: VisualFrame) => void): () => void {
		this.frameHandlers.add(handler)
		return () => this.frameHandlers.delete(handler)
	}

	getSpatialMap(): SpatialElement[] {
		this.assertUsable()
		return this.layers.hot.getSpatialMap()
	}

	onSpatialMapUpdate(handler: (elements: SpatialElement[]) => void): () => void {
		this.spatialHandlers.add(handler)
		return () => this.spatialHandlers.delete(handler)
	}

	sendInputToRemote(event: RemoteInputEvent): Promise<void> {
		this.assertUsable()
		return this.layers.hot.sendInputEvent(event)
	}

	navigateRemote(url: string): Promise<void> {
		this.assertUsable()
		return this.layers.hot.sendInputEvent({
			type: 'navigate',
			url,
			timestamp: nowIso(),
		})
	}

	async executeRemoteTask(
		prompt: string,
		images?: { data: string; dimension: { width: number; height: number } }[]
	): Promise<CloudAgent> {
		this.assertUsable()
		if (!this.activeCloudAgent) {
			throw new Error('No active cloud agent for this mirror session.')
		}
		await this.cloudClient.followUp(this.activeCloudAgent.id, {
			prompt: { text: prompt, images },
		})
		this.activeCloudAgent = await this.cloudClient.getAgent(this.activeCloudAgent.id)
		this.emitEvent({
			type: 'mirror:cloud-agent',
			agentId: this.activeCloudAgent.id,
			agentStatus: this.activeCloudAgent.status,
		})
		return this.activeCloudAgent
	}

	async initiateVisualHandoff(request: VisualHandoffRequest): Promise<void> {
		this.assertUsable()
		await this.layers.hot.initiateHandoff(request)
		this.emitEvent({
			type: 'mirror:visual-handoff',
			direction: request.direction,
			trigger: request.trigger,
		})
	}

	onNavigationIntercept(
		handler: (
			intercept: FetchInterceptPayload & {
				flagged: boolean
				flagReason?: string
			}
		) => void
	): () => void {
		this.navigationHandlers.add(handler)
		return () => this.navigationHandlers.delete(handler)
	}

	resolveIntercept(
		requestId: string,
		resolution: FetchInterceptPayload['resolution'],
		fulfillOptions?: {
			body: string
			statusCode?: number
			headers?: Record<string, string>
		}
	): Promise<void> {
		this.assertUsable()
		return this.layers.warm.resolveNavigationIntercept(requestId, resolution, fulfillOptions)
	}

	async forceSync(layer?: 'cold' | 'warm' | 'hot'): Promise<void> {
		this.assertUsable()
		if (!layer || layer === 'cold') {
			this.setLayerStatus('cold', 'syncing')
			await this.layers.cold.syncToRemote()
			this.setLayerStatus('cold', 'synced')
		}
		if (!layer || layer === 'warm') {
			this.setLayerStatus('warm', 'syncing')
			await this.layers.warm.forceSync()
			this.setLayerStatus('warm', 'synced')
		}
		if (!layer || layer === 'hot') {
			this.setLayerStatus('hot', 'syncing')
			await this.layers.hot.refreshProjectedInputs()
			await this.layers.hot.captureFrame()
			this.setLayerStatus('hot', 'synced')
		}
		this.state = { ...this.state, lastFullSync: nowIso() }
	}

	getProfileSnapshot(): ProfileSnapshot | null {
		return this.layers.cold.getSnapshot()
	}

	getAuthSnapshot(): WarmLayerSnapshot | null {
		return this.layers.warm.getSnapshot()
	}

	onEvent(handler: (event: MirrorEvent) => void): () => void {
		this.eventHandlers.add(handler)
		return () => this.eventHandlers.delete(handler)
	}

	async dispose(): Promise<void> {
		if (this.disposed) return
		await this.endSession({ deleteAgent: false, syncBack: false })
		this.disposed = true
		this.eventHandlers.clear()
		this.frameHandlers.clear()
		this.spatialHandlers.clear()
		this.navigationHandlers.clear()
	}
}

export const createMirrorController: CreateMirrorController = (
	config: MirrorControllerConfig
): IMirrorController => {
	return new MirrorController(config)
}
