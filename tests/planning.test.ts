/**
 * M1 — Planning Phase Tests
 *
 * Tests plan rendering, sub-goal advancement logic, and signal parsing.
 */
import { describe, expect, it } from 'vitest'

import { advanceSubGoal, renderPlan } from '../packages/core/src/PageAgentCore'
import type { AgentPlan } from '../packages/core/src/types'

describe('M1: Planning Phase', () => {
	describe('Plan Rendering', () => {
		it('should render all sub-goals with correct markers', () => {
			const plan: AgentPlan = {
				sub_goals: ['Navigate to login', 'Enter credentials', 'Click submit'],
				current_sub_goal_index: 1,
			}
			const rendered = renderPlan(plan)
			expect(rendered).toContain('1. ✅ Navigate to login')
			expect(rendered).toContain('2. → Enter credentials (CURRENT)')
			expect(rendered).toContain('3. Click submit')
		})

		it('should mark first goal as current when index is 0', () => {
			const plan: AgentPlan = {
				sub_goals: ['Step A', 'Step B'],
				current_sub_goal_index: 0,
			}
			const rendered = renderPlan(plan)
			expect(rendered).toContain('1. → Step A (CURRENT)')
			expect(rendered).toContain('2. Step B')
			expect(rendered).not.toContain('✅')
		})

		it('should mark all but last as completed when on last goal', () => {
			const plan: AgentPlan = {
				sub_goals: ['A', 'B', 'C'],
				current_sub_goal_index: 2,
			}
			const rendered = renderPlan(plan)
			expect(rendered).toContain('1. ✅ A')
			expect(rendered).toContain('2. ✅ B')
			expect(rendered).toContain('3. → C (CURRENT)')
		})
	})

	describe('Sub-goal Signal Parsing (exact match)', () => {
		const plan: AgentPlan = {
			sub_goals: ['Step 1', 'Step 2', 'Step 3'],
			current_sub_goal_index: 0,
		}

		it('should advance on exact "completed" signal', () => {
			const result = advanceSubGoal(plan, 'completed')
			expect(result).not.toBeNull()
			expect(result!.current_sub_goal_index).toBe(1)
		})

		it('should advance on "completed" with whitespace', () => {
			const result = advanceSubGoal(plan, '  Completed  ')
			expect(result).not.toBeNull()
			expect(result!.current_sub_goal_index).toBe(1)
		})

		it('should NOT advance on "not completed" (old bug: .includes would match)', () => {
			const result = advanceSubGoal(plan, 'not completed')
			// With exact match, this should NOT advance
			expect(result!.current_sub_goal_index).toBe(0)
		})

		it('should NOT advance on "task completed successfully" (substring match)', () => {
			const result = advanceSubGoal(plan, 'task completed successfully')
			expect(result!.current_sub_goal_index).toBe(0)
		})

		it('should clear plan on "revise" signal', () => {
			const result = advanceSubGoal(plan, 'revise')
			expect(result).toBeNull()
		})

		it('should clear plan on "need to revise plan" signal', () => {
			const result = advanceSubGoal(plan, 'need to revise plan')
			expect(result).toBeNull()
		})

		it('should not change on "still working" signal', () => {
			const result = advanceSubGoal(plan, 'still working')
			expect(result!.current_sub_goal_index).toBe(0)
		})

		it('should not advance past last sub-goal', () => {
			const lastPlan: AgentPlan = {
				sub_goals: ['Only step'],
				current_sub_goal_index: 0,
			}
			const result = advanceSubGoal(lastPlan, 'completed')
			expect(result!.current_sub_goal_index).toBe(0) // stays at 0, no more goals
		})
	})
})
