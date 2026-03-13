import { describe, expect, it, vi } from 'vitest'

import { createMirrorController } from '../../packages/mirror/src/MirrorController'
import type { ICloudAgentClient } from '../../packages/mirror/src/cloud-agent/client'
import type { CloudAgent } from '../../packages/mirror/src/cloud-agent/types'
import type { IColdLayer, ProfileSnapshot } from '../../packages/mirror/src/layers/cold'
import type {
	AuthEvent,
	IWarmLayer,
	WarmLayerSnapshot,
} from '../../packages/mirror/src/layers/warm'
import type { LayerSyncStatus } from '../../packages/mirror/src/types'
import { HotLayerHarness, createSnapshot, createSpatialElement } from './test-harness'

function createCloudAgent(id = 'agent-1'): CloudAgent {
	return {
		id,
		status: 'RUNNING',
		source: { repository: 'https://github.com/example/repo' },
		target: { url: 'ws://remote-cdp/ws' },
		createdAt: new Date().toISOString(),
	}
}

describe('MirrorController', () => {
	it('starts a session, routes events, and ends cleanly', async () => {
		const hot = new HotLayerHarness()
		hot.emitSnapshot(createSnapshot(1, [createSpatialElement(1)]))

		let coldSnapshot: ProfileSnapshot | null = {
			version: 'v1',
			capturedAt: new Date().toISOString(),
			sizeBytes: 10,
			hash: 'hash',
			includedPaths: ['/cookies'],
			excludedPaths: [],
		}
		const cold: IColdLayer = {
			get status(): LayerSyncStatus {
				return 'synced'
			},
			initialize: vi.fn(async () => ({
				profilePath: '/tmp/profile',
				snapshot: coldSnapshot!,
				cdpConnection: {
					webSocketDebuggerUrl: 'ws://local-cdp/ws',
					debuggingPort: 9222,
				},
				ephemeralDir: '/tmp/ephemeral',
			})),
			syncToRemote: vi.fn(async () => coldSnapshot!),
			syncFromRemote: vi.fn(async () => coldSnapshot),
			getSnapshot: vi.fn(() => coldSnapshot),
			getCdpConnection: vi.fn(() => ({
				webSocketDebuggerUrl: 'ws://local-cdp/ws',
				debuggingPort: 9222,
			})),
			dispose: vi.fn(async () => {
				coldSnapshot = null
			}),
		}

		let authHandler: (event: AuthEvent) => void = () => {
			throw new Error('Expected warm layer auth handler to be registered.')
		}
		const warmSnapshot: WarmLayerSnapshot = {
			totalCredentials: 0,
			byKind: {
				cookie: 0,
				'oauth-token': 0,
				'session-storage': 0,
				'local-storage': 0,
				'indexed-db': 0,
				'service-worker-registration': 0,
				'payment-method': 0,
			},
			activeOrigins: [],
			expiringSoon: [],
			lastPushedAt: null,
			activeCdpDomains: [],
			navigationProxyActive: true,
		}
		const warm: IWarmLayer = {
			get status(): LayerSyncStatus {
				return 'synced'
			},
			initialize: vi.fn(async () => warmSnapshot),
			onAuthEvent: (handler) => {
				authHandler = handler
				return () => {
					authHandler = () => {
						throw new Error('Warm auth handler is not active.')
					}
				}
			},
			forceSync: vi.fn(async () => warmSnapshot),
			getCredentialsForOrigin: vi.fn(async () => []),
			injectCredential: vi.fn(async () => undefined),
			revokeCredential: vi.fn(async () => undefined),
			resolveNavigationIntercept: vi.fn(async () => undefined),
			getSnapshot: vi.fn(() => warmSnapshot),
			dispose: vi.fn(async () => undefined),
		}

		const cloudAgent = createCloudAgent()
		const launchAgent = vi.fn(async () => cloudAgent)
		const stopAgent = vi.fn(async () => ({ id: cloudAgent.id }))
		const cloudClient: ICloudAgentClient = {
			listAgents: vi.fn(async () => ({ agents: [] })),
			getAgent: vi.fn(async () => cloudAgent),
			launchAgent,
			followUp: vi.fn(async () => ({ id: cloudAgent.id })),
			stopAgent,
			deleteAgent: vi.fn(async () => ({ id: cloudAgent.id })),
			getConversation: vi.fn(async () => ({ id: cloudAgent.id, messages: [] })),
			listArtifacts: vi.fn(async () => ({ artifacts: [] })),
			downloadArtifact: vi.fn(async () => ({
				url: 'https://artifact',
				expiresAt: new Date().toISOString(),
			})),
			getApiKeyInfo: vi.fn(async () => ({
				apiKeyName: 'key',
				createdAt: new Date().toISOString(),
				userEmail: 'test@example.com',
			})),
			listModels: vi.fn(async () => ({ models: ['test-model'] })),
			listRepositories: vi.fn(async () => ({ repositories: [] })),
		}

		const controller = createMirrorController({
			apiKey: 'test-key',
			repository: 'https://github.com/example/repo',
			quic: { remoteEndpoint: 'quic://mirror.example:4433' },
			remoteCdpUrl: 'ws://remote-cdp/ws',
			dependencies: {
				coldLayer: cold,
				warmLayer: warm,
				hotLayer: hot,
				cloudClient,
			},
		})

		const { sessionId } = await controller.startSession()
		expect(sessionId).toBe(controller.state.sessionId)
		expect(controller.state.status).toBe('live')
		expect(launchAgent).toHaveBeenCalledTimes(1)

		await controller.navigateRemote('https://example.com/dashboard')
		expect(hot.inputEvents.at(-1)).toMatchObject({
			type: 'navigate',
			url: 'https://example.com/dashboard',
		})

		const intercepts: string[] = []
		controller.onNavigationIntercept((intercept) => {
			intercepts.push(intercept.requestId)
		})

		authHandler({
			type: 'navigation-intercept',
			timestamp: new Date().toISOString(),
			intercept: {
				requestId: 'req-1',
				url: 'https://example.com/login',
				method: 'GET',
				headers: {},
				resourceType: 'Document',
			},
		})
		expect(intercepts).toEqual(['req-1'])

		await controller.endSession({ deleteAgent: false, syncBack: true })
		expect(stopAgent).toHaveBeenCalledWith(cloudAgent.id)
		expect(controller.state.status).toBe('disconnected')
	})
})
