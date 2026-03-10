import type {
	CdpConnectionConfig,
	ColdLayerConfig,
	LayerSyncStatus,
	MirrorSessionId,
	QuicTransportConfig,
} from '../types'

// ---------------------------------------------------------------------------
// Cold Layer – Tauri Ephemeral Bootstrapper + Chrome Profile Sync
// ---------------------------------------------------------------------------
//
// The cold layer bootstraps a browser environment on both sides:
//
// 1. **Cloud Profile Packager** compresses a baseline configuration
//    (enterprise policies, root CAs, safe caches) into a < 10 MB .zstd
//    payload served over QUIC.
//
// 2. **Tauri Ephemeral Bootstrapper** (local) fetches the zstd payload,
//    extracts it to a disposable OS temp directory, then natively spawns
//    Chrome pointing to it:
//      chrome --user-data-dir=%TEMP%/cloud_session_xyz --remote-debugging-port=9222
//    When the session ends, Tauri deletes the folder.
//
// 3. Incremental profile diffs keep the two sides aligned for long-running
//    sessions. Bi-directional sync is supported so changes on the cloud
//    can flow back to the user's canonical profile.
// ---------------------------------------------------------------------------

/** Metadata about a compressed profile payload */
export interface ProfilePayload {
	/** URL where the .zstd payload can be fetched */
	url: string
	/** Byte-size of the compressed payload */
	compressedSizeBytes: number
	/** Byte-size after decompression */
	uncompressedSizeBytes: number
	/** SHA-256 hash of the compressed payload for integrity verification */
	hash: string
	/** Compression format (currently always zstd) */
	compression: 'zstd'
	/** ISO-8601 timestamp when this payload was packaged */
	packagedAt: string
	/** Contents of the payload */
	contents: ProfilePayloadContents
}

/** What's included in the baseline profile payload */
export interface ProfilePayloadContents {
	/** Enterprise policies (chrome://policy) */
	enterprisePolicies: boolean
	/** Root CA certificates */
	rootCertificates: boolean
	/** Safe caches (e.g. font cache, spell-check dictionaries) */
	safeCaches: boolean
	/** Extension pre-configurations */
	extensions: string[]
	/** Custom items packed by the Cloud Profile Packager */
	custom: string[]
}

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

/** A single diff chunk produced by the Tauri bootstrapper */
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
	phase: 'fetching-payload' | 'extracting' | 'diffing' | 'uploading' | 'applying'
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
// IPC contract with the Tauri Ephemeral Bootstrapper
// ---------------------------------------------------------------------------

/**
 * Commands sent from the mirror module → Tauri Rust process.
 *
 * Tauri is responsible for:
 *   - Fetching the zstd payload from the Cloud Profile Packager
 *   - Extracting it to an ephemeral directory
 *   - Spawning Chrome with --user-data-dir=... --remote-debugging-port=9222
 *   - Computing profile diffs for incremental sync
 *   - Cleaning up ephemeral directories on session end
 */
export type LauncherCommand =
	| { type: 'fetch-profile-payload'; url: string; targetDir: string }
	| { type: 'spawn-chrome'; userDataDir: string; debuggingPort: number; extraFlags?: string[] }
	| { type: 'discover-profile' }
	| { type: 'snapshot'; profilePath: string; excludePatterns: string[] }
	| { type: 'diff'; baseVersion: string; profilePath: string; excludePatterns: string[] }
	| { type: 'apply-remote'; chunks: ProfileDiffChunk[] }
	| { type: 'cleanup-ephemeral'; sessionDir: string }
	| { type: 'abort' }

/**
 * Messages sent from the Tauri Rust process → mirror module.
 */
export type LauncherMessage =
	| { type: 'payload-fetched'; targetDir: string; payload: ProfilePayload }
	| { type: 'chrome-spawned'; pid: number; debuggerUrl: string; userDataDir: string }
	| { type: 'profile-discovered'; profilePath: string }
	| { type: 'snapshot-ready'; snapshot: ProfileSnapshot }
	| { type: 'diff-chunk'; chunk: ProfileDiffChunk; progress: ColdSyncProgress }
	| { type: 'diff-complete'; newVersion: string }
	| { type: 'apply-complete'; appliedChunks: number }
	| { type: 'ephemeral-cleaned'; sessionDir: string }
	| { type: 'error'; message: string; cause?: string }

// ---------------------------------------------------------------------------
// Cold Layer Interface
// ---------------------------------------------------------------------------

/**
 * The cold layer manages full Chrome profile bootstrap and synchronisation
 * between the user's local browser and the remote shadow environment.
 *
 * The Tauri Ephemeral Bootstrapper handles the heavy lifting:
 *   1. Fetch a compressed (.zstd) baseline profile from the Cloud Profile Packager.
 *   2. Extract it to a disposable temp directory.
 *   3. Spawn Chrome with `--user-data-dir=<temp>` and `--remote-debugging-port=9222`.
 *   4. On session end, delete the ephemeral directory.
 *
 * Lifecycle:
 *   1. `initialize()` – Connect to Tauri, fetch payload, spawn Chrome.
 *   2. `syncToRemote()` – Push incremental profile diff to the cloud.
 *   3. `syncFromRemote()` – Pull cloud profile changes back locally.
 *   4. `dispose()` – Kill Chrome, clean up ephemeral dir.
 */
export interface IColdLayer {
	readonly status: LayerSyncStatus

	/**
	 * Bootstrap the local browser environment:
	 *   1. Connect to the Tauri IPC.
	 *   2. Fetch the zstd profile payload from the Cloud Profile Packager.
	 *   3. Extract to an ephemeral directory.
	 *   4. Spawn Chrome with the ephemeral user-data-dir.
	 *   5. Return the CDP connection details for the spawned Chrome.
	 */
	initialize(
		sessionId: MirrorSessionId,
		config: ColdLayerConfig,
		quicConfig: QuicTransportConfig
	): Promise<{
		profilePath: string
		snapshot: ProfileSnapshot
		cdpConnection: CdpConnectionConfig
		ephemeralDir: string
	}>

	/**
	 * Push local profile state to the remote environment.
	 * Uses incremental diff when a previous snapshot exists.
	 * Diffs are streamed over a QUIC bidirectional stream.
	 */
	syncToRemote(onProgress?: (progress: ColdSyncProgress) => void): Promise<ProfileSnapshot>

	/**
	 * Pull profile changes from the remote environment back to local.
	 * Only available when `config.bidirectional` is true.
	 */
	syncFromRemote(onProgress?: (progress: ColdSyncProgress) => void): Promise<ProfileSnapshot | null>

	/** Get the current snapshot metadata without triggering a sync. */
	getSnapshot(): ProfileSnapshot | null

	/** Get the CDP connection established during initialization. */
	getCdpConnection(): CdpConnectionConfig | null

	/**
	 * Tear down the cold layer:
	 *   - Disconnect from Tauri IPC
	 *   - Optionally kill the spawned Chrome process
	 *   - Delete the ephemeral profile directory
	 */
	dispose(): Promise<void>
}
