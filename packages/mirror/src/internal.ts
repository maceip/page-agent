// ---------------------------------------------------------------------------
// Advanced/internal mirror surface
// ---------------------------------------------------------------------------
//
// These exports are transport- and implementation-centric. Prefer importing
// from "./stable" for regular integration.

export type {
	CdpConnectionConfig,
	CdpCookiePayload,
	CdpDomain,
	ColdLayerConfig,
	DiffFrame,
	DiffPatch,
	ElementRole,
	HotLayerConfig,
	LayerSyncStatus,
	MicroDOMDiff,
	MicroDOMSnapshot,
	MirrorCloudAgentEvent,
	MirrorErrorEvent,
	MirrorLayerSyncEvent,
	MirrorNavigationInterceptEvent,
	MirrorStatusChangeEvent,
	MirrorVisualHandoffEvent,
	QuicTransportConfig,
	Rect,
	SpatialElement,
	TauriWindowState,
	VisualFrame,
	WarmLayerConfig,
} from './types'

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
