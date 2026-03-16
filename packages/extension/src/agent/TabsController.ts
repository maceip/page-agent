import { type TabInfo, sendTabControlMessage } from './tab-control-protocol'

const PREFIX = '[TabsController]'

function debug(...messages: any[]) {
	console.debug(`\x1b[90m${PREFIX}\x1b[0m`, ...messages)
}

/**
 * Controller for managing browser tabs.
 * - live in the agent env (extension page or content script)
 * - no chrome apis. call sw for tab operations
 */
export class TabsController extends EventTarget {
	currentTabId: number | null = null

	private tabs: TabMeta[] = []
	private initialTabId: number | null = null
	private tabGroupId: number | null = null
	private task: string = ''

	async init(task: string, includeInitialTab: boolean = true) {
		debug('init', task, includeInitialTab)

		this.task = task
		this.tabs = []
		this.currentTabId = null
		this.tabGroupId = null
		this.initialTabId = null

		const activeTab = await sendTabControlMessage('get_active_tab')
		if (!activeTab.success) {
			throw new Error(`Failed to get active tab: ${activeTab.error}`)
		}

		this.initialTabId = activeTab.tabId
		if (!this.initialTabId) {
			throw new Error('Failed to get initial tab ID.')
		}

		if (includeInitialTab) {
			this.currentTabId = this.initialTabId
			const info = await this.getTabInfo(this.initialTabId)
			this.tabs.push({
				id: info.tabId,
				isInitial: true,
				url: info.url,
				title: info.title,
				status: info.status,
			})

			await this.createTabGroup([this.initialTabId])
		}

		await this.updateCurrentTabId(this.currentTabId)

		const tabChangeHandler = (message: unknown): void => {
			if (
				typeof message !== 'object' ||
				message === null ||
				(message as { type?: unknown }).type !== 'TAB_CHANGE'
			) {
				return
			}

			const tabMessage = message as {
				action?: 'created' | 'removed' | 'updated'
				payload?: {
					tab?: chrome.tabs.Tab
					tabId?: number
				}
			}

			if (tabMessage.action === 'created') {
				const tab = tabMessage.payload?.tab
				if (!tab || tab.groupId !== this.tabGroupId || tab.id == null) return
				if (!this.tabs.find((t) => t.id === tab.id)) {
					this.tabs.push({ id: tab.id, isInitial: false })
				}
				void this.switchToTab(tab.id)
				return
			}

			if (tabMessage.action === 'removed') {
				const tabId = tabMessage.payload?.tabId
				if (typeof tabId !== 'number') return
				const targetTab = this.tabs.find((t) => t.id === tabId)
				if (!targetTab) return

				this.tabs = this.tabs.filter((t) => t.id !== tabId)
				if (this.currentTabId !== tabId) return

				const nextTab = this.tabs[this.tabs.length - 1] || null
				if (nextTab) {
					void this.switchToTab(nextTab.id)
				} else {
					void this.updateCurrentTabId(null)
				}
				return
			}

			if (tabMessage.action === 'updated') {
				const tab = tabMessage.payload?.tab
				const tabId = tabMessage.payload?.tabId
				if (!tab || typeof tabId !== 'number') return
				const targetTab = this.tabs.find((t) => t.id === tabId)
				if (!targetTab) return
				targetTab.url = tab.url
				targetTab.title = tab.title
				targetTab.status = tab.status
			}
		}

		chrome.runtime.onMessage.addListener(tabChangeHandler)
		this.addEventListener('dispose', () => {
			chrome.runtime.onMessage.removeListener(tabChangeHandler)
		})
	}

	async openNewTab(url: string): Promise<string> {
		debug('openNewTab', url)

		const result = await sendTabControlMessage('open_new_tab', { url })
		if (!result.success) {
			throw new Error(`Failed to open new tab: ${result.error}`)
		}

		const tabId = result.tabId
		this.windowId = result.windowId
		this.tabs.push({
			id: tabId,
			isInitial: false,
		})

		await this.switchToTab(tabId)

		if (!this.tabGroupId) {
			const created = await sendTabControlMessage('create_tab_group', {
				tabIds: [tabId],
				windowId: this.windowId,
			})
			if (!created.success) {
				throw new Error(`Failed to create tab group: ${created.error}`)
			}
			this.tabGroupId = created.groupId

			const updated = await sendTabControlMessage('update_tab_group', {
				groupId: this.tabGroupId,
				properties: {
					title: `PageAgent(${this.task})`,
					color: randomColor() as chrome.tabGroups.Color,
					collapsed: false,
				},
			})
			if (!updated.success) {
				throw new Error(`Failed to update tab group: ${updated.error}`)
			}
		} else {
			const added = await sendTabControlMessage('add_tab_to_group', {
				tabId,
				groupId: this.tabGroupId,
			})
			if (!added.success) {
				throw new Error(`Failed to add tab to group: ${added.error}`)
			}
		}

		await this.waitUntilTabLoaded(tabId)
		return `✅ Opened new tab ID ${tabId} with URL ${url}`
	}

	async switchToTab(tabId: number): Promise<string> {
		debug('switchToTab', tabId)

		const targetTab = this.tabs.find((t) => t.id === tabId)
		if (!targetTab) {
			throw new Error(`Tab ID ${tabId} not found in tab list.`)
		}

		await this.updateCurrentTabId(tabId)
		return `✅ Switched to tab ID ${tabId}.`
	}

	async closeTab(tabId: number): Promise<string> {
		debug('closeTab', tabId)

		const targetTab = this.tabs.find((t) => t.id === tabId)
		if (!targetTab) {
			throw new Error(`Tab ID ${tabId} not found in tab list.`)
		}
		if (targetTab.isInitial) {
			throw new Error(`Cannot close the initial tab ID ${tabId}.`)
		}

		const result = await sendTabControlMessage('close_tab', { tabId })
		if (!result.success) {
			throw new Error(`Failed to close tab ID ${tabId}: ${result.error}`)
		}

		this.tabs = this.tabs.filter((t) => t.id !== tabId)
		if (this.currentTabId === tabId) {
			const newCurrentTab = this.tabs[this.tabs.length - 1] || null
			if (newCurrentTab) {
				await this.switchToTab(newCurrentTab.id)
			} else {
				await this.updateCurrentTabId(null)
			}
		}

		return `✅ Closed tab ID ${tabId}.`
	}

	private async createTabGroup(tabIds: number[]) {
		const result = await sendMessage({
			type: 'TAB_CONTROL',
			action: 'create_tab_group',
			payload: { tabIds },
		})

		if (!result?.success) {
			throw new Error(`Failed to create tab group: ${result?.error}`)
		}

		this.tabGroupId = result.groupId as number

		await sendMessage({
			type: 'TAB_CONTROL',
			action: 'update_tab_group',
			payload: {
				groupId: this.tabGroupId,
				properties: {
					title: `PageAgent(${this.task})`,
					color: randomColor(),
					collapsed: false,
				},
			},
		})
	}

	async updateCurrentTabId(tabId: number | null) {
		debug('updateCurrentTabId', tabId)
		this.currentTabId = tabId
		await chrome.storage.local.set({ currentTabId: tabId })
	}

	async getTabInfo(tabId: number): Promise<TabInfo> {
		const tabMeta = this.tabs.find((t) => t.id === tabId)
		if (tabMeta && tabMeta.url && tabMeta.title && tabMeta.status) {
			return { tabId, title: tabMeta.title, url: tabMeta.url, status: tabMeta.status }
		}

		debug('getTabInfo: pulling from background script', tabId)
		const result = await sendTabControlMessage('get_tab_info', { tabId })
		if (!result.success) {
			throw new Error(`Failed to get tab info for tab ${tabId}: ${result.error}`)
		}

		if (tabMeta) {
			tabMeta.url = result.url
			tabMeta.title = result.title
			tabMeta.status = result.status
		}

		return result
	}

	async summarizeTabs(): Promise<string> {
		const summaries = [`| Tab ID | URL | Title | Current |`, `|-----|-----|-----|-----|`]
		for (const tab of this.tabs) {
			const { title, url } = await this.getTabInfo(tab.id)
			summaries.push(
				`| ${tab.id} | ${url} | ${title} | ${this.currentTabId === tab.id ? '✅' : ''} |`
			)
		}
		if (!this.tabs.length) {
			summaries.push('\nNo tabs available. Open a tab if needed.')
		}

		return summaries.join('\n')
	}

	async waitUntilTabLoaded(tabId: number, timeoutMs = 4_000): Promise<void> {
		const started = Date.now()
		while (Date.now() - started < timeoutMs) {
			const info = await this.getTabInfo(tabId)
			if (info.status === 'complete') return
			if (info.status === 'unloaded') {
				throw new Error(`Tab ID ${tabId} is unloaded.`)
			}
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		throw new Error(`Timed out waiting for tab ${tabId} to finish loading.`)
	}

	/**
	 * Wait for a possible navigation after an action without adding fixed latency.
	 * If the tab enters loading state during the probe window, wait for completion.
	 */
	async waitForPotentialNavigation(
		tabId: number,
		options?: { probeWindowMs?: number; completionTimeoutMs?: number }
	): Promise<void> {
		const probeWindowMs = options?.probeWindowMs ?? 1_000
		const completionTimeoutMs = options?.completionTimeoutMs ?? 4_000

		const initial = await this.getTabInfo(tabId)
		if (initial.status === 'loading') {
			await this.waitUntilTabLoaded(tabId, completionTimeoutMs)
			return
		}

		const probeStart = Date.now()
		while (Date.now() - probeStart < probeWindowMs) {
			const info = await this.getTabInfo(tabId)
			if (info.status === 'loading') {
				await this.waitUntilTabLoaded(tabId, completionTimeoutMs)
				return
			}
			await new Promise((resolve) => setTimeout(resolve, 80))
		}
	}

	dispose() {
		this.dispatchEvent(new Event('dispose'))
	}
}

interface TabMeta {
	id: number
	isInitial: boolean
	url?: string
	title?: string
	status?: 'loading' | 'unloaded' | 'complete'
}

const TAB_GROUP_COLORS = ['blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan'] as const

type TabGroupColor = (typeof TAB_GROUP_COLORS)[number]

function randomColor(): TabGroupColor {
	return TAB_GROUP_COLORS[Math.floor(Math.random() * TAB_GROUP_COLORS.length)]
}
