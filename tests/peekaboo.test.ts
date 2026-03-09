/**
 * Tests for Peekaboo mode - self-removal and re-injection support.
 *
 * Verifies that page-agent can:
 * 1. Detect fingerprinting activity on pages
 * 2. Self-remove cleanly when detection is triggered
 * 3. Leave no DOM artifacts after withdrawal
 * 4. Emit proper lifecycle events
 * 5. Work correctly on major sites' anti-bot patterns
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChameleonEngine, detectFingerprintingActivity } from '../packages/core/src/chameleon'
import { PeekabooController } from '../packages/core/src/peekaboo'

describe('PeekabooController', () => {
	let peekaboo: PeekabooController
	let chameleon: ChameleonEngine

	beforeEach(() => {
		chameleon = new ChameleonEngine()
		chameleon.activate()
	})

	afterEach(() => {
		peekaboo?.dispose()
		chameleon?.deactivate()
		// Clean up DOM
		document.body.innerHTML = ''
		document.head.querySelectorAll('style').forEach((s) => s.remove())
	})

	describe('Lifecycle', () => {
		it('should start in inactive state when not enabled', () => {
			peekaboo = new PeekabooController({ enabled: false })
			expect(peekaboo.status).toBe('inactive')
		})

		it('should transition to monitoring when started with enabled=true', () => {
			peekaboo = new PeekabooController({ enabled: true })
			peekaboo.start(chameleon)
			expect(peekaboo.status).toBe('monitoring')
		})

		it('should remain inactive when start is called but enabled=false', () => {
			peekaboo = new PeekabooController({ enabled: false })
			peekaboo.start(chameleon)
			expect(peekaboo.status).toBe('inactive')
		})

		it('should transition to safe after monitoring timeout', async () => {
			peekaboo = new PeekabooController({
				enabled: true,
				monitoringTimeout: 100,
				detectionDelay: 50,
			})

			const safePromise = new Promise<void>((resolve) => {
				peekaboo.addEventListener('safe', () => resolve())
			})

			peekaboo.start(chameleon)

			await safePromise
			expect(peekaboo.status).toBe('safe')
		})

		it('should call onSafe callback when monitoring completes without detection', async () => {
			const onSafe = vi.fn()
			peekaboo = new PeekabooController({
				enabled: true,
				monitoringTimeout: 100,
				detectionDelay: 50,
				onSafe,
			})

			peekaboo.start(chameleon)

			await new Promise((r) => setTimeout(r, 150))
			expect(onSafe).toHaveBeenCalledOnce()
		})
	})

	describe('Withdrawal', () => {
		it('should withdraw manually', async () => {
			peekaboo = new PeekabooController({ enabled: true })
			peekaboo.start(chameleon)

			await peekaboo.withdraw('test reason')
			expect(peekaboo.status).toBe('withdrawn')
		})

		it('should call onWithdraw callback with reason', async () => {
			const onWithdraw = vi.fn()
			peekaboo = new PeekabooController({
				enabled: true,
				onWithdraw,
			})
			peekaboo.start(chameleon)

			await peekaboo.withdraw('test reason')
			expect(onWithdraw).toHaveBeenCalledWith('test reason')
		})

		it('should emit withdraw event', async () => {
			peekaboo = new PeekabooController({ enabled: true })
			peekaboo.start(chameleon)

			const withdrawPromise = new Promise<string>((resolve) => {
				peekaboo.addEventListener('withdraw', (e) => {
					resolve((e as CustomEvent).detail.reason)
				})
			})

			await peekaboo.withdraw('test event reason')

			const reason = await withdrawPromise
			expect(reason).toBe('test event reason')
		})

		it('should not withdraw twice', async () => {
			const onWithdraw = vi.fn()
			peekaboo = new PeekabooController({
				enabled: true,
				onWithdraw,
			})
			peekaboo.start(chameleon)

			await peekaboo.withdraw('first')
			await peekaboo.withdraw('second')

			expect(onWithdraw).toHaveBeenCalledOnce()
		})

		it('should deactivate chameleon on withdrawal', async () => {
			peekaboo = new PeekabooController({ enabled: true })
			peekaboo.start(chameleon)

			expect(chameleon.isActive).toBe(true)
			await peekaboo.withdraw('deactivation test')
			expect(chameleon.isActive).toBe(false)
		})
	})

	describe('DOM Cleanup on Withdrawal', () => {
		it('should remove page-agent panel element', async () => {
			const panel = document.createElement('div')
			panel.id = 'page-agent-runtime_agent-panel'
			document.body.appendChild(panel)

			peekaboo = new PeekabooController({ enabled: true })
			peekaboo.start(chameleon)
			await peekaboo.withdraw('cleanup test')

			expect(document.getElementById('page-agent-runtime_agent-panel')).toBeNull()
		})

		it('should remove elements with data-page-agent-ignore', async () => {
			const el = document.createElement('div')
			el.setAttribute('data-page-agent-ignore', 'true')
			document.body.appendChild(el)

			peekaboo = new PeekabooController({ enabled: true })
			peekaboo.start(chameleon)
			await peekaboo.withdraw('cleanup test')

			expect(document.querySelectorAll('[data-page-agent-ignore]').length).toBe(0)
		})

		it('should remove elements with data-browser-use-ignore', async () => {
			const el = document.createElement('div')
			el.setAttribute('data-browser-use-ignore', 'true')
			document.body.appendChild(el)

			peekaboo = new PeekabooController({ enabled: true })
			peekaboo.start(chameleon)
			await peekaboo.withdraw('cleanup test')

			expect(document.querySelectorAll('[data-browser-use-ignore]').length).toBe(0)
		})

		it('should remove chameleon-namespaced elements', async () => {
			// The chameleon injects elements with its namespace
			const el = document.createElement('div')
			el.setAttribute(`data-${chameleon.namespace}`, '')
			document.body.appendChild(el)

			peekaboo = new PeekabooController({ enabled: true })
			peekaboo.start(chameleon)
			await peekaboo.withdraw('cleanup test')

			expect(document.querySelectorAll(`[data-${chameleon.namespace}]`).length).toBe(0)
		})

		it('should remove injected styles containing page-agent references', async () => {
			const style = document.createElement('style')
			style.textContent = '.page-agent-test { color: red; }'
			document.head.appendChild(style)

			peekaboo = new PeekabooController({ enabled: true })
			peekaboo.start(chameleon)
			await peekaboo.withdraw('cleanup test')

			const remaining = Array.from(document.querySelectorAll('style')).filter((s) =>
				s.textContent?.includes('page-agent')
			)
			expect(remaining.length).toBe(0)
		})

		it('should not remove non-agent elements', async () => {
			const userEl = document.createElement('div')
			userEl.id = 'user-content'
			userEl.textContent = 'User content'
			document.body.appendChild(userEl)

			peekaboo = new PeekabooController({ enabled: true })
			peekaboo.start(chameleon)
			await peekaboo.withdraw('cleanup test')

			expect(document.getElementById('user-content')).not.toBeNull()
			expect(document.getElementById('user-content')?.textContent).toBe('User content')
		})
	})

	describe('Fingerprinting Detection', () => {
		it('should detect known fingerprinting library globals', () => {
			;(globalThis as any).FingerprintJS = { version: '4.0' }

			const detected = detectFingerprintingActivity()
			expect(detected).toBe(true)

			delete (globalThis as any).FingerprintJS
		})

		it('should detect BotD global', () => {
			;(globalThis as any).BotD = { detect: () => {} }

			const detected = detectFingerprintingActivity()
			expect(detected).toBe(true)

			delete (globalThis as any).BotD
		})

		it('should detect fingerprinting scripts by URL pattern', () => {
			const script = document.createElement('script')
			script.src = 'https://cdn.example.com/fingerprint.min.js'
			document.head.appendChild(script)

			const detected = detectFingerprintingActivity()
			expect(detected).toBe(true)

			script.remove()
		})

		it('should detect reCAPTCHA scripts', () => {
			const script = document.createElement('script')
			script.src = 'https://www.google.com/recaptcha/api.js'
			document.head.appendChild(script)

			const detected = detectFingerprintingActivity()
			expect(detected).toBe(true)

			script.remove()
		})

		it('should detect hCaptcha scripts', () => {
			const script = document.createElement('script')
			script.src = 'https://js.hcaptcha.com/1/api.js'
			document.head.appendChild(script)

			const detected = detectFingerprintingActivity()
			expect(detected).toBe(true)

			script.remove()
		})

		it('should detect DataDome scripts', () => {
			const script = document.createElement('script')
			script.src = 'https://js.datadome.co/tags.js'
			document.head.appendChild(script)

			const detected = detectFingerprintingActivity()
			expect(detected).toBe(true)

			script.remove()
		})

		it('should detect Cloudflare Turnstile', () => {
			const script = document.createElement('script')
			script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
			document.head.appendChild(script)

			const detected = detectFingerprintingActivity()
			expect(detected).toBe(true)

			script.remove()
		})

		it('should return false when no fingerprinting is present', () => {
			const detected = detectFingerprintingActivity()
			expect(detected).toBe(false)
		})

		it('should use custom detector when provided', async () => {
			const customDetector = vi.fn().mockReturnValue(true)
			peekaboo = new PeekabooController({
				enabled: true,
				detectionDelay: 50,
				autoWithdraw: true,
				customDetector,
			})

			const withdrawPromise = new Promise<void>((resolve) => {
				peekaboo.addEventListener('withdraw', () => resolve())
			})

			peekaboo.start(chameleon)
			await withdrawPromise

			expect(customDetector).toHaveBeenCalled()
			expect(peekaboo.status).toBe('withdrawn')
		})
	})

	describe('Auto-withdraw on Detection', () => {
		it('should auto-withdraw when fingerprinting is detected', async () => {
			;(globalThis as any).FingerprintJS = { version: '4.0' }

			const onWithdraw = vi.fn()
			peekaboo = new PeekabooController({
				enabled: true,
				detectionDelay: 50,
				autoWithdraw: true,
				onWithdraw,
			})

			peekaboo.start(chameleon)

			await new Promise((r) => setTimeout(r, 200))

			expect(peekaboo.status).toBe('withdrawn')
			expect(onWithdraw).toHaveBeenCalled()

			delete (globalThis as any).FingerprintJS
		})

		it('should emit detected event but not withdraw when autoWithdraw=false', async () => {
			;(globalThis as any).FingerprintJS = { version: '4.0' }

			const detectedHandler = vi.fn()
			peekaboo = new PeekabooController({
				enabled: true,
				detectionDelay: 50,
				autoWithdraw: false,
			})

			peekaboo.addEventListener('detected', detectedHandler)
			peekaboo.start(chameleon)

			await new Promise((r) => setTimeout(r, 200))

			expect(detectedHandler).toHaveBeenCalled()
			// Should NOT be withdrawn since autoWithdraw is false
			expect(peekaboo.status).not.toBe('withdrawn')

			delete (globalThis as any).FingerprintJS
		})
	})

	describe('DOM Probe Detection', () => {
		it('should detect extension resource probing elements', async () => {
			peekaboo = new PeekabooController({
				enabled: true,
				detectionDelay: 5000, // Long delay to test DOM probe detection
				autoWithdraw: true,
			})

			const withdrawPromise = new Promise<void>((resolve) => {
				peekaboo.addEventListener('withdraw', () => resolve())
			})

			peekaboo.start(chameleon)

			// Simulate probe element insertion (like extension-detector tools)
			const probeImg = document.createElement('img')
			probeImg.src = 'chrome-extension://fake-id/icon.png'
			document.body.appendChild(probeImg)

			await withdrawPromise
			expect(peekaboo.status).toBe('withdrawn')
		})

		it('should detect known detection library class names', async () => {
			peekaboo = new PeekabooController({
				enabled: true,
				detectionDelay: 5000,
				autoWithdraw: true,
			})

			const withdrawPromise = new Promise<void>((resolve) => {
				peekaboo.addEventListener('withdraw', () => resolve())
			})

			peekaboo.start(chameleon)

			// Simulate detection library probe
			const probeDiv = document.createElement('div')
			probeDiv.className = 'extension-detector-probe'
			document.body.appendChild(probeDiv)

			await withdrawPromise
			expect(peekaboo.status).toBe('withdrawn')
		})
	})

	describe('Major Site Compatibility', () => {
		// These tests simulate the anti-bot patterns used by major sites
		// to verify peekaboo correctly responds to them

		it('should handle Google reCAPTCHA pattern', async () => {
			// Simulate Google's reCAPTCHA injection
			const script = document.createElement('script')
			script.src = 'https://www.google.com/recaptcha/enterprise.js'
			document.head.appendChild(script)

			peekaboo = new PeekabooController({
				enabled: true,
				detectionDelay: 50,
				autoWithdraw: true,
			})

			peekaboo.start(chameleon)

			await new Promise((r) => setTimeout(r, 200))
			expect(peekaboo.status).toBe('withdrawn')

			script.remove()
		})

		it('should handle Cloudflare bot protection pattern', async () => {
			const script = document.createElement('script')
			script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
			document.head.appendChild(script)

			peekaboo = new PeekabooController({
				enabled: true,
				detectionDelay: 50,
				autoWithdraw: true,
			})

			peekaboo.start(chameleon)

			await new Promise((r) => setTimeout(r, 200))
			expect(peekaboo.status).toBe('withdrawn')

			script.remove()
		})

		it('should handle PerimeterX pattern', async () => {
			const script = document.createElement('script')
			script.src = 'https://client.perimeterx.net/PXabcdef/main.min.js'
			document.head.appendChild(script)

			peekaboo = new PeekabooController({
				enabled: true,
				detectionDelay: 50,
				autoWithdraw: true,
			})

			peekaboo.start(chameleon)

			await new Promise((r) => setTimeout(r, 200))
			expect(peekaboo.status).toBe('withdrawn')

			script.remove()
		})

		it('should handle Akamai Bot Manager pattern', async () => {
			const script = document.createElement('script')
			script.src = 'https://example.com/akamai/bot-detection.js'
			document.head.appendChild(script)

			peekaboo = new PeekabooController({
				enabled: true,
				detectionDelay: 50,
				autoWithdraw: true,
			})

			peekaboo.start(chameleon)

			await new Promise((r) => setTimeout(r, 200))
			expect(peekaboo.status).toBe('withdrawn')

			script.remove()
		})

		it('should not trigger on clean pages without bot protection', async () => {
			// Simulate a normal page with no bot protection
			const script = document.createElement('script')
			script.src = 'https://cdn.example.com/jquery.min.js'
			document.head.appendChild(script)

			peekaboo = new PeekabooController({
				enabled: true,
				detectionDelay: 50,
				monitoringTimeout: 150,
			})

			peekaboo.start(chameleon)

			await new Promise((r) => setTimeout(r, 300))
			expect(peekaboo.status).toBe('safe')

			script.remove()
		})
	})

	describe('UX Safety', () => {
		it('should not interfere with normal page operation when inactive', () => {
			peekaboo = new PeekabooController({ enabled: false })

			// Create some page content
			const div = document.createElement('div')
			div.id = 'test-content'
			div.textContent = 'Hello world'
			document.body.appendChild(div)

			// Content should be unaffected
			expect(document.getElementById('test-content')?.textContent).toBe('Hello world')
		})

		it('should preserve page state during monitoring', async () => {
			const div = document.createElement('div')
			div.id = 'important-content'
			div.textContent = 'Important data'
			document.body.appendChild(div)

			peekaboo = new PeekabooController({
				enabled: true,
				monitoringTimeout: 100,
				detectionDelay: 50,
			})
			peekaboo.start(chameleon)

			// Wait for monitoring to complete
			await new Promise((r) => setTimeout(r, 150))

			// Page content should be completely unaffected
			expect(document.getElementById('important-content')?.textContent).toBe('Important data')
		})

		it('should only remove agent elements during withdrawal, not page elements', async () => {
			// Set up page content
			const userContent = document.createElement('div')
			userContent.id = 'user-app'
			userContent.innerHTML = '<p>User paragraph</p><button>Click me</button>'
			document.body.appendChild(userContent)

			// Set up agent elements
			const agentPanel = document.createElement('div')
			agentPanel.id = 'page-agent-runtime_agent-panel'
			document.body.appendChild(agentPanel)

			const agentOverlay = document.createElement('div')
			agentOverlay.setAttribute('data-page-agent-ignore', 'true')
			document.body.appendChild(agentOverlay)

			peekaboo = new PeekabooController({ enabled: true })
			peekaboo.start(chameleon)

			await peekaboo.withdraw('ux test')

			// Agent elements removed
			expect(document.getElementById('page-agent-runtime_agent-panel')).toBeNull()
			expect(document.querySelector('[data-page-agent-ignore]')).toBeNull()

			// User content preserved
			expect(document.getElementById('user-app')).not.toBeNull()
			expect(document.querySelector('#user-app p')?.textContent).toBe('User paragraph')
			expect(document.querySelector('#user-app button')?.textContent).toBe('Click me')
		})
	})
})
