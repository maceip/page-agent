/**
 * E2E test entry point — bundles real page-controller functions into a
 * browser-injectable IIFE so E2E tests exercise production code.
 *
 * We import directly from the sub-modules to avoid pulling in the full
 * PageController class (which has CSS/SVG dependencies for the visual mask).
 *
 * diffState is already tested by unit tests importing from real production code.
 * This bundle focuses on what REQUIRES a real browser: DOM extraction + actions.
 */
export {
	getFlatTree,
	flatTreeToString,
	getSelectorMap,
} from '../packages/page-controller/src/dom/index'
export {
	pressKeyAction,
	clickElement,
	inputTextElement,
	getElementByIndex,
} from '../packages/page-controller/src/actions'
