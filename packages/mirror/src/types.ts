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
	/** Local CDP endpoint (e.g. "ws://127.0.0.1:9222") */
	localCdpEndpoint: string | null
	/** Remote/cloud CDP endpoint relayed over QUIC */
	remoteCdpEndpoint: string | null
}

// ---------------------------------------------------------------------------
// Transport & connectivity
// ---------------------------------------------------------------------------

/**
 * QUIC transport configuration.
 *
 * All inter-layer communication between the local Tauri shim and the cloud
 * environment is multiplexed over QUIC.  Each layer opens one or more
 * uni/bi-directional QUIC streams inside the same connection.
 */
export interface QuicTransportConfig {
	/** Remote QUIC endpoint (e.g. "quic://cloud.example.com:4433") */
	remoteEndpoint: string

	/**
	 * TLS certificate / CA bundle for the QUIC connection (PEM-encoded).
	 * When undefined, the system root CAs are used.
	 */
	tlsCertificatePem?: string

	/** Maximum concurrent bidirectional streams (default: 16) */
	maxBidiStreams?: number

	/** Maximum concurrent unidirectional streams (default: 32) */
	maxUniStreams?: number

	/** Keep-alive interval in ms (0 = disabled, default: 5000) */
	keepAliveIntervalMs?: number

	/** Connection idle timeout in ms (default: 30_000) */
	idleTimeoutMs?: number

	/**
	 * QUIC congestion control algorithm hint.
	 * The actual enforcement is in the Rust/QUIC implementation.
	 */
	congestionControl?: 'cubic' | 'bbr' | 'bbr2'
}

/**
 * CDP (Chrome DevTools Protocol) connection descriptor.
 *
 * Both the local and remote browsers expose CDP over WebSocket on port 9222.
 * The Tauri shim maintains two CDP strings – one for each side.
 */
export interface CdpConnectionConfig {
	/** WebSocket debug URL (e.g. "ws://127.0.0.1:9222/devtools/browser/<id>") */
	webSocketDebuggerUrl: string

	/** The debugging port Chrome was launched with */
	debuggingPort: number

	/**
	 * CDP domains to enable on this connection.
	 * Each layer enables only the domains it needs.
	 */
	enabledDomains?: CdpDomain[]
}

/**
 * CDP domains referenced across the three mirror layers.
 */
export type CdpDomain =
	| 'Network'
	| 'Storage'
	| 'Fetch'
	| 'Page'
	| 'DOM'
	| 'DOMSnapshot'
	| 'Runtime'
	| 'Input'
	| 'Emulation'
	| 'Target'
	| 'Browser'
	| 'Security'

// ---------------------------------------------------------------------------
// Tauri window manager
// ---------------------------------------------------------------------------

/**
 * Tauri manages two browser "strings" (processes):
 *   - local: the user's visible Chrome instance
 *   - cloud: the headless Chrome in the remote environment
 *
 * The shim is responsible for:
 *   - Spawning local Chrome with the right flags
 *   - Establishing the QUIC tunnel to the cloud
 *   - Overlaying the WebCodecs canvas for hot-layer handoffs
 *   - Managing the invisible UI projector (transparent input elements)
 */
export interface TauriWindowState {
	/** Whether the local Chrome window is currently visible to the user */
	localVisible: boolean
	/** Whether the hot-layer canvas overlay is active */
	canvasOverlayActive: boolean
	/** Whether transparent input elements are projected */
	inputProjectionActive: boolean
	/** Current overlay opacity (0 = fully transparent, 1 = opaque) */
	overlayOpacity: number
}

// ---------------------------------------------------------------------------
// Events emitted by MirrorController
// ---------------------------------------------------------------------------

export type MirrorEvent =
	| MirrorStatusChangeEvent
	| MirrorLayerSyncEvent
	| MirrorErrorEvent
	| MirrorCloudAgentEvent
	| MirrorNavigationInterceptEvent
	| MirrorVisualHandoffEvent

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
	layer: 'cold' | 'warm' | 'hot' | 'controller' | 'quic' | 'cdp'
	message: string
	cause?: unknown
}

export interface MirrorCloudAgentEvent {
	type: 'mirror:cloud-agent'
	agentId: string
	agentStatus: string
}

/**
 * Emitted when the warm layer's navigation proxy intercepts a request.
 * Consumers can use this to implement security policies (e.g. phishing detection).
 */
export interface MirrorNavigationInterceptEvent {
	type: 'mirror:navigation-intercept'
	/** The URL the user attempted to navigate to */
	requestedUrl: string
	/** CDP Fetch.requestPaused requestId – needed to continue or fulfill */
	requestId: string
	/** Whether the cloud's security analysis flagged this URL */
	flagged: boolean
	/** Reason for flagging (if any) */
	flagReason?: string
}

/**
 * Emitted during a visual handoff between local and cloud browsers.
 * For example, during a cloud-passkey login flow.
 */
export interface MirrorVisualHandoffEvent {
	type: 'mirror:visual-handoff'
	direction: 'local-to-cloud' | 'cloud-to-local'
	/** The trigger that initiated the handoff */
	trigger: string
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

	/** QUIC transport configuration for the local ↔ cloud tunnel */
	quic: QuicTransportConfig

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
	 * IPC address of the Tauri ephemeral bootstrapper.
	 * The bootstrapper handles zstd payload extraction and Chrome process spawning.
	 */
	tauriIpcAddress?: string

	/**
	 * URL of the cloud profile packager endpoint that serves the compressed
	 * baseline profile payload (.zstd, typically < 10 MB).
	 */
	profilePackagerUrl?: string

	/**
	 * Local directory for ephemeral profile extraction.
	 * Tauri extracts the zstd payload here and spawns Chrome with
	 * `--user-data-dir=<ephemeralDir>/cloud_session_<id>`.
	 * Defaults to the OS temp directory.
	 */
	ephemeralDir?: string

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

	/**
	 * Chrome remote debugging port for the locally-spawned instance.
	 * @default 9222
	 */
	debuggingPort?: number

	/**
	 * Additional Chrome command-line flags to pass when spawning locally.
	 * e.g. ["--disable-extensions", "--no-first-run"]
	 */
	chromeFlags?: string[]
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

	/**
	 * CDP domains to enable on the warm layer's event bus connections.
	 * @default ['Network', 'Storage', 'Fetch', 'Page']
	 */
	cdpDomains?: CdpDomain[]

	/**
	 * Whether to enable the Navigation Proxy (CDP Fetch domain interception).
	 * When enabled, local navigations are paused via Fetch.requestPaused,
	 * mirrored to the cloud for security analysis, then continued or blocked.
	 * @default true
	 */
	enableNavigationProxy?: boolean
}

export interface HotLayerConfig {
	/**
	 * Target frames-per-second for MoQ (Media over QUIC) visual streaming.
	 * @default 30
	 */
	targetFps?: number

	/**
	 * Maximum bandwidth budget in kbps (0 = unlimited).
	 * The hot layer will adaptively reduce quality to stay within budget.
	 * @default 0
	 */
	maxBandwidthKbps?: number

	/**
	 * Video codec for MoQ streaming from the cloud's headless framebuffer.
	 * AV1 is preferred for compression efficiency; H264 as a fallback.
	 * @default 'av1'
	 */
	codec?: 'av1' | 'h264' | 'vp9'

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

	/**
	 * Whether to enable the Invisible UI Projector.
	 * When active, Tauri renders transparent native HTML <input> elements
	 * over the video <canvas> using the Micro-DOM spatial map, enabling
	 * native OS cursors, password managers, and autofill to function.
	 * @default true
	 */
	enableInvisibleUiProjector?: boolean

	/**
	 * Whether to use unreliable QUIC datagrams for MoQ frames.
	 * Provides lower latency at the cost of potential frame drops.
	 * @default true
	 */
	useUnreliableDatagrams?: boolean
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
	/** Frame format – 'av1' for MoQ-delivered encoded frames, image formats for snapshots */
	format: 'av1' | 'h264' | 'vp9' | 'png' | 'jpeg' | 'webp'
	/** Raw frame data (encoded video NAL units or image bytes) */
	data: ArrayBuffer
	/** Viewport dimensions when captured */
	viewport: { width: number; height: number }
	/** Browser state snapshot taken concurrently with the frame */
	browserState?: BrowserState
	/**
	 * Micro-DOM spatial map extracted by the dom-extract pipeline.
	 * Used by the Invisible UI Projector to position transparent input elements.
	 */
	spatialMap?: MicroDOMSnapshot
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
	format: 'av1' | 'h264' | 'vp9' | 'png' | 'jpeg' | 'webp'
	data: ArrayBuffer
}

// ---------------------------------------------------------------------------
// Micro-DOM Spatial Map
// ---------------------------------------------------------------------------
//
// Extracted by the dom-extract pipeline (MutationObserver + TreeWalker scan)
// running inside the cloud browser. Pushed over WebSocket/QUIC as compact
// JSON snapshots and incremental diffs.
//
// The Invisible UI Projector consumes these to render transparent native
// HTML <input>/<textarea>/<select>/<a>/<button> elements over the video
// <canvas>, enabling native OS cursors, password managers, autofill, and
// screen readers to function normally over a flat pixel stream.
// ---------------------------------------------------------------------------

/** Bounding rectangle in CSS pixels, viewport-relative */
export interface Rect {
	x: number
	y: number
	w: number
	h: number
}

/** Classification of an interactive element */
export type ElementRole =
	| 'input'       // <input> (text, email, number, etc.)
	| 'password'    // <input type="password">
	| 'checkbox'    // <input type="checkbox">, role="checkbox"
	| 'radio'       // <input type="radio">, role="radio"
	| 'select'      // <select>, role="combobox", role="listbox"
	| 'textarea'    // <textarea>, contentEditable
	| 'button'      // <button>, role="button", submit inputs
	| 'link'        // <a>, role="link"
	| 'file'        // <input type="file">
	| 'range'       // <input type="range">
	| 'toggle'      // role="switch", <details>
	| 'tab'         // role="tab"
	| 'menuitem'    // role="menuitem"
	| 'scrollable'  // scrollable containers
	| 'clickable'   // generic clickable (onclick, cursor:pointer, etc.)

/**
 * A single interactive element in the micro-DOM spatial map.
 *
 * Extracted by the TreeWalker-based scanner with ARIA role classification,
 * 5-point elementFromPoint occlusion detection, and shadow DOM recursion.
 */
export interface SpatialElement {
	/** Stable numeric ID (persists across scans via WeakMap) */
	id: number
	/** Bounding box in CSS pixels, viewport-relative */
	rect: Rect
	/** Element classification (ARIA-aware) */
	role: ElementRole
	/** Current value (for inputs/textareas/selects) */
	value?: string
	/** Placeholder text */
	placeholder?: string
	/** Accessible label (aria-label, associated <label>, visible text) */
	label?: string
	/** Whether the element is disabled */
	disabled?: boolean
	/** Whether the element is checked (checkboxes, radios, toggles) */
	checked?: boolean
	/** Element tag name (lowercase) */
	tag: string
	/** CSS selector for targeting this element in the remote DOM */
	selector?: string
	/** Tab index for focus ordering (-1 if not focusable) */
	tabIndex?: number
	/** Paint order / z-index for occlusion sorting */
	zOrder: number
	/** Whether element is within viewport (plus threshold) */
	inViewport: boolean
	/** Raw input type attribute (e.g. "email", "tel") */
	inputType?: string
	/** href for links */
	href?: string
	/** Autocomplete hint (e.g. "username", "current-password") */
	autocomplete?: string
	/** Whether this element is inside an iframe */
	inIframe?: boolean
	/** Accumulated iframe offset to viewport origin */
	frameOffset?: { x: number; y: number }
	/** Whether the element is currently focused in the remote browser */
	isFocused?: boolean
	/** CDP DOMSnapshot backend node ID (for CDP fallback operations) */
	backendNodeId?: number
}

/** Full micro-DOM snapshot — sent on initial connection and major DOM changes */
export interface MicroDOMSnapshot {
	/** Monotonic sequence number */
	seq: number
	/** Capture timestamp (ms since epoch) */
	ts: number
	/** Viewport dimensions */
	viewport: { w: number; h: number }
	/** Document scroll position */
	scroll: { x: number; y: number }
	/** Device pixel ratio */
	dpr: number
	/** Page URL */
	url: string
	/** Page title */
	title: string
	/** All interactive elements */
	elements: SpatialElement[]
	/**
	 * Simplified HTML for LLM consumption.
	 * Each interactive element rendered as `[id]<tag attrs>label />` using
	 * stable IDs matching the elements array. Directly usable as
	 * BrowserState.content for PageAgentCore.
	 */
	simplifiedHTML: string
}

/** Incremental diff — sent when <50% of elements changed */
export interface MicroDOMDiff {
	/** Monotonic sequence number */
	seq: number
	/** Capture timestamp (ms since epoch) */
	ts: number
	/** Updated viewport if changed */
	viewport?: { w: number; h: number }
	/** Updated scroll if changed */
	scroll?: { x: number; y: number }
	/** Elements added or updated (full element data) */
	upserted: SpatialElement[]
	/** Element IDs removed */
	removed: number[]
}

// ---------------------------------------------------------------------------
// CDP Event Bus payloads (used by warm layer's identity replicator)
// ---------------------------------------------------------------------------

/**
 * A cookie payload as exchanged between the local and cloud CDP event buses.
 * Mirrors the shape of CDP Network.Cookie with the fields needed for
 * Network.setCookie injection.
 */
export interface CdpCookiePayload {
	name: string
	value: string
	domain: string
	path: string
	expires: number
	httpOnly: boolean
	secure: boolean
	sameSite: 'Strict' | 'Lax' | 'None'
	/** ISO-8601 timestamp when this cookie was observed changing */
	observedAt: string
}

/**
 * Fetch domain interception payload.
 * Represents a paused request captured via Fetch.requestPaused on the
 * local browser by the warm layer's Navigation Proxy (the "Chaperone").
 */
export interface FetchInterceptPayload {
	/** CDP Fetch.requestPaused event's requestId */
	requestId: string
	/** The URL of the intercepted request */
	url: string
	/** HTTP method */
	method: string
	/** Request headers */
	headers: Record<string, string>
	/** Resource type (Document, Script, etc.) */
	resourceType: string
	/**
	 * The action to take after cloud security analysis:
	 *   - 'continue': Fetch.continueRequest – let it through
	 *   - 'fulfill': Fetch.fulfillRequest – inject a local response (e.g. interstitial)
	 *   - 'fail': Fetch.failRequest – abort the request
	 */
	resolution?: 'continue' | 'fulfill' | 'fail'
	/** If resolution is 'fulfill', the response body to inject */
	fulfillBody?: string
	/** If resolution is 'fulfill', the response status code */
	fulfillStatusCode?: number
}
