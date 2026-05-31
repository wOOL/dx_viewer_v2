<script lang="ts">
	import AuroraBackground from '$components/brand/AuroraBackground.svelte';
	import Wordmark from '$components/brand/Wordmark.svelte';
	import * as m from '$lib/paraglide/messages';

	let { children } = $props();
</script>

<AuroraBackground />

<div class="auth-stage">
	<div class="auth-card">
		<div class="card-rim"></div>
		<header class="brand">
			<Wordmark size="md" />
		</header>

		<div class="rule"></div>

		<div class="content">
			{@render children()}
		</div>
	</div>
	<footer class="foot">
		<span>© {new Date().getFullYear()} BeCertain</span>
		<span class="dot">·</span>
		<a href="/privacy">{m.dx_auth_footer_privacy()}</a>
		<span class="dot">·</span>
		<a href="/terms">{m.dx_auth_footer_terms()}</a>
	</footer>
</div>

<style>
	.auth-stage {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		padding: 64px 24px 40px;
		gap: 32px;
		animation: rise 720ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}
	.auth-card {
		position: relative;
		width: 100%;
		max-width: 460px;
		background:
			linear-gradient(180deg, rgba(33, 53, 72, 0.78), rgba(26, 44, 62, 0.92)),
			radial-gradient(ellipse at top, rgba(240, 199, 100, 0.08), transparent 60%);
		border: 1px solid rgba(240, 199, 100, 0.16);
		border-radius: 14px;
		padding: 56px 52px 44px;
		backdrop-filter: blur(20px) saturate(140%);
		-webkit-backdrop-filter: blur(20px) saturate(140%);
		box-shadow:
			0 1px 0 rgba(255, 255, 255, 0.06) inset,
			0 0 0 1px rgba(15, 28, 38, 0.5) inset,
			0 30px 80px -20px rgba(0, 0, 0, 0.6),
			0 12px 40px -10px rgba(240, 199, 100, 0.08);
	}
	/* Inner gold "rim" — a one-pixel hairline that catches the light. */
	.card-rim {
		position: absolute;
		inset: 1px;
		border-radius: 13px;
		pointer-events: none;
		padding: 1px;
		background: linear-gradient(
			135deg,
			rgba(240, 199, 100, 0.22) 0%,
			rgba(240, 199, 100, 0) 35%,
			rgba(240, 199, 100, 0) 65%,
			rgba(240, 199, 100, 0.12) 100%
		);
		-webkit-mask:
			linear-gradient(#000, #000) content-box,
			linear-gradient(#000, #000);
		mask:
			linear-gradient(#000, #000) content-box,
			linear-gradient(#000, #000);
		-webkit-mask-composite: xor;
		mask-composite: exclude;
	}
	.brand {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 14px;
		margin-bottom: 32px;
		animation: rise 720ms 80ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}
	.rule {
		height: 1px;
		margin: 0 auto 32px;
		width: 44px;
		background: linear-gradient(90deg, transparent, rgba(240, 199, 100, 0.55), transparent);
		animation: rise 720ms 160ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}
	.content {
		display: flex;
		flex-direction: column;
		gap: 24px;
		animation: rise 720ms 200ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}
	.foot {
		display: flex;
		gap: 10px;
		align-items: center;
		font-size: 10px;
		font-family: var(--font-mono);
		color: var(--text-tertiary);
		letter-spacing: 0.16em;
		text-transform: uppercase;
		animation: rise 720ms 320ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
	}
	.foot a {
		color: var(--text-tertiary);
		text-decoration: none;
		transition: color 180ms;
	}
	.foot a:hover {
		color: var(--accent);
	}
	.dot {
		opacity: 0.5;
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	@media (max-width: 560px) {
		.auth-card {
			padding: 44px 28px 36px;
			max-width: 100%;
		}
	}
</style>
