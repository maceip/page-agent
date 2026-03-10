import { I18n, type SupportedLanguage } from '../i18n'
import { truncate } from '../utils'
import { createCard, createReflectionLines } from './cards'
import type { AgentActivity, PanelAgentAdapter } from './types'

import styles from './Panel.module.css'

/** Available hotpoint positions */
type HotpointPosition =
	| 'bottom-center'
	| 'bottom-right'
	| 'bottom-left'
	| 'top-right'
	| 'top-left'

/**
 * Panel configuration
 */
export interface PanelConfig {
	language?: SupportedLanguage
	/**
	 * Whether to prompt for next task after task completion
	 * @default true
	 */
	promptForNextTask?: boolean
	/**
	 * Initial hotpoint position for the panel
	 * @default 'bottom-right'
	 */
	position?: HotpointPosition
}

/**
 * Agent control panel
 *
 * Architecture:
 * - History list: renders directly from agent.history (historical events)
 * - Header bar: shows activity events (transient state) and agent status
 * - Hotpoint system: panel snaps to screen corners/edges
 *
 * This separation ensures data consistency - history is the single source of truth
 * for what has been done, while activity shows what is happening now.
 */
export class Panel {
	#wrapper: HTMLElement
	#indicator: HTMLElement
	#statusText: HTMLElement
	#historySection: HTMLElement
	#expandButton: HTMLElement
	#actionButton: HTMLElement
	#inputSection: HTMLElement
	#taskInput: HTMLInputElement

	#agent: PanelAgentAdapter
	#config: PanelConfig
	#isExpanded = false
	#i18n: I18n
	#userAnswerResolver: ((input: string) => void) | null = null
	#isWaitingForUserAnswer: boolean = false
	#headerUpdateTimer: ReturnType<typeof setInterval> | null = null
	#pendingHeaderText: string | null = null
	#isAnimating = false

	/** Current hotpoint position */
	#position: HotpointPosition

	/** Drag state */
	#isDragging = false
	#dragStartX = 0
	#dragStartY = 0
	#dragOffsetX = 0
	#dragOffsetY = 0

	// Event handlers (bound for removal)
	#onStatusChange = () => this.#handleStatusChange()
	#onHistoryChange = () => this.#handleHistoryChange()
	#onActivity = (e: Event) => this.#handleActivity((e as CustomEvent<AgentActivity>).detail)
	#onAgentDispose = () => this.dispose()

	get wrapper(): HTMLElement {
		return this.#wrapper
	}

	/**
	 * Create a Panel bound to an agent
	 * @param agent - Agent instance that implements PanelAgentAdapter
	 * @param config - Optional panel configuration
	 */
	constructor(agent: PanelAgentAdapter, config: PanelConfig = {}) {
		this.#agent = agent
		this.#config = config
		this.#i18n = new I18n(config.language ?? 'en-US')
		this.#position = config.position ?? 'bottom-right'

		// Set up askUser callback on agent
		this.#agent.onAskUser = (question) => this.#askUser(question)

		// Create UI elements
		this.#wrapper = this.#createWrapper()
		this.#indicator = this.#wrapper.querySelector(`.${styles.indicator}`)!
		this.#statusText = this.#wrapper.querySelector(`.${styles.statusText}`)!
		this.#historySection = this.#wrapper.querySelector(`.${styles.historySection}`)!
		this.#expandButton = this.#wrapper.querySelector(`.${styles.expandButton}`)!
		this.#actionButton = this.#wrapper.querySelector(`.${styles.stopButton}`)!
		this.#inputSection = this.#wrapper.querySelector(`.${styles.inputSectionWrapper}`)!
		this.#taskInput = this.#wrapper.querySelector(`.${styles.taskInput}`)!

		// Listen to agent events
		this.#agent.addEventListener('statuschange', this.#onStatusChange)
		this.#agent.addEventListener('historychange', this.#onHistoryChange)
		this.#agent.addEventListener('activity', this.#onActivity)
		this.#agent.addEventListener('dispose', this.#onAgentDispose)

		this.#setupEventListeners()
		this.#startHeaderUpdateLoop()

		this.#showInputArea()

		// Apply initial position
		this.#applyPosition()

		this.hide() // Start hidden
	}

	// ========== Hotpoint system ==========

	#applyPosition(): void {
		// Remove all position classes
		const positions: HotpointPosition[] = [
			'bottom-center',
			'bottom-right',
			'bottom-left',
			'top-right',
			'top-left',
		]
		for (const pos of positions) {
			this.#wrapper.classList.remove(styles[`pos-${pos}` as keyof typeof styles] as string)
		}

		// Construct the CSS module class key
		const classKey = `pos-${this.#position}` as string
		// CSS modules use camelCase for hyphenated class names
		const camelKey = classKey.replace(/-([a-z])/g, (_, c) => c.toUpperCase())
		const className = (styles as Record<string, string>)[camelKey]
		if (className) {
			this.#wrapper.classList.add(className)
		}

		// Clear any inline positioning from drag
		this.#wrapper.style.left = ''
		this.#wrapper.style.top = ''
		this.#wrapper.style.right = ''
		this.#wrapper.style.bottom = ''
	}

	/** Snap to the nearest hotpoint based on current screen position */
	#snapToNearestHotpoint(screenX: number, screenY: number): void {
		const vw = window.innerWidth
		const vh = window.innerHeight

		const isTop = screenY < vh / 2
		const isLeft = screenX < vw / 3
		const isRight = screenX > (vw * 2) / 3

		let newPos: HotpointPosition
		if (isTop) {
			newPos = isLeft ? 'top-left' : 'top-right'
		} else {
			if (isLeft) newPos = 'bottom-left'
			else if (isRight) newPos = 'bottom-right'
			else newPos = 'bottom-center'
		}

		this.#position = newPos
		this.#applyPosition()
	}

	// ========== Agent event handlers ==========

	/** Handle agent status change */
	#handleStatusChange(): void {
		const status = this.#agent.status

		// Map agent status to UI indicator type
		const indicatorType =
			status === 'running' ? 'thinking' : status === 'idle' ? 'thinking' : status
		this.#updateStatusIndicator(indicatorType)

		// Morph action button: running = stop, not running = close (X)
		if (status === 'running') {
			this.#actionButton.textContent = '\u25A0'
			this.#actionButton.title = this.#i18n.t('ui.panel.stop')
		} else {
			this.#actionButton.textContent = 'X'
			this.#actionButton.title = this.#i18n.t('ui.panel.close')
		}

		// Show/hide based on status
		if (status === 'running') {
			this.show()
			this.#hideInputArea() // Hide input while running
		}

		// Handle completion
		if (status === 'completed' || status === 'error') {
			if (!this.#isExpanded) {
				this.#expand()
			}
			if (this.#shouldShowInputArea()) {
				this.#showInputArea()
			}
		}
	}

	/** Handle agent history change - re-render history list from agent.history */
	#handleHistoryChange(): void {
		this.#renderHistory()
	}

	/**
	 * Handle agent activity - transient state for immediate UI feedback
	 * Activity events are NOT persisted in history, only used for header bar updates
	 */
	#handleActivity(activity: AgentActivity): void {
		switch (activity.type) {
			case 'thinking':
				this.#pendingHeaderText = this.#i18n.t('ui.panel.thinking')
				this.#updateStatusIndicator('thinking')
				break

			case 'executing':
				this.#pendingHeaderText = this.#getToolExecutingText(activity.tool, activity.input)
				this.#updateStatusIndicator('executing')
				break

			case 'executed':
				this.#pendingHeaderText = truncate(activity.output, 50)
				break

			case 'retrying':
				this.#pendingHeaderText = `Retrying (${activity.attempt}/${activity.maxAttempts})`
				this.#updateStatusIndicator('retrying')
				break

			case 'error':
				this.#pendingHeaderText = truncate(activity.message, 50)
				this.#updateStatusIndicator('error')
				break
		}
	}

	/**
	 * Ask for user input (internal, called by agent via onAskUser)
	 */
	#askUser(question: string): Promise<string> {
		return new Promise((resolve) => {
			// Set `waiting for user answer` state
			this.#isWaitingForUserAnswer = true
			this.#userAnswerResolver = resolve

			// Expand history panel
			if (!this.#isExpanded) {
				this.#expand()
			}

			// Add temporary question card so user can see the full question
			const tempCard = document.createElement('div')
			tempCard.innerHTML = createCard({
				icon: '\u2753',
				content: `Question: ${question}`,
				type: 'question',
			})
			const cardElement = tempCard.firstElementChild as HTMLElement
			cardElement.setAttribute('data-temp-card', 'true')
			this.#historySection.appendChild(cardElement)
			this.#scrollToBottom()

			this.#showInputArea(this.#i18n.t('ui.panel.userAnswerPrompt'))
		})
	}

	// ========== Public control methods ==========

	show(): void {
		this.wrapper.classList.remove(styles.hiding as string)
		this.wrapper.style.display = 'block'
		void this.wrapper.offsetHeight
		this.wrapper.style.opacity = '1'
	}

	hide(): void {
		this.wrapper.style.opacity = '0'
		this.wrapper.classList.add(styles.hiding as string)
		this.wrapper.style.display = 'none'
	}

	reset(): void {
		this.#statusText.textContent = this.#i18n.t('ui.panel.ready')
		this.#updateStatusIndicator('thinking')
		this.#renderHistory()
		this.#collapse()
		// Reset user input state
		this.#isWaitingForUserAnswer = false
		this.#userAnswerResolver = null
		// Show input area
		this.#showInputArea()
	}

	expand(): void {
		this.#expand()
	}

	collapse(): void {
		this.#collapse()
	}

	/**
	 * Dispose panel and clean up event listeners
	 */
	dispose(): void {
		// Remove agent event listeners
		this.#agent.removeEventListener('statuschange', this.#onStatusChange)
		this.#agent.removeEventListener('historychange', this.#onHistoryChange)
		this.#agent.removeEventListener('activity', this.#onActivity)
		this.#agent.removeEventListener('dispose', this.#onAgentDispose)

		// Clean up UI
		this.#isWaitingForUserAnswer = false
		this.#stopHeaderUpdateLoop()
		this.wrapper.remove()
	}

	// ========== Private methods ==========

	#getToolExecutingText(toolName: string, args: unknown): string {
		const a = args as Record<string, string | number>
		switch (toolName) {
			case 'click_element_by_index':
				return this.#i18n.t('ui.tools.clicking', { index: a.index })
			case 'input_text':
				return this.#i18n.t('ui.tools.inputting', { index: a.index })
			case 'select_dropdown_option':
				return this.#i18n.t('ui.tools.selecting', { text: a.text })
			case 'scroll':
				return this.#i18n.t('ui.tools.scrolling')
			case 'wait':
				return this.#i18n.t('ui.tools.waiting', { seconds: a.seconds })
			case 'ask_user':
				return this.#i18n.t('ui.tools.askingUser')
			case 'done':
				return this.#i18n.t('ui.tools.done')
			default:
				return this.#i18n.t('ui.tools.executing', { toolName })
		}
	}

	/**
	 * Action button handler: stop when running, close (dispose) when idle
	 */
	#handleActionButton(): void {
		if (this.#agent.status === 'running') {
			this.#agent.stop()
		} else {
			this.#agent.dispose()
		}
	}

	/**
	 * Submit task
	 */
	#submitTask() {
		const input = this.#taskInput.value.trim()
		if (!input) return

		// Hide input area
		this.#hideInputArea()

		if (this.#isWaitingForUserAnswer) {
			// Handle user input mode
			this.#handleUserAnswer(input)
		} else {
			// Execute task via agent
			this.#agent.execute(input)
		}
	}

	/**
	 * Handle user answer
	 */
	#handleUserAnswer(input: string): void {
		// Remove temporary question cards (only direct children for safety)
		Array.from(this.#historySection.children).forEach((child) => {
			if (child.getAttribute('data-temp-card') === 'true') {
				child.remove()
			}
		})

		// Reset state
		this.#isWaitingForUserAnswer = false

		// Call resolver to return user input
		if (this.#userAnswerResolver) {
			this.#userAnswerResolver(input)
			this.#userAnswerResolver = null
		}
	}

	/**
	 * Show input area
	 */
	#showInputArea(placeholder?: string): void {
		// Clear input field
		this.#taskInput.value = ''
		this.#taskInput.placeholder = placeholder || this.#i18n.t('ui.panel.taskInput')
		this.#inputSection.classList.remove(styles.hidden)
		// Focus on input field
		setTimeout(() => {
			this.#taskInput.focus()
		}, 100)
	}

	/**
	 * Hide input area
	 */
	#hideInputArea(): void {
		this.#inputSection.classList.add(styles.hidden)
	}

	/**
	 * Check if input area should be shown
	 */
	#shouldShowInputArea(): boolean {
		// Always show input area if waiting for user input
		if (this.#isWaitingForUserAnswer) return true

		const history = this.#agent.history
		if (history.length === 0) {
			return true // Initial state
		}

		const status = this.#agent.status
		const isTaskEnded = status === 'completed' || status === 'error'

		// Only show input area after task completion if configured to do so
		if (isTaskEnded) {
			return this.#config.promptForNextTask ?? true
		}

		return false
	}

	#createWrapper(): HTMLElement {
		const wrapper = document.createElement('div')
		wrapper.id = 'page-agent-runtime_agent-panel'
		wrapper.className = styles.wrapper
		wrapper.setAttribute('data-browser-use-ignore', 'true')
		wrapper.setAttribute('data-page-agent-ignore', 'true')

		wrapper.innerHTML = `
			<div class="${styles.background}"></div>
			<div class="${styles.historySectionWrapper}">
				<div class="${styles.historySection}">
					<div class="${styles.historyItem}">
						<div class="${styles.historyContent}">
							<span class="${styles.statusIcon}">🧠</span>
							<span>${this.#i18n.t('ui.panel.waitingPlaceholder')}</span>
						</div>
					</div>
				</div>
			</div>
			<div class="${styles.header}">
				<div class="${styles.statusSection}">
					<div class="${styles.indicator} ${styles.thinking}"></div>
					<div class="${styles.statusText}">${this.#i18n.t('ui.panel.ready')}</div>
				</div>
				<div class="${styles.controls}">
					<button class="${styles.controlButton} ${styles.expandButton}" title="${this.#i18n.t('ui.panel.expand')}">
						▼
					</button>
					<button class="${styles.controlButton} ${styles.stopButton}" title="${this.#i18n.t('ui.panel.close')}">
						X
					</button>
				</div>
			</div>
			<div class="${styles.inputSectionWrapper} ${styles.hidden}">
				<div class="${styles.inputSection}">
					<input
						type="text"
						class="${styles.taskInput}"
						maxlength="200"
					/>
				</div>
			</div>
		`

		document.body.appendChild(wrapper)
		return wrapper
	}

	#setupEventListeners(): void {
		// Click header area to expand/collapse
		const header = this.wrapper.querySelector(`.${styles.header}`)!

		// --- Drag-to-hotpoint logic ---
		let dragStartTime = 0

		const onPointerDown = (e: PointerEvent) => {
			// Don't drag from buttons
			if ((e.target as HTMLElement).closest(`.${styles.controlButton}`)) return

			this.#isDragging = false
			dragStartTime = Date.now()
			this.#dragStartX = e.clientX
			this.#dragStartY = e.clientY

			const rect = this.#wrapper.getBoundingClientRect()
			this.#dragOffsetX = e.clientX - rect.left
			this.#dragOffsetY = e.clientY - rect.top

			header.addEventListener('pointermove', onPointerMove)
			window.addEventListener('pointerup', onPointerUp)
		}

		const onPointerMove = (e: PointerEvent) => {
			const dx = Math.abs(e.clientX - this.#dragStartX)
			const dy = Math.abs(e.clientY - this.#dragStartY)

			if (!this.#isDragging && (dx > 5 || dy > 5)) {
				this.#isDragging = true
				this.#wrapper.classList.add(styles.dragging)

				// Switch to absolute positioning
				const rect = this.#wrapper.getBoundingClientRect()
				this.#wrapper.style.position = 'fixed'
				this.#wrapper.style.left = `${rect.left}px`
				this.#wrapper.style.top = `${rect.top}px`
				this.#wrapper.style.right = 'auto'
				this.#wrapper.style.bottom = 'auto'
				this.#wrapper.style.transform = 'none'
			}

			if (this.#isDragging) {
				this.#wrapper.style.left = `${e.clientX - this.#dragOffsetX}px`
				this.#wrapper.style.top = `${e.clientY - this.#dragOffsetY}px`
			}
		}

		const onPointerUp = (e: PointerEvent) => {
			header.removeEventListener('pointermove', onPointerMove)
			window.removeEventListener('pointerup', onPointerUp)

			if (this.#isDragging) {
				this.#isDragging = false
				this.#wrapper.classList.remove(styles.dragging)

				// Snap to nearest hotpoint
				const rect = this.#wrapper.getBoundingClientRect()
				const centerX = rect.left + rect.width / 2
				const centerY = rect.top + rect.height / 2
				this.#snapToNearestHotpoint(centerX, centerY)
			} else {
				// It was a click, not a drag — toggle expand
				const elapsed = Date.now() - dragStartTime
				if (elapsed < 300) {
					this.#toggle()
				}
			}
		}

		header.addEventListener('pointerdown', onPointerDown as EventListener)

		// Expand button
		this.#expandButton.addEventListener('click', (e) => {
			e.stopPropagation()
			this.#toggle()
		})

		// Action button (stop / close)
		this.#actionButton.addEventListener('click', (e) => {
			e.stopPropagation()
			this.#handleActionButton()
		})

		// Submit on Enter key in input field
		this.#taskInput.addEventListener('keydown', (e) => {
			if (e.isComposing) return // Ignore IME composition keys
			if (e.key === 'Enter') {
				e.preventDefault()
				this.#submitTask()
			}
		})

		// Prevent input area click event bubbling
		this.#inputSection.addEventListener('click', (e) => {
			e.stopPropagation()
		})
	}

	#toggle(): void {
		if (this.#isExpanded) {
			this.#collapse()
		} else {
			this.#expand()
		}
	}

	#expand(): void {
		this.#isExpanded = true
		this.wrapper.classList.add(styles.expanded)
		this.#expandButton.textContent = '\u25B2'
	}

	#collapse(): void {
		this.#isExpanded = false
		this.wrapper.classList.remove(styles.expanded)
		this.#expandButton.textContent = '\u25BC'
	}

	/**
	 * Start periodic header update loop
	 */
	#startHeaderUpdateLoop(): void {
		// Check every 350ms (faster than before for snappier updates)
		this.#headerUpdateTimer = setInterval(() => {
			this.#checkAndUpdateHeader()
		}, 350)
	}

	/**
	 * Stop periodic header update loop
	 */
	#stopHeaderUpdateLoop(): void {
		if (this.#headerUpdateTimer) {
			clearInterval(this.#headerUpdateTimer)
			this.#headerUpdateTimer = null
		}
	}

	/**
	 * Check if header needs update and trigger animation if not currently animating
	 */
	#checkAndUpdateHeader(): void {
		// If no pending text or currently animating, skip
		if (!this.#pendingHeaderText || this.#isAnimating) {
			return
		}

		// If text is already displayed, clear pending and skip
		if (this.#statusText.textContent === this.#pendingHeaderText) {
			this.#pendingHeaderText = null
			return
		}

		// Start animation
		const textToShow = this.#pendingHeaderText
		this.#pendingHeaderText = null
		this.#animateTextChange(textToShow)
	}

	/**
	 * Animate text change with fade out/in effect
	 */
	#animateTextChange(newText: string): void {
		this.#isAnimating = true

		// Fade out current text
		this.#statusText.classList.add(styles.fadeOut)

		setTimeout(() => {
			// Update text content
			this.#statusText.textContent = newText

			// Fade in new text
			this.#statusText.classList.remove(styles.fadeOut)
			this.#statusText.classList.add(styles.fadeIn)

			setTimeout(() => {
				this.#statusText.classList.remove(styles.fadeIn)
				this.#isAnimating = false
			}, 200)
		}, 100) // Faster transition
	}

	#updateStatusIndicator(
		type: 'thinking' | 'executing' | 'executed' | 'retrying' | 'completed' | 'error'
	): void {
		// Clear all status classes
		this.#indicator.className = styles.indicator

		// Add corresponding status class
		this.#indicator.classList.add(styles[type])
	}

	#scrollToBottom(): void {
		// Execute in next event loop to ensure DOM update completion
		setTimeout(() => {
			this.#historySection.scrollTop = this.#historySection.scrollHeight
		}, 0)
	}

	/**
	 * Render history directly from agent.history
	 *
	 * Renders:
	 * 1. Task (first item, from agent.task)
	 * 2. Reflection cards (evaluation, memory, next_goal)
	 * 3. Tool execution with output
	 * 4. Observations
	 */
	#renderHistory(): void {
		const items: string[] = []

		// 1. Task card (always first)
		const task = this.#agent.task
		if (task) {
			items.push(this.#createTaskCard(task))
		}

		// 2. Render each history event
		const history = this.#agent.history
		for (const event of history) {
			items.push(...this.#createHistoryCards(event))
		}

		this.#historySection.innerHTML = items.join('')
		this.#scrollToBottom()
	}

	#createTaskCard(task: string): string {
		return createCard({ icon: '🎯', content: task, type: 'input' })
	}

	/** Create cards for a history event */
	#createHistoryCards(event: PanelAgentAdapter['history'][number]): string[] {
		const cards: string[] = []
		const meta =
			event.type === 'step' && event.stepIndex !== undefined
				? this.#i18n.t('ui.panel.step', {
						number: (event.stepIndex + 1).toString(),
					})
				: undefined

		if (event.type === 'step') {
			// Reflection card
			if (event.reflection) {
				const lines = createReflectionLines(event.reflection)
				if (lines.length > 0) {
					cards.push(createCard({ icon: '🧠', content: lines, meta }))
				}
			}

			// Action card
			const action = event.action
			if (action) {
				cards.push(...this.#createActionCards(action, meta))
			}
		} else if (event.type === 'observation') {
			cards.push(
				createCard({ icon: '👁️', content: event.content || '', meta, type: 'observation' })
			)
		} else if (event.type === 'user_takeover') {
			cards.push(createCard({ icon: '👤', content: 'User takeover', meta, type: 'input' }))
		} else if (event.type === 'retry') {
			const retryInfo = `${event.message || 'Retrying'} (${event.attempt}/${event.maxAttempts})`
			cards.push(createCard({ icon: '🔄', content: retryInfo, meta, type: 'observation' }))
		} else if (event.type === 'error') {
			cards.push(
				createCard({ icon: '❌', content: event.message || 'Error', meta, type: 'observation' })
			)
		}

		return cards
	}

	/** Create cards for an action */
	#createActionCards(
		action: { name: string; input: unknown; output: string },
		meta?: string
	): string[] {
		const cards: string[] = []

		if (action.name === 'done') {
			const input = action.input as { text?: string }
			const text = input.text || action.output || ''
			if (text) {
				cards.push(createCard({ icon: '🤖', content: text, meta, type: 'output' }))
			}
		} else if (action.name === 'ask_user') {
			const input = action.input as { question?: string }
			const answer = action.output.replace(/^User answered:\s*/i, '')
			cards.push(
				createCard({
					icon: '❓',
					content: `Question: ${input.question || ''}`,
					meta,
					type: 'question',
				})
			)
			cards.push(createCard({ icon: '💬', content: `Answer: ${answer}`, meta, type: 'input' }))
		} else {
			const toolText = this.#getToolExecutingText(action.name, action.input)
			cards.push(createCard({ icon: '🔨', content: toolText, meta }))
			if (action.output?.length > 0) {
				cards.push(createCard({ icon: '🔨', content: action.output, meta, type: 'output' }))
			}
		}

		return cards
	}
}
