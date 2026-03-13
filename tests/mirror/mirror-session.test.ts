import { describe, expect, it } from 'vitest'

import { MirrorSession } from '../../packages/mirror/src/MirrorSession'
import type { MicroDOMDiff } from '../../packages/mirror/src/types'
import { HotLayerHarness, createSnapshot, createSpatialElement } from './test-harness'

describe('MirrorSession', () => {
	it('materializes diffs into snapshots and keeps metadata fresh', async () => {
		const hot = new HotLayerHarness()
		const base = createSnapshot(1, [createSpatialElement(1), createSpatialElement(2)])
		hot.emitSnapshot(base)

		const session = new MirrorSession(hot)
		session.start()

		const diff: MicroDOMDiff = {
			seq: 2,
			ts: Date.now(),
			url: 'https://example.com/login',
			title: 'Login',
			dpr: 2,
			upserted: [
				createSpatialElement(2, {
					label: 'Password "Primary"',
					placeholder: 'Enter "password"',
				}),
				createSpatialElement(3, {
					tag: 'button',
					role: 'button',
					label: 'Sign in',
				}),
			],
			removed: [1],
		}

		hot.emitDiff(diff)

		const snapshot = session.getLatestSnapshot()
		expect(snapshot).not.toBeNull()
		expect(snapshot?.seq).toBe(2)
		expect(snapshot?.url).toBe('https://example.com/login')
		expect(snapshot?.title).toBe('Login')
		expect(snapshot?.dpr).toBe(2)
		expect(snapshot?.elements.map((el) => el.id)).toEqual([2, 3])
		expect(snapshot?.simplifiedHTML).toContain('&quot;')

		const browserState = await session.controller.getBrowserState()
		expect(browserState.content).toContain('[2]<input')
		expect(browserState.content).toContain('[3]<button')
	})

	it('ignores late callbacks after disposal', () => {
		const hot = new HotLayerHarness()
		hot.emitSnapshot(createSnapshot(1, [createSpatialElement(1)]))

		const session = new MirrorSession(hot)
		session.start()
		session.dispose()

		hot.emitDiff({
			seq: 2,
			ts: Date.now(),
			upserted: [createSpatialElement(1, { label: 'Late update' })],
			removed: [],
		})

		expect(session.getLatestSnapshot()).toBeNull()
	})
})
