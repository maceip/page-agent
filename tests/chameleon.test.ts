/**
 * Tests for Chameleon - anti-fingerprinting strategies.
 *
 * Verifies that page-agent's chameleon mode:
 * 1. Randomizes DOM namespaces to prevent class-based fingerprinting
 * 2. Applies timing jitter to mimic human interaction patterns
 * 3. Minimizes DOM footprint to reduce extension detectability
 * 4. Properly activates and deactivates without affecting page state
 * 5. Camouflages injected elements with accessibility-appropriate attributes
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
	ChameleonEngine,
	detectFingerprintingActivity,
	getTimingJitter,
} from '../packages/core/src/chameleon'

describe('ChameleonEngine', () => {
	let chameleon: ChameleonEngine

	afterEach(() => {
		chameleon?.deactivate()
		document.body.innerHTML = ''
	})

	describe('Construction and Configuration', () => {
		it('should construct with default config', () => {
			chameleon = new ChameleonEngine()
			expect(chameleon.config.randomizeNamespace).toBe(true)
			expect(chameleon.config.timingJitter).toBe(true)
			expect(chameleon.config.minimizeFootprint).toBe(true)
			expect(chameleon.config.camouflageStyles).toBe(true)
			expect(chameleon.config.normalizeApiAccess).toBe(true)
		})

		it('should accept partial config overrides', () => {
			chameleon = new ChameleonEngine({
				timingJitter: false,
				randomizeNamespace: false,
			})
			expect(chameleon.config.timingJitter).toBe(false)
			expect(chameleon.config.randomizeNamespace).toBe(false)
			// Other defaults remain
			expect(chameleon.config.minimizeFootprint).toBe(true)
		})

		it('should use "page-agent" namespace when randomization is disabled', () => {
			chameleon = new ChameleonEngine({ randomizeNamespace: false })
			expect(chameleon.namespace).toBe('page-agent')
		})

		it('should generate randomized namespace when enabled', () => {
			chameleon = new ChameleonEngine({ randomizeNamespace: true })
			expect(chameleon.namespace).not.toBe('page-agent')
			expect(chameleon.namespace.length).toBeGreaterThan(0)
		})

		it('should generate different namespaces each time', () => {
			const namespaces = new Set<string>()
			for (let i = 0; i < 20; i++) {
				const engine = new ChameleonEngine({ randomizeNamespace: true })
				namespaces.add(engine.namespace)
			}
			// With 20 iterations, we should get multiple unique namespaces
			expect(namespaces.size).toBeGreaterThan(1)
		})

		it('should use accessibility-related namespace prefixes', () => {
			// Generate many namespaces and check they all use accessibility prefixes
			const accessibilityPrefixes = [
				'a11y',
				'aria',
				'sr',
				'acc',
				'assist',
				'wcag',
				'ax',
				'axe',
				'inc',
				'ada',
			]

			for (let i = 0; i < 50; i++) {
				const engine = new ChameleonEngine({ randomizeNamespace: true })
				const prefix = engine.namespace.split('-')[0]
				expect(accessibilityPrefixes).toContain(prefix)
			}
		})
	})

	describe('Activation / Deactivation', () => {
		it('should start inactive', () => {
			chameleon = new ChameleonEngine()
			expect(chameleon.isActive).toBe(false)
		})

		it('should become active after activate()', () => {
			chameleon = new ChameleonEngine()
			chameleon.activate()
			expect(chameleon.isActive).toBe(true)
		})

		it('should become inactive after deactivate()', () => {
			chameleon = new ChameleonEngine()
			chameleon.activate()
			chameleon.deactivate()
			expect(chameleon.isActive).toBe(false)
		})

		it('should be idempotent - multiple activate() calls are safe', () => {
			chameleon = new ChameleonEngine()
			chameleon.activate()
			chameleon.activate()
			chameleon.activate()
			expect(chameleon.isActive).toBe(true)
		})

		it('should be idempotent - multiple deactivate() calls are safe', () => {
			chameleon = new ChameleonEngine()
			chameleon.activate()
			chameleon.deactivate()
			chameleon.deactivate()
			expect(chameleon.isActive).toBe(false)
		})
	})

	describe('Element Wrapping (DOM Footprint Minimization)', () => {
		it('should add namespace data attribute to wrapped elements', () => {
			chameleon = new ChameleonEngine()
			const el = document.createElement('div')
			chameleon.wrapElement(el)

			expect(el.hasAttribute(`data-${chameleon.namespace}`)).toBe(true)
		})

		it('should add managed attribute to wrapped elements', () => {
			chameleon = new ChameleonEngine()
			const el = document.createElement('div')
			chameleon.wrapElement(el)

			expect(el.getAttribute(`data-${chameleon.namespace}-managed`)).toBe('true')
		})

		it('should replace identifiable attributes with namespaced ones', () => {
			chameleon = new ChameleonEngine()
			const el = document.createElement('div')
			el.setAttribute('data-page-agent-ignore', 'true')
			el.setAttribute('data-browser-use-ignore', 'true')

			chameleon.wrapElement(el)

			// Original identifiable attributes removed
			expect(el.hasAttribute('data-page-agent-ignore')).toBe(false)
			expect(el.hasAttribute('data-browser-use-ignore')).toBe(false)
			// Namespaced attribute added
			expect(el.hasAttribute(`data-${chameleon.namespace}-managed`)).toBe(true)
		})

		it('should add accessibility attributes for camouflage', () => {
			chameleon = new ChameleonEngine({ camouflageStyles: true })
			const el = document.createElement('div')
			chameleon.wrapElement(el)

			expect(el.getAttribute('role')).toBe('complementary')
			expect(el.getAttribute('aria-label')).toBe('Accessibility assistant')
		})

		it('should not override existing role attribute', () => {
			chameleon = new ChameleonEngine({ camouflageStyles: true })
			const el = document.createElement('div')
			el.setAttribute('role', 'dialog')

			chameleon.wrapElement(el)

			expect(el.getAttribute('role')).toBe('dialog')
		})

		it('should not override existing aria-label', () => {
			chameleon = new ChameleonEngine({ camouflageStyles: true })
			const el = document.createElement('div')
			el.setAttribute('aria-label', 'Custom label')

			chameleon.wrapElement(el)

			expect(el.getAttribute('aria-label')).toBe('Custom label')
		})

		it('should skip footprint minimization when disabled', () => {
			chameleon = new ChameleonEngine({ minimizeFootprint: false })
			const el = document.createElement('div')
			el.setAttribute('data-page-agent-ignore', 'true')

			chameleon.wrapElement(el)

			// Original attributes preserved
			expect(el.hasAttribute('data-page-agent-ignore')).toBe(true)
		})
	})

	describe('Class Name Generation', () => {
		it('should generate namespaced class names', () => {
			chameleon = new ChameleonEngine()
			const className = chameleon.generateClassName('wrapper')
			expect(className).toBe(`${chameleon.namespace}__wrapper`)
		})

		it('should return base name when namespace randomization is disabled', () => {
			chameleon = new ChameleonEngine({ randomizeNamespace: false })
			const className = chameleon.generateClassName('wrapper')
			expect(className).toBe('wrapper')
		})
	})

	describe('Injected Element Tracking', () => {
		it('should find all elements with namespace attribute', () => {
			chameleon = new ChameleonEngine()

			const el1 = document.createElement('div')
			el1.setAttribute(`data-${chameleon.namespace}`, '')
			document.body.appendChild(el1)

			const el2 = document.createElement('span')
			el2.setAttribute(`data-${chameleon.namespace}`, '')
			document.body.appendChild(el2)

			const el3 = document.createElement('div')
			el3.id = 'not-injected'
			document.body.appendChild(el3)

			const injected = chameleon.getInjectedElements()
			expect(injected.length).toBe(2)
		})

		it('should remove all injected elements', () => {
			chameleon = new ChameleonEngine()

			for (let i = 0; i < 5; i++) {
				const el = document.createElement('div')
				el.setAttribute(`data-${chameleon.namespace}`, '')
				document.body.appendChild(el)
			}

			// Also add a non-injected element
			const userEl = document.createElement('div')
			userEl.id = 'user-el'
			document.body.appendChild(userEl)

			chameleon.removeAllTraces()

			expect(chameleon.getInjectedElements().length).toBe(0)
			expect(document.getElementById('user-el')).not.toBeNull()
		})

		it('should remove injected style elements', () => {
			chameleon = new ChameleonEngine()

			const style = chameleon.injectStyle('.test { color: red; }')
			expect(style.parentNode).not.toBeNull()

			chameleon.removeAllTraces()

			expect(document.querySelectorAll(`style[data-${chameleon.namespace}-style]`).length).toBe(0)
		})
	})

	describe('Style Injection', () => {
		it('should inject style with namespace marker', () => {
			chameleon = new ChameleonEngine()
			const style = chameleon.injectStyle('.test { color: blue; }')

			expect(style.hasAttribute(`data-${chameleon.namespace}-style`)).toBe(true)
			expect(style.textContent).toBe('.test { color: blue; }')
		})

		it('should append style to document head', () => {
			chameleon = new ChameleonEngine()
			chameleon.injectStyle('.test { color: green; }')

			const styles = document.head.querySelectorAll(`style[data-${chameleon.namespace}-style]`)
			expect(styles.length).toBe(1)
		})
	})
})

describe('Timing Jitter', () => {
	it('should return values within expected range', () => {
		const baseMs = 400
		const results: number[] = []

		for (let i = 0; i < 100; i++) {
			results.push(getTimingJitter(baseMs))
		}

		// All values should be within 0.6x to 2.0x of base
		for (const r of results) {
			expect(r).toBeGreaterThanOrEqual(baseMs * 0.6)
			expect(r).toBeLessThanOrEqual(baseMs * 2.0)
		}
	})

	it('should produce varied results (not all identical)', () => {
		const results = new Set<number>()
		for (let i = 0; i < 50; i++) {
			results.add(getTimingJitter(400))
		}
		// Should have multiple distinct values
		expect(results.size).toBeGreaterThan(5)
	})

	it('should return integer values', () => {
		for (let i = 0; i < 20; i++) {
			const result = getTimingJitter(400)
			expect(Number.isInteger(result)).toBe(true)
		}
	})

	it('should scale with base time', () => {
		const smallResults: number[] = []
		const largeResults: number[] = []

		for (let i = 0; i < 100; i++) {
			smallResults.push(getTimingJitter(100))
			largeResults.push(getTimingJitter(1000))
		}

		const smallAvg = smallResults.reduce((a, b) => a + b, 0) / smallResults.length
		const largeAvg = largeResults.reduce((a, b) => a + b, 0) / largeResults.length

		// Large base time should produce proportionally larger values
		expect(largeAvg).toBeGreaterThan(smallAvg * 3) // Rough check
	})

	describe('Jittered Delay', () => {
		it('should apply jitter when timingJitter is enabled', async () => {
			const chameleon = new ChameleonEngine({ timingJitter: true })

			const start = Date.now()
			await chameleon.jitteredDelay(100)
			const elapsed = Date.now() - start

			// Should be at least 60ms (0.6 * 100) and not more than 250ms (2.0 * 100 + overhead)
			expect(elapsed).toBeGreaterThanOrEqual(50) // Allow small timing tolerance
			expect(elapsed).toBeLessThan(300)
		})

		it('should use exact delay when timingJitter is disabled', async () => {
			const chameleon = new ChameleonEngine({ timingJitter: false })

			const start = Date.now()
			await chameleon.jitteredDelay(100)
			const elapsed = Date.now() - start

			// Should be close to 100ms
			expect(elapsed).toBeGreaterThanOrEqual(90)
			expect(elapsed).toBeLessThan(200)
		})
	})
})

describe('Fingerprinting Detection', () => {
	afterEach(() => {
		// Clean up any test globals
		const testGlobals = ['FingerprintJS', 'Fingerprint2', 'ClientJS', 'fpCollect', 'BotD', 'botd']
		for (const g of testGlobals) {
			delete (globalThis as any)[g]
		}
		// Clean up scripts
		document.head.querySelectorAll('script').forEach((s) => s.remove())
	})

	it('should detect FingerprintJS', () => {
		;(globalThis as any).FingerprintJS = {}
		expect(detectFingerprintingActivity()).toBe(true)
	})

	it('should detect Fingerprint2', () => {
		;(globalThis as any).Fingerprint2 = {}
		expect(detectFingerprintingActivity()).toBe(true)
	})

	it('should detect ClientJS', () => {
		;(globalThis as any).ClientJS = {}
		expect(detectFingerprintingActivity()).toBe(true)
	})

	it('should not false-positive on clean pages', () => {
		expect(detectFingerprintingActivity()).toBe(false)
	})

	it('should detect Imperva scripts', () => {
		const script = document.createElement('script')
		script.src = 'https://cdn.imperva.com/bot-detect.js'
		document.head.appendChild(script)

		expect(detectFingerprintingActivity()).toBe(true)
	})

	it('should detect Kasada scripts', () => {
		const script = document.createElement('script')
		script.src = 'https://example.com/kasada/ips.js'
		document.head.appendChild(script)

		expect(detectFingerprintingActivity()).toBe(true)
	})

	it('should detect Distil Networks scripts', () => {
		const script = document.createElement('script')
		script.src = 'https://example.com/distil/bot-guard.js'
		document.head.appendChild(script)

		expect(detectFingerprintingActivity()).toBe(true)
	})

	it('should detect GeeTest scripts', () => {
		const script = document.createElement('script')
		script.src = 'https://static.geetest.com/v4/gt4.js'
		document.head.appendChild(script)

		expect(detectFingerprintingActivity()).toBe(true)
	})

	it('should not detect normal third-party scripts', () => {
		const scripts = [
			'https://cdn.jsdelivr.net/npm/lodash@4.17.21/lodash.min.js',
			'https://unpkg.com/react@18/umd/react.production.min.js',
			'https://www.googletagmanager.com/gtag/js',
			'https://connect.facebook.net/en_US/sdk.js',
		]

		for (const src of scripts) {
			const script = document.createElement('script')
			script.src = src
			document.head.appendChild(script)
		}

		expect(detectFingerprintingActivity()).toBe(false)
	})
})

describe('API Access Normalization', () => {
	it('should not error during activation in test environment', () => {
		const chameleon = new ChameleonEngine({ normalizeApiAccess: true })
		expect(() => chameleon.activate()).not.toThrow()
		chameleon.deactivate()
	})

	it('should not error during deactivation', () => {
		const chameleon = new ChameleonEngine({ normalizeApiAccess: true })
		chameleon.activate()
		expect(() => chameleon.deactivate()).not.toThrow()
	})

	it('should safely handle repeated activate/deactivate cycles', () => {
		const chameleon = new ChameleonEngine({ normalizeApiAccess: true })
		for (let i = 0; i < 10; i++) {
			chameleon.activate()
			chameleon.deactivate()
		}
		expect(chameleon.isActive).toBe(false)
	})
})

describe('Integration with PageAgent', () => {
	it('should be importable from core exports', async () => {
		// Verify the exports are properly set up
		const core = await import('../packages/core/src/PageAgentCore')
		expect(core.ChameleonEngine).toBeDefined()
		expect(core.PeekabooController).toBeDefined()
		expect(core.detectFingerprintingActivity).toBeDefined()
		expect(core.getTimingJitter).toBeDefined()
	})
})
