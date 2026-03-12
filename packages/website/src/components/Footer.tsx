import { siGithub } from 'simple-icons'

export default function Footer() {
	return (
		<footer
			className="bg-stone-50 dark:bg-stone-900 border-t border-stone-200 dark:border-stone-700"
			role="contentinfo"
		>
			<div className="max-w-7xl mx-auto px-6 py-6">
				<div className="flex flex-col md:flex-row justify-between items-center space-y-4 md:space-y-0">
					<p className="text-stone-600 dark:text-stone-400 text-sm">
						&copy; 2026 page-agent. All rights reserved.
					</p>
					<div className="flex items-center space-x-6">
						<a
							href="https://github.com/maceip/page-agent/blob/main/docs/terms-and-privacy.md"
							target="_blank"
							rel="noopener noreferrer"
							className="text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 transition-colors duration-200 text-sm"
						>
							Terms &amp; Privacy
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
