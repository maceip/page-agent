import { describe, expect, it } from 'vitest'

import { MirrorSession } from '../../packages/mirror/src/MirrorSession'
import type { MicroDOMDiff } from '../../packages/mirror/src/types'
import { HotLayerHarness, createSnapshot, createSpatialElement } from '../mirror/test-harness'

function percentile(values: number[], p: number): number {
	const sorted = [...values].sort((a, b) => a - b)
	const index = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
	return sorted[index]
}

describe('mirror latency budgets', () => {
	it('keeps p95 micro-DOM diff materialization under budget', () => {
		const hot = new HotLayerHarness()
		const elements = Array.from({ length: 300 }, (_, i) => createSpatialElement(i + 1))
		hot.emitSnapshot(createSnapshot(1, elements))

		const session = new MirrorSession(hot)
		session.start()

		const samples: number[] = []
		for (let seq = 2; seq <= 202; seq++) {
			const updateId = (seq % 300) + 1
			const diff: MicroDOMDiff = {
				seq,
				ts: Date.now(),
				upserted: [
					createSpatialElement(updateId, {
						label: `Updated ${seq}`,
						placeholder: `p-${seq}`,
					}),
				],
				removed: [],
			}

			const started = performance.now()
			hot.emitDiff(diff)
			samples.push(performance.now() - started)
		}

		const p95 = percentile(samples, 0.95)
		expect(p95).toBeLessThan(8)
		session.dispose()
	})

	it('keeps p95 input dispatch latency under budget', async () => {
		const hot = new HotLayerHarness()
		hot.emitSnapshot(createSnapshot(1, [createSpatialElement(1)]))
		const session = new MirrorSession(hot)
		session.start()

		const samples: number[] = []
		for (let i = 0; i < 150; i++) {
			const started = performance.now()
			await session.controller.clickElement(1)
			samples.push(performance.now() - started)
		}

		const p95 = percentile(samples, 0.95)
		expect(p95).toBeLessThan(6)
		session.dispose()
	})
})
