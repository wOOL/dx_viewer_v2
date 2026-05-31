<script lang="ts">
	// Decorative aurora-style background — layered gold waves on dark navy.
	// Pure SVG so it scales crisp on any DPR and has zero runtime cost.
</script>

<div class="aurora" aria-hidden="true">
	<svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">
		<defs>
			<linearGradient id="goldStroke" x1="0%" y1="50%" x2="100%" y2="50%">
				<stop offset="0%" stop-color="#F0C764" stop-opacity="0" />
				<stop offset="25%" stop-color="#F0C764" stop-opacity="0.55" />
				<stop offset="55%" stop-color="#F5D47A" stop-opacity="0.9" />
				<stop offset="80%" stop-color="#F0C764" stop-opacity="0.45" />
				<stop offset="100%" stop-color="#F0C764" stop-opacity="0" />
			</linearGradient>
			<linearGradient id="goldStrokeFaint" x1="0%" y1="50%" x2="100%" y2="50%">
				<stop offset="0%" stop-color="#F0C764" stop-opacity="0" />
				<stop offset="40%" stop-color="#F0C764" stop-opacity="0.22" />
				<stop offset="60%" stop-color="#F0C764" stop-opacity="0.28" />
				<stop offset="100%" stop-color="#F0C764" stop-opacity="0" />
			</linearGradient>
			<filter id="softGlow" x="-10%" y="-50%" width="120%" height="200%">
				<feGaussianBlur in="SourceGraphic" stdDeviation="6" />
				<feMerge>
					<feMergeNode />
					<feMergeNode in="SourceGraphic" />
				</feMerge>
			</filter>
		</defs>

		<!-- Faint backing strands -->
		<g stroke="url(#goldStrokeFaint)" fill="none" stroke-linecap="round">
			<path d="M-100 760 C 360 640, 720 880, 1080 720 S 1700 560, 2100 660" stroke-width="0.7" />
			<path d="M-100 820 C 320 700, 760 940, 1140 760 S 1780 620, 2100 720" stroke-width="0.6" />
			<path d="M-100 880 C 280 760, 800 1000, 1200 800 S 1820 680, 2100 780" stroke-width="0.5" />
		</g>

		<!-- Bright glowing strands -->
		<g stroke="url(#goldStroke)" fill="none" stroke-linecap="round" filter="url(#softGlow)">
			<path d="M-100 700 C 340 580, 700 820, 1080 660 S 1700 500, 2100 600" stroke-width="1.4" />
			<path d="M-100 740 C 320 620, 720 860, 1100 700 S 1720 540, 2100 640" stroke-width="1.1" />
			<path d="M-100 800 C 280 680, 760 920, 1180 740 S 1800 600, 2100 700" stroke-width="0.9" />
		</g>

		<!-- Highlight strand crossing through the centre -->
		<g stroke="url(#goldStroke)" fill="none" stroke-linecap="round" filter="url(#softGlow)" opacity="0.85">
			<path d="M-100 860 C 240 740, 820 980, 1240 780 S 1860 640, 2100 760" stroke-width="1.6" />
		</g>
	</svg>
</div>

<style>
	.aurora {
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		background:
			radial-gradient(ellipse at 70% 80%, rgba(240, 199, 100, 0.06), transparent 55%),
			var(--bg);
		overflow: hidden;
	}
	.aurora svg {
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
