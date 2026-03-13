/**
 * Content script for RemotePageController.
 * Receives typed PAGE_CONTROL messages and dispatches them to the local PageController.
 */
import { PageController } from '@page-agent/page-controller'

import {
	ACTION_TO_METHOD,
	type PageControlAction,
	isPageControlAction,
	validatePageControlPayload,
} from './page-control-protocol'

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
	 * This is a trust boundary; action and payload are validated before dispatch.
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

	chrome.runtime.onMessage.addListener(
		(message: unknown, _sender, sendResponse): true | undefined => {
			if (typeof message !== 'object' || message === null) {
				return
			}
			if ((message as { type?: unknown }).type !== 'PAGE_CONTROL') return

			const action = (message as { action?: unknown }).action
			const payload = (message as { payload?: unknown[] }).payload

			// Validate action is known
			if (typeof action !== 'string' || !isPageControlAction(action)) {
				sendResponse({
					success: false,
					error: `Unknown PAGE_CONTROL action: ${action}`,
				})
				return
			}
			try {
				validatePageControlPayload(action, payload)
			} catch (error) {
				sendResponse({
					success: false,
					error: error instanceof Error ? error.message : String(error),
				})
				return
			}

			const pc = getPC()
			dispatch(pc, action, payload)
				.then((result) => sendResponse(result))
				.catch((error) =>
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error),
					})
				)

			return true
		}
	)
}
