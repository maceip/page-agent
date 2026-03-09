import { initPageController } from '@/agent/RemotePageController.content'
import { initObservers } from '@/observers/observer-manager'

// import { DEMO_CONFIG } from '@/agent/constants'

const DEBUG_PREFIX = '[Content]'

export default defineContentScript({
	matches: ['<all_urls>'],
	runAt: 'document_end',

	main() {
		console.debug(`${DEBUG_PREFIX} Loaded on ${window.location.href}`)
		initPageController()

		// Start page observers for passive memory capture
		// (only activates on matching AI platform URLs)
		initObservers()

		// if auth token matches, expose agent to page
		chrome.storage.local.get('PageAgentExtUserAuthToken').then((result) => {
			// extension side token.
			// @note this is isolated world. it is safe to assume user script cannot access it
			const extToken = result.PageAgentExtUserAuthToken
			if (!extToken) return

			// page side token
			const pageToken = localStorage.getItem('PageAgentExtUserAuthToken')
			if (!pageToken) return

			if (pageToken !== extToken) return

			console.log('[PageAgentExt]: Auth tokens match. Exposing agent to page.')

			// add isolated world script
			exposeAgentToPage().then(
				// add main-world script
				() => injectScript('/main-world.js')
			)
		})
	},
})

async function exposeAgentToPage() {
	const { MultiPageAgent } = await import('@/agent/MultiPageAgent')
	console.log('[PageAgentExt]: MultiPageAgent loaded')

	/**
	 * singleton MultiPageAgent to handle requests from the page
	 */
	let multiPageAgent: InstanceType<typeof MultiPageAgent> | null = null

	window.addEventListener('message', async (e) => {
		const data = e.data
		if (typeof data !== 'object' || data === null) return
		if (data.channel !== 'PAGE_AGENT_EXT_REQUEST') return

		const { action, payload, id } = data

		switch (action) {
			case 'execute': {
				// singleton check
				if (multiPageAgent && multiPageAgent.status === 'running') {
					window.postMessage(
						{
							channel: 'PAGE_AGENT_EXT_RESPONSE',
							id,
							action: 'execute_result',
							error: 'Agent is already running a task. Please wait until it finishes.',
						},
						'*'
					)
					return
				}

				try {
					const { task, config } = payload

					// Dispose old instance before creating new one
					multiPageAgent?.dispose()

					multiPageAgent = new MultiPageAgent(config)

					// events

					multiPageAgent.addEventListener('statuschange', (event) => {
						if (!multiPageAgent) return
						window.postMessage(
							{
								channel: 'PAGE_AGENT_EXT_RESPONSE',
								id,
								action: 'status_change_event',
								payload: multiPageAgent.status,
							},
							'*'
						)
					})

					multiPageAgent.addEventListener('activity', (event) => {
						if (!multiPageAgent) return
						window.postMessage(
							{
								channel: 'PAGE_AGENT_EXT_RESPONSE',
								id,
								action: 'activity_event',
								payload: (event as CustomEvent).detail,
							},
							'*'
						)
					})

					multiPageAgent.addEventListener('historychange', (event) => {
						if (!multiPageAgent) return
						window.postMessage(
							{
								channel: 'PAGE_AGENT_EXT_RESPONSE',
								id,
								action: 'history_change_event',
								payload: multiPageAgent.history,
							},
							'*'
						)
					})

					// result

					const result = await multiPageAgent.execute(task)

					window.postMessage(
						{
							channel: 'PAGE_AGENT_EXT_RESPONSE',
							id,
							action: 'execute_result',
							payload: result,
						},
						'*'
					)
				} catch (error) {
					window.postMessage(
						{
							channel: 'PAGE_AGENT_EXT_RESPONSE',
							id,
							action: 'execute_result',
							error: (error as Error).message,
						},
						'*'
					)
				}

				break
			}

			case 'stop': {
				multiPageAgent?.stop()
				break
			}

			// Memory API: let authenticated pages recall/save memories
			case 'memory_recall': {
				chrome.runtime.sendMessage(
					{ type: 'MEMORY_RECALL', payload: payload || { scope: window.location.href, limit: 5 } },
					(response) => {
						window.postMessage(
							{
								channel: 'PAGE_AGENT_EXT_RESPONSE',
								id,
								action: 'memory_recall_result',
								payload: response?.memories || [],
							},
							'*'
						)
					}
				)
				break
			}

			case 'memory_save': {
				chrome.runtime.sendMessage(
					{
						type: 'MEMORY_WRITE',
						payload: {
							content: payload?.content || '',
							tags: payload?.tags || [],
							kind: payload?.kind || 'observation',
							scope: payload?.scope || window.location.href,
							source: { agent: payload?.agent || 'user', url: window.location.href },
						},
					},
					(response) => {
						window.postMessage(
							{
								channel: 'PAGE_AGENT_EXT_RESPONSE',
								id,
								action: 'memory_save_result',
								payload: response?.ok ? response.memory : null,
								error: response?.ok ? undefined : response?.error,
							},
							'*'
						)
					}
				)
				break
			}

			default:
				console.warn(`${DEBUG_PREFIX} Unknown action from page:`, action)
				break
		}
	})
}
