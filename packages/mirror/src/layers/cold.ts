import type { ColdLayerConfig, LayerSyncStatus, MirrorSessionId } from '../types'

// ---------------------------------------------------------------------------
// Cold Layer – Chrome Profile Sync via Native Rust Launcher
// ---------------------------------------------------------------------------
//
// The cold layer is responsible for bootstrapping a remote browser environment
// that mirrors the user's local Chrome profile.  It relies on a native Rust
// launcher process that:
//   1. Discovers the local Chrome profile directory.
//   2. Diffs local profile state against the remote snapshot.
//   3. Streams incremental updates over a bi-directional IPC channel.
//
// This layer is the slowest to converge (profile data can be large) but only
// needs to run once per session or when the remote env is recycled.
// ---------------------------------------------------------------------------

/** Snapshot metadata for a synced Chrome profile */
export interface ProfileSnapshot {
	/** Opaque version tag – compare to detect drift */
	version: string
	/** ISO-8601 timestamp when this snapshot was captured */
	capturedAt: string
	/** Byte-size of the serialised profile payload */
	sizeBytes: number
	/** Hash (SHA-256) of the serialised profile payload */
	hash: string
	/** Paths that were included in this snapshot */
	includedPaths: string[]
	/** Paths that were excluded (matched excludePatterns) */
	excludedPaths: string[]
}

/** A single diff chunk produced by the Rust launcher */
export interface ProfileDiffChunk {
	/** Relative path inside the Chrome profile directory */
	path: string
	operation: 'add' | 'modify' | 'delete'
	/** Byte payload (undefined for deletes) */
	data?: ArrayBuffer
	/** SHA-256 of the new file content (undefined for deletes) */
	hash?: string
}

/** Progress information emitted during a cold-layer sync */
export interface ColdSyncProgress {
	/** Total chunks to transfer */
	totalChunks: number
	/** Chunks transferred so far */
	completedChunks: number
	/** Bytes transferred so far */
	bytesTransferred: number
	/** Estimated bytes remaining */
	bytesRemaining: number
	/** Current transfer rate (bytes/sec) */
	transferRateBps: number
}

// ---------------------------------------------------------------------------
// IPC contract with the Rust launcher
// ---------------------------------------------------------------------------

/**
 * Commands that the mirror module sends *to* the native Rust launcher.
 */
export type LauncherCommand =
	| { type: 'discover-profile' }
	| { type: 'snapshot'; profilePath: string; excludePatterns: string[] }
	| { type: 'diff'; baseVersion: string; profilePath: string; excludePatterns: string[] }
	| { type: 'apply-remote'; chunks: ProfileDiffChunk[] }
	| { type: 'abort' }

/**
 * Messages that the native Rust launcher sends *back* to the mirror module.
 */
export type LauncherMessage =
	| { type: 'profile-discovered'; profilePath: string }
	| { type: 'snapshot-ready'; snapshot: ProfileSnapshot }
	| { type: 'diff-chunk'; chunk: ProfileDiffChunk; progress: ColdSyncProgress }
	| { type: 'diff-complete'; newVersion: string }
	| { type: 'apply-complete'; appliedChunks: number }
	| { type: 'error'; message: string; cause?: string }

// ---------------------------------------------------------------------------
// Cold Layer Interface
// ---------------------------------------------------------------------------

/**
 * The cold layer manages full Chrome profile synchronisation between the
 * user's local browser and the remote shadow environment.
 *
 * Lifecycle:
 *   1. `initialize()` – Connect to the Rust launcher & discover the profile.
 *   2. `syncToRemote()` – Push a full or incremental snapshot to the remote.
 *   3. `syncFromRemote()` – Pull remote profile changes back to local (if bidirectional).
 *   4. `dispose()` – Tear down IPC and release resources.
 */
export interface IColdLayer {
	readonly status: LayerSyncStatus

	/**
	 * Connect to the native Rust launcher and discover the Chrome profile.
	 * Must be called before any sync operations.
	 */
	initialize(
		sessionId: MirrorSessionId,
		config: ColdLayerConfig
	): Promise<{ profilePath: string; snapshot: ProfileSnapshot }>

	/**
	 * Push local profile state to the remote environment.
	 * Uses incremental diff when a previous snapshot exists.
	 *
	 * @param onProgress - Optional progress callback
	 * @returns The new snapshot metadata after the sync completes
	 */
	syncToRemote(
		onProgress?: (progress: ColdSyncProgress) => void
	): Promise<ProfileSnapshot>

	/**
	 * Pull profile changes from the remote environment back to local.
	 * Only available when `config.bidirectional` is true.
	 *
	 * @param onProgress - Optional progress callback
	 * @returns The new snapshot metadata, or null if bidirectional sync is disabled
	 */
	syncFromRemote(
		onProgress?: (progress: ColdSyncProgress) => void
	): Promise<ProfileSnapshot | null>

	/**
	 * Get the current snapshot metadata without triggering a sync.
	 */
	getSnapshot(): ProfileSnapshot | null

	/**
	 * Tear down the IPC connection and release resources.
	 */
	dispose(): Promise<void>
}
