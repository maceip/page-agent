import { ExternalLink } from 'lucide-react'
import { siGithub } from 'simple-icons'

export default function OneMoreThingSection() {
	return (
		<section className="px-6 py-14" aria-labelledby="architecture-heading">
			<div className="max-w-4xl mx-auto">
				<div className="text-center mb-12">
					<h2
						id="architecture-heading"
						className="text-4xl lg:text-5xl font-bold mb-4 text-stone-900 dark:text-stone-100"
					>
						How It Works
					</h2>
					<p className="text-stone-500 dark:text-stone-400 max-w-2xl mx-auto">
						Three packages, clear boundaries.
					</p>
				</div>

				<div className="grid sm:grid-cols-3 gap-5 text-left max-w-3xl mx-auto mb-12">
					<div className="rounded-xl bg-white dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 p-5">
						<h3 className="font-semibold text-stone-900 dark:text-stone-100 mb-1 font-mono text-sm">
							page-controller
						</h3>
						<p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
							DOM state management, element indexing, interactive element detection. Text-based — no
							screenshots, no OCR.
						</p>
					</div>
					<div className="rounded-xl bg-white dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 p-5">
						<h3 className="font-semibold text-stone-900 dark:text-stone-100 mb-1 font-mono text-sm">
							core
						</h3>
						<p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
							ReAct agent loop, tool system (click, input, scroll, execute_js, wait, ask_user,
							done), LLM integration, chameleon + peekaboo orchestration.
						</p>
					</div>
					<div className="rounded-xl bg-white dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 p-5">
						<div className="flex items-center gap-2 mb-1">
							<h3 className="font-semibold text-stone-900 dark:text-stone-100 font-mono text-sm">
								mirror
							</h3>
							<span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
								in review
							</span>
						</div>
						<p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
							Three-layer sync: Cold (Tauri + profile zstd), Warm (CDP + credential replication),
							Hot (MoQ + AV1 streaming).
						</p>
					</div>
				</div>

				<div className="flex justify-center">
					<a
						href="https://github.com/maceip/page-agent"
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-2 px-6 py-3 bg-stone-900 dark:bg-stone-100 text-white dark:text-stone-900 font-medium rounded-xl hover:bg-stone-800 dark:hover:bg-stone-200 transition-colors duration-200"
					>
						<svg role="img" viewBox="0 0 24 24" className="w-4 h-4 fill-current" aria-hidden="true">
							<path d={siGithub.path} />
						</svg>
						<span>View on GitHub</span>
						<ExternalLink className="w-3.5 h-3.5 opacity-50" />
					</a>
				</div>
			</div>
		</section>
	)
}
