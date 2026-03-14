'use strict'
var PageController = (() => {
	var __defProp = Object.defineProperty
	var __getOwnPropDesc = Object.getOwnPropertyDescriptor
	var __getOwnPropNames = Object.getOwnPropertyNames
	var __hasOwnProp = Object.prototype.hasOwnProperty
	var __export = (target, all) => {
		for (var name in all) __defProp(target, name, { get: all[name], enumerable: true })
	}
	var __copyProps = (to, from, except, desc) => {
		if ((from && typeof from === 'object') || typeof from === 'function') {
			for (let key of __getOwnPropNames(from))
				if (!__hasOwnProp.call(to, key) && key !== except)
					__defProp(to, key, {
						get: () => from[key],
						enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable,
					})
		}
		return to
	}
	var __toCommonJS = (mod) => __copyProps(__defProp({}, '__esModule', { value: true }), mod)

	// e2e/page-controller-entry.ts
	var page_controller_entry_exports = {}
	__export(page_controller_entry_exports, {
		clickElement: () => clickElement,
		flatTreeToString: () => flatTreeToString,
		getElementByIndex: () => getElementByIndex,
		getFlatTree: () => getFlatTree,
		getSelectorMap: () => getSelectorMap,
		inputTextElement: () => inputTextElement,
		pressKeyAction: () => pressKeyAction,
	})

	// packages/page-controller/src/dom/dom_tree/index.js
	var dom_tree_default = (
		args = {
			doHighlightElements: true,
			focusHighlightIndex: -1,
			viewportExpansion: 0,
			debugMode: false,
			/**
			 * @edit
			 */
			/** @type {Element[]} */
			interactiveBlacklist: [],
			/** @type {Element[]} */
			interactiveWhitelist: [],
			highlightOpacity: 0.1,
			highlightLabelOpacity: 0.5,
		}
	) => {
		const { interactiveBlacklist, interactiveWhitelist, highlightOpacity, highlightLabelOpacity } =
			args
		const { doHighlightElements, focusHighlightIndex, viewportExpansion, debugMode } = args
		let highlightIndex = 0
		const extraData = /* @__PURE__ */ new WeakMap()
		function addExtraData(element, data) {
			if (!element || element.nodeType !== Node.ELEMENT_NODE) return
			extraData.set(element, { ...extraData.get(element), ...data })
		}
		const DOM_CACHE = {
			boundingRects: /* @__PURE__ */ new WeakMap(),
			clientRects: /* @__PURE__ */ new WeakMap(),
			computedStyles: /* @__PURE__ */ new WeakMap(),
			clearCache: () => {
				DOM_CACHE.boundingRects = /* @__PURE__ */ new WeakMap()
				DOM_CACHE.clientRects = /* @__PURE__ */ new WeakMap()
				DOM_CACHE.computedStyles = /* @__PURE__ */ new WeakMap()
			},
		}
		function getCachedBoundingRect(element) {
			if (!element) return null
			if (DOM_CACHE.boundingRects.has(element)) {
				return DOM_CACHE.boundingRects.get(element)
			}
			const rect = element.getBoundingClientRect()
			if (rect) {
				DOM_CACHE.boundingRects.set(element, rect)
			}
			return rect
		}
		function getCachedComputedStyle(element) {
			if (!element) return null
			if (DOM_CACHE.computedStyles.has(element)) {
				return DOM_CACHE.computedStyles.get(element)
			}
			const style = window.getComputedStyle(element)
			if (style) {
				DOM_CACHE.computedStyles.set(element, style)
			}
			return style
		}
		function getCachedClientRects(element) {
			if (!element) return null
			if (DOM_CACHE.clientRects.has(element)) {
				return DOM_CACHE.clientRects.get(element)
			}
			const rects = element.getClientRects()
			if (rects) {
				DOM_CACHE.clientRects.set(element, rects)
			}
			return rects
		}
		const DOM_HASH_MAP = {}
		const ID = { current: 0 }
		const HIGHLIGHT_CONTAINER_ID = 'playwright-highlight-container'
		const xpathCache = /* @__PURE__ */ new WeakMap()
		function highlightElement(element, index, parentIframe = null) {
			if (!element) return index
			const overlays = []
			let label = null
			let labelWidth = 20
			let labelHeight = 16
			let cleanupFn = null
			try {
				let container = document.getElementById(HIGHLIGHT_CONTAINER_ID)
				if (!container) {
					container = document.createElement('div')
					container.id = HIGHLIGHT_CONTAINER_ID
					container.style.position = 'fixed'
					container.style.pointerEvents = 'none'
					container.style.top = '0'
					container.style.left = '0'
					container.style.width = '100%'
					container.style.height = '100%'
					container.style.zIndex = '2147483640'
					container.style.backgroundColor = 'transparent'
					document.body.appendChild(container)
				}
				const rects = element.getClientRects()
				if (!rects || rects.length === 0) return index
				const colors = [
					'#FF0000',
					'#00FF00',
					'#0000FF',
					'#FFA500',
					'#800080',
					'#008080',
					'#FF69B4',
					'#4B0082',
					'#FF4500',
					'#2E8B57',
					'#DC143C',
					'#4682B4',
				]
				const colorIndex = index % colors.length
				let baseColor = colors[colorIndex]
				const backgroundColor =
					baseColor +
					Math.floor(highlightOpacity * 255)
						.toString(16)
						.padStart(2, '0')
				baseColor =
					baseColor +
					Math.floor(highlightLabelOpacity * 255)
						.toString(16)
						.padStart(2, '0')
				let iframeOffset = { x: 0, y: 0 }
				if (parentIframe) {
					const iframeRect = parentIframe.getBoundingClientRect()
					iframeOffset.x = iframeRect.left
					iframeOffset.y = iframeRect.top
				}
				const fragment = document.createDocumentFragment()
				for (const rect of rects) {
					if (rect.width === 0 || rect.height === 0) continue
					const overlay = document.createElement('div')
					overlay.style.position = 'fixed'
					overlay.style.border = `2px solid ${baseColor}`
					overlay.style.backgroundColor = backgroundColor
					overlay.style.pointerEvents = 'none'
					overlay.style.boxSizing = 'border-box'
					const top = rect.top + iframeOffset.y
					const left = rect.left + iframeOffset.x
					overlay.style.top = `${top}px`
					overlay.style.left = `${left}px`
					overlay.style.width = `${rect.width}px`
					overlay.style.height = `${rect.height}px`
					fragment.appendChild(overlay)
					overlays.push({ element: overlay, initialRect: rect })
				}
				const firstRect = rects[0]
				label = document.createElement('div')
				label.className = 'playwright-highlight-label'
				label.style.position = 'fixed'
				label.style.background = baseColor
				label.style.color = 'white'
				label.style.padding = '1px 4px'
				label.style.borderRadius = '4px'
				label.style.fontSize = `${Math.min(12, Math.max(8, firstRect.height / 2))}px`
				label.textContent = index.toString()
				labelWidth = label.offsetWidth > 0 ? label.offsetWidth : labelWidth
				labelHeight = label.offsetHeight > 0 ? label.offsetHeight : labelHeight
				const firstRectTop = firstRect.top + iframeOffset.y
				const firstRectLeft = firstRect.left + iframeOffset.x
				let labelTop = firstRectTop + 2
				let labelLeft = firstRectLeft + firstRect.width - labelWidth - 2
				if (firstRect.width < labelWidth + 4 || firstRect.height < labelHeight + 4) {
					labelTop = firstRectTop - labelHeight - 2
					labelLeft = firstRectLeft + firstRect.width - labelWidth
					if (labelLeft < iframeOffset.x) labelLeft = firstRectLeft
				}
				labelTop = Math.max(0, Math.min(labelTop, window.innerHeight - labelHeight))
				labelLeft = Math.max(0, Math.min(labelLeft, window.innerWidth - labelWidth))
				label.style.top = `${labelTop}px`
				label.style.left = `${labelLeft}px`
				fragment.appendChild(label)
				const updatePositions = () => {
					const newRects = element.getClientRects()
					let newIframeOffset = { x: 0, y: 0 }
					if (parentIframe) {
						const iframeRect = parentIframe.getBoundingClientRect()
						newIframeOffset.x = iframeRect.left
						newIframeOffset.y = iframeRect.top
					}
					overlays.forEach((overlayData, i) => {
						if (i < newRects.length) {
							const newRect = newRects[i]
							const newTop = newRect.top + newIframeOffset.y
							const newLeft = newRect.left + newIframeOffset.x
							overlayData.element.style.top = `${newTop}px`
							overlayData.element.style.left = `${newLeft}px`
							overlayData.element.style.width = `${newRect.width}px`
							overlayData.element.style.height = `${newRect.height}px`
							overlayData.element.style.display =
								newRect.width === 0 || newRect.height === 0 ? 'none' : 'block'
						} else {
							overlayData.element.style.display = 'none'
						}
					})
					if (newRects.length < overlays.length) {
						for (let i = newRects.length; i < overlays.length; i++) {
							overlays[i].element.style.display = 'none'
						}
					}
					if (label && newRects.length > 0) {
						const firstNewRect = newRects[0]
						const firstNewRectTop = firstNewRect.top + newIframeOffset.y
						const firstNewRectLeft = firstNewRect.left + newIframeOffset.x
						let newLabelTop = firstNewRectTop + 2
						let newLabelLeft = firstNewRectLeft + firstNewRect.width - labelWidth - 2
						if (firstNewRect.width < labelWidth + 4 || firstNewRect.height < labelHeight + 4) {
							newLabelTop = firstNewRectTop - labelHeight - 2
							newLabelLeft = firstNewRectLeft + firstNewRect.width - labelWidth
							if (newLabelLeft < newIframeOffset.x) newLabelLeft = firstNewRectLeft
						}
						newLabelTop = Math.max(0, Math.min(newLabelTop, window.innerHeight - labelHeight))
						newLabelLeft = Math.max(0, Math.min(newLabelLeft, window.innerWidth - labelWidth))
						label.style.top = `${newLabelTop}px`
						label.style.left = `${newLabelLeft}px`
						label.style.display = 'block'
					} else if (label) {
						label.style.display = 'none'
					}
				}
				const throttleFunction = (func, delay) => {
					let lastCall = 0
					return (...args2) => {
						const now = performance.now()
						if (now - lastCall < delay) return
						lastCall = now
						return func(...args2)
					}
				}
				const throttledUpdatePositions = throttleFunction(updatePositions, 16)
				window.addEventListener('scroll', throttledUpdatePositions, true)
				window.addEventListener('resize', throttledUpdatePositions)
				cleanupFn = () => {
					window.removeEventListener('scroll', throttledUpdatePositions, true)
					window.removeEventListener('resize', throttledUpdatePositions)
					overlays.forEach((overlay) => overlay.element.remove())
					if (label) label.remove()
				}
				container.appendChild(fragment)
				return index + 1
			} finally {
				if (cleanupFn) {
					;(window._highlightCleanupFunctions = window._highlightCleanupFunctions || []).push(
						cleanupFn
					)
				}
			}
		}
		function getElementPosition(currentElement) {
			if (!currentElement.parentElement) {
				return 0
			}
			const tagName = currentElement.nodeName.toLowerCase()
			const siblings = Array.from(currentElement.parentElement.children).filter(
				(sib) => sib.nodeName.toLowerCase() === tagName
			)
			if (siblings.length === 1) {
				return 0
			}
			const index = siblings.indexOf(currentElement) + 1
			return index
		}
		function getXPathTree(element, stopAtBoundary = true) {
			if (xpathCache.has(element)) return xpathCache.get(element)
			const segments = []
			let currentElement = element
			while (currentElement && currentElement.nodeType === Node.ELEMENT_NODE) {
				if (
					stopAtBoundary &&
					(currentElement.parentNode instanceof ShadowRoot ||
						currentElement.parentNode instanceof HTMLIFrameElement)
				) {
					break
				}
				const position = getElementPosition(currentElement)
				const tagName = currentElement.nodeName.toLowerCase()
				const xpathIndex = position > 0 ? `[${position}]` : ''
				segments.unshift(`${tagName}${xpathIndex}`)
				currentElement = currentElement.parentNode
			}
			const result = segments.join('/')
			xpathCache.set(element, result)
			return result
		}
		function isScrollableElement(element) {
			if (!element || element.nodeType !== Node.ELEMENT_NODE) {
				return null
			}
			const style = getCachedComputedStyle(element)
			if (!style) return null
			const display = style.display
			if (display === 'inline' || display === 'inline-block') {
				return null
			}
			const overflowX = style.overflowX
			const overflowY = style.overflowY
			const scrollableX = overflowX === 'auto' || overflowX === 'scroll'
			const scrollableY = overflowY === 'auto' || overflowY === 'scroll'
			if (!scrollableX && !scrollableY) {
				return null
			}
			const scrollWidth = element.scrollWidth - element.clientWidth
			const scrollHeight = element.scrollHeight - element.clientHeight
			const threshold = 4
			if (scrollWidth < threshold && scrollHeight < threshold) {
				return null
			}
			if (!scrollableY && scrollWidth < threshold) {
				return null
			}
			if (!scrollableX && scrollHeight < threshold) {
				return null
			}
			const distanceToTop = element.scrollTop
			const distanceToLeft = element.scrollLeft
			const distanceToRight = element.scrollWidth - element.clientWidth - element.scrollLeft
			const distanceToBottom = element.scrollHeight - element.clientHeight - element.scrollTop
			const scrollData = {
				top: distanceToTop,
				right: distanceToRight,
				bottom: distanceToBottom,
				left: distanceToLeft,
			}
			addExtraData(element, {
				scrollable: true,
				scrollData,
			})
			return scrollData
		}
		function isTextNodeVisible(textNode) {
			try {
				if (viewportExpansion === -1) {
					const parentElement2 = textNode.parentElement
					if (!parentElement2) return false
					try {
						return parentElement2.checkVisibility({
							checkOpacity: true,
							checkVisibilityCSS: true,
						})
					} catch (e) {
						const style = window.getComputedStyle(parentElement2)
						return (
							style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
						)
					}
				}
				const range = document.createRange()
				range.selectNodeContents(textNode)
				const rects = range.getClientRects()
				if (!rects || rects.length === 0) {
					return false
				}
				let isAnyRectVisible = false
				let isAnyRectInViewport = false
				for (const rect of rects) {
					if (rect.width > 0 && rect.height > 0) {
						isAnyRectVisible = true
						if (
							!(
								rect.bottom < -viewportExpansion ||
								rect.top > window.innerHeight + viewportExpansion ||
								rect.right < -viewportExpansion ||
								rect.left > window.innerWidth + viewportExpansion
							)
						) {
							isAnyRectInViewport = true
							break
						}
					}
				}
				if (!isAnyRectVisible || !isAnyRectInViewport) {
					return false
				}
				const parentElement = textNode.parentElement
				if (!parentElement) return false
				try {
					return parentElement.checkVisibility({
						checkOpacity: true,
						checkVisibilityCSS: true,
					})
				} catch (e) {
					const style = window.getComputedStyle(parentElement)
					return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'
				}
			} catch (e) {
				console.warn('Error checking text node visibility:', e)
				return false
			}
		}
		function isElementAccepted(element) {
			if (!element || !element.tagName) return false
			const alwaysAccept = /* @__PURE__ */ new Set([
				'body',
				'div',
				'main',
				'article',
				'section',
				'nav',
				'header',
				'footer',
			])
			const tagName = element.tagName.toLowerCase()
			if (alwaysAccept.has(tagName)) return true
			const leafElementDenyList = /* @__PURE__ */ new Set([
				'svg',
				'script',
				'style',
				'link',
				'meta',
				'noscript',
				'template',
			])
			return !leafElementDenyList.has(tagName)
		}
		function isElementVisible(element) {
			const style = getCachedComputedStyle(element)
			return (
				element.offsetWidth > 0 &&
				element.offsetHeight > 0 &&
				style?.visibility !== 'hidden' &&
				style?.display !== 'none'
			)
		}
		function isInteractiveElement(element) {
			if (!element || element.nodeType !== Node.ELEMENT_NODE) {
				return false
			}
			if (interactiveBlacklist.includes(element)) {
				return false
			}
			if (interactiveWhitelist.includes(element)) {
				return true
			}
			const tagName = element.tagName.toLowerCase()
			const style = getCachedComputedStyle(element)
			const interactiveCursors = /* @__PURE__ */ new Set([
				'pointer',
				// Link/clickable elements
				'move',
				// Movable elements
				'text',
				// Text selection
				'grab',
				// Grabbable elements
				'grabbing',
				// Currently grabbing
				'cell',
				// Table cell selection
				'copy',
				// Copy operation
				'alias',
				// Alias creation
				'all-scroll',
				// Scrollable content
				'col-resize',
				// Column resize
				'context-menu',
				// Context menu available
				'crosshair',
				// Precise selection
				'e-resize',
				// East resize
				'ew-resize',
				// East-west resize
				'help',
				// Help available
				'n-resize',
				// North resize
				'ne-resize',
				// Northeast resize
				'nesw-resize',
				// Northeast-southwest resize
				'ns-resize',
				// North-south resize
				'nw-resize',
				// Northwest resize
				'nwse-resize',
				// Northwest-southeast resize
				'row-resize',
				// Row resize
				's-resize',
				// South resize
				'se-resize',
				// Southeast resize
				'sw-resize',
				// Southwest resize
				'vertical-text',
				// Vertical text selection
				'w-resize',
				// West resize
				'zoom-in',
				// Zoom in
				'zoom-out',
				// Zoom out
			])
			const nonInteractiveCursors = /* @__PURE__ */ new Set([
				'not-allowed',
				// Action not allowed
				'no-drop',
				// Drop not allowed
				'wait',
				// Processing
				'progress',
				// In progress
				'initial',
				// Initial value
				'inherit',
				// Inherited value
				//? Let's just include all potentially clickable elements that are not specifically blocked
				// 'none',        // No cursor
				// 'default',     // Default cursor
				// 'auto',        // Browser default
			])
			function doesElementHaveInteractivePointer(element2) {
				if (element2.tagName.toLowerCase() === 'html') return false
				if (style?.cursor && interactiveCursors.has(style.cursor)) return true
				return false
			}
			let isInteractiveCursor = doesElementHaveInteractivePointer(element)
			if (isInteractiveCursor) {
				return true
			}
			const interactiveElements = /* @__PURE__ */ new Set([
				'a',
				// Links
				'button',
				// Buttons
				'input',
				// All input types (text, checkbox, radio, etc.)
				'select',
				// Dropdown menus
				'textarea',
				// Text areas
				'details',
				// Expandable details
				'summary',
				// Summary element (clickable part of details)
				'label',
				// Form labels (often clickable)
				'option',
				// Select options
				'optgroup',
				// Option groups
				'fieldset',
				// Form fieldsets (can be interactive with legend)
				'legend',
				// Fieldset legends
			])
			const explicitDisableTags = /* @__PURE__ */ new Set([
				'disabled',
				// Standard disabled attribute
				// 'aria-disabled',      // ARIA disabled state
				'readonly',
				// Read-only state
				// 'aria-readonly',     // ARIA read-only state
				// 'aria-hidden',       // Hidden from accessibility
				// 'hidden',            // Hidden attribute
				// 'inert',             // Inert attribute
				// 'aria-inert',        // ARIA inert state
				// 'tabindex="-1"',     // Removed from tab order
				// 'aria-hidden="true"' // Hidden from screen readers
			])
			if (interactiveElements.has(tagName)) {
				if (style?.cursor && nonInteractiveCursors.has(style.cursor)) {
					return false
				}
				for (const disableTag of explicitDisableTags) {
					if (
						element.hasAttribute(disableTag) ||
						element.getAttribute(disableTag) === 'true' ||
						element.getAttribute(disableTag) === ''
					) {
						return false
					}
				}
				if (element.disabled) {
					return false
				}
				if (element.readOnly) {
					return false
				}
				if (element.inert) {
					return false
				}
				return true
			}
			const role = element.getAttribute('role')
			const ariaRole = element.getAttribute('aria-role')
			if (element.getAttribute('contenteditable') === 'true' || element.isContentEditable) {
				return true
			}
			if (
				element.classList &&
				(element.classList.contains('button') ||
					element.classList.contains('dropdown-toggle') ||
					element.getAttribute('data-index') ||
					element.getAttribute('data-toggle') === 'dropdown' ||
					element.getAttribute('aria-haspopup') === 'true')
			) {
				return true
			}
			const interactiveRoles = /* @__PURE__ */ new Set([
				'button',
				// Directly clickable element
				// 'link',            // Clickable link
				'menu',
				// Menu container (ARIA menus)
				'menubar',
				// Menu bar container
				'menuitem',
				// Clickable menu item
				'menuitemradio',
				// Radio-style menu item (selectable)
				'menuitemcheckbox',
				// Checkbox-style menu item (toggleable)
				'radio',
				// Radio button (selectable)
				'checkbox',
				// Checkbox (toggleable)
				'tab',
				// Tab (clickable to switch content)
				'switch',
				// Toggle switch (clickable to change state)
				'slider',
				// Slider control (draggable)
				'spinbutton',
				// Number input with up/down controls
				'combobox',
				// Dropdown with text input
				'searchbox',
				// Search input field
				'textbox',
				// Text input field
				'listbox',
				// Selectable list
				'option',
				// Selectable option in a list
				'scrollbar',
				// Scrollable control
			])
			const hasInteractiveRole =
				interactiveElements.has(tagName) ||
				(role && interactiveRoles.has(role)) ||
				(ariaRole && interactiveRoles.has(ariaRole))
			if (hasInteractiveRole) return true
			try {
				if (typeof getEventListeners === 'function') {
					const listeners = getEventListeners(element)
					const mouseEvents = ['click', 'mousedown', 'mouseup', 'dblclick']
					for (const eventType of mouseEvents) {
						if (listeners[eventType] && listeners[eventType].length > 0) {
							return true
						}
					}
				}
				const getEventListenersForNode =
					element?.ownerDocument?.defaultView?.getEventListenersForNode ||
					window.getEventListenersForNode
				if (typeof getEventListenersForNode === 'function') {
					const listeners = getEventListenersForNode(element)
					const interactionEvents = [
						'click',
						'mousedown',
						'mouseup',
						'keydown',
						'keyup',
						'submit',
						'change',
						'input',
						'focus',
						'blur',
					]
					for (const eventType of interactionEvents) {
						for (const listener of listeners) {
							if (listener.type === eventType) {
								return true
							}
						}
					}
				}
				const commonMouseAttrs = ['onclick', 'onmousedown', 'onmouseup', 'ondblclick']
				for (const attr of commonMouseAttrs) {
					if (element.hasAttribute(attr) || typeof element[attr] === 'function') {
						return true
					}
				}
			} catch (e) {}
			if (isScrollableElement(element)) {
				return true
			}
			return false
		}
		function isTopElement(element) {
			if (viewportExpansion === -1) {
				return true
			}
			const rects = getCachedClientRects(element)
			if (!rects || rects.length === 0) {
				return false
			}
			let isAnyRectInViewport = false
			for (const rect2 of rects) {
				if (
					rect2.width > 0 &&
					rect2.height > 0 &&
					!(
						// Only check non-empty rects
						(
							rect2.bottom < -viewportExpansion ||
							rect2.top > window.innerHeight + viewportExpansion ||
							rect2.right < -viewportExpansion ||
							rect2.left > window.innerWidth + viewportExpansion
						)
					)
				) {
					isAnyRectInViewport = true
					break
				}
			}
			if (!isAnyRectInViewport) {
				return false
			}
			let doc = element.ownerDocument
			if (doc !== window.document) {
				return true
			}
			let rect = Array.from(rects).find((r) => r.width > 0 && r.height > 0)
			if (!rect) {
				return false
			}
			const shadowRoot = element.getRootNode()
			if (shadowRoot instanceof ShadowRoot) {
				const centerX = rect.left + rect.width / 2
				const centerY = rect.top + rect.height / 2
				try {
					const topEl = shadowRoot.elementFromPoint(centerX, centerY)
					if (!topEl) return false
					let current = topEl
					while (current && current !== shadowRoot) {
						if (current === element) return true
						current = current.parentElement
					}
					return false
				} catch (e) {
					return true
				}
			}
			const margin = 5
			const checkPoints = [
				// Initially only this was used, but it was not enough
				{ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
				{ x: rect.left + margin, y: rect.top + margin },
				// top left
				// { x: rect.right - margin, y: rect.top + margin },    // top right
				// { x: rect.left + margin, y: rect.bottom - margin },  // bottom left
				{ x: rect.right - margin, y: rect.bottom - margin },
				// bottom right
			]
			return checkPoints.some(({ x, y }) => {
				try {
					const topEl = document.elementFromPoint(x, y)
					if (!topEl) return false
					let current = topEl
					while (current && current !== document.documentElement) {
						if (current === element) return true
						current = current.parentElement
					}
					return false
				} catch (e) {
					return true
				}
			})
		}
		function isInExpandedViewport(element, viewportExpansion2) {
			if (viewportExpansion2 === -1) {
				return true
			}
			const rects = element.getClientRects()
			if (!rects || rects.length === 0) {
				const boundingRect = getCachedBoundingRect(element)
				if (!boundingRect || boundingRect.width === 0 || boundingRect.height === 0) {
					return false
				}
				return !(
					boundingRect.bottom < -viewportExpansion2 ||
					boundingRect.top > window.innerHeight + viewportExpansion2 ||
					boundingRect.right < -viewportExpansion2 ||
					boundingRect.left > window.innerWidth + viewportExpansion2
				)
			}
			for (const rect of rects) {
				if (rect.width === 0 || rect.height === 0) continue
				if (
					!(
						rect.bottom < -viewportExpansion2 ||
						rect.top > window.innerHeight + viewportExpansion2 ||
						rect.right < -viewportExpansion2 ||
						rect.left > window.innerWidth + viewportExpansion2
					)
				) {
					return true
				}
			}
			return false
		}
		function isInteractiveCandidate(element) {
			if (!element || element.nodeType !== Node.ELEMENT_NODE) return false
			const tagName = element.tagName.toLowerCase()
			const interactiveElements = /* @__PURE__ */ new Set([
				'a',
				'button',
				'input',
				'select',
				'textarea',
				'details',
				'summary',
				'label',
			])
			if (interactiveElements.has(tagName)) return true
			const hasQuickInteractiveAttr =
				element.hasAttribute('onclick') ||
				element.hasAttribute('role') ||
				element.hasAttribute('tabindex') ||
				element.hasAttribute('aria-') ||
				element.hasAttribute('data-action') ||
				element.getAttribute('contenteditable') === 'true'
			return hasQuickInteractiveAttr
		}
		const DISTINCT_INTERACTIVE_TAGS = /* @__PURE__ */ new Set([
			'a',
			'button',
			'input',
			'select',
			'textarea',
			'summary',
			'details',
			'label',
			'option',
		])
		const INTERACTIVE_ROLES = /* @__PURE__ */ new Set([
			'button',
			'link',
			'menuitem',
			'menuitemradio',
			'menuitemcheckbox',
			'radio',
			'checkbox',
			'tab',
			'switch',
			'slider',
			'spinbutton',
			'combobox',
			'searchbox',
			'textbox',
			'listbox',
			'option',
			'scrollbar',
		])
		function isHeuristicallyInteractive(element) {
			if (!element || element.nodeType !== Node.ELEMENT_NODE) return false
			if (!isElementVisible(element)) return false
			const hasInteractiveAttributes =
				element.hasAttribute('role') ||
				element.hasAttribute('tabindex') ||
				element.hasAttribute('onclick') ||
				typeof element.onclick === 'function'
			const hasInteractiveClass = /\b(btn|clickable|menu|item|entry|link)\b/i.test(
				element.className || ''
			)
			const isInKnownContainer = Boolean(
				element.closest('button,a,[role="button"],.menu,.dropdown,.list,.toolbar')
			)
			const hasVisibleChildren = [...element.children].some(isElementVisible)
			const isParentBody = element.parentElement && element.parentElement.isSameNode(document.body)
			return (
				(isInteractiveElement(element) || hasInteractiveAttributes || hasInteractiveClass) &&
				hasVisibleChildren &&
				isInKnownContainer &&
				!isParentBody
			)
		}
		function isElementDistinctInteraction(element) {
			if (!element || element.nodeType !== Node.ELEMENT_NODE) {
				return false
			}
			const tagName = element.tagName.toLowerCase()
			const role = element.getAttribute('role')
			if (tagName === 'iframe') {
				return true
			}
			if (DISTINCT_INTERACTIVE_TAGS.has(tagName)) {
				return true
			}
			if (role && INTERACTIVE_ROLES.has(role)) {
				return true
			}
			if (element.isContentEditable || element.getAttribute('contenteditable') === 'true') {
				return true
			}
			if (
				element.hasAttribute('data-testid') ||
				element.hasAttribute('data-cy') ||
				element.hasAttribute('data-test')
			) {
				return true
			}
			if (element.hasAttribute('onclick') || typeof element.onclick === 'function') {
				return true
			}
			try {
				const getEventListenersForNode =
					element?.ownerDocument?.defaultView?.getEventListenersForNode ||
					window.getEventListenersForNode
				if (typeof getEventListenersForNode === 'function') {
					const listeners = getEventListenersForNode(element)
					const interactionEvents = [
						'click',
						'mousedown',
						'mouseup',
						'keydown',
						'keyup',
						'submit',
						'change',
						'input',
						'focus',
						'blur',
					]
					for (const eventType of interactionEvents) {
						for (const listener of listeners) {
							if (listener.type === eventType) {
								return true
							}
						}
					}
				}
				const commonEventAttrs = [
					'onmousedown',
					'onmouseup',
					'onkeydown',
					'onkeyup',
					'onsubmit',
					'onchange',
					'oninput',
					'onfocus',
					'onblur',
				]
				if (commonEventAttrs.some((attr) => element.hasAttribute(attr))) {
					return true
				}
			} catch (e) {}
			if (isHeuristicallyInteractive(element)) {
				return true
			}
			return false
		}
		function handleHighlighting(nodeData, node, parentIframe, isParentHighlighted) {
			if (!nodeData.isInteractive) return false
			let shouldHighlight = false
			if (!isParentHighlighted) {
				shouldHighlight = true
			} else {
				if (isElementDistinctInteraction(node)) {
					shouldHighlight = true
				} else {
					shouldHighlight = false
				}
			}
			if (shouldHighlight) {
				nodeData.isInViewport = isInExpandedViewport(node, viewportExpansion)
				if (nodeData.isInViewport || viewportExpansion === -1) {
					nodeData.highlightIndex = highlightIndex++
					if (doHighlightElements) {
						if (focusHighlightIndex >= 0) {
							if (focusHighlightIndex === nodeData.highlightIndex) {
								highlightElement(node, nodeData.highlightIndex, parentIframe)
							}
						} else {
							highlightElement(node, nodeData.highlightIndex, parentIframe)
						}
						return true
					}
				} else {
				}
			}
			return false
		}
		function buildDomTree(node, parentIframe = null, isParentHighlighted = false) {
			if (
				!node ||
				node.id === HIGHLIGHT_CONTAINER_ID ||
				(node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE)
			) {
				return null
			}
			if (!node || node.id === HIGHLIGHT_CONTAINER_ID) {
				return null
			}
			if (node.dataset?.browserUseIgnore === 'true' || node.dataset?.pageAgentIgnore === 'true') {
				return null
			}
			if (node.getAttribute && node.getAttribute('aria-hidden') === 'true') {
				return null
			}
			if (node === document.body) {
				const nodeData2 = {
					tagName: 'body',
					attributes: {},
					xpath: '/body',
					children: [],
				}
				for (const child of node.childNodes) {
					const domElement = buildDomTree(child, parentIframe, false)
					if (domElement) nodeData2.children.push(domElement)
				}
				const id2 = `${ID.current++}`
				DOM_HASH_MAP[id2] = nodeData2
				return id2
			}
			if (node.nodeType !== Node.ELEMENT_NODE && node.nodeType !== Node.TEXT_NODE) {
				return null
			}
			if (node.nodeType === Node.TEXT_NODE) {
				const textContent = node.textContent?.trim()
				if (!textContent) {
					return null
				}
				const parentElement = node.parentElement
				if (!parentElement || parentElement.tagName.toLowerCase() === 'script') {
					return null
				}
				const id2 = `${ID.current++}`
				DOM_HASH_MAP[id2] = {
					type: 'TEXT_NODE',
					text: textContent,
					isVisible: isTextNodeVisible(node),
				}
				return id2
			}
			if (node.nodeType === Node.ELEMENT_NODE && !isElementAccepted(node)) {
				return null
			}
			if (viewportExpansion !== -1 && !node.shadowRoot) {
				const rect = getCachedBoundingRect(node)
				const style = getCachedComputedStyle(node)
				const isFixedOrSticky = style && (style.position === 'fixed' || style.position === 'sticky')
				const hasSize = node.offsetWidth > 0 || node.offsetHeight > 0
				if (
					!rect ||
					(!isFixedOrSticky &&
						!hasSize &&
						(rect.bottom < -viewportExpansion ||
							rect.top > window.innerHeight + viewportExpansion ||
							rect.right < -viewportExpansion ||
							rect.left > window.innerWidth + viewportExpansion))
				) {
					return null
				}
			}
			const nodeData = {
				tagName: node.tagName.toLowerCase(),
				attributes: {},
				/**
				 * @edit no need for xpath
				 */
				// xpath: getXPathTree(node, true),
				children: [],
			}
			if (
				isInteractiveCandidate(node) ||
				node.tagName.toLowerCase() === 'iframe' ||
				node.tagName.toLowerCase() === 'body'
			) {
				const attributeNames = node.getAttributeNames?.() || []
				for (const name of attributeNames) {
					const value = node.getAttribute(name)
					nodeData.attributes[name] = value
				}
				if (
					node.tagName.toLowerCase() === 'input' &&
					(node.type === 'checkbox' || node.type === 'radio')
				) {
					nodeData.attributes.checked = node.checked ? 'true' : 'false'
				}
			}
			let nodeWasHighlighted = false
			if (node.nodeType === Node.ELEMENT_NODE) {
				nodeData.isVisible = isElementVisible(node)
				if (nodeData.isVisible) {
					nodeData.isTopElement = isTopElement(node)
					const role = node.getAttribute('role')
					const isMenuContainer = role === 'menu' || role === 'menubar' || role === 'listbox'
					if (nodeData.isTopElement || isMenuContainer) {
						nodeData.isInteractive = isInteractiveElement(node)
						nodeWasHighlighted = handleHighlighting(
							nodeData,
							node,
							parentIframe,
							isParentHighlighted
						)
						nodeData.ref = node
					}
				}
			}
			if (node.tagName) {
				const tagName = node.tagName.toLowerCase()
				if (tagName === 'iframe') {
					try {
						const iframeDoc = node.contentDocument || node.contentWindow?.document
						if (iframeDoc) {
							for (const child of iframeDoc.childNodes) {
								const domElement = buildDomTree(child, node, false)
								if (domElement) nodeData.children.push(domElement)
							}
						}
					} catch (e) {
						console.warn('Unable to access iframe:', e)
					}
				} else if (
					node.isContentEditable ||
					node.getAttribute('contenteditable') === 'true' ||
					node.id === 'tinymce' ||
					node.classList.contains('mce-content-body') ||
					(tagName === 'body' && node.getAttribute('data-id')?.startsWith('mce_'))
				) {
					for (const child of node.childNodes) {
						const domElement = buildDomTree(child, parentIframe, nodeWasHighlighted)
						if (domElement) nodeData.children.push(domElement)
					}
				} else {
					if (node.shadowRoot) {
						nodeData.shadowRoot = true
						for (const child of node.shadowRoot.childNodes) {
							const domElement = buildDomTree(child, parentIframe, nodeWasHighlighted)
							if (domElement) nodeData.children.push(domElement)
						}
					}
					for (const child of node.childNodes) {
						const passHighlightStatusToChild = nodeWasHighlighted || isParentHighlighted
						const domElement = buildDomTree(child, parentIframe, passHighlightStatusToChild)
						if (domElement) nodeData.children.push(domElement)
					}
				}
			}
			if (nodeData.tagName === 'a' && nodeData.children.length === 0 && !nodeData.attributes.href) {
				const rect = getCachedBoundingRect(node)
				const hasSize =
					(rect && rect.width > 0 && rect.height > 0) ||
					node.offsetWidth > 0 ||
					node.offsetHeight > 0
				if (!hasSize) {
					return null
				}
			}
			nodeData.extra = extraData.get(node) || null
			const id = `${ID.current++}`
			DOM_HASH_MAP[id] = nodeData
			return id
		}
		const rootId = buildDomTree(document.body)
		DOM_CACHE.clearCache()
		return { rootId, map: DOM_HASH_MAP }
	}

	// packages/page-controller/src/dom/index.ts
	var DEFAULT_VIEWPORT_EXPANSION = -1
	function resolveViewportExpansion(viewportExpansion) {
		return viewportExpansion ?? DEFAULT_VIEWPORT_EXPANSION
	}
	var newElementsCache = /* @__PURE__ */ new WeakMap()
	function getFlatTree(config) {
		const viewportExpansion = resolveViewportExpansion(config.viewportExpansion)
		const interactiveBlacklist = []
		for (const item of config.interactiveBlacklist || []) {
			if (typeof item === 'function') {
				interactiveBlacklist.push(item())
			} else {
				interactiveBlacklist.push(item)
			}
		}
		const interactiveWhitelist = []
		for (const item of config.interactiveWhitelist || []) {
			if (typeof item === 'function') {
				interactiveWhitelist.push(item())
			} else {
				interactiveWhitelist.push(item)
			}
		}
		const elements = dom_tree_default({
			doHighlightElements: true,
			debugMode: true,
			focusHighlightIndex: -1,
			viewportExpansion,
			interactiveBlacklist,
			interactiveWhitelist,
			highlightOpacity: config.highlightOpacity ?? 0,
			highlightLabelOpacity: config.highlightLabelOpacity ?? 0.1,
		})
		const currentUrl = window.location.href
		for (const nodeId in elements.map) {
			const node = elements.map[nodeId]
			if (node.isInteractive && node.ref) {
				const ref = node.ref
				if (!newElementsCache.has(ref)) {
					newElementsCache.set(ref, currentUrl)
					node.isNew = true
				}
			}
		}
		return elements
	}
	var globRegexCache = /* @__PURE__ */ new Map()
	function globToRegex(pattern) {
		let regex = globRegexCache.get(pattern)
		if (!regex) {
			const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
			regex = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`)
			globRegexCache.set(pattern, regex)
		}
		return regex
	}
	function matchAttributes(attrs, patterns) {
		const result = {}
		for (const pattern of patterns) {
			if (pattern.includes('*')) {
				const regex = globToRegex(pattern)
				for (const key of Object.keys(attrs)) {
					if (regex.test(key) && attrs[key].trim()) {
						result[key] = attrs[key].trim()
					}
				}
			} else {
				const value = attrs[pattern]
				if (value && value.trim()) {
					result[pattern] = value.trim()
				}
			}
		}
		return result
	}
	function flatTreeToString(flatTree, includeAttributes, cappingOptions) {
		const DEFAULT_INCLUDE_ATTRIBUTES = [
			'title',
			'type',
			'checked',
			'name',
			'role',
			'value',
			'placeholder',
			'data-date-format',
			'alt',
			'aria-label',
			'aria-expanded',
			'data-state',
			'aria-checked',
			// @edit added for better form handling
			'id',
			'for',
			// for jump check
			'target',
			// absolute position dropdown menu
			'aria-haspopup',
			'aria-controls',
			'aria-owns',
			// content editable
			'contenteditable',
		]
		const includeAttrs = [...(includeAttributes || []), ...DEFAULT_INCLUDE_ATTRIBUTES]
		const capTextLength = (text, maxLength) => {
			if (text.length > maxLength) {
				return text.substring(0, maxLength) + '...'
			}
			return text
		}
		const buildTreeNode = (nodeId) => {
			const node = flatTree.map[nodeId]
			if (!node) return null
			if (node.type === 'TEXT_NODE') {
				const textNode = node
				return {
					type: 'text',
					text: textNode.text,
					isVisible: textNode.isVisible,
					parent: null,
					children: [],
				}
			} else {
				const elementNode = node
				const children = []
				if (elementNode.children) {
					for (const childId of elementNode.children) {
						const child = buildTreeNode(childId)
						if (child) {
							child.parent = null
							children.push(child)
						}
					}
				}
				return {
					type: 'element',
					tagName: elementNode.tagName,
					attributes: elementNode.attributes ?? {},
					isVisible: elementNode.isVisible ?? false,
					isInteractive: elementNode.isInteractive ?? false,
					isTopElement: elementNode.isTopElement ?? false,
					isNew: elementNode.isNew ?? false,
					highlightIndex: elementNode.highlightIndex,
					parent: null,
					children,
					extra: elementNode.extra ?? {},
				}
			}
		}
		const setParentReferences = (node, parent = null) => {
			node.parent = parent
			for (const child of node.children) {
				setParentReferences(child, node)
			}
		}
		const rootNode = buildTreeNode(flatTree.rootId)
		if (!rootNode) return ''
		setParentReferences(rootNode)
		const maxElements = cappingOptions?.maxElements
		let includedIndices = null
		let totalInteractiveCount = 0
		if (maxElements !== void 0 && maxElements > 0) {
			const interactiveElements = []
			for (const nodeId in flatTree.map) {
				const node = flatTree.map[nodeId]
				if (node.isInteractive && typeof node.highlightIndex === 'number') {
					interactiveElements.push({
						highlightIndex: node.highlightIndex,
						isInViewport: !!node.isInViewport,
						isNew: !!node.isNew,
						domOrder: node.highlightIndex,
						// highlightIndex is assigned in DOM order
					})
				}
			}
			totalInteractiveCount = interactiveElements.length
			if (totalInteractiveCount > maxElements) {
				interactiveElements.sort((a, b) => {
					const scoreA = (a.isInViewport ? 1e4 : 0) + (a.isNew ? 1e3 : 0)
					const scoreB = (b.isInViewport ? 1e4 : 0) + (b.isNew ? 1e3 : 0)
					if (scoreA !== scoreB) return scoreB - scoreA
					return a.domOrder - b.domOrder
				})
				includedIndices = /* @__PURE__ */ new Set()
				for (let i = 0; i < maxElements; i++) {
					includedIndices.add(interactiveElements[i].highlightIndex)
				}
			}
		}
		const hasParentWithHighlightIndex = (node) => {
			let current = node.parent
			while (current) {
				if (current.type === 'element' && current.highlightIndex !== void 0) {
					return true
				}
				current = current.parent
			}
			return false
		}
		let omittedRun = 0
		const flushOmitted = (result2, depthStr) => {
			if (omittedRun > 0) {
				result2.push(
					`${depthStr}[... ${omittedRun} more element${omittedRun === 1 ? '' : 's'}, scroll or refine to reveal]`
				)
				omittedRun = 0
			}
		}
		const processNode = (node, depth, result2) => {
			let nextDepth = depth
			const depthStr = '	'.repeat(depth)
			if (node.type === 'element') {
				if (node.highlightIndex !== void 0) {
					if (includedIndices !== null && !includedIndices.has(node.highlightIndex)) {
						omittedRun++
						for (const child of node.children) {
							processNode(child, depth, result2)
						}
						return
					}
					flushOmitted(result2, depthStr)
					nextDepth += 1
					const text = getAllTextTillNextClickableElement(node)
					let attributesHtmlStr = ''
					if (includeAttrs.length > 0 && node.attributes) {
						const attributesToInclude = matchAttributes(node.attributes, includeAttrs)
						const keys = Object.keys(attributesToInclude)
						if (keys.length > 1) {
							const keysToRemove = /* @__PURE__ */ new Set()
							const seenValues = {}
							for (const key of keys) {
								const value = attributesToInclude[key]
								if (value.length > 5) {
									if (value in seenValues) {
										keysToRemove.add(key)
									} else {
										seenValues[value] = key
									}
								}
							}
							for (const key of keysToRemove) {
								delete attributesToInclude[key]
							}
						}
						if (attributesToInclude.role === node.tagName) {
							delete attributesToInclude.role
						}
						const attrsToRemoveIfTextMatches = ['aria-label', 'placeholder', 'title']
						for (const attr of attrsToRemoveIfTextMatches) {
							if (
								attributesToInclude[attr] &&
								attributesToInclude[attr].toLowerCase().trim() === text.toLowerCase().trim()
							) {
								delete attributesToInclude[attr]
							}
						}
						if (Object.keys(attributesToInclude).length > 0) {
							attributesHtmlStr = Object.entries(attributesToInclude)
								.map(([key, value]) => `${key}=${capTextLength(value, 20)}`)
								.join(' ')
						}
					}
					const highlightIndicator = node.isNew
						? `*[${node.highlightIndex}]`
						: `[${node.highlightIndex}]`
					let line = `${depthStr}${highlightIndicator}<${node.tagName ?? ''}`
					if (attributesHtmlStr) {
						line += ` ${attributesHtmlStr}`
					}
					if (node.extra) {
						if (node.extra.scrollable) {
							let scrollDataText = ''
							if (node.extra.scrollData?.left)
								scrollDataText += `left=${node.extra.scrollData.left}, `
							if (node.extra.scrollData?.top) scrollDataText += `top=${node.extra.scrollData.top}, `
							if (node.extra.scrollData?.right)
								scrollDataText += `right=${node.extra.scrollData.right}, `
							if (node.extra.scrollData?.bottom)
								scrollDataText += `bottom=${node.extra.scrollData.bottom}`
							line += ` data-scrollable="${scrollDataText}"`
						}
					}
					if (text) {
						const trimmedText = text.trim()
						if (!attributesHtmlStr) {
							line += ' '
						}
						line += `>${trimmedText}`
					} else if (!attributesHtmlStr) {
						line += ' '
					}
					line += ' />'
					result2.push(line)
				}
				for (const child of node.children) {
					processNode(child, nextDepth, result2)
				}
			} else if (node.type === 'text') {
				if (hasParentWithHighlightIndex(node)) {
					return
				}
				if (
					node.parent &&
					node.parent.type === 'element' &&
					node.parent.isVisible &&
					node.parent.isTopElement
				) {
					flushOmitted(result2, depthStr)
					result2.push(`${depthStr}${node.text ?? ''}`)
				}
			}
		}
		const result = []
		processNode(rootNode, 0, result)
		flushOmitted(result, '')
		if (includedIndices !== null && totalInteractiveCount > 0) {
			const omittedCount = totalInteractiveCount - includedIndices.size
			if (omittedCount > 0) {
				result.push(
					`
[${omittedCount} of ${totalInteractiveCount} interactive elements omitted \u2014 showing ${includedIndices.size} most relevant. Scroll to reveal more.]`
				)
			}
		}
		return result.join('\n')
	}
	var getAllTextTillNextClickableElement = (node, maxDepth = -1) => {
		const textParts = []
		const collectText = (currentNode, currentDepth) => {
			if (maxDepth !== -1 && currentDepth > maxDepth) {
				return
			}
			if (
				currentNode.type === 'element' &&
				currentNode !== node &&
				currentNode.highlightIndex !== void 0
			) {
				return
			}
			if (currentNode.type === 'text' && currentNode.text) {
				textParts.push(currentNode.text)
			} else if (currentNode.type === 'element') {
				for (const child of currentNode.children) {
					collectText(child, currentDepth + 1)
				}
			}
		}
		collectText(node, 0)
		return textParts.join('\n').trim()
	}
	function getSelectorMap(flatTree) {
		const selectorMap = /* @__PURE__ */ new Map()
		const keys = Object.keys(flatTree.map)
		for (const key of keys) {
			const node = flatTree.map[key]
			if (node.isInteractive && typeof node.highlightIndex === 'number') {
				selectorMap.set(node.highlightIndex, node)
			}
		}
		return selectorMap
	}
	function cleanUpHighlights() {
		const cleanupFunctions = window._highlightCleanupFunctions || []
		for (const cleanup of cleanupFunctions) {
			if (typeof cleanup === 'function') {
				cleanup()
			}
		}
		window._highlightCleanupFunctions = []
	}
	window.addEventListener('popstate', () => {
		cleanUpHighlights()
	})
	window.addEventListener('hashchange', () => {
		cleanUpHighlights()
	})
	window.addEventListener('beforeunload', () => {
		cleanUpHighlights()
	})
	var navigation = window.navigation
	if (navigation && typeof navigation.addEventListener === 'function') {
		navigation.addEventListener('navigate', () => {
			cleanUpHighlights()
		})
	} else {
		let currentUrl = window.location.href
		setInterval(() => {
			if (window.location.href !== currentUrl) {
				currentUrl = window.location.href
				cleanUpHighlights()
			}
		}, 500)
	}

	// packages/page-controller/src/actions.ts
	async function waitFor(seconds) {
		await new Promise((resolve) => setTimeout(resolve, seconds * 1e3))
	}
	async function movePointerToElement(element) {
		const rect = element.getBoundingClientRect()
		const x = rect.left + rect.width / 2
		const y = rect.top + rect.height / 2
		window.dispatchEvent(new CustomEvent('PageAgent::MovePointerTo', { detail: { x, y } }))
		await waitFor(0.3)
	}
	function getElementByIndex(selectorMap, index) {
		const interactiveNode = selectorMap.get(index)
		if (!interactiveNode) {
			throw new Error(`No interactive element found at index ${index}`)
		}
		const element = interactiveNode.ref
		if (!element) {
			throw new Error(`Element at index ${index} does not have a reference`)
		}
		if (!(element instanceof HTMLElement)) {
			throw new Error(`Element at index ${index} is not an HTMLElement`)
		}
		return element
	}
	var lastClickedElement = null
	function blurLastClickedElement() {
		if (lastClickedElement) {
			lastClickedElement.blur()
			lastClickedElement.dispatchEvent(
				new MouseEvent('mouseout', { bubbles: true, cancelable: true })
			)
			lastClickedElement = null
		}
	}
	async function clickElement(element) {
		blurLastClickedElement()
		lastClickedElement = element
		await scrollIntoViewIfNeeded(element)
		await movePointerToElement(element)
		window.dispatchEvent(new CustomEvent('PageAgent::ClickPointer'))
		await waitFor(0.1)
		element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true, cancelable: true }))
		element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true }))
		element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
		element.focus()
		element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
		element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
		await waitFor(0.2)
	}
	var nativeInputValueSetter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		'value'
	).set
	var nativeTextAreaValueSetter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		'value'
	).set
	async function inputTextElement(element, text) {
		const isContentEditable = element.isContentEditable
		if (
			!(element instanceof HTMLInputElement) &&
			!(element instanceof HTMLTextAreaElement) &&
			!isContentEditable
		) {
			throw new Error('Element is not an input, textarea, or contenteditable')
		}
		await clickElement(element)
		if (isContentEditable) {
			if (
				element.dispatchEvent(
					new InputEvent('beforeinput', {
						bubbles: true,
						cancelable: true,
						inputType: 'deleteContent',
					})
				)
			) {
				element.innerText = ''
				element.dispatchEvent(
					new InputEvent('input', {
						bubbles: true,
						inputType: 'deleteContent',
					})
				)
			}
			if (
				element.dispatchEvent(
					new InputEvent('beforeinput', {
						bubbles: true,
						cancelable: true,
						inputType: 'insertText',
						data: text,
					})
				)
			) {
				element.innerText = text
				element.dispatchEvent(
					new InputEvent('input', {
						bubbles: true,
						inputType: 'insertText',
						data: text,
					})
				)
			}
			element.dispatchEvent(new Event('change', { bubbles: true }))
			element.blur()
		} else if (element instanceof HTMLTextAreaElement) {
			nativeTextAreaValueSetter.call(element, text)
		} else {
			nativeInputValueSetter.call(element, text)
		}
		if (!isContentEditable) {
			element.dispatchEvent(new Event('input', { bubbles: true }))
		}
		await waitFor(0.1)
		blurLastClickedElement()
	}
	async function pressKeyAction(key, modifiers) {
		const mods = {
			ctrlKey: modifiers?.includes('Ctrl') || modifiers?.includes('Control') || false,
			shiftKey: modifiers?.includes('Shift') || false,
			altKey: modifiers?.includes('Alt') || false,
			metaKey: modifiers?.includes('Meta') || modifiers?.includes('Command') || false,
		}
		const codeMap = {
			Enter: 'Enter',
			Escape: 'Escape',
			Tab: 'Tab',
			Backspace: 'Backspace',
			Delete: 'Delete',
			Space: 'Space',
			' ': 'Space',
			ArrowDown: 'ArrowDown',
			ArrowUp: 'ArrowUp',
			ArrowLeft: 'ArrowLeft',
			ArrowRight: 'ArrowRight',
			Home: 'Home',
			End: 'End',
			PageUp: 'PageUp',
			PageDown: 'PageDown',
		}
		const code = codeMap[key] || (key.length === 1 ? `Key${key.toUpperCase()}` : key)
		const target = document.activeElement || document.body
		const eventInit = {
			key,
			code,
			bubbles: true,
			cancelable: true,
			...mods,
		}
		target.dispatchEvent(new KeyboardEvent('keydown', eventInit))
		target.dispatchEvent(new KeyboardEvent('keypress', eventInit))
		target.dispatchEvent(new KeyboardEvent('keyup', eventInit))
		await waitFor(0.1)
	}
	async function scrollIntoViewIfNeeded(element) {
		const el = element
		if (el.scrollIntoViewIfNeeded) {
			el.scrollIntoViewIfNeeded()
		} else {
			el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' })
		}
	}
	return __toCommonJS(page_controller_entry_exports)
})()
