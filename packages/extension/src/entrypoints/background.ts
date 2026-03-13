import { handlePageControlMessage } from '@/agent/RemotePageController.background'
import { handleTabControlMessage, setupTabChangeEvents } from '@/agent/TabsController.background'
import { isPageControlMessage } from '@/agent/page-control-protocol'
import { isTabControlMessage } from '@/agent/tab-control-protocol'
import { initMemoryBackground } from '@/lib/memory-background'

export default defineBackground(() => {
	console.log('[Background] Service Worker started')

	// tab change events

	setupTabChangeEvents()

	// memory durability hub — alarms, cross-device sync, persistence

	initMemoryBackground()

	// generate user auth token

	chrome.storage.local.get('PageAgentExtUserAuthToken').then((result) => {
		if (result.PageAgentExtUserAuthToken) return

		const userAuthToken = crypto.randomUUID()
		chrome.storage.local.set({ PageAgentExtUserAuthToken: userAuthToken })
	})

	// message proxy — memory messages are handled by initMemoryBackground's own listener

	chrome.runtime.onMessage.addListener(
		(message: unknown, sender, sendResponse): true | undefined => {
			if (isTabControlMessage(message)) {
				return handleTabControlMessage(message, sender, sendResponse)
			} else if (
				isPageControlMessage(message) ||
				(typeof message === 'object' &&
					message !== null &&
					(message as { type?: unknown }).type === 'PAGE_CONTROL' &&
					(message as { action?: unknown }).action === 'get_my_tab_id')
			) {
				return handlePageControlMessage(message, sender, sendResponse)
			}
			// Unknown or memory messages (handled by memory listener) — no response needed
			return undefined
		}
	)

	// setup

	chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {})
})
