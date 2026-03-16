import { FlaskConical, Monitor, Shield } from 'lucide-react'

export default function ScenariosSection() {
	return (
		<section
			className="px-6 py-16 bg-stone-50 dark:bg-stone-900/40"
			aria-labelledby="scenarios-heading"
		>
			<div className="max-w-6xl mx-auto">
				<div className="text-center mb-12">
					<h2
						id="scenarios-heading"
						className="text-4xl lg:text-5xl font-bold mb-4 text-stone-900 dark:text-stone-100"
					>
						Built For
					</h2>
					<p className="text-stone-500 dark:text-stone-400 max-w-xl mx-auto">
						Real workflows, not demos.
					</p>
				</div>

				<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
					{/* Automated QA */}
					<div className="rounded-2xl bg-white dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 shadow-sm">
						<div className="p-6 pb-4">
							<div className="rounded-xl bg-stone-950 p-4 font-mono text-xs leading-6 text-stone-400 overflow-hidden">
								<div>
									<span className="text-amber-500">const</span>{' '}
									<span className="text-stone-300">agent</span> ={' '}
									<span className="text-amber-500">new</span>{' '}
									<span className="text-stone-200">PageAgent</span>
									{'()'}
								</div>
								<div className="mt-1">
									<span className="text-amber-500">await</span>{' '}
									<span className="text-stone-300">agent</span>.
									<span className="text-stone-200">run</span>
									{'('}
								</div>
								<div className="pl-2 text-stone-500">{`"Navigate to /checkout,`}</div>
								<div className="pl-2 text-stone-500">{`  fill the form with test data,`}</div>
								<div className="pl-2 text-stone-500">{`  submit, and verify the`}</div>
								<div className="pl-2 text-stone-500">{`  confirmation page shows`}</div>
								<div className="pl-2 text-stone-500">{`  order ID."`}</div>
								<div>{')'}</div>
							</div>
						</div>
						<div className="p-6 pt-2">
							<div className="flex items-center gap-2 mb-2">
								<FlaskConical className="w-5 h-5 text-amber-600 dark:text-amber-500" />
								<h3 className="font-semibold text-lg text-stone-900 dark:text-stone-100">
									Automated QA
								</h3>
							</div>
							<p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
								Inject the agent into staging, give it natural language test scripts. It navigates,
								fills forms, validates — without Selenium or Playwright infrastructure.
							</p>
						</div>
					</div>

					{/* Cross-Device Mirroring */}
					<div className="rounded-2xl bg-white dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 shadow-sm">
						<div className="p-6 pb-4">
							<div className="rounded-xl bg-stone-950 p-4 font-mono text-xs leading-6 text-stone-400 overflow-hidden">
								<div className="text-stone-500">{'// mirror architecture'}</div>
								<div>
									<span className="text-stone-500">cold</span>{' '}
									<span className="text-stone-600">|</span> Tauri + profile zstd
								</div>
								<div>
									<span className="text-stone-500">warm</span>{' '}
									<span className="text-stone-600">|</span> CDP + credential sync
								</div>
								<div>
									<span className="text-stone-500"> hot</span>{' '}
									<span className="text-stone-600">|</span> MoQ + AV1 streaming
								</div>
								<div className="mt-2 text-stone-500">{'// local -> headless remote'}</div>
								<div>
									<span className="text-amber-500">await</span>{' '}
									<span className="text-stone-300">mirror</span>.
									<span className="text-stone-200">sync</span>
									{'()'}
								</div>
							</div>
						</div>
						<div className="p-6 pt-2">
							<div className="flex items-center gap-2 mb-2">
								<Monitor className="w-5 h-5 text-amber-600 dark:text-amber-500" />
								<h3 className="font-semibold text-lg text-stone-900 dark:text-stone-100">
									Cross-Device Mirroring
								</h3>
							</div>
							<p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
								Mirror architecture syncs a local browser session to a remote headless instance.
								Cold/warm/hot layers handle everything from profile bootstrap to sub-frame pixel
								streaming.
							</p>
						</div>
					</div>

					{/* Undetectable Automation */}
					<div className="rounded-2xl bg-white dark:bg-stone-800/60 border border-stone-200 dark:border-stone-700 shadow-sm">
						<div className="p-6 pb-4">
							<div className="rounded-xl bg-stone-950 p-4 font-mono text-xs leading-6 text-stone-400 overflow-hidden">
								<div className="text-stone-500">{'// chameleon mode'}</div>
								<div>
									<span className="text-amber-500">namespace</span>:{' '}
									<span className="text-stone-300">{`"__a11y_helper_\${rand}"`}</span>
								</div>
								<div>
									<span className="text-amber-500">mutations</span>:{' '}
									<span className="text-stone-300">randomized</span>
								</div>
								<div className="mt-2 text-stone-500">{'// peekaboo mode'}</div>
								<div>
									<span className="text-amber-500">on</span>(
									<span className="text-stone-300">{`'fingerprint'`}</span>,{' '}
									<span className="text-stone-600">{'() =>'}</span>{' '}
									<span className="text-stone-300">withdraw</span>())
								</div>
								<div className="mt-2 text-stone-500">{'// DataDome, PerimeterX: nothing'}</div>
							</div>
						</div>
						<div className="p-6 pt-2">
							<div className="flex items-center gap-2 mb-2">
								<Shield className="w-5 h-5 text-amber-600 dark:text-amber-500" />
								<h3 className="font-semibold text-lg text-stone-900 dark:text-stone-100">
									Undetectable Automation
								</h3>
							</div>
							<p className="text-sm text-stone-600 dark:text-stone-400 leading-relaxed">
								Chameleon randomizes your namespace to look like an a11y framework. Peekaboo
								withdraws on fingerprinting. Sites running DataDome or PerimeterX see nothing.
							</p>
						</div>
					</div>
				</div>
			</div>
		</section>
	)
}
