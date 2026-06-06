<script lang="ts">
	import { page } from '$app/state';
	import TopBar from '$lib/components/TopBar.svelte';
	import { studies } from '$lib/stores/studies.svelte';
	import { auth } from '$lib/stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import IosWorkspace from '$lib/components/ios/IosWorkspace.svelte';
	import { history } from '$lib/stores/history.svelte';
	import { studyRoutePath, studyBelongsOnRoute } from '$lib/studyRoute';

	const patientId = $derived(page.params.patientId);
	const studyId = $derived(page.params.studyId);
	const patient = $derived(studies.getPatient(patientId!));
	const study = $derived(studies.getStudy(patientId!, studyId!));

	// A non-IOS study (X-ray / panoramic / photo / CBCT) reached on this route by
	// bookmark, typed address, or a hand-edited id would mount IosWorkspace on data
	// it can't parse (a JPEG, or a CBCT volume) — failing the mesh load AND exposing
	// a "Run AI Segmentation" CTA that would bill a paid IOS seg on the wrong file.
	// Redirect it to its real viewer instead (symmetric to the 2D viewer's guard).
	// Loop-safe: only fires for a modality that genuinely isn't this route's, and at
	// most once per study id; the route we send to is exactly where it belongs.
	const wrongModality = $derived(!!study && !studyBelongsOnRoute(study.modality, 'ios'));
	let redirectedFor = $state('');
	$effect(() => {
		if (wrongModality && study && redirectedFor !== study.id) {
			redirectedFor = study.id;
			// eslint-disable-next-line svelte/no-navigation-without-resolve -- studyRoutePath() is resolve()-backed
			void goto(studyRoutePath(study.modality, patientId!, study.id), { replaceState: true });
		}
	});

	// 3D gate: when the user hasn't enabled CBCT/IOS tools, the 3D viewer is hidden
	// entirely — a bookmarked / history / typed `/ios/…` link must not mount the
	// workspace. Bounce to the patient record (which itself hides the 3D tab), or to
	// /studies if the patient can't be resolved. This is the route-level choke point;
	// hiding tabs/tiles + rejecting 3D uploads are presentational layers on top.
	let gatedRedirect = $state(false);
	$effect(() => {
		if (!auth.threeDEnabled && !gatedRedirect) {
			gatedRedirect = true;
			void goto(
				patientId
					? resolve('/(app)/patients/[patientId]', { patientId })
					: resolve('/(app)/studies'),
				{ replaceState: true }
			);
		}
	});

	onMount(async () => {
		// Catch so a transient load failure falls through to the redirect rather
		// than stranding the viewer on its loading state (see #56).
		if (studies.patients.length === 0) {
			try {
				await studies.refresh();
			} catch {
				/* fall through to the redirect */
			}
		}
		if (!study) {
			goto(resolve('/(app)/studies'));
			return;
		}
		initialLoadDone = true;
	});

	// Deleted-while-open: another tab deleting this study now PROPAGATES (the cross-tab
	// change channel refreshes the projection) and would strand this viewer on its
	// loading state forever — leave with the same redirect once the projection settles.
	let initialLoadDone = $state(false);
	$effect(() => {
		if (initialLoadDone && !studies.loading && !study) goto(resolve('/(app)/studies'));
	});

	let recorded = '';
	$effect(() => {
		if (patient && study && study.id !== recorded) {
			recorded = study.id;
			history.record({
				patientId: patientId!,
				studyId: study.id,
				patientName: patient.name,
				modality: study.modality,
				kind: 'ios'
			});
		}
	});
</script>

{#if patient && study && !wrongModality && auth.threeDEnabled}
	<TopBar title="" showSearch={false} />
	<!-- Key on study id so navigating between IOS studies on the same route (e.g. via
	     the History menu) remounts the workspace and reloads the correct mesh. -->
	{#key study.id}
		<IosWorkspace {patient} {study} patientId={patientId!} />
	{/key}
{:else}
	<!-- Spinner doubles as the wrong-modality transient state: the $effect above is
	     navigating away to the correct viewer, so we just avoid mounting IosWorkspace
	     on an unparseable study in the meantime. -->
	<div class="flex h-full items-center justify-center">
		<span class="spinner text-3xl text-fg-2"></span>
	</div>
{/if}
