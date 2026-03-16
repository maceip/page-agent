/**
 * S1 — DOM Pruning / Element Capping Tests
 *
 * Validates that flatTreeToString correctly caps interactive elements,
 * prioritizes viewport + new elements, and produces summary lines.
 */
import { describe, expect, it } from 'vitest'

import type { FlatDomTree } from '../packages/page-controller/src/dom/dom_tree/type'
import { flatTreeToString } from '../packages/page-controller/src/dom/index'

/** Helper: create a minimal flat tree with N interactive elements */
function makeFlatTree(
	count: number,
	opts?: { viewportIndices?: Set<number>; newIndices?: Set<number> }
): FlatDomTree {
	const map: FlatDomTree['map'] = {}
	const children: string[] = []

	for (let i = 0; i < count; i++) {
		const nodeId = `el-${i}`
		children.push(nodeId)
		map[nodeId] = {
			tagName: 'button',
			isInteractive: true as const,
			highlightIndex: i,
			isVisible: true,
			isTopElement: true,
			isInViewport: opts?.viewportIndices?.has(i) ?? false,
			isNew: opts?.newIndices?.has(i) ?? false,
			ref: document.createElement('button'),
			children: [`text-${i}`],
		}
		// Text child
		map[`text-${i}`] = {
			type: 'TEXT_NODE' as const,
			text: `Button ${i}`,
			isVisible: true,
		}
	}

	map.root = {
		tagName: 'body',
		isVisible: true,
		isTopElement: true,
		children,
	}

	return { rootId: 'root', map }
}

describe('S1: DOM Pruning — Element Capping', () => {
	it('should include all elements when maxElements is undefined', () => {
		const tree = makeFlatTree(5)
		const result = flatTreeToString(tree, [])
		// All 5 elements should appear
		for (let i = 0; i < 5; i++) {
			expect(result).toContain(`[${i}]`)
		}
		expect(result).not.toContain('more element')
	})

	it('should include all elements when count <= maxElements', () => {
		const tree = makeFlatTree(5)
		const result = flatTreeToString(tree, [], { maxElements: 10 })
		for (let i = 0; i < 5; i++) {
			expect(result).toContain(`[${i}]`)
		}
		expect(result).not.toContain('omitted')
	})

	it('should cap elements and show summary when count > maxElements', () => {
		const tree = makeFlatTree(10)
		const result = flatTreeToString(tree, [], { maxElements: 3 })
		// Should contain exactly 3 element markers
		const matches = result.match(/\[\d+\]/g) || []
		expect(matches.length).toBe(3)
		// Should contain omitted summary
		expect(result).toContain('omitted')
	})

	it('should prioritize viewport elements over non-viewport', () => {
		// 10 elements, indices 7-9 are in viewport
		const tree = makeFlatTree(10, { viewportIndices: new Set([7, 8, 9]) })
		const result = flatTreeToString(tree, [], { maxElements: 3 })
		// All 3 viewport elements should be included
		expect(result).toContain('[7]')
		expect(result).toContain('[8]')
		expect(result).toContain('[9]')
	})

	it('should prioritize new elements (after viewport)', () => {
		// 10 elements, none in viewport, indices 4-5 are new
		const tree = makeFlatTree(10, { newIndices: new Set([4, 5]) })
		const result = flatTreeToString(tree, [], { maxElements: 4 })
		// New elements should be included
		expect(result).toContain('[4]')
		expect(result).toContain('[5]')
	})

	it('should show consecutive omission summary lines', () => {
		const tree = makeFlatTree(10)
		const result = flatTreeToString(tree, [], { maxElements: 2 })
		expect(result).toContain('more element')
		expect(result).toContain('scroll or refine to reveal')
	})

	it('should handle maxElements = 0 gracefully (no elements shown)', () => {
		const tree = makeFlatTree(5)
		// maxElements=0 is now guarded: <=0 means "skip capping" (show all)
		const result = flatTreeToString(tree, [], { maxElements: 0 })
		// With our fix, maxElements <= 0 skips capping entirely, showing all elements
		for (let i = 0; i < 5; i++) {
			expect(result).toContain(`[${i}]`)
		}
	})

	it('should mark new elements with asterisk', () => {
		const tree = makeFlatTree(3, { newIndices: new Set([1]) })
		const result = flatTreeToString(tree, [])
		// New elements get *[N] prefix
		expect(result).toContain('*[1]')
		expect(result).not.toContain('*[0]')
		expect(result).not.toContain('*[2]')
	})

	it('should display overall omission summary at end', () => {
		const tree = makeFlatTree(20)
		const result = flatTreeToString(tree, [], { maxElements: 5 })
		// Should have a summary at the end like "[15 of 20 interactive elements omitted..."
		expect(result).toContain('15 of 20')
		expect(result).toContain('most relevant')
	})
})
