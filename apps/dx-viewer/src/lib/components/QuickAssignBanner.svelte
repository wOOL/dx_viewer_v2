<script lang="ts">
	import { page } from '$app/state';
	import { studies } from '$lib/stores/studies.svelte';
	import QuickAssignCard from './QuickAssignCard.svelte';

	// Shown whenever the route being viewed belongs to a "quick" (temporary) patient
	// — i.e. just after a one-click drag/paste/screen-capture analysis. Keying the
	// card on the patient id resets its form state when navigating between patients.
	const patientId = $derived(page.params?.patientId);
	const patient = $derived(patientId ? studies.getPatient(patientId) : undefined);
</script>

{#if patient?.quick}
	{#key patient.id}
		<QuickAssignCard {patient} />
	{/key}
{/if}
