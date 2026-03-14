import type { ActionResult, BrowserState, IPageController, StateSummary } from '@page-agent/page-controller'

import type { TabsController } from './TabsController'
import { sendPageControlMessage } from './page-control-protocol'

/**
 * Agent-side page controller for the extension.
 * Lives in the agent env (extension page or side panel) and communicates
 * with the real PageController in the content script via typed messages.
 */
export class RemotePageController implements IPageController {
	tabsController: TabsController

	constructor(tabsController: TabsController) {
		this.tabsController = tabsController
	}

	get currentTabId(): number | null {
		return this.tabsController.currentTabId
	}

	private requireTabId(): number {
		const id = this.currentTabId
		if (id == null) throw new Error('tabsController not initialized.')
		return id
	}

	async getCurrentUrl(): Promise<string> {
		if (!this.currentTabId) return ''
		const { url } = await this.tabsController.getTabInfo(this.currentTabId)
		return url || ''
	}

	private async getCurrentTitle(): Promise<string> {
		if (!this.currentTabId) return ''
		const { title } = await this.tabsController.getTabInfo(this.currentTabId)
		return title || ''
	}

	async getLastUpdateTime(): Promise<number> {
		return sendPageControlMessage('get_last_update_time', this.requireTabId())
	}

	async getStateSummary(): Promise<StateSummary> {
		const url = await this.getCurrentUrl()
		return {
			url,
			elementCount: 0, // Not available remotely; diff will still detect URL changes
		}
	}

	async getBrowserState(): Promise<BrowserState> {
		const tabId = this.requireTabId()
		const currentUrl = await this.getCurrentUrl()
		const currentTitle = await this.getCurrentTitle()

		let browserState: BrowserState

		if (!isContentScriptAllowed(currentUrl)) {
			browserState = {
				url: currentUrl,
				title: currentTitle,
				header: '',
				content: '(empty page. either current page is not readable or not loaded yet.)',
				footer: '',
			}
		} else {
			browserState = await sendPageControlMessage('get_browser_state', tabId)
		}

		const sum = await this.tabsController.summarizeTabs()
		browserState.header = sum + '\n\n' + (browserState.header || '')

		return browserState
	}

	async updateTree(): Promise<string> {
		if (!this.currentTabId || !isContentScriptAllowed(await this.getCurrentUrl())) {
			return '<EMPTY>'
		}
		return sendPageControlMessage('update_tree', this.currentTabId)
	}

	async cleanUpHighlights(): Promise<void> {
		if (!this.currentTabId || !isContentScriptAllowed(await this.getCurrentUrl())) {
			return
		}
		await sendPageControlMessage('clean_up_highlights', this.currentTabId)
	}

	async clickElement(index: number): Promise<ActionResult> {
		const res = await this.callAction('click_element', index)
		// may cause page navigation, wait for loading to start
		await new Promise((resolve) => setTimeout(resolve, 1000))
		return res
	}

	async inputText(index: number, text: string): Promise<ActionResult> {
		return this.callAction('input_text', index, text)
	}

	async selectOption(index: number, optionText: string): Promise<ActionResult> {
		return this.callAction('select_option', index, optionText)
	}

	async scroll(options: {
		down: boolean
		numPages: number
		pixels?: number
		index?: number
	}): Promise<ActionResult> {
		return this.callAction('scroll', options)
	}

	async scrollHorizontally(options: {
		right: boolean
		pixels: number
		index?: number
	}): Promise<ActionResult> {
		return this.callAction('scroll_horizontally', options)
	}

	async executeJavascript(script: string): Promise<ActionResult> {
		return this.callAction('execute_javascript', script)
	}

	/** @note Managed by content script via storage polling. */
	async showMask(): Promise<void> {}
	/** @note Managed by content script via storage polling. */
	async hideMask(): Promise<void> {}
	/** @note Managed by content script via storage polling. */
	dispose(): void {}

	private async callAction<
		K extends
			| 'click_element'
			| 'input_text'
			| 'select_option'
			| 'scroll'
			| 'scroll_horizontally'
			| 'execute_javascript',
	>(
		action: K,
		...args: import('./page-control-protocol').PageControlRemoteMethods[K]['args']
	): Promise<ActionResult> {
		const tabId = this.currentTabId
		if (!tabId) {
			return { success: false, message: 'RemotePageController not initialized.' }
		}
		if (!isContentScriptAllowed(await this.getCurrentUrl())) {
			return {
				success: false,
				message:
					'Operation not allowed on this page. Use open_new_tab to navigate to a web page first.',
			}
		}
		return sendPageControlMessage(action, tabId, ...args)
	}
}

/**
 * Check if a URL can run content scripts.
 */
function isContentScriptAllowed(url: string | undefined): boolean {
	if (!url) return false

	const restrictedPatterns = [
		/^chrome:\/\//,
		/^chrome-extension:\/\//,
		/^about:/,
		/^edge:\/\//,
		/^brave:\/\//,
		/^opera:\/\//,
		/^vivaldi:\/\//,
		/^file:\/\//,
		/^view-source:/,
		/^devtools:\/\//,
	]

	return !restrictedPatterns.some((pattern) => pattern.test(url))
}
