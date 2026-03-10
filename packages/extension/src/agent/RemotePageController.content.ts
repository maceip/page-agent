/**
 * Content script for RemotePageController.
 * Receives typed PAGE_CONTROL messages and dispatches them to the local PageController.
 */
import { PageController } from '@page-agent/page-controller'

import { ACTION_TO_METHOD, type PageControlAction } from './page-control-protocol'

export function initPageController() {
	let pageController: PageController | null = null
	let intervalID: number | null = null

	const myTabIdPromise = chrome.runtime
		.sendMessage({ type: 'PAGE_CONTROL', action: 'get_my_tab_id' })
		.then((response) => {
			return (response as { tabId: number | null }).tabId
		})
		.catch((error) => {
			console.error('[RemotePageController.ContentScript]: Failed to get my tab id', error)
			return null
		})

	function getPC(): PageController {
		if (!pageController) {
			pageController = new PageController({ enableMask: false, viewportExpansion: 400 })
		}
		return pageController
	}

	intervalID = window.setInterval(async () => {
		const agentHeartbeat = (await chrome.storage.local.get('agentHeartbeat')).agentHeartbeat
		const now = Date.now()
		const agentInTouch = typeof agentHeartbeat === 'number' && now - agentHeartbeat < 2_000

		const isAgentRunning = (await chrome.storage.local.get('isAgentRunning')).isAgentRunning
		const currentTabId = (await chrome.storage.local.get('currentTabId')).currentTabId

		const shouldShowMask = isAgentRunning && agentInTouch && currentTabId === (await myTabIdPromise)

		if (shouldShowMask) {
			const pc = getPC()
			pc.initMask()
			await pc.showMask()
		} else {
			if (pageController) {
				pageController.hideMask()
				pageController.cleanUpHighlights()
			}
		}

		if (!isAgentRunning && agentInTouch) {
			if (pageController) {
				pageController.dispose()
				pageController = null
			}
		}
	}, 500)

	/**
	 * Dispatch a PAGE_CONTROL action to the local PageController.
	 * This is a trust boundary — the message payload is validated by action name
	 * (known set from ACTION_TO_METHOD) but args are not re-validated at runtime.
	 */
	function dispatch(
		pc: PageController,
		action: PageControlAction,
		payload: unknown[] | undefined
	): Promise<unknown> {
		const methodName = ACTION_TO_METHOD[action]
		const fn = pc[methodName as keyof PageController] as (...args: unknown[]) => Promise<unknown>
		return fn.apply(pc, payload || [])
	}

	chrome.runtime.onMessage.addListener((message, sender, sendResponse): true | undefined => {
		if (message.type !== 'PAGE_CONTROL') {
			return
		}

		const { action, payload } = message as { action: string; payload?: any[] }

		// Validate action is known
		if (!(action in ACTION_TO_METHOD)) {
			sendResponse({
				success: false,
				error: `Unknown PAGE_CONTROL action: ${action}`,
			})
			return
		}

		const pc = getPC()
		dispatch(pc, action as PageControlAction, payload)
			.then((result) => sendResponse(result))
			.catch((error) =>
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				})
			)

		return true
	})
}
