<script lang="ts">
	import PremiumPlaceholder from '$lib/components/PremiumPlaceholder.svelte';
	import { BarChart3 } from 'lucide-svelte';
	import { _ } from 'svelte-i18n';
</script>

<PremiumPlaceholder
	title={$_('nav.insights')}
	icon={BarChart3}
	headline={$_('upsell.insightsHeadline')}
	blurb={$_('upsell.insightsBlurb')}
	footerHeadline={$_('upsell.insightsFooter')}
>
	{#snippet mockup()}
		<div class="rounded-2xl bg-white p-8 shadow-lg shadow-black/5">
			<div class="flex items-start gap-6">
				<div class="w-44 flex-shrink-0">
					<div class="rounded-lg bg-gray-50 p-4 text-center">
						<div class="mb-1 text-[11px] text-gray-500">AI Case Acceptance Rate</div>
						<div class="text-4xl font-semibold text-[#1890ff]">82%</div>
						<div
							class="mt-2 inline-block rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-700"
						>
							+ 39% after BeCertain
						</div>
						<div class="mt-3 rounded-full bg-cyan-50 px-3 py-1 text-[11px] text-cyan-700">
							You're outperforming similar practices by 10%
						</div>
					</div>
				</div>
				<div class="flex-1">
					<div class="flex h-48 items-end gap-1.5">
						{#each [30, 32, 28, 34, 38, 44, 48, 54, 60, 66, 72, 80] as h, i (i)}
							<div
								class="flex-1 rounded-t {i < 4
									? 'bg-gray-300'
									: 'bg-gradient-to-t from-[#1890ff] to-[#69c0ff]'}"
								style:height="{h * 2}px"
							></div>
						{/each}
					</div>
					<div class="mt-1 flex justify-between text-[10px] text-gray-400">
						{#each ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov2', 'Dec2'] as m, i (i)}
							<span>{m.replace(/\d/, '')}</span>
						{/each}
					</div>
				</div>
			</div>
			<hr class="my-6 border-gray-100" />
			<div class="grid grid-cols-4 gap-4 text-[11px] tracking-wide text-gray-500 uppercase">
				<div>Office Name</div>
				<div class="text-center">Patients</div>
				<div class="text-center">Total AI Opportunities</div>
				<div class="text-right">AI Treatment Planning Rate</div>
			</div>
			<div class="mt-2 space-y-1.5 text-xs text-gray-700">
				<div class="grid grid-cols-4 gap-4 py-1">
					<div class="font-semibold">Average</div>
					<div class="text-center">655</div>
					<div class="text-center">851</div>
					<div class="text-right font-semibold text-[#1890ff]">
						17.1% <span class="text-gray-400">(142)</span>
					</div>
				</div>
				<div class="grid grid-cols-4 gap-4 py-1">
					<div>▸ Northwest Dental</div>
					<div class="text-center">770</div>
					<div class="text-center">1,326</div>
					<div class="text-right font-semibold text-[#1890ff]">
						29.2% <span class="text-gray-400">(351)</span>
					</div>
				</div>
				<div class="grid grid-cols-4 gap-4 py-1">
					<div class="pl-4">Karen Lopez</div>
					<div class="text-center">182</div>
					<div class="text-center">309</div>
					<div class="text-right font-semibold text-[#1890ff]">
						28.2% <span class="text-gray-400">(81)</span>
					</div>
				</div>
				<div class="grid grid-cols-4 gap-4 py-1">
					<div class="pl-4">Michael Chen</div>
					<div class="text-center">141</div>
					<div class="text-center">245</div>
					<div class="text-right font-semibold text-[#1890ff]">
						32.8% <span class="text-gray-400">(60)</span>
					</div>
				</div>
			</div>
		</div>
	{/snippet}
</PremiumPlaceholder>
