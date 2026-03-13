/**
 * Background logic for TabsController.
 * Proxies typed TAB_CONTROL messages to chrome.tabs/tabGroups APIs.
 */
import type { TabControlAction, TabControlMessage } from './tab-control-protocol'
import { isTabControlAction, validateTabControlPayload } from './tab-control-protocol'

const PREFIX = '[TabsController.background]'

function debug(...messages: any[]) {
	console.debug(`\x1b[90m${PREFIX}\x1b[0m`, ...messages)
}

export function handleTabControlMessage(
	message: TabControlMessage,
	_sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void
): true | undefined {
	const { action, payload } = message

	if (!isTabControlAction(action)) {
		sendResponse({ success: false, error: `Unknown action: ${String(action)}` })
		return
	}

	try {
		validateTabControlPayload(action, payload)
	} catch (error) {
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : String(error),
		})
		return
	}

	switch (action as TabControlAction) {
		case 'get_active_tab': {
			debug('get_active_tab')
			chrome.tabs
				.query({ active: true, currentWindow: true })
				.then((tabs) => {
					const tabId = tabs.length > 0 ? tabs[0].id || null : null
					debug('get_active_tab: success', tabId)
					sendResponse({ success: true, tabId })
				})
				.catch((error) => {
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error),
					})
				})
			return true // async response
		}

		case 'get_tab_info': {
			debug('get_tab_info', payload)
			chrome.tabs
				.get((payload as { tabId: number }).tabId)
				.then((tab) => {
					debug('get_tab_info: success', tab)
					sendResponse({
						success: true,
						tabId: tab.id ?? (payload as { tabId: number }).tabId,
						title: tab.title ?? '',
						url: tab.url ?? '',
						status: (tab.status ?? 'unloaded') as 'loading' | 'unloaded' | 'complete',
					})
				})
				.catch((error) => {
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error),
					})
				})
			return true // async response
		}

		case 'open_new_tab': {
			debug('open_new_tab', payload)
			chrome.tabs
				.create({ url: (payload as { url: string }).url, active: false })
				.then((newTab) => {
					if (newTab.id == null || newTab.windowId == null) {
						throw new Error('New tab is missing id/windowId.')
					}
					debug('open_new_tab: success', newTab)
					sendResponse({ success: true, tabId: newTab.id, windowId: newTab.windowId })
				})
				.catch((error) => {
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error),
					})
				})
			return true // async response
		}

		case 'create_tab_group': {
			debug('create_tab_group', payload)
			const args = payload as { tabIds: number[]; windowId: number | null }
			const tabIds =
				args.tabIds.length === 1 ? args.tabIds[0] : (args.tabIds as [number, ...number[]])
			chrome.tabs
				.group({
					tabIds,
					createProperties: { windowId: args.windowId ?? undefined },
				})
				.then((groupId) => {
					debug('create_tab_group: success', groupId)
					sendResponse({ success: true, groupId })
				})
				.catch((error) => {
					console.error(PREFIX, 'Failed to create tab group', error)
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error),
					})
				})
			return true // async response
		}

		case 'update_tab_group': {
			debug('update_tab_group', payload)
			const args = payload as {
				groupId: number
				properties: chrome.tabGroups.UpdateProperties
			}
			chrome.tabGroups
				.update(args.groupId, args.properties)
				.then(() => {
					sendResponse({ success: true })
				})
				.catch((error) => {
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error),
					})
				})
			return true // async response
		}

		case 'add_tab_to_group': {
			debug('add_tab_to_group', payload)
			const args = payload as { tabId: number; groupId: number }
			chrome.tabs
				.group({ tabIds: args.tabId, groupId: args.groupId })
				.then(() => {
					sendResponse({ success: true })
				})
				.catch((error) => {
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error),
					})
				})
			return true // async response
		}

		case 'close_tab': {
			debug('close_tab', payload)
			chrome.tabs
				.remove((payload as { tabId: number }).tabId)
				.then(() => {
					sendResponse({ success: true })
				})
				.catch((error) => {
					sendResponse({
						success: false,
						error: error instanceof Error ? error.message : String(error),
					})
				})
			return true // async response
		}

		default:
			sendResponse({ success: false, error: `Unknown action: ${action}` })
			return
	}
}

export function setupTabChangeEvents() {
	console.log('[TabsController.background] setupTabChangeEvents')

	chrome.tabs.onCreated.addListener((tab) => {
		debug('onCreated', tab)
		chrome.runtime
			.sendMessage({ type: 'TAB_CHANGE', action: 'created', payload: { tab } })
			.catch((error) => {
				debug('onCreated error:', error)
			})
	})

	chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
		debug('onRemoved', tabId, removeInfo)
		chrome.runtime
			.sendMessage({
				type: 'TAB_CHANGE',
				action: 'removed',
				payload: { tabId, removeInfo },
			})
			.catch((error) => {
				debug('onRemoved error:', error)
			})
	})

	chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
		debug('onUpdated', tabId, changeInfo)
		chrome.runtime
			.sendMessage({
				type: 'TAB_CHANGE',
				action: 'updated',
				payload: { tabId, changeInfo, tab },
			})
			.catch((error) => {
				debug('onUpdated error:', error)
			})
	})
}
