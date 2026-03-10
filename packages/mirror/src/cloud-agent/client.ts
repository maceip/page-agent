import type {
	ApiKeyInfo,
	ArtifactDownloadResponse,
	ArtifactsResponse,
	CloudAgent,
	CloudAgentConversation,
	FollowUpParams,
	LaunchAgentParams,
	ListAgentsParams,
	ListAgentsResponse,
	ListModelsResponse,
	ListRepositoriesResponse,
} from './types'

// ---------------------------------------------------------------------------
// Cloud Agents API Client – Interface
// ---------------------------------------------------------------------------

/**
 * Interface for communicating with the Cloud Agents REST API.
 *
 * Implementors handle HTTP transport, authentication (Basic auth with apiKey),
 * retry logic, and response parsing.
 */
export interface ICloudAgentClient {
	// -- Agent lifecycle -----------------------------------------------------

	/** List cloud agents for the authenticated user. */
	listAgents(params?: ListAgentsParams): Promise<ListAgentsResponse>

	/** Get a single agent's current status. */
	getAgent(id: string): Promise<CloudAgent>

	/** Launch a new cloud agent. */
	launchAgent(params: LaunchAgentParams): Promise<CloudAgent>

	/** Send a follow-up prompt to an existing agent. */
	followUp(id: string, params: FollowUpParams): Promise<{ id: string }>

	/** Stop a running agent (pausable – follow-up resumes it). */
	stopAgent(id: string): Promise<{ id: string }>

	/** Permanently delete an agent. */
	deleteAgent(id: string): Promise<{ id: string }>

	// -- Conversation & Artifacts -------------------------------------------

	/** Retrieve the full conversation history for an agent. */
	getConversation(id: string): Promise<CloudAgentConversation>

	/** List artifacts produced by an agent (max 100, agents < 6 months old). */
	listArtifacts(id: string): Promise<ArtifactsResponse>

	/**
	 * Get a pre-signed download URL for a specific artifact.
	 * The URL expires after 15 minutes.
	 */
	downloadArtifact(id: string, path: string): Promise<ArtifactDownloadResponse>

	// -- Account & Metadata -------------------------------------------------

	/** Information about the API key being used. */
	getApiKeyInfo(): Promise<ApiKeyInfo>

	/** List recommended model IDs. */
	listModels(): Promise<ListModelsResponse>

	/** List GitHub repositories accessible to the authenticated user. */
	listRepositories(): Promise<ListRepositoriesResponse>
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

export interface CloudAgentClientConfig {
	/** API key for Basic authentication */
	apiKey: string

	/** Base URL for the API (default: "https://api.cursor.com") */
	baseUrl?: string

	/** Optional custom fetch implementation (e.g. for testing or proxying) */
	customFetch?: typeof globalThis.fetch
}
