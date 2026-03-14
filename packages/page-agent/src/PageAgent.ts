/**
 * Copyright (C) 2025 Alibaba Group Holding Limited
 * All rights reserved.
 */
import { type AgentConfig, PageAgentCore } from '@page-agent/core'
import { PageController, type PageControllerConfig } from '@page-agent/page-controller'
import { Panel } from '@page-agent/ui'

export * from '@page-agent/core'

export type PageAgentConfig = AgentConfig & PageControllerConfig

export class PageAgent extends PageAgentCore {
	panel: Panel

	constructor(config: PageAgentConfig) {
		// Responsive maxElements: scale with viewport width when not explicitly set.
		// Desktop (>=1024px): 80 elements. Tablet (>=768px): 60. Mobile (<768px): 40.
		const defaultMaxElements =
			typeof window !== 'undefined'
				? window.innerWidth >= 1024
					? 80
					: window.innerWidth >= 768
						? 60
						: 40
				: 80
		const rawMaxElements = config.maxElements ?? defaultMaxElements
		const maxElements = Math.max(10, Math.min(Math.floor(rawMaxElements), 500))

		const pageController = new PageController({
			...config,
			enableMask: config.enableMask ?? true,
			maxElements,
		})

		super({ ...config, pageController })

		this.panel = new Panel(this, {
			language: config.language,
		})
	}
}
