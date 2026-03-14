/**
 * S3 — Action Enrichment / diffState Tests
 *
 * Validates that diffState correctly computes human-readable diffs
 * between before/after state snapshots.
 */
import { describe, expect, it } from 'vitest'

import { diffState } from '../packages/page-controller/src/PageController'
import type { StateSummary } from '../packages/page-controller/src/PageController'

describe('S3: Action Enrichment — diffState', () => {
	it('should return empty string when nothing changed', () => {
		const state: StateSummary = { url: 'https://example.com/page', elementCount: 10 }
		expect(diffState(state, state)).toBe('')
	})

	it('should detect URL change (same origin, shows pathname)', () => {
		const before: StateSummary = { url: 'https://example.com/page1', elementCount: 5 }
		const after: StateSummary = { url: 'https://example.com/page2', elementCount: 5 }
		const result = diffState(before, after)
		expect(result).toContain('URL changed')
		expect(result).toContain('/page1')
		expect(result).toContain('/page2')
	})

	it('should detect URL change (cross-origin, shows full URLs)', () => {
		const before: StateSummary = { url: 'https://a.com/p', elementCount: 5 }
		const after: StateSummary = { url: 'https://b.com/q', elementCount: 5 }
		const result = diffState(before, after)
		expect(result).toContain('URL changed')
		expect(result).toContain('https://a.com/p')
		expect(result).toContain('https://b.com/q')
	})

	it('should detect new elements appearing', () => {
		const before: StateSummary = { url: 'https://example.com', elementCount: 5 }
		const after: StateSummary = { url: 'https://example.com', elementCount: 8 }
		const result = diffState(before, after)
		expect(result).toContain('3 new interactive elements appeared')
	})

	it('should detect elements removed', () => {
		const before: StateSummary = { url: 'https://example.com', elementCount: 10 }
		const after: StateSummary = { url: 'https://example.com', elementCount: 7 }
		const result = diffState(before, after)
		expect(result).toContain('3 elements removed')
	})

	it('should handle singular element change', () => {
		const before: StateSummary = { url: 'https://example.com', elementCount: 5 }
		const after: StateSummary = { url: 'https://example.com', elementCount: 6 }
		expect(diffState(before, after)).toContain('1 new interactive element appeared')

		const before2: StateSummary = { url: 'https://example.com', elementCount: 5 }
		const after2: StateSummary = { url: 'https://example.com', elementCount: 4 }
		expect(diffState(before2, after2)).toContain('1 element removed')
	})

	it('should combine URL change and element count change', () => {
		const before: StateSummary = { url: 'https://example.com/a', elementCount: 5 }
		const after: StateSummary = { url: 'https://example.com/b', elementCount: 10 }
		const result = diffState(before, after)
		expect(result).toContain('URL changed')
		expect(result).toContain('5 new interactive elements appeared')
	})

	it('should handle invalid URLs gracefully (no crash)', () => {
		const before: StateSummary = { url: 'not-a-url', elementCount: 5 }
		const after: StateSummary = { url: 'also-not-a-url', elementCount: 5 }
		const result = diffState(before, after)
		// Should still detect URL change, using full strings
		expect(result).toContain('URL changed')
		expect(result).toContain('not-a-url')
	})

	it('should include query string and hash in pathname diff', () => {
		const before: StateSummary = { url: 'https://example.com/p?a=1', elementCount: 5 }
		const after: StateSummary = { url: 'https://example.com/p?b=2#section', elementCount: 5 }
		const result = diffState(before, after)
		expect(result).toContain('?a=1')
		expect(result).toContain('?b=2#section')
	})
})
