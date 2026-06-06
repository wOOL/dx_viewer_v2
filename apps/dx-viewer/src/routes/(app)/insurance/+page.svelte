<script lang="ts">
	import PremiumPlaceholder from '$lib/components/PremiumPlaceholder.svelte';
	import { Shield } from 'lucide-svelte';
	import { _ } from 'svelte-i18n';
</script>

<PremiumPlaceholder
	title={$_('nav.insurance')}
	icon={Shield}
	headline={$_('upsell.insuranceHeadline')}
	blurb={$_('upsell.insuranceBlurb')}
	footerHeadline={$_('upsell.insuranceFooter')}
>
	{#snippet mockup()}
		<div class="rounded-2xl bg-white p-6 text-sm text-gray-700 shadow-lg shadow-black/5">
			<div
				class="grid grid-cols-6 gap-3 border-b border-gray-100 pb-2 text-[10px] tracking-wide text-gray-400 uppercase"
			>
				<div>Patient</div>
				<div>Appointment</div>
				<div>Carrier</div>
				<div>Ins. Remaining</div>
				<div>Deductible</div>
				<div>Status</div>
			</div>
			<div class="grid grid-cols-6 gap-3 py-3 text-xs opacity-50">
				<div>
					<div class="font-medium">Kobe Stanton</div>
					<div class="text-[10px] text-gray-400">#659834783</div>
				</div>
				<div>
					<div>Apr 20, 2026</div>
					<div class="text-[10px] text-gray-400">08:30 AM</div>
				</div>
				<div>○ Delta Dental</div>
				<div>
					<div>$2,000</div>
					<div class="text-[10px] text-gray-400">max $2,000</div>
				</div>
				<div>N/A</div>
				<div>
					<span class="rounded-full bg-pink-100 px-2 py-0.5 text-[10px] text-pink-700"
						>Plan terminated</span
					>
				</div>
			</div>
			<div class="grid grid-cols-6 gap-3 py-3 text-xs">
				<div>
					<div class="font-semibold">Jaquan Crona</div>
					<div class="text-[10px] text-gray-400">#659834783</div>
				</div>
				<div>
					<div>Jan 10, 2026</div>
					<div class="text-[10px] text-gray-400">08:30 AM</div>
				</div>
				<div>● Guardian</div>
				<div>
					<div class="font-semibold">$2,000</div>
					<div class="text-[10px] text-gray-400">max $2,000</div>
				</div>
				<div>$500</div>
				<div>
					<span class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] text-green-700"
						>● Coverage found</span
					>
				</div>
			</div>
			<div class="mx-3 my-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
				<div class="mb-2 text-[10px] tracking-wide text-gray-400 uppercase">
					Planned & Scheduled Treatments
				</div>
				<div class="grid grid-cols-3 gap-2 text-xs">
					<div>Filling <span class="ml-2 text-gray-400">D2330</span></div>
					<div class="col-span-2 text-green-600">✓ 70% covered — eligible as of 1/1/2026</div>
					<div>Periodic Exam <span class="ml-2 text-gray-400">D0120</span></div>
					<div class="col-span-2 text-green-600">✓ 100% covered — next eligibility 7/18/2026</div>
					<div>Sealants <span class="ml-2 text-gray-400">D1351</span></div>
					<div class="col-span-2 text-red-600">✗ Not covered — age exceeding limitation</div>
				</div>
			</div>
			<div class="grid grid-cols-6 gap-3 py-3 text-xs opacity-50">
				<div>
					<div class="font-medium">Brigid Trantow</div>
					<div class="text-[10px] text-gray-400">#659834783</div>
				</div>
				<div>
					<div>Apr 20, 2026</div>
					<div class="text-[10px] text-gray-400">08:30 AM</div>
				</div>
				<div>○ Delta Dental</div>
				<div>
					<div>$2,000</div>
					<div class="text-[10px] text-gray-400">max $2,000</div>
				</div>
				<div>$50</div>
				<div>
					<span class="rounded-full bg-green-100 px-2 py-0.5 text-[10px] text-green-700"
						>● Coverage found</span
					>
				</div>
			</div>
		</div>
	{/snippet}
</PremiumPlaceholder>
