import { describe, expect, it, vi } from 'vitest'

import { RemotePageController as ExtensionRemotePageController } from '../../packages/extension/src/agent/RemotePageController'
import { RemotePageController as MirrorRemotePageController } from '../../packages/mirror/src/RemotePageController'
import {
	type IPageController,
	PageController,
} from '../../packages/page-controller/src/PageController'
import { HotLayerHarness, createSnapshot, createSpatialElement } from '../mirror/test-harness'

async function runContract(controller: IPageController, actionIndex: number): Promise<void> {
	const tree = await controller.updateTree()
	expect(typeof tree).toBe('string')

	const state = await controller.getBrowserState()
	expect(typeof state.url).toBe('string')
	expect(typeof state.title).toBe('string')
	expect(typeof state.header).toBe('string')
	expect(typeof state.content).toBe('string')
	expect(typeof state.footer).toBe('string')

	const actionResults = await Promise.all([
		controller.clickElement(actionIndex),
		controller.inputText(actionIndex, 'hello'),
		controller.selectOption(actionIndex, 'option'),
		controller.scroll({ down: true, numPages: 1 }),
		controller.scrollHorizontally({ right: true, pixels: 10 }),
		controller.executeJavascript('return 1 + 1'),
	])

	for (const result of actionResults) {
		expect(typeof result.success).toBe('boolean')
		expect(typeof result.message).toBe('string')
	}

	await controller.cleanUpHighlights()
	await controller.showMask()
	await controller.hideMask()
	controller.dispose()
}

describe('IPageController contract', () => {
	it('PageController (local DOM) satisfies contract', async () => {
		document.body.innerHTML = `
      <main>
        <button id="btn">Click me</button>
        <input id="name" placeholder="Name" />
        <select id="role">
          <option value="option">option</option>
        </select>
      </main>
    `
		const controller = new PageController({ enableMask: false })
		await runContract(controller, 0)
	})

	it('Mirror RemotePageController satisfies contract', async () => {
		const hot = new HotLayerHarness()
		hot.emitSnapshot(createSnapshot(1, [createSpatialElement(7)]))
		const controller = new MirrorRemotePageController(hot)
		await runContract(controller, 7)
	})

	it('Extension RemotePageController satisfies contract', async () => {
		const originalChrome = (globalThis as Record<string, unknown>).chrome
		const sendMessage = vi.fn(async (message: { action: string }) => {
			if (message.action === 'get_last_update_time') return 0
			if (message.action === 'get_browser_state') {
				return {
					url: 'https://example.com',
					title: 'Example',
					header: 'header',
					content: '[1]<button />',
					footer: 'footer',
				}
			}
			if (message.action === 'update_tree') return '[1]<button />'
			if (message.action === 'clean_up_highlights') return undefined
			return { success: true, message: 'ok' }
		})

		;(globalThis as Record<string, unknown>).chrome = {
			runtime: { sendMessage },
		}

		const waitForPotentialNavigation = vi.fn(async () => undefined)
		const tabsController = {
			currentTabId: 1,
			getTabInfo: vi.fn(async () => ({
				tabId: 1,
				title: 'Tab',
				url: 'https://example.com',
				status: 'complete',
			})),
			summarizeTabs: vi.fn(async () => 'tab-summary'),
			waitForPotentialNavigation,
		}

		const controller = new ExtensionRemotePageController(
			tabsController as unknown as import('../../packages/extension/src/agent/TabsController').TabsController
		)

		try {
			await runContract(controller, 1)
			expect(waitForPotentialNavigation).toHaveBeenCalled()
		} finally {
			;(globalThis as Record<string, unknown>).chrome = originalChrome
		}
	})
})
