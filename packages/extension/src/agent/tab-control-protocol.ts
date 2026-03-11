/**
 * Typed message protocol for tab-control cross-context communication.
 *
 * This is the single source of truth for TAB_CONTROL messages between
 * extension runtime contexts.
 */

export interface TabInfo {
	tabId: number
	title: string
	url: string
	status: 'loading' | 'unloaded' | 'complete'
}

export type TabControlResponse<T extends object = Record<string, never>> =
	| ({ success: true } & T)
	| { success: false; error: string }

export interface TabControlRemoteMethods {
	get_active_tab: {
		args: []
		return: TabControlResponse<{ tabId: number | null }>
	}
	get_tab_info: {
		args: [payload: { tabId: number }]
		return: TabControlResponse<TabInfo>
	}
	open_new_tab: {
		args: [payload: { url: string }]
		return: TabControlResponse<{ tabId: number; windowId: number }>
	}
	create_tab_group: {
		args: [payload: { tabIds: number[]; windowId: number | null }]
		return: TabControlResponse<{ groupId: number }>
	}
	update_tab_group: {
		args: [
			payload: {
				groupId: number
				properties: {
					title: string
					color: chrome.tabGroups.Color
					collapsed: boolean
				}
			},
		]
		return: TabControlResponse
	}
	add_tab_to_group: {
		args: [payload: { tabId: number; groupId: number }]
		return: TabControlResponse
	}
	close_tab: {
		args: [payload: { tabId: number }]
		return: TabControlResponse
	}
}

export type TabControlAction = keyof TabControlRemoteMethods

export interface TabControlMessage<K extends TabControlAction = TabControlAction> {
	type: 'TAB_CONTROL'
	action: K
	payload?: TabControlRemoteMethods[K]['args'][0]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function hasNumber(value: unknown, key: string): boolean {
	return isRecord(value) && typeof value[key] === 'number'
}

const TAB_CONTROL_PAYLOAD_VALIDATORS: Record<TabControlAction, (payload: unknown) => boolean> = {
	get_active_tab: (payload) => payload === undefined,
	get_tab_info: (payload) => hasNumber(payload, 'tabId'),
	open_new_tab: (payload) => isRecord(payload) && typeof payload.url === 'string',
	create_tab_group: (payload) =>
		isRecord(payload) &&
		Array.isArray(payload.tabIds) &&
		payload.tabIds.length > 0 &&
		payload.tabIds.every((id) => typeof id === 'number') &&
		(typeof payload.windowId === 'number' || payload.windowId === null),
	update_tab_group: (payload) =>
		isRecord(payload) &&
		hasNumber(payload, 'groupId') &&
		isRecord(payload.properties) &&
		typeof payload.properties.title === 'string' &&
		typeof payload.properties.color === 'string' &&
		typeof payload.properties.collapsed === 'boolean',
	add_tab_to_group: (payload) => hasNumber(payload, 'tabId') && hasNumber(payload, 'groupId'),
	close_tab: (payload) => hasNumber(payload, 'tabId'),
}

export function isTabControlAction(value: string): value is TabControlAction {
	return value in TAB_CONTROL_PAYLOAD_VALIDATORS
}

export function isTabControlMessage(value: unknown): value is TabControlMessage {
	if (!isRecord(value)) return false
	if (value.type !== 'TAB_CONTROL') return false
	if (typeof value.action !== 'string') return false
	if (!isTabControlAction(value.action)) return false
	return true
}

export function validateTabControlPayload(action: TabControlAction, payload: unknown): void {
	if (!TAB_CONTROL_PAYLOAD_VALIDATORS[action](payload)) {
		throw new Error(`Invalid payload for TAB_CONTROL action "${action}"`)
	}
}

function assertTabControlResponse(action: TabControlAction, value: unknown): void {
	if (!isRecord(value) || typeof value.success !== 'boolean') {
		throw new Error(`TAB_CONTROL "${action}" returned invalid response envelope.`)
	}
	if (!value.success && typeof value.error !== 'string') {
		throw new Error(`TAB_CONTROL "${action}" failed without a valid error message.`)
	}
}

export async function sendTabControlMessage<K extends TabControlAction>(
	action: K,
	...args: TabControlRemoteMethods[K]['args']
): Promise<TabControlRemoteMethods[K]['return']> {
	const payload = args[0]
	validateTabControlPayload(action, payload)

	const response = await chrome.runtime.sendMessage({
		type: 'TAB_CONTROL',
		action,
		payload,
	} satisfies TabControlMessage<K>)

	assertTabControlResponse(action, response)
	return response as TabControlRemoteMethods[K]['return']
}
