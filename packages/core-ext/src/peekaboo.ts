/**
 * Peekaboo Mode - Self-removal and re-injection for page-agent.
 *
 * For sites that try to fingerprint code injection and render differently
 * or throw a CAPTCHA, Peekaboo mode:
 * 1. Detects that the page is attempting to fingerprint the extension
 * 2. Removes itself completely from the page DOM and JS context
 * 3. Lets the page load normally without interference
 * 4. Notifies the user to re-inject when ready
 *
 * This works in conjunction with the Chameleon engine to ensure clean removal
 * and to minimize the fingerprint surface during active operation.
 *
 * Research basis:
 * - "Chronos: Continuous Extension Fingerprinting" (CCS 2022) - MutationObserver-based detection
 * - "Fingerprinting in Style" (USENIX Security 2021) - style-based extension fingerprinting
 * - "A Study on Malicious Browser Extensions in 2025" (arXiv 2503.04292)
 * - Extension-detector fingerprinting tool analysis (DataDome 2025)
 */
import type { ChameleonEngine } from './chameleon'
import { detectFingerprintingActivity } from './chameleon'

/** Configuration for Peekaboo mode */
export interface PeekabooConfig {
	/**
	 * Enable peekaboo mode for this page.
	 * When enabled, the agent monitors for fingerprinting attempts
	 * and can self-remove to avoid detection.
	 * @default false
	 */
	enabled?: boolean

	/**
	 * Delay in ms before checking for fingerprinting after injection.
	 * Allows the page's detection scripts time to load.
	 * @default 1500
	 */
	detectionDelay?: number

	/**
	 * Whether to auto-withdraw when fingerprinting is detected.
	 * If false, only emits a warning event without self-removing.
	 * @default true
	 */
	autoWithdraw?: boolean

	/**
	 * Maximum time in ms to wait before giving up on detection monitoring.
	 * After this time, peekaboo stops monitoring and assumes the page is safe.
	 * @default 10000
	 */
	monitoringTimeout?: number

	/**
	 * Custom detection function. If provided, this overrides the built-in
	 * fingerprinting detection. Should return true if fingerprinting is detected.
	 */
	customDetector?: () => boolean | Promise<boolean>

	/**
	 * Callback invoked when peekaboo triggers withdrawal.
	 * Use this to notify the user that re-injection is needed.
	 */
	onWithdraw?: (reason: string) => void

	/**
	 * Callback invoked when the page is deemed safe (no fingerprinting detected).
	 */
	onSafe?: () => void
}

const DEFAULT_PEEKABOO_CONFIG: Required<
	Omit<PeekabooConfig, 'customDetector' | 'onWithdraw' | 'onSafe'>
> = {
	enabled: false,
	detectionDelay: 1500,
	autoWithdraw: true,
	monitoringTimeout: 10000,
}

export type PeekabooStatus =
	| 'inactive' // Peekaboo not enabled
	| 'monitoring' // Actively monitoring for fingerprinting
	| 'safe' // No fingerprinting detected, operating normally
	| 'withdrawing' // Currently removing self from page
	| 'withdrawn' // Fully removed, waiting for re-injection
	| 'error' // Error during monitoring or withdrawal

/**
 * PeekabooController manages the self-removal and re-injection lifecycle.
 *
 * Lifecycle:
 *   inactive -> monitoring -> safe (normal operation)
 *                          -> withdrawing -> withdrawn (fingerprinting detected)
 */
export class PeekabooController extends EventTarget {
	readonly config: PeekabooConfig
	#status: PeekabooStatus = 'inactive'
	#chameleon: ChameleonEngine | null = null
	#monitoringTimer: ReturnType<typeof setTimeout> | null = null
	#detectionTimer: ReturnType<typeof setTimeout> | null = null
	#mutationObserver: MutationObserver | null = null
	#fingerprintingDetected = false

	constructor(config: PeekabooConfig = {}) {
		super()
		this.config = { ...DEFAULT_PEEKABOO_CONFIG, ...config }
	}

	/** Current peekaboo status */
	get status(): PeekabooStatus {
		return this.#status
	}

	/**
	 * Start peekaboo monitoring.
	 * Call this after the agent is injected into the page.
	 * @param chameleon - ChameleonEngine instance for cleanup coordination
	 */
	start(chameleon: ChameleonEngine): void {
		if (!this.config.enabled) {
			this.#setStatus('inactive')
			return
		}

		this.#chameleon = chameleon
		this.#setStatus('monitoring')

		// Monitor for fingerprinting activity
		this.#startMonitoring()
	}

	/**
	 * Manually trigger withdrawal (self-removal).
	 * Can be called by the user or programmatically.
	 */
	async withdraw(reason = 'Manual withdrawal requested'): Promise<void> {
		if (this.#status === 'withdrawn' || this.#status === 'withdrawing') return

		this.#setStatus('withdrawing')
		this.#stopMonitoring()

		try {
			// Phase 1: Remove all DOM elements injected by chameleon/agent
			if (this.#chameleon) {
				this.#chameleon.removeAllTraces()
				this.#chameleon.deactivate()
			}

			// Phase 2: Clean up any remaining page-agent artifacts
			this.#cleanupArtifacts()

			this.#setStatus('withdrawn')

			// Notify user
			this.config.onWithdraw?.(reason)
			this.dispatchEvent(new CustomEvent('withdraw', { detail: { reason } }))
		} catch (error) {
			this.#setStatus('error')
			console.error('[Peekaboo] Error during withdrawal:', error)
		}
	}

	/**
	 * Stop peekaboo monitoring without triggering withdrawal.
	 * Call this when disposing the agent normally.
	 */
	stop(): void {
		this.#stopMonitoring()
		this.#setStatus('inactive')
	}

	/**
	 * Dispose and clean up all resources.
	 */
	dispose(): void {
		this.#stopMonitoring()
		this.#chameleon = null
	}

	// ========== Private methods ==========

	#setStatus(status: PeekabooStatus): void {
		if (this.#status !== status) {
			this.#status = status
			this.dispatchEvent(new CustomEvent('statuschange', { detail: { status } }))
		}
	}

	/**
	 * Start monitoring for fingerprinting activity.
	 * Uses multiple detection strategies.
	 */
	#startMonitoring(): void {
		const delay = this.config.detectionDelay ?? DEFAULT_PEEKABOO_CONFIG.detectionDelay
		const timeout = this.config.monitoringTimeout ?? DEFAULT_PEEKABOO_CONFIG.monitoringTimeout

		// Strategy 1: Delayed initial check
		// Wait for page detection scripts to load, then check
		this.#detectionTimer = setTimeout(async () => {
			const detected = await this.#checkForFingerprinting()
			if (detected) {
				this.#handleFingerprintingDetected('Fingerprinting scripts detected on page')
			}
		}, delay)

		// Strategy 2: Monitor for DOM probing
		// Watch for characteristic MutationObserver patterns used by
		// extension fingerprinting (Chronos, CCS 2022)
		this.#setupDomProbeDetection()

		// Strategy 3: Set monitoring timeout
		// After timeout, assume page is safe
		this.#monitoringTimer = setTimeout(() => {
			if (this.#status === 'monitoring' && !this.#fingerprintingDetected) {
				this.#setStatus('safe')
				this.config.onSafe?.()
				this.dispatchEvent(new Event('safe'))
				this.#stopMonitoring()
			}
		}, timeout)
	}

	#stopMonitoring(): void {
		if (this.#monitoringTimer) {
			clearTimeout(this.#monitoringTimer)
			this.#monitoringTimer = null
		}
		if (this.#detectionTimer) {
			clearTimeout(this.#detectionTimer)
			this.#detectionTimer = null
		}
		if (this.#mutationObserver) {
			this.#mutationObserver.disconnect()
			this.#mutationObserver = null
		}
	}

	/**
	 * Check for fingerprinting activity using built-in or custom detector.
	 */
	async #checkForFingerprinting(): Promise<boolean> {
		if (this.config.customDetector) {
			return this.config.customDetector()
		}
		return detectFingerprintingActivity()
	}

	/**
	 * Monitor for DOM probing attempts.
	 * Extension fingerprinting tools often:
	 * 1. Insert probe elements and check for modifications
	 * 2. Query for chrome-extension:// resources
	 * 3. Check for known extension class names/IDs
	 */
	#setupDomProbeDetection(): void {
		if (typeof MutationObserver === 'undefined') return

		this.#mutationObserver = new MutationObserver((mutations) => {
			for (const mutation of mutations) {
				// Check for probe elements being inserted
				for (const node of mutation.addedNodes) {
					if (node instanceof HTMLElement) {
						this.#checkForProbeElement(node)
					}
				}
			}
		})

		this.#mutationObserver.observe(document.documentElement, {
			childList: true,
			subtree: true,
		})
	}

	/**
	 * Check if an element appears to be a fingerprinting probe.
	 * Probe elements typically:
	 * - Have chrome-extension:// URLs in src/href
	 * - Are hidden/zero-size elements used for detection
	 * - Have characteristic class names from detection libraries
	 */
	#checkForProbeElement(element: HTMLElement): void {
		// Check for extension resource probing
		const src = element.getAttribute('src') || ''
		const href = element.getAttribute('href') || ''
		if (src.includes('chrome-extension://') || href.includes('chrome-extension://')) {
			this.#handleFingerprintingDetected('Extension resource probing detected')
			return
		}

		// Check for known detection library class names
		const probePatterns = [
			'extension-detector',
			'ext-detect',
			'fp-detect',
			'bot-detect',
			'bot-check',
		]
		const classes = element.className?.toLowerCase?.() || ''
		for (const pattern of probePatterns) {
			if (classes.includes(pattern)) {
				this.#handleFingerprintingDetected(`Detection library probe element found: ${pattern}`)
				return
			}
		}
	}

	/**
	 * Handle fingerprinting detection.
	 */
	#handleFingerprintingDetected(reason: string): void {
		if (this.#fingerprintingDetected) return // Already handling
		this.#fingerprintingDetected = true

		this.dispatchEvent(new CustomEvent('detected', { detail: { reason } }))

		if (this.config.autoWithdraw !== false) {
			this.withdraw(reason)
		}
	}

	/**
	 * Clean up any remaining page-agent artifacts from the DOM.
	 * This is the nuclear option - removes everything the agent may have injected.
	 */
	#cleanupArtifacts(): void {
		// Remove known page-agent elements
		const selectors = [
			'#page-agent-runtime_agent-panel',
			'[data-page-agent-ignore]',
			'[data-page-agent-not-interactive]',
			'[data-browser-use-ignore]',
			'[data-page-agent-highlight]',
		]

		for (const selector of selectors) {
			try {
				const elements = document.querySelectorAll(selector)
				for (const el of elements) {
					el.remove()
				}
			} catch {
				// Selector may be invalid in some environments
			}
		}

		// Remove any style elements injected by the agent
		const styles = document.querySelectorAll('style')
		for (const style of styles) {
			const text = style.textContent || ''
			if (text.includes('page-agent') || text.includes('simulator-mask')) {
				style.remove()
			}
		}
	}
}
