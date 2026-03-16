/**
 * @page-agent/core-ext
 *
 * Stealth extensions for page-agent:
 * - Chameleon: anti-fingerprinting engine
 * - Peekaboo: self-removal controller
 * - Sanitize: content sanitization utilities
 * - StealthAgent: extended PageAgentCore with all of the above
 */

// Chameleon
export { ChameleonEngine, detectFingerprintingActivity, getTimingJitter } from './chameleon'
export type { ChameleonConfig } from './chameleon'

// Peekaboo
export { PeekabooController } from './peekaboo'
export type { PeekabooConfig, PeekabooStatus } from './peekaboo'

// Sanitize
export { sanitizeHTML, sanitizePageContent } from './sanitize'

// StealthAgent
export { StealthAgent } from './StealthAgent'
export type { StealthAgentConfig, StealthConfig } from './StealthAgent'
