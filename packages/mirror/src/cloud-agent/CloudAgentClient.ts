import type { CloudAgentClientConfig, ICloudAgentClient } from './client'
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

const DEFAULT_BASE_URL = 'https://api.cursor.com'

function encodeBase64(raw: string): string {
	if (typeof globalThis.btoa === 'function') {
		return globalThis.btoa(raw)
	}
	const bufferCtor = (
		globalThis as {
			Buffer?: { from: (value: string) => { toString: (encoding: 'base64') => string } }
		}
	).Buffer
	if (!bufferCtor) {
		throw new Error('Base64 encoding is unavailable in this runtime.')
	}
	return bufferCtor.from(raw).toString('base64')
}

function buildQuery(params: Record<string, string | number | undefined>): string {
	const query = new URLSearchParams()
	for (const [key, value] of Object.entries(params)) {
		if (value === undefined) continue
		query.set(key, String(value))
	}
	const encoded = query.toString()
	return encoded ? `?${encoded}` : ''
}

export class CloudAgentClient implements ICloudAgentClient {
	private readonly baseUrl: string
	private readonly apiKey: string
	private readonly fetchImpl: typeof globalThis.fetch

	constructor(config: CloudAgentClientConfig) {
		if (!config.apiKey.trim()) {
			throw new Error('CloudAgentClient requires a non-empty apiKey.')
		}

		this.apiKey = config.apiKey
		this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
		this.fetchImpl = config.customFetch ?? globalThis.fetch

		if (!this.fetchImpl) {
			throw new Error('CloudAgentClient requires a fetch implementation.')
		}
	}

	private authHeader(): string {
		return `Basic ${encodeBase64(`${this.apiKey}:`)}`
	}

	private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
		const headers = new Headers(init?.headers)
		headers.set('Authorization', this.authHeader())
		if (!headers.has('Content-Type')) {
			headers.set('Content-Type', 'application/json')
		}

		const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
			...init,
			headers,
		})

		if (!response.ok) {
			const body = await response.text()
			throw new Error(
				`Cloud Agents API request failed: ${response.status} ${response.statusText} (${path})${body ? ` - ${body}` : ''}`
			)
		}

		if (response.status === 204) {
			return undefined as T
		}

		return (await response.json()) as T
	}

	listAgents(params?: ListAgentsParams): Promise<ListAgentsResponse> {
		return this.requestJson<ListAgentsResponse>(
			`/agents${buildQuery({
				limit: params?.limit,
				cursor: params?.cursor,
				prUrl: params?.prUrl,
			})}`
		)
	}

	getAgent(id: string): Promise<CloudAgent> {
		return this.requestJson<CloudAgent>(`/agents/${id}`)
	}

	launchAgent(params: LaunchAgentParams): Promise<CloudAgent> {
		return this.requestJson<CloudAgent>('/agents', {
			method: 'POST',
			body: JSON.stringify(params),
		})
	}

	followUp(id: string, params: FollowUpParams): Promise<{ id: string }> {
		return this.requestJson<{ id: string }>(`/agents/${id}/follow-up`, {
			method: 'POST',
			body: JSON.stringify(params),
		})
	}

	stopAgent(id: string): Promise<{ id: string }> {
		return this.requestJson<{ id: string }>(`/agents/${id}/stop`, {
			method: 'POST',
		})
	}

	deleteAgent(id: string): Promise<{ id: string }> {
		return this.requestJson<{ id: string }>(`/agents/${id}`, {
			method: 'DELETE',
		})
	}

	getConversation(id: string): Promise<CloudAgentConversation> {
		return this.requestJson<CloudAgentConversation>(`/agents/${id}/conversation`)
	}

	listArtifacts(id: string): Promise<ArtifactsResponse> {
		return this.requestJson<ArtifactsResponse>(`/agents/${id}/artifacts`)
	}

	downloadArtifact(id: string, path: string): Promise<ArtifactDownloadResponse> {
		return this.requestJson<ArtifactDownloadResponse>(
			`/agents/${id}/artifacts/download${buildQuery({ path })}`
		)
	}

	getApiKeyInfo(): Promise<ApiKeyInfo> {
		return this.requestJson<ApiKeyInfo>('/auth/api-key')
	}

	listModels(): Promise<ListModelsResponse> {
		return this.requestJson<ListModelsResponse>('/models')
	}

	listRepositories(): Promise<ListRepositoriesResponse> {
		return this.requestJson<ListRepositoriesResponse>('/repositories')
	}
}

export function createCloudAgentClient(config: CloudAgentClientConfig): ICloudAgentClient {
	return new CloudAgentClient(config)
}
