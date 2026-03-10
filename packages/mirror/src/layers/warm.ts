import type {
	CdpCookiePayload,
	CdpDomain,
	FetchInterceptPayload,
	LayerSyncStatus,
	MirrorSessionId,
	WarmLayerConfig,
} from '../types'

// ---------------------------------------------------------------------------
// Warm Layer – CDP Event Bus + Identity Replicator + Navigation Proxy
// ---------------------------------------------------------------------------
//
// The warm layer maintains real-time, bidirectional synchronisation of
// session memory and network intent between the local and cloud browsers.
//
// Architecture:
//   - **Raw CDP Event Bus**: Lightweight daemons on both sides maintain
//     standard WebSocket connections to their respective :9222 ports.
//     They translate native browser events into JSON payloads sent over QUIC.
//
//   - **Identity Replicator**: Subscribes to the CDP Network and Storage
//     domains.  When a cookie or token mutates on one side, it serialises the
//     change as JSON over QUIC.  The receiving side injects it into active
//     memory using Network.setCookie / Storage.setStorageItem.
//
//   - **Navigation Proxy ("The Chaperone")**: Uses the CDP Fetch domain
//     (Fetch.enable + Fetch.requestPaused) on the local browser.  It
//     intercepts local network requests before they leave the machine,
//     mirrors them to the cloud for security analysis, then decides:
//       - Fetch.continueRequest – let it through
//       - Fetch.fulfillRequest – inject a local response (e.g. phishing interstitial)
//       - Fetch.failRequest – abort entirely
// ---------------------------------------------------------------------------

/** Classification of credential types handled by the warm layer */
export type CredentialKind =
	| 'cookie'
	| 'oauth-token'
	| 'session-storage'
	| 'local-storage'
	| 'indexed-db'
	| 'service-worker-registration'
	| 'payment-method'

/** A single credential/secret that needs to be synced */
export interface CredentialEntry {
	/** Unique key (e.g. cookie name + domain, storage key, etc.) */
	id: string
	kind: CredentialKind
	/** The origin this credential belongs to (e.g. "https://example.com") */
	origin: string
	/** Human-readable label for UI/logging (never the actual secret value) */
	label: string
	/**
	 * Opaque encrypted payload.
	 * The warm layer MUST encrypt credential values in transit and at rest.
	 * The encryption scheme is implementation-defined.
	 */
	encryptedPayload: ArrayBuffer
	/** ISO-8601 timestamp when this credential was last observed locally */
	observedAt: string
	/** ISO-8601 expiry (if known – e.g. cookie Expires, token exp claim) */
	expiresAt?: string
	/**
	 * Raw CDP cookie data (populated when kind === 'cookie').
	 * Used for direct injection via Network.setCookie.
	 */
	cdpCookie?: CdpCookiePayload
}

// ---------------------------------------------------------------------------
// Auth events detected via CDP domain subscriptions
// ---------------------------------------------------------------------------

/** Auth event detected in the local browser via CDP */
export type AuthEvent =
	| AuthEventLogin
	| AuthEventLogout
	| AuthEventTokenRefresh
	| AuthEventCookieChange
	| AuthEventStorageChange
	| AuthEventPaymentChange
	| AuthEventNavigationIntercept

export interface AuthEventLogin {
	type: 'login'
	origin: string
	credentials: CredentialEntry[]
	/** CDP domain that detected the login (typically 'Network') */
	detectedVia: CdpDomain
	timestamp: string
}

export interface AuthEventLogout {
	type: 'logout'
	origin: string
	/** Credential IDs that were cleared */
	clearedIds: string[]
	timestamp: string
}

export interface AuthEventTokenRefresh {
	type: 'token-refresh'
	origin: string
	credential: CredentialEntry
	previousExpiresAt?: string
	timestamp: string
}

export interface AuthEventCookieChange {
	type: 'cookie-change'
	origin: string
	added: CredentialEntry[]
	removed: string[]
	/** Raw CDP cookie payloads ready for Network.setCookie injection */
	cdpCookies: CdpCookiePayload[]
	timestamp: string
}

export interface AuthEventStorageChange {
	type: 'storage-change'
	origin: string
	storageType: 'local-storage' | 'session-storage' | 'indexed-db'
	changed: CredentialEntry[]
	removed: string[]
	timestamp: string
}

export interface AuthEventPaymentChange {
	type: 'payment-change'
	added: CredentialEntry[]
	removed: string[]
	timestamp: string
}

/**
 * Emitted when the Navigation Proxy (Chaperone) intercepts a request
 * via CDP Fetch.requestPaused.  This allows the cloud to perform
 * security analysis before the local browser connects to the destination.
 */
export interface AuthEventNavigationIntercept {
	type: 'navigation-intercept'
	intercept: FetchInterceptPayload
	timestamp: string
}

/** Summary of what's currently synced to the remote */
export interface WarmLayerSnapshot {
	/** Total number of credentials being tracked */
	totalCredentials: number
	/** Breakdown by kind */
	byKind: Record<CredentialKind, number>
	/** Origins with active sessions */
	activeOrigins: string[]
	/** Credentials expiring within the freshness TTL */
	expiringSoon: { id: string; origin: string; expiresAt: string }[]
	/** ISO-8601 timestamp of the last push to the remote */
	lastPushedAt: string | null
	/** CDP domains currently subscribed to on local side */
	activeCdpDomains: CdpDomain[]
	/** Whether the Navigation Proxy is active */
	navigationProxyActive: boolean
}

// ---------------------------------------------------------------------------
// Warm Layer Interface
// ---------------------------------------------------------------------------

/**
 * The warm layer keeps the remote shadow browser authenticated by
 * maintaining a CDP Event Bus on both sides (local + cloud), connected
 * via QUIC streams.
 *
 * Components:
 *   - **Identity Replicator**: CDP Network/Storage domain subscriptions
 *     detect cookie/token mutations and replicate them via Network.setCookie.
 *   - **Navigation Proxy**: CDP Fetch domain intercepts local requests,
 *     mirrors them to the cloud for security analysis, then continues,
 *     fulfills (e.g. with a phishing interstitial), or fails them.
 *
 * Lifecycle:
 *   1. `initialize()` – Open CDP WebSocket to local :9222, enable domains,
 *      establish QUIC stream to cloud-side CDP relay.
 *   2. Auth events auto-push to the remote as they occur.
 *   3. Navigation requests are intercepted and proxied to the cloud.
 *   4. `dispose()` – Disable Fetch interception, close CDP connections.
 */
export interface IWarmLayer {
	readonly status: LayerSyncStatus

	/**
	 * Begin observing auth-related events via CDP on the local browser
	 * and syncing them to the remote environment over QUIC.
	 *
	 * Internally:
	 *   1. Opens a WebSocket to the local Chrome's :9222 debug endpoint.
	 *   2. Enables CDP domains: Network, Storage, and optionally Fetch.
	 *   3. Establishes a QUIC bidirectional stream to the cloud-side CDP relay.
	 *   4. Starts the Identity Replicator and Navigation Proxy.
	 */
	initialize(
		sessionId: MirrorSessionId,
		config: WarmLayerConfig,
		localCdpUrl: string,
		remoteCdpUrl: string
	): Promise<WarmLayerSnapshot>

	/**
	 * Register a callback to be notified of auth events as they occur.
	 * Includes navigation intercepts from the Chaperone.
	 */
	onAuthEvent(handler: (event: AuthEvent) => void): () => void

	/**
	 * Force a full credential sync to the remote, regardless of change detection.
	 * Internally enumerates all cookies via Network.getAllCookies on the local
	 * browser and pushes them via Network.setCookie on the remote.
	 */
	forceSync(): Promise<WarmLayerSnapshot>

	/**
	 * Retrieve credentials for a specific origin.
	 * Returns only metadata – encrypted payloads are never exposed through this method.
	 */
	getCredentialsForOrigin(origin: string): Promise<Omit<CredentialEntry, 'encryptedPayload'>[]>

	/**
	 * Manually inject a credential into the sync pipeline.
	 * For cookies, this calls Network.setCookie on the remote via CDP.
	 */
	injectCredential(entry: CredentialEntry): Promise<void>

	/**
	 * Revoke / remove a credential from both local tracking and the remote.
	 * For cookies, calls Network.deleteCookies on both sides.
	 */
	revokeCredential(id: string): Promise<void>

	/**
	 * Resolve a navigation intercept.
	 * This is how consumers respond to the Chaperone's Fetch.requestPaused event.
	 *
	 * @param requestId - The CDP requestId from the intercept event
	 * @param resolution - continue, fulfill (with custom body), or fail
	 */
	resolveNavigationIntercept(
		requestId: string,
		resolution: FetchInterceptPayload['resolution'],
		fulfillOptions?: {
			body: string
			statusCode?: number
			headers?: Record<string, string>
		}
	): Promise<void>

	/** Get the current snapshot without triggering a sync. */
	getSnapshot(): WarmLayerSnapshot | null

	/**
	 * Tear down the warm layer:
	 *   - Disable Fetch interception (Fetch.disable)
	 *   - Close CDP WebSocket connections
	 *   - Close QUIC streams
	 */
	dispose(): Promise<void>
}
