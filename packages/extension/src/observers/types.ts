/**
 * Page Observer Types
 *
 * Observers passively watch AI platform UIs for context to capture.
 * Each observer is per-platform and handles its own DOM selectors.
 */
import type { MemorySource } from '@/lib/memory-types'

/** Observation extracted from a page */
export interface PageObservation {
	/** What was observed */
	content: string
	/** URL where this was observed */
	url: string
	/** Source platform */
	source: MemorySource
	/** Tags for categorization */
	tags: string[]
	/** Kind of observation */
	kind: 'observation' | 'task_result' | 'workflow_step'
}

/** Observer configuration for a platform */
export interface ObserverConfig {
	/** Display name */
	name: string
	/** URL patterns this observer matches */
	patterns: string[]
	/** Source agent identifier */
	agent: string
	/** Whether this observer is enabled by default */
	defaultEnabled: boolean
}

/** Observer state persisted in chrome.storage */
export interface ObserverSettings {
	/** Map of observer name → enabled */
	enabled: Record<string, boolean>
	/** Debounce interval in ms */
	debounceMs: number
}

export const DEFAULT_OBSERVER_SETTINGS: ObserverSettings = {
	enabled: {},
	debounceMs: 300,
}
