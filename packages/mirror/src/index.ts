// ---------------------------------------------------------------------------
// @page-agent/mirror – Browser State Mirroring
// ---------------------------------------------------------------------------
//
// Three-layer architecture for mirroring all browser state between a user's
// local browser and a remote "shadow agent" operating a cloud browser:
//
//   Cold  → Chrome profile bootstrap (managed by native Rust launcher)
//   Warm  → Identity / auth events / secrets / payment (event-driven)
//   Hot   → Visual layer syncing (real-time stream)
//
// The remote cloud browser is managed via the Cloud Agents API, ensuring each
// user always has a fresh and live shadow agent.
// ---------------------------------------------------------------------------

// -- Core types & config ----------------------------------------------------
export type {
	ColdLayerConfig,
	DiffFrame,
	DiffPatch,
	HotLayerConfig,
	LayerSyncStatus,
	MirrorConfig,
	MirrorCloudAgentEvent,
	MirrorErrorEvent,
	MirrorEvent,
	MirrorLayerSyncEvent,
	MirrorSessionId,
	MirrorSessionStatus,
	MirrorState,
	MirrorStatusChangeEvent,
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
	ProfileSnapshot,
} from './layers/cold'

export type {
	AuthEvent,
	AuthEventCookieChange,
	AuthEventLogin,
	AuthEventLogout,
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
	RemoteInputEvent,
	RemoteKeyboardEvent,
	RemoteMouseEvent,
	RemoteTouchEvent,
	RemoteWheelEvent,
	ScrollState,
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

// -- MirrorController (orchestrator) ----------------------------------------
export type {
	CreateMirrorController,
	IMirrorController,
	MirrorControllerConfig,
} from './MirrorController'
