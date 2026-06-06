<script lang="ts">
	import PremiumPlaceholder from '$lib/components/PremiumPlaceholder.svelte';
	import { Building2 } from 'lucide-svelte';
	import { _ } from 'svelte-i18n';
</script>

<PremiumPlaceholder
	title={$_('nav.practice')}
	icon={Building2}
	headline={$_('upsell.practiceHeadline')}
	blurb={$_('upsell.practiceBlurb')}
	footerHeadline={$_('upsell.practiceFooter')}
>
	{#snippet mockup()}
		<div class="rounded-2xl bg-white p-8 shadow-lg shadow-black/5">
			<div class="-mt-2 mb-4 text-right">
				<button
					class="inline-flex items-center gap-1 rounded-full bg-[#1890ff] px-4 py-1.5 text-xs font-medium text-white"
					>📋 Daily Huddle</button
				>
			</div>
			<div class="grid grid-cols-3 gap-4">
				<div class="space-y-2 opacity-50">
					{#each ['Lindsey Cornell', 'Cordelia Fay', 'Joel Maggis', 'Margot Garman'] as name (name)}
						<div class="rounded border border-gray-200 p-2 text-xs text-gray-500">
							<div class="font-medium">{name}</div>
							<div>12pm to 1pm</div>
						</div>
					{/each}
				</div>
				<div class="col-span-2">
					<div class="rounded-xl border border-gray-200 bg-white p-4 shadow">
						<div class="mb-3 flex items-center justify-between">
							<div class="text-base font-semibold text-gray-900">Cordelia Fay</div>
							<div class="flex items-center gap-1 text-xs text-gray-500">✅ Delta Dental</div>
						</div>
						<div class="space-y-2 text-xs">
							<div class="flex items-center gap-2 text-gray-700">
								<span class="text-pink-500">●</span> FMX
								<span class="ml-auto text-red-500">Overdue 2/2/2026</span>
							</div>
							<div class="flex items-center gap-2 text-gray-700">
								<span class="text-cyan-500">●</span> Cleaning
								<span class="ml-auto text-red-500">Overdue 1/15/2026</span>
							</div>
						</div>
						<hr class="my-3 border-gray-100" />
						<div class="mb-2 text-xs font-semibold text-gray-700">📅 Scheduled Today</div>
						<div class="space-y-1 text-xs text-gray-600">
							<div class="flex">
								<span class="flex-1"
									>Periodic Exam &nbsp;<span class="text-gray-400">D0120</span></span
								><span class="text-green-600">100% covered</span>
							</div>
							<div class="flex">
								<span class="flex-1"
									>SRP on LR quad &nbsp;<span class="text-gray-400">D4341</span></span
								><span class="text-green-600">90% covered</span>
							</div>
							<div class="flex">
								<span class="flex-1">Estimated out-of-pocket:</span><span
									class="font-semibold text-gray-900">$30</span
								>
							</div>
						</div>
						<div class="mt-3 rounded bg-gradient-to-r from-cyan-50 to-cyan-100 p-3">
							<div class="text-xs font-semibold text-gray-700">🦷 Treatment Findings</div>
							<div class="mt-1 text-xs text-gray-600">
								Restoration predicted <span class="text-[#1890ff]">Tooth #30</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	{/snippet}
</PremiumPlaceholder>
