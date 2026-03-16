import { siGithub, siX } from 'simple-icons'

export default function Footer() {
	return (
		<footer
			className="bg-stone-50 dark:bg-stone-900 border-t border-stone-200 dark:border-stone-700"
			role="contentinfo"
		>
			<div className="max-w-7xl mx-auto px-6 py-6">
				<div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
					<div className="text-stone-600 dark:text-stone-400 text-sm text-center md:text-left">
						<p>
							<a
								href="https://x.com/simonluvramen"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-block bg-[linear-gradient(60deg,#39b6ff_0%,#bd45fb_33%,#ff5733_66%,#ffd600_100%)] bg-clip-text text-xs leading-none text-transparent font-mono transition-opacity duration-200 hover:opacity-85"
							>
								Simon.
							</a>
						</p>
						<p className="text-stone-600 dark:text-stone-400 text-xs mt-0.5">
							&copy; 2026 page-agent. All rights reserved.
						</p>
					</div>

					<div className="flex items-center">
						<a
							href="https://github.com/maceip/page-agent/blob/main/docs/terms-and-privacy.md"
							target="_blank"
							rel="noopener noreferrer"
							className="text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors duration-200 text-sm mr-4"
						>
							Terms &amp; Privacy
						</a>
						<a
							href="https://x.com/simonluvramen"
							target="_blank"
							rel="noopener noreferrer"
							className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors duration-200 mr-4"
							aria-label="X (Twitter)"
						>
							<svg
								role="img"
								viewBox="0 0 24 24"
								className="w-4 h-4 fill-current"
								aria-hidden="true"
							>
								<path d={siX.path} />
							</svg>
						</a>
						<a
							href="https://github.com/maceip/page-agent"
							target="_blank"
							rel="noopener noreferrer"
							className="text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors duration-200"
							aria-label="Visit GitHub repository"
						>
							<svg
								role="img"
								viewBox="0 0 24 24"
								className="w-5 h-5 fill-current"
								aria-hidden="true"
							>
								<path d={siGithub.path} />
							</svg>
						</a>
					</div>
				</div>
			</div>
		</footer>
	)
}
