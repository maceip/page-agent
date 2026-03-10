// ---------------------------------------------------------------------------
// @page-agent/mirror – Browser State Mirroring
// ---------------------------------------------------------------------------
//
// Three-layer architecture for mirroring all browser state between a user's
// local browser and a remote "shadow agent" operating a cloud browser.
//
// Infrastructure:
//   Tauri (Rust) shim as local window manager, holding two CDP strings
//   QUIC as the multiplexed transport between local and cloud
//   CDP (Chrome DevTools Protocol) for zero-dependency browser control
//
// Layers:
//   Cold  → Tauri Ephemeral Bootstrapper + zstd profile payloads
//   Warm  → CDP Event Bus + Identity Replicator + Navigation Proxy
//   Hot   → MoQ Pipeline (AV1/QUIC) + WebCodecs + Invisible UI Projector
//
// The remote cloud browser is managed via the Cloud Agents API, ensuring each
// user always has a fresh and live shadow agent.
// ---------------------------------------------------------------------------

// -- Core types & config ----------------------------------------------------
export type {
	CdpConnectionConfig,
	CdpCookiePayload,
	CdpDomain,
	ColdLayerConfig,
	DiffFrame,
	DiffPatch,
	ElementRole,
	FetchInterceptPayload,
	HotLayerConfig,
	LayerSyncStatus,
	MicroDOMDiff,
	MicroDOMSnapshot,
	MirrorCloudAgentEvent,
	MirrorConfig,
	MirrorErrorEvent,
	MirrorEvent,
	MirrorLayerSyncEvent,
	MirrorNavigationInterceptEvent,
	MirrorSessionId,
	MirrorSessionStatus,
	MirrorState,
	MirrorStatusChangeEvent,
	MirrorVisualHandoffEvent,
	QuicTransportConfig,
	Rect,
	SpatialElement,
	TauriWindowState,
	VisualFrame,
	WarmLayerConfig,
} from './types'

// -- Layer interfaces -------------------------------------------------------
export type {
	ColdSyncProgress,
	IColdLayer,
	LauncherCommand,
	LauncherMessage,
	ProfileDiffChunk,
	ProfilePayload,
	ProfilePayloadContents,
	ProfileSnapshot,
} from './layers/cold'

export type {
	AuthEvent,
	AuthEventCookieChange,
	AuthEventLogin,
	AuthEventLogout,
	AuthEventNavigationIntercept,
	AuthEventPaymentChange,
	AuthEventStorageChange,
	AuthEventTokenRefresh,
	CredentialEntry,
	CredentialKind,
	IWarmLayer,
	WarmLayerSnapshot,
} from './layers/warm'

export type {
	DomMutation,
	HotLayerMetrics,
	IHotLayer,
	RemoteCheckEvent,
	RemoteFocusEvent,
	RemoteInputEvent,
	RemoteKeyboardEvent,
	RemoteMouseEvent,
	RemoteNavigateEvent,
	RemoteSelectEvent,
	RemoteTouchEvent,
	RemoteTypeEvent,
	RemoteWheelEvent,
	ScrollState,
	VisualHandoffRequest,
} from './layers/hot'

// -- Cloud Agent API --------------------------------------------------------
export type {
	CloudAgentClientConfig,
	ICloudAgentClient,
} from './cloud-agent/client'

export type {
	ApiKeyInfo,
	ArtifactDownloadResponse,
	ArtifactsResponse,
	CloudAgent,
	CloudAgentArtifact,
	CloudAgentConversation,
	CloudAgentMessage,
	CloudAgentPrompt,
	CloudAgentSource,
	CloudAgentStatus,
	CloudAgentTarget,
	CloudAgentWebhook,
	FollowUpParams,
	LaunchAgentParams,
	ListAgentsParams,
	ListAgentsResponse,
	ListModelsResponse,
	ListRepositoriesResponse,
} from './cloud-agent/types'

// -- Remote adapter for PageAgentCore ----------------------------------------
export { RemotePageController } from './RemotePageController'

// -- Session wiring (RemotePageController ↔ IHotLayer) -----------------------
export { MirrorSession } from './MirrorSession'

// -- MirrorController (orchestrator) ----------------------------------------
export type {
	CreateMirrorController,
	IMirrorController,
	MirrorControllerConfig,
} from './MirrorController'
