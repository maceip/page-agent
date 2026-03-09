import type { LayerSyncStatus, MirrorSessionId, WarmLayerConfig } from '../types'

// ---------------------------------------------------------------------------
// Warm Layer – Identity, Auth, Secrets & Payment Sync
// ---------------------------------------------------------------------------
//
// The warm layer keeps the remote shadow browser authenticated as the user.
// It handles:
//   - Cookies and session tokens
//   - OAuth / OIDC tokens (access + refresh)
//   - Service-worker registrations & push subscriptions
//   - LocalStorage / SessionStorage / IndexedDB auth entries
//   - Saved payment methods (when explicitly opted in)
//
// Unlike the cold layer (which syncs static profile data), the warm layer
// is event-driven: it reacts to auth-related changes in the local browser
// and pushes them to the remote in near-real-time.
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
}

/** Auth event detected in the local browser */
export type AuthEvent =
	| AuthEventLogin
	| AuthEventLogout
	| AuthEventTokenRefresh
	| AuthEventCookieChange
	| AuthEventStorageChange
	| AuthEventPaymentChange

export interface AuthEventLogin {
	type: 'login'
	origin: string
	credentials: CredentialEntry[]
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

/** Summary of what's currently synced to the remote */
export interface WarmLayerSnapshot {
	/** Total number of credentials being tracked */
	totalCredentials: number
	/** Breakdown by kind */
	byKind: Record<CredentialKind, number>
	/** Origins with active sessions */
	activeOrigins: string[]
	/** Credentials expiring within the freshness TTL */
	expiringSoon: Array<{ id: string; origin: string; expiresAt: string }>
	/** ISO-8601 timestamp of the last push to the remote */
	lastPushedAt: string | null
}

// ---------------------------------------------------------------------------
// Warm Layer Interface
// ---------------------------------------------------------------------------

/**
 * The warm layer ensures the remote shadow browser stays authenticated
 * with the user's current identity and secrets.
 *
 * Lifecycle:
 *   1. `initialize()` – Start observing auth events in the local browser.
 *   2. Auth events auto-push to the remote as they occur.
 *   3. `forceSync()` – Manually trigger a full credential push.
 *   4. `dispose()` – Stop observation and clean up.
 */
export interface IWarmLayer {
	readonly status: LayerSyncStatus

	/**
	 * Begin observing auth-related events in the local browser and syncing
	 * them to the remote environment.
	 */
	initialize(
		sessionId: MirrorSessionId,
		config: WarmLayerConfig
	): Promise<WarmLayerSnapshot>

	/**
	 * Register a callback to be notified of auth events as they occur.
	 */
	onAuthEvent(handler: (event: AuthEvent) => void): () => void

	/**
	 * Force a full credential sync to the remote, regardless of change detection.
	 * Useful after cold-layer bootstrap to ensure the new remote env is primed.
	 */
	forceSync(): Promise<WarmLayerSnapshot>

	/**
	 * Retrieve credentials for a specific origin.
	 * Returns only metadata – encrypted payloads are never exposed through this method.
	 */
	getCredentialsForOrigin(
		origin: string
	): Promise<Array<Omit<CredentialEntry, 'encryptedPayload'>>>

	/**
	 * Manually inject a credential into the sync pipeline.
	 * Useful for programmatic auth flows (e.g. API-key login, headless auth).
	 */
	injectCredential(entry: CredentialEntry): Promise<void>

	/**
	 * Revoke / remove a credential from both local tracking and the remote.
	 */
	revokeCredential(id: string): Promise<void>

	/**
	 * Get the current snapshot without triggering a sync.
	 */
	getSnapshot(): WarmLayerSnapshot | null

	/**
	 * Tear down observers and release resources.
	 */
	dispose(): Promise<void>
}
