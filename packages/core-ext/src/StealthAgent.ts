/**
 * StealthAgent - Extended PageAgentCore with anti-fingerprinting and self-removal.
 *
 * This wraps upstream's PageAgentCore without modifying it,
 * adding peekaboo (self-removal) and chameleon (anti-fingerprinting) capabilities.
 */
import { PageAgentCore, type PageAgentCoreConfig } from '@page-agent/core'

import type { ChameleonConfig } from './chameleon'
import { ChameleonEngine } from './chameleon'
import type { PeekabooConfig } from './peekaboo'
import { PeekabooController } from './peekaboo'
import { sanitizePageContent } from './sanitize'

export interface StealthConfig {
	/**
	 * Peekaboo mode configuration.
	 * When enabled, the agent can self-remove from the page if fingerprinting
	 * is detected, then prompt the user to re-inject.
	 * @experimental
	 */
	peekaboo?: PeekabooConfig

	/**
	 * Chameleon anti-fingerprinting configuration.
	 * Applies layered strategies to prevent the agent from being
	 * false-positive detected as automation software.
	 * Automatically enabled when peekaboo is enabled.
	 * @experimental
	 */
	chameleon?: ChameleonConfig
}

export type StealthAgentConfig = PageAgentCoreConfig & StealthConfig

/**
 * Extended PageAgentCore with stealth capabilities.
 *
 * Usage:
 *   const agent = new StealthAgent({
 *     ...coreConfig,
 *     peekaboo: { enabled: true },
 *     chameleon: { timingJitter: true },
 *   })
 */
export class StealthAgent extends PageAgentCore {
	/** Chameleon anti-fingerprinting engine */
	readonly chameleon: ChameleonEngine | null
	/** Peekaboo self-removal controller */
	readonly peekaboo: PeekabooController | null

	readonly #stealthConfig: StealthConfig

	constructor(config: StealthAgentConfig) {
		// Wrap transformPageContent to include sanitization
		const originalTransform = config.transformPageContent
		const wrappedConfig: PageAgentCoreConfig = {
			...config,
			transformPageContent: async (content: string) => {
				let sanitized = sanitizePageContent(content)
				if (originalTransform) {
					sanitized = await originalTransform(sanitized)
				}
				return sanitized
			},
		}

		super(wrappedConfig)

		this.#stealthConfig = {
			peekaboo: config.peekaboo,
			chameleon: config.chameleon,
		}

		// Initialize Chameleon (anti-fingerprinting)
		const peekabooEnabled = this.#stealthConfig.peekaboo?.enabled
		if (this.#stealthConfig.chameleon || peekabooEnabled) {
			this.chameleon = new ChameleonEngine(this.#stealthConfig.chameleon)
			this.chameleon.activate()
		} else {
			this.chameleon = null
		}

		// Initialize Peekaboo (self-removal)
		if (peekabooEnabled) {
			this.peekaboo = new PeekabooController(this.#stealthConfig.peekaboo)
			if (this.chameleon) {
				this.peekaboo.start(this.chameleon)
			}

			// If peekaboo withdraws, stop the agent gracefully
			this.peekaboo.addEventListener('withdraw', () => {
				if (this.status === 'running') {
					this.stop()
				}
			})
		} else {
			this.peekaboo = null
		}
	}

	override async execute(task: string) {
		// Use chameleon jittered delay if available by hooking into the step loop
		// via onAfterStep. This replaces the inline chameleon delay that was in core.
		const originalAfterStep = this.config.onAfterStep
		if (this.chameleon?.isActive) {
			const chameleon = this.chameleon
			this.config.onAfterStep = async (agent, history) => {
				await originalAfterStep?.(agent, history)
				// The base class uses waitFor(0.4) between steps.
				// Chameleon adds jitter on top of that via its own timing.
				// We apply a small additional jitter here for naturalness.
				await chameleon.jitteredDelay(50)
			}
		}

		return super.execute(task)
	}

	override dispose() {
		// Clean up chameleon and peekaboo before core disposal
		this.peekaboo?.dispose()
		this.chameleon?.deactivate()
		super.dispose()
	}
}
