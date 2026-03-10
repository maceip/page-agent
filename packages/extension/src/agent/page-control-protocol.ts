/**
 * Typed message protocol for PageController cross-context communication.
 *
 * Replaces the old `{ action: string, payload?: any }` contract with a
 * compile-time-checked discriminated union. Misspelling an action, changing
 * a payload shape, or mismatching a return type is now a type error.
 */
import type { ActionResult, BrowserState } from '@page-agent/page-controller'

/**
 * Maps every PAGE_CONTROL action to its [args, return] tuple.
 * This is the single source of truth for the extension's message protocol.
 */
export interface PageControlMethodMap {
	get_last_update_time: { args: []; return: number }
	get_browser_state: { args: []; return: BrowserState }
	update_tree: { args: []; return: string }
	clean_up_highlights: { args: []; return: undefined }
	click_element: { args: [index: number]; return: ActionResult }
	input_text: { args: [index: number, text: string]; return: ActionResult }
	select_option: { args: [index: number, optionText: string]; return: ActionResult }
	scroll: {
		args: [options: { down: boolean; numPages: number; pixels?: number; index?: number }]
		return: ActionResult
	}
	scroll_horizontally: {
		args: [options: { right: boolean; pixels: number; index?: number }]
		return: ActionResult
	}
	execute_javascript: { args: [script: string]; return: ActionResult }
}

/** All valid PAGE_CONTROL action names */
export type PageControlAction = keyof PageControlMethodMap

/** Maps snake_case action names to camelCase method names on PageController */
export const ACTION_TO_METHOD = {
	get_last_update_time: 'getLastUpdateTime',
	get_browser_state: 'getBrowserState',
	update_tree: 'updateTree',
	clean_up_highlights: 'cleanUpHighlights',
	click_element: 'clickElement',
	input_text: 'inputText',
	select_option: 'selectOption',
	scroll: 'scroll',
	scroll_horizontally: 'scrollHorizontally',
	execute_javascript: 'executeJavascript',
} as const satisfies Record<PageControlAction, string>

/** A typed PAGE_CONTROL message sent over chrome.runtime */
export interface PageControlMessage<K extends PageControlAction = PageControlAction> {
	type: 'PAGE_CONTROL'
	action: K
	targetTabId: number
	payload?: PageControlMethodMap[K]['args']
}

/** Send a typed PAGE_CONTROL message over chrome.runtime. */
export function sendPageControlMessage<K extends PageControlAction>(
	action: K,
	targetTabId: number,
	...args: PageControlMethodMap[K]['args']
): Promise<PageControlMethodMap[K]['return']> {
	return chrome.runtime
		.sendMessage({
			type: 'PAGE_CONTROL',
			action,
			targetTabId,
			payload: args.length > 0 ? args : undefined,
		} satisfies PageControlMessage<K>)
		.catch((error) => {
			console.error('[PageControl]', action, error)
			return null as any
		})
}
