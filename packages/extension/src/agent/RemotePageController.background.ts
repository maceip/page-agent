/**
 * Background handler for RemotePageController.
 * Proxies PAGE_CONTROL messages from the agent env to the content script.
 */
import { isPageControlMessage, validatePageControlPayload } from './page-control-protocol'

interface GetMyTabIdMessage {
	type: 'PAGE_CONTROL'
	action: 'get_my_tab_id'
}

function isGetMyTabIdMessage(value: unknown): value is GetMyTabIdMessage {
	return (
		typeof value === 'object' &&
		value !== null &&
		(value as { type?: unknown }).type === 'PAGE_CONTROL' &&
		(value as { action?: unknown }).action === 'get_my_tab_id'
	)
}

export function handlePageControlMessage(
	message: unknown,
	sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void
): true | undefined {
	const PREFIX = '[RemotePageController.background]'

	if (isGetMyTabIdMessage(message)) {
		sendResponse({ tabId: sender.tab?.id || null })
		return
	}

	if (!isPageControlMessage(message)) {
		sendResponse({
			success: false,
			error: 'Invalid PAGE_CONTROL message.',
		})
		return
	}

	const { action, payload, targetTabId } = message
	try {
		validatePageControlPayload(action, payload)
	} catch (error) {
		sendResponse({
			success: false,
			error: error instanceof Error ? error.message : String(error),
		})
		return
	}

	// proxy to content script
	chrome.tabs
		.sendMessage(targetTabId, {
			type: 'PAGE_CONTROL' as const,
			action,
			payload,
		})
		.then((result) => {
			sendResponse(result)
		})
		.catch((error) => {
			console.error(PREFIX, error)
			sendResponse({
				success: false,
				error: error instanceof Error ? error.message : String(error),
			})
		})

	return true // async response
}
