// ---------------------------------------------------------------------------
// Cloud Agents API – Type definitions matching the REST API
// ---------------------------------------------------------------------------

export type CloudAgentStatus =
	| 'CREATING'
	| 'RUNNING'
	| 'FINISHED'
	| 'ERROR'
	| 'STOPPED'

export interface CloudAgentSource {
	repository: string
	ref?: string
	prUrl?: string
}

export interface CloudAgentTarget {
	branchName?: string
	url?: string
	prUrl?: string
	autoCreatePr?: boolean
	openAsCursorGithubApp?: boolean
	skipReviewerRequest?: boolean
	autoBranch?: boolean
}

export interface CloudAgent {
	id: string
	name?: string
	status: CloudAgentStatus
	source: CloudAgentSource
	target: CloudAgentTarget
	summary?: string
	createdAt: string
}

export interface CloudAgentMessage {
	id: string
	type: 'user_message' | 'assistant_message'
	text: string
}

export interface CloudAgentConversation {
	id: string
	messages: CloudAgentMessage[]
}

export interface CloudAgentArtifact {
	absolutePath: string
	sizeBytes: number
	updatedAt: string
}

export interface CloudAgentPrompt {
	text: string
	images?: Array<{
		data: string
		dimension: { width: number; height: number }
	}>
}

export interface CloudAgentWebhook {
	url: string
	secret?: string
}

// ---------------------------------------------------------------------------
// Request / Response types
// ---------------------------------------------------------------------------

export interface ListAgentsParams {
	limit?: number
	cursor?: string
	prUrl?: string
}

export interface ListAgentsResponse {
	agents: CloudAgent[]
	nextCursor?: string
}

export interface LaunchAgentParams {
	prompt: CloudAgentPrompt
	model?: string
	source: CloudAgentSource
	target?: CloudAgentTarget
	webhook?: CloudAgentWebhook
}

export interface FollowUpParams {
	prompt: CloudAgentPrompt
}

export interface ArtifactsResponse {
	artifacts: CloudAgentArtifact[]
}

export interface ArtifactDownloadResponse {
	url: string
	expiresAt: string
}

export interface ApiKeyInfo {
	apiKeyName: string
	createdAt: string
	userEmail: string
}

export interface ListModelsResponse {
	models: string[]
}

export interface ListRepositoriesResponse {
	repositories: Array<{
		owner: string
		name: string
		repository: string
	}>
}
