/**
 * Background handler for RemotePageController.
 * Proxies PAGE_CONTROL messages from the agent env to the content script.
 */

export function handlePageControlMessage(
	message: { type: 'PAGE_CONTROL'; action: string; targetTabId: number; payload?: unknown },
	sender: chrome.runtime.MessageSender,
	sendResponse: (response: unknown) => void
): true | undefined {
	const PREFIX = '[RemotePageController.background]'

	const { action, payload, targetTabId } = message

	if (action === 'get_my_tab_id') {
		sendResponse({ tabId: sender.tab?.id || null })
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
