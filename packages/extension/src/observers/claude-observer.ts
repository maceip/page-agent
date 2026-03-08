/**
 * Claude Code Observer
 *
 * Watches claude.ai for task completions, code outputs, and terminal results.
 * Extracts structured summaries without capturing raw content (privacy-preserving).
 *
 * Targets: claude.ai/code/*, claude.ai/chat/*
 */
import { PageObserver } from './observer-base'
import type { PageObservation } from './types'

export class ClaudeObserver extends PageObserver {
	private lastMessageCount = 0

	constructor(onObservation: (obs: PageObservation) => void, debounceMs = 300) {
		super(
			{
				name: 'Claude',
				patterns: ['claude.ai/*'],
				agent: 'claude-code',
				defaultEnabled: true,
			},
			onObservation,
			debounceMs
		)
	}

	protected getObservationTarget(): Element | null {
		// Claude's main content area — try multiple selectors for resilience
		return (
			document.querySelector('[data-testid="conversation"]') ||
			document.querySelector('main') ||
			document.querySelector('[role="main"]') ||
			document.body
		)
	}

	protected extractObservations(_mutations: MutationRecord[]): void {
		// Look for completed assistant messages
		const messageBlocks = document.querySelectorAll(
			'[data-testid="assistant-message"], [class*="assistant"], [data-is-streaming="false"]'
		)

		if (messageBlocks.length <= this.lastMessageCount) return
		this.lastMessageCount = messageBlocks.length

		// Get the most recent assistant message
		const lastMessage = messageBlocks[messageBlocks.length - 1]
		if (!lastMessage) return

		// Check if still streaming
		if (lastMessage.closest('[data-is-streaming="true"]')) return

		// Extract a summary (not raw content — privacy)
		const text = lastMessage.textContent?.trim() || ''
		if (text.length < 10) return

		// Summarize: first 200 chars + detect code blocks and tool use
		const hasCode = lastMessage.querySelector('pre, code, [class*="code"]') !== null
		const hasTerminal = text.includes('$') || text.includes('>>>') || text.includes('npm ')

		let summary = text.slice(0, 200)
		if (text.length > 200) summary += '...'

		const tags: string[] = ['claude']
		if (hasCode) tags.push('code')
		if (hasTerminal) tags.push('terminal')

		// Detect task completion patterns
		const isCompletion =
			text.includes('completed') ||
			text.includes('done') ||
			text.includes('finished') ||
			text.includes('successfully')

		this.emitIfNew({
			content: summary,
			url: window.location.href,
			source: { agent: 'claude-code', url: window.location.href },
			tags,
			kind: isCompletion ? 'task_result' : 'observation',
		})
	}
}
