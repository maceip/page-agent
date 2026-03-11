// ---------------------------------------------------------------------------
// Stable mirror integration surface
// ---------------------------------------------------------------------------

export type {
	FetchInterceptPayload,
	MirrorConfig,
	MirrorEvent,
	MirrorSessionContext,
	MirrorSessionId,
	MirrorSessionStatus,
	MirrorState,
} from './types'

export type {
	CreateMirrorController,
	IMirrorController,
	MirrorControllerConfig,
	MirrorControllerDependencies,
} from './MirrorController'
export { MirrorController, createMirrorController } from './MirrorController'

export { MirrorSession } from './MirrorSession'
export { RemotePageController } from './RemotePageController'

export type { CloudAgentClientConfig, ICloudAgentClient } from './cloud-agent/client'
export { CloudAgentClient, createCloudAgentClient } from './cloud-agent/CloudAgentClient'
