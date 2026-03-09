import type { BrowserState } from '@page-agent/page-controller'

// ---------------------------------------------------------------------------
// Mirror Session & Lifecycle
// ---------------------------------------------------------------------------

/** Unique identifier for a mirror session binding a local browser to a remote shadow agent */
export type MirrorSessionId = string & { readonly __brand: unique symbol }

/** Overall health of the mirrored browser connection */
export type MirrorSessionStatus =
	| 'initializing'
	| 'cold-syncing'
	| 'warm-syncing'
	| 'live'
	| 'degraded'
	| 'disconnected'
	| 'error'

/** Per-layer sync status */
export type LayerSyncStatus = 'idle' | 'syncing' | 'synced' | 'stale' | 'error'

/** Aggregate view of all three layers */
export interface MirrorState {
	sessionId: MirrorSessionId
	status: MirrorSessionStatus
	cold: LayerSyncStatus
	warm: LayerSyncStatus
	hot: LayerSyncStatus
	/** ISO-8601 timestamp of the last successful full sync */
	lastFullSync: string | null
	/** Remote cloud-agent id powering this session */
	cloudAgentId: string | null
}

// ---------------------------------------------------------------------------
// Events emitted by MirrorController
// ---------------------------------------------------------------------------

export type MirrorEvent =
	| MirrorStatusChangeEvent
	| MirrorLayerSyncEvent
	| MirrorErrorEvent
	| MirrorCloudAgentEvent

export interface MirrorStatusChangeEvent {
	type: 'mirror:status-change'
	previous: MirrorSessionStatus
	current: MirrorSessionStatus
}

export interface MirrorLayerSyncEvent {
	type: 'mirror:layer-sync'
	layer: 'cold' | 'warm' | 'hot'
	status: LayerSyncStatus
	/** How long the sync took in ms (undefined if still in progress) */
	durationMs?: number
}

export interface MirrorErrorEvent {
	type: 'mirror:error'
	layer: 'cold' | 'warm' | 'hot' | 'controller'
	message: string
	cause?: unknown
}

export interface MirrorCloudAgentEvent {
	type: 'mirror:cloud-agent'
	agentId: string
	agentStatus: string
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface MirrorConfig {
	/** Cloud Agents API key (Basic auth) */
	apiKey: string

	/** Cloud Agents API base URL */
	apiBaseUrl?: string

	/** GitHub repository URL backing the user's shadow environment */
	repository: string

	/** Git ref to use as the base for shadow environments */
	ref?: string

	/** Cold-layer configuration */
	cold?: ColdLayerConfig

	/** Warm-layer configuration */
	warm?: WarmLayerConfig

	/** Hot-layer configuration */
	hot?: HotLayerConfig

	/** Webhook URL for agent status push notifications */
	webhookUrl?: string

	/** Webhook secret (min 32 chars) */
	webhookSecret?: string
}

export interface ColdLayerConfig {
	/**
	 * IPC address of the native Rust launcher process.
	 * The launcher handles bi-directional Chrome profile sync.
	 */
	launcherIpcAddress?: string

	/**
	 * Absolute path to the local Chrome profile directory.
	 * When unset, uses the launcher's default discovery.
	 */
	profilePath?: string

	/**
	 * Paths / glob patterns within the profile to exclude from sync.
	 * Defaults to a sensible deny-list (e.g. crash dumps, GPU cache).
	 */
	excludePatterns?: string[]

	/**
	 * Whether to enable bi-directional sync (true) or upload-only (false).
	 * @default true
	 */
	bidirectional?: boolean
}

export interface WarmLayerConfig {
	/**
	 * How long an auth token is considered fresh before re-sync is needed (ms).
	 * @default 300_000 (5 minutes)
	 */
	tokenFreshnessTtlMs?: number

	/**
	 * Origins whose cookies / storage should be synced.
	 * Supports glob patterns (e.g. "*.example.com").
	 * An empty array means "all origins the user has visited".
	 */
	originAllowList?: string[]

	/**
	 * Origins to never sync (takes precedence over allowList).
	 */
	originDenyList?: string[]

	/**
	 * Whether to sync payment methods / autofill data.
	 * @default false
	 */
	syncPaymentMethods?: boolean
}

export interface HotLayerConfig {
	/**
	 * Target frames-per-second for visual state streaming.
	 * @default 5
	 */
	targetFps?: number

	/**
	 * Maximum bandwidth budget in kbps (0 = unlimited).
	 * The hot layer will adaptively reduce quality to stay within budget.
	 * @default 0
	 */
	maxBandwidthKbps?: number

	/**
	 * Whether to use differential frame encoding (send only changed regions).
	 * @default true
	 */
	differentialEncoding?: boolean

	/**
	 * Viewport dimensions for the remote browser.
	 * When unset, mirrors the local browser's current viewport.
	 */
	viewport?: { width: number; height: number }
}

// ---------------------------------------------------------------------------
// Visual Frame (Hot Layer)
// ---------------------------------------------------------------------------

/** A single visual snapshot of the remote browser */
export interface VisualFrame {
	/** Monotonically increasing sequence number */
	seq: number
	/** ISO-8601 capture timestamp */
	timestamp: string
	/** Frame format */
	format: 'png' | 'jpeg' | 'webp'
	/** Raw image data */
	data: ArrayBuffer
	/** Viewport dimensions when captured */
	viewport: { width: number; height: number }
	/** Browser state snapshot taken concurrently with the frame */
	browserState?: BrowserState
}

/** Differential frame – only the changed rectangular regions */
export interface DiffFrame {
	seq: number
	baseSeq: number
	timestamp: string
	patches: DiffPatch[]
}

export interface DiffPatch {
	x: number
	y: number
	width: number
	height: number
	format: 'png' | 'jpeg' | 'webp'
	data: ArrayBuffer
}
