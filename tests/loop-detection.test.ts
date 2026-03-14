/**
 * S5 — Loop Detection Tests
 *
 * Tests the #detectLoop private method through the public observation system.
 * Since #detectLoop is private, we test it indirectly by building agent history
 * and checking observations.
 */
import { describe, expect, it, vi } from 'vitest'

import { detectLoop } from '../packages/core/src/PageAgentCore'
import type { AgentStepEvent, HistoricalEvent } from '../packages/core/src/types'

/** Helper to create a step event */
function makeStep(actionName: string, input: any = {}, stepIndex: number = 0): AgentStepEvent {
	return {
		type: 'step',
		stepIndex,
		reflection: {},
		action: { name: actionName, input, output: 'ok' },
		usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
	}
}

describe('S5: Loop Detection', () => {
	it('should return null when history is too short', () => {
		const history = [makeStep('click_element_by_index', { index: 0 })]
		expect(detectLoop(history)).toBeNull()
	})

	it('should return null when actions are diverse', () => {
		const history = [
			makeStep('click_element_by_index', { index: 0 }),
			makeStep('input_text', { index: 1, text: 'hello' }),
			makeStep('scroll', { down: true }),
			makeStep('click_element_by_index', { index: 2 }),
		]
		expect(detectLoop(history)).toBeNull()
	})

	it('should detect loop when same action repeated >= threshold times', () => {
		const history = [
			makeStep('click_element_by_index', { index: 5 }),
			makeStep('click_element_by_index', { index: 5 }),
			makeStep('click_element_by_index', { index: 5 }),
		]
		expect(detectLoop(history, 3)).toBe('click_element_by_index')
	})

	it('should not detect loop for excluded actions (wait, done, ask_user)', () => {
		const history = [
			makeStep('wait', { seconds: 1 }),
			makeStep('wait', { seconds: 1 }),
			makeStep('wait', { seconds: 1 }),
			makeStep('wait', { seconds: 1 }),
		]
		expect(detectLoop(history, 3)).toBeNull()
	})

	it('should not detect loop when same action has different inputs', () => {
		const history = [
			makeStep('click_element_by_index', { index: 0 }),
			makeStep('click_element_by_index', { index: 1 }),
			makeStep('click_element_by_index', { index: 2 }),
		]
		expect(detectLoop(history, 3)).toBeNull()
	})

	it('should handle threshold clamping: <2 clamps to 2', () => {
		const history = [
			makeStep('click_element_by_index', { index: 0 }),
			makeStep('click_element_by_index', { index: 0 }),
		]
		// threshold=0 should clamp to 2, so 2 identical actions should trigger
		expect(detectLoop(history, 0)).toBe('click_element_by_index')
	})

	it('should handle threshold clamping: >10 clamps to 10', () => {
		// 10 identical actions
		const history = Array.from({ length: 10 }, () =>
			makeStep('click_element_by_index', { index: 0 })
		)
		// threshold=100 clamps to 10, should still detect with 10 identical actions
		// But window size = 10 + 2 = 12, and we have exactly 10, so threshold 10 should match
		expect(detectLoop(history, 100)).toBe('click_element_by_index')
	})

	it('should handle circular reference input without crashing', () => {
		const circularObj: any = { index: 0 }
		circularObj.self = circularObj

		const history = [
			makeStep('click_element_by_index', circularObj),
			makeStep('click_element_by_index', circularObj),
			makeStep('click_element_by_index', circularObj),
		]
		// Should not throw, falls back to name-only hash
		expect(detectLoop(history, 3)).toBe('click_element_by_index')
	})

	it('should only look at recent window, not entire history', () => {
		// Old actions followed by diverse recent actions
		const history = [
			makeStep('click_element_by_index', { index: 5 }),
			makeStep('click_element_by_index', { index: 5 }),
			makeStep('click_element_by_index', { index: 5 }),
			// Recent diverse actions
			makeStep('input_text', { index: 0, text: 'a' }),
			makeStep('scroll', { down: true }),
			makeStep('click_element_by_index', { index: 1 }),
			makeStep('hover_element', { index: 2 }),
			makeStep('input_text', { index: 3, text: 'b' }),
		]
		// threshold=3, windowSize=5, only looks at last 5 steps which are diverse
		expect(detectLoop(history, 3)).toBeNull()
	})

	it('should ignore non-step events in history', () => {
		const history: HistoricalEvent[] = [
			makeStep('click_element_by_index', { index: 0 }),
			{ type: 'observation', content: 'some observation' },
			makeStep('click_element_by_index', { index: 0 }),
			{ type: 'error', message: 'some error' },
			makeStep('click_element_by_index', { index: 0 }),
		]
		expect(detectLoop(history, 3)).toBe('click_element_by_index')
	})
})
