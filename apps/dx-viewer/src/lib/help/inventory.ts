// THE COVERAGE TARGET. Every distinct interactive element / function / keyboard
// action a user can reach in the app. The Help manual (see manual.ts) must document
// each one; help/coverage.test.ts asserts that (the goal's hard STOP condition).
//
// `nameKey` is the i18n key for the control's display name — it REUSES the existing
// catalog key wherever the control already has one (so the manual names match the
// real UI, and we add minimal new strings). Names without an existing key live under
// `help.ctl.*`. Templated/repeated controls (per-class toggles, tooth-chart cells,
// FMX slots) are ONE entry at the granularity a manual actually documents.
//
// Genuinely inert/decorative controls (render but do nothing) are NOT listed here;
// they're acknowledged in coverage.test.ts's KNOWN_INERT allowlist instead.

export interface Interaction {
	id: string;
	area: string;
	nameKey: string;
	/** Experimental (Labs-gated) control: only reachable when an admin has granted the
	 *  account `labs_enabled` AND the relevant per-user toggle (enable3d / enablePhoto /
	 *  enablePanoramic) is on. The Help page hides these unless the viewer has Labs; the
	 *  manual PDF omits them entirely. Set on the controls that live INSIDE an otherwise
	 *  core section (e.g. the experimental upload-modality buttons); a wholly-experimental
	 *  area is flagged at the section level instead (see manual.ts). */
	experimental?: boolean;
}

/** Per-control demo screenshot filename (no extension). Derived from the id so
 *  inventory + shot generator + help page + coverage test agree without a manual map. */
export function shotFor(id: string): string {
	return id.replace(/\./g, '-');
}

/** Version string appended to shot URLs in the help page as `?v=…` so a fresh
 *  deploy bypasses Cloudflare's static-asset cache (`Cache-Control: max-age=14400`).
 *  Bump whenever a shot's content changes (so old browser tabs reload too). */
export const MANUAL_VER = '20260603e';

/** i18n key for the per-control demo body (one-sentence "what it does, what you see"). */
export function bodyKeyFor(id: string): string {
	return `help.demo.${id.replace(/\./g, '_')}`;
}

export const INVENTORY: Interaction[] = [
	// ── Home dashboard (the redesigned /studies landing) ────────────────────
	{ id: 'home.dropzone', area: 'home', nameKey: 'dashboard.dropUpload' },
	{ id: 'home.createPatient', area: 'home', nameKey: 'dashboard.createPatient' },
	{ id: 'home.search', area: 'home', nameKey: 'dashboard.searchPlaceholder' },
	{ id: 'home.recent', area: 'home', nameKey: 'dashboard.recentAnalyses' },
	{ id: 'home.viewAll', area: 'home', nameKey: 'dashboard.viewAll' },
	{ id: 'home.metrics', area: 'home', nameKey: 'dashboard.metrics' },

	// ── Signing in / account creation (public) ──────────────────────────────
	{ id: 'auth.signin.email', area: 'auth', nameKey: 'login.email' },
	{ id: 'auth.signin.password', area: 'auth', nameKey: 'login.password' },
	{ id: 'auth.signin.submit', area: 'auth', nameKey: 'login.signIn' },
	{ id: 'auth.signin.useCode', area: 'auth', nameKey: 'login.signInWithCode' },
	{ id: 'auth.signin.usePassword', area: 'auth', nameKey: 'login.usePassword' },
	{ id: 'auth.otp.sendCode', area: 'auth', nameKey: 'login.sendCode' },
	{ id: 'auth.otp.code', area: 'auth', nameKey: 'login.code' },
	{ id: 'auth.otp.verify', area: 'auth', nameKey: 'login.verifyAndSignIn' },
	{ id: 'auth.otp.requestNew', area: 'auth', nameKey: 'login.requestNewCode' },
	{ id: 'auth.link.createAccount', area: 'auth', nameKey: 'login.createAccount' },
	{ id: 'auth.link.forgot', area: 'auth', nameKey: 'login.forgotPassword' },
	{ id: 'auth.signup.name', area: 'auth', nameKey: 'signup.fullName' },
	{ id: 'auth.signup.email', area: 'auth', nameKey: 'signup.workEmail' },
	{ id: 'auth.signup.confirm', area: 'auth', nameKey: 'signup.confirmPassword' },
	{ id: 'auth.signup.acceptTerms', area: 'auth', nameKey: 'signup.terms' },
	{ id: 'auth.signup.submit', area: 'auth', nameKey: 'signup.submit' },
	{ id: 'auth.forgot.email', area: 'auth', nameKey: 'forgot.title' },
	{ id: 'auth.forgot.submit', area: 'auth', nameKey: 'forgot.submit' },
	{ id: 'auth.forgot.back', area: 'auth', nameKey: 'forgot.backToSignIn' },
	{ id: 'modals.consent.agree', area: 'auth', nameKey: 'consent.agree' },
	{ id: 'modals.consent.decline', area: 'auth', nameKey: 'consent.decline' },

	// ── The workspace (sidebar + top bar, on every page) ────────────────────
	{ id: 'workspace.sidebar.home', area: 'workspace', nameKey: 'nav.home' },
	{ id: 'workspace.sidebar.help', area: 'workspace', nameKey: 'nav.help' },
	{ id: 'workspace.sidebar.theme', area: 'workspace', nameKey: 'theme.toggle' },
	{ id: 'workspace.sidebar.userMenu', area: 'workspace', nameKey: 'nav.userMenu' },
	{ id: 'workspace.menu.account', area: 'workspace', nameKey: 'nav.account' },
	{ id: 'workspace.menu.billing', area: 'workspace', nameKey: 'nav.billing' },
	{ id: 'workspace.menu.settings', area: 'workspace', nameKey: 'nav.settings' },
	{ id: 'workspace.menu.logout', area: 'workspace', nameKey: 'nav.logout' },
	{ id: 'workspace.topbar.search', area: 'workspace', nameKey: 'common.search' },
	{ id: 'workspace.topbar.history', area: 'workspace', nameKey: 'topbar.history' },
	{ id: 'workspace.topbar.historyClear', area: 'workspace', nameKey: 'topbar.clear' },

	// ── Studies dashboard ───────────────────────────────────────────────────
	{ id: 'studies.newStudy', area: 'studies', nameKey: 'common.newStudy' },
	{ id: 'studies.patientCard', area: 'studies', nameKey: 'help.ctl.patientCard' },
	{ id: 'studies.retry', area: 'studies', nameKey: 'common.retry' },
	{ id: 'studies.clearSearch', area: 'studies', nameKey: 'common.clearSearch' },
	{ id: 'studies.pager', area: 'studies', nameKey: 'pager.label' },

	// ── New study (upload) ──────────────────────────────────────────────────
	{ id: 'upload.modXray', area: 'upload', nameKey: 'upload.modXray' },
	{ id: 'upload.modPanoramic', area: 'upload', nameKey: 'upload.modPanoramic', experimental: true },
	{ id: 'upload.modCbct', area: 'upload', nameKey: 'upload.modCbct', experimental: true },
	{ id: 'upload.modIos', area: 'upload', nameKey: 'upload.modIos', experimental: true },
	{ id: 'upload.modPhoto', area: 'upload', nameKey: 'upload.modPhoto', experimental: true },
	{ id: 'upload.name', area: 'upload', nameKey: 'upload.patientName' },
	{ id: 'upload.dob', area: 'upload', nameKey: 'upload.dob' },
	{ id: 'upload.phonePhoto', area: 'upload', nameKey: 'upload.phonePhoto' },
	{ id: 'upload.browse', area: 'upload', nameKey: 'upload.browse' },
	{ id: 'upload.dropzone', area: 'upload', nameKey: 'help.ctl.dropzone' },
	{ id: 'upload.remove', area: 'upload', nameKey: 'upload.remove' },
	{ id: 'upload.run', area: 'upload', nameKey: 'upload.run' },
	{ id: 'upload.cancel', area: 'upload', nameKey: 'common.cancel' },

	// ── Quick-analyze (global drag / paste / screen-capture) + assign banner ─
	{ id: 'quick.drag', area: 'quick', nameKey: 'help.ctl.dragAnalyze' },
	{ id: 'quick.paste', area: 'quick', nameKey: 'help.ctl.pasteAnalyze' },
	{ id: 'quick.screenCapture', area: 'quick', nameKey: 'help.ctl.screenCapture' },
	{ id: 'quick.assign.nameIt', area: 'quick', nameKey: 'quickassign.nameIt' },
	{ id: 'quick.assign.addExisting', area: 'quick', nameKey: 'quickassign.addExisting' },
	{ id: 'quick.assign.keep', area: 'quick', nameKey: 'quickassign.keep' },
	{ id: 'quick.assign.nameInput', area: 'quick', nameKey: 'quickassign.nameLabel' },
	{ id: 'quick.assign.dobInput', area: 'quick', nameKey: 'quickassign.dobLabel' },
	{ id: 'quick.assign.save', area: 'quick', nameKey: 'quickassign.save' },
	{ id: 'quick.assign.search', area: 'quick', nameKey: 'quickassign.searchPlaceholder' },
	{ id: 'quick.assign.assign', area: 'quick', nameKey: 'quickassign.assign' },
	{ id: 'quick.assign.cancel', area: 'quick', nameKey: 'quickassign.cancel' },

	// ── 2D X-ray viewer ─────────────────────────────────────────────────────
	{ id: 'viewer2d.back', area: 'viewer2d', nameKey: 'viewer.back' },
	{ id: 'viewer2d.fmxToggle', area: 'viewer2d', nameKey: 'viewer.fmx', experimental: true },
	{ id: 'viewer2d.tabXrays', area: 'viewer2d', nameKey: 'viewer.xrays' },
	{ id: 'viewer2d.tabPhotos', area: 'viewer2d', nameKey: 'viewer.photos', experimental: true },
	{ id: 'viewer2d.report', area: 'viewer2d', nameKey: 'viewer.report' },
	{ id: 'viewer2d.prev', area: 'viewer2d', nameKey: 'viewer.prevStudy' },
	{ id: 'viewer2d.next', area: 'viewer2d', nameKey: 'viewer.nextStudy' },
	{ id: 'viewer2d.fullFmx', area: 'viewer2d', nameKey: 'viewer.fullFmx', experimental: true },
	{ id: 'viewer2d.arrowKeys', area: 'viewer2d', nameKey: 'help.ctl.arrowPrevNext' },
	{ id: 'viewer2d.zoomIn', area: 'viewer2d', nameKey: 'viewer.zoomIn' },
	{ id: 'viewer2d.zoomOut', area: 'viewer2d', nameKey: 'viewer.zoomOut' },
	{ id: 'viewer2d.fit', area: 'viewer2d', nameKey: 'viewer.fitScreen' },
	{ id: 'viewer2d.actualSize', area: 'viewer2d', nameKey: 'viewer.actualSize' },
	{ id: 'viewer2d.magnifier', area: 'viewer2d', nameKey: 'viewer.magnifier' },
	{ id: 'viewer2d.rotateRight', area: 'viewer2d', nameKey: 'viewer.rotate' },
	{ id: 'viewer2d.flipH', area: 'viewer2d', nameKey: 'viewer.flipH' },
	{ id: 'viewer2d.flipV', area: 'viewer2d', nameKey: 'viewer.flipV' },
	{ id: 'viewer2d.adjust', area: 'viewer2d', nameKey: 'viewer.adjust' },
	{ id: 'viewer2d.invert', area: 'viewer2d', nameKey: 'viewer.invert' },
	{ id: 'viewer2d.toothNumbers', area: 'viewer2d', nameKey: 'viewer.toothNumbersTool' },
	{ id: 'viewer2d.anatomy', area: 'viewer2d', nameKey: 'viewer.anatomyTool' },
	{ id: 'viewer2d.resetAdjust', area: 'viewer2d', nameKey: 'viewer.resetAdjustments' },
	{ id: 'viewer2d.pan', area: 'viewer2d', nameKey: 'help.ctl.dragPan' },
	{ id: 'viewer2d.wheelZoom', area: 'viewer2d', nameKey: 'help.ctl.wheelZoom' },
	{ id: 'viewer2d.adjust.brightness', area: 'viewer2d', nameKey: 'viewer.brightness' },
	{ id: 'viewer2d.adjust.contrast', area: 'viewer2d', nameKey: 'viewer.contrast' },
	{ id: 'viewer2d.adjust.sharpness', area: 'viewer2d', nameKey: 'viewer.sharpness' },
	{ id: 'viewer2d.adjust.saturation', area: 'viewer2d', nameKey: 'viewer.saturation' },
	{ id: 'viewer2d.adjust.reset', area: 'viewer2d', nameKey: 'viewer.reset' },
	{ id: 'viewer2d.findings.allPathology', area: 'viewer2d', nameKey: 'findings.hideAll' },
	{ id: 'viewer2d.findings.classToggle', area: 'viewer2d', nameKey: 'help.ctl.classToggle' },
	{ id: 'viewer2d.editDetections', area: 'viewer2d', nameKey: 'detect.addRect' },

	// ── Full-mouth series (FMX) grid + viewer navigator ─────────────────────
	{ id: 'fmx.grid.slot', area: 'fmx', nameKey: 'help.ctl.fmxSlot', experimental: true },
	{ id: 'fmx.navigator', area: 'fmx', nameKey: 'fmx.navigator' },
	{ id: 'fmx.navigator.pick', area: 'fmx', nameKey: 'fmx.navigatorHint' },

	// ── Camera photos ───────────────────────────────────────────────────────
	{ id: 'photos.add', area: 'photos', nameKey: 'photos.add' },
	{ id: 'photos.view', area: 'photos', nameKey: 'photos.view' },
	{ id: 'photos.delete', area: 'photos', nameKey: 'photos.delete' },
	{ id: 'photos.navigate', area: 'photos', nameKey: 'photos.next' },
	{ id: 'photos.close', area: 'photos', nameKey: 'photos.close' },

	// ── Patient record ──────────────────────────────────────────────────────
	{ id: 'patient.back', area: 'patient', nameKey: 'viewer.back' },
	{ id: 'patient.fmxToggle', area: 'patient', nameKey: 'viewer.fmx', experimental: true },
	{ id: 'patient.dateFilter', area: 'patient', nameKey: 'help.ctl.dateFilter' },
	{ id: 'patient.tabXrays', area: 'patient', nameKey: 'viewer.xrays' },
	{ id: 'patient.tab3d', area: 'patient', nameKey: 'viewer.threeD', experimental: true },
	{ id: 'patient.tabPhotos', area: 'patient', nameKey: 'viewer.photos', experimental: true },
	{ id: 'patient.edit', area: 'patient', nameKey: 'patient.edit' },
	{ id: 'patient.delete', area: 'patient', nameKey: 'patient.delete' },
	{ id: 'patient.addStudy', area: 'patient', nameKey: 'viewer.addStudy' },
	{ id: 'patient.printout', area: 'patient', nameKey: 'viewer.printout' },
	{ id: 'patient.openStudy', area: 'patient', nameKey: 'viewer.openStudy' },
	{ id: 'patient.deleteStudy', area: 'patient', nameKey: 'viewer.delete' },

	// ── CBCT (3D) viewer ────────────────────────────────────────────────────
	{ id: 'cbct.back', area: 'cbct', nameKey: 'viewer.back' },
	{ id: 'cbct.viewMpr', area: 'cbct', nameKey: 'cbct.viewMpr' },
	{ id: 'cbct.view3d', area: 'cbct', nameKey: 'cbct.view3d' },
	{ id: 'cbct.viewPanoramic', area: 'cbct', nameKey: 'cbct.viewPanoramic' },
	{ id: 'cbct.viewReport', area: 'cbct', nameKey: 'cbct.viewReport' },
	{ id: 'cbct.runSegmentation', area: 'cbct', nameKey: 'cbct.runSegmentation' },
	{ id: 'cbct.tool.crosshair', area: 'cbct', nameKey: 'cbct.crosshairTool' },
	{ id: 'cbct.tool.pan', area: 'cbct', nameKey: 'cbct.pan' },
	{ id: 'cbct.tool.wl', area: 'cbct', nameKey: 'cbct.windowLevel' },
	{ id: 'cbct.tool.measure', area: 'cbct', nameKey: 'cbct.linearMeasurement' },
	{ id: 'cbct.tool.angle', area: 'cbct', nameKey: 'cbct.angleMeasurement' },
	{ id: 'cbct.tool.annotate', area: 'cbct', nameKey: 'cbct.annotation' },
	{ id: 'cbct.tool.slab', area: 'cbct', nameKey: 'cbct.slabThickness' },
	{ id: 'cbct.tool.toggleCrosshair', area: 'cbct', nameKey: 'cbct.toggleCrosshair' },
	{ id: 'cbct.tool.resetWL', area: 'cbct', nameKey: 'cbct.resetWindowLevel' },
	{ id: 'cbct.tool.resetAll', area: 'cbct', nameKey: 'cbct.resetAll' },
	{ id: 'cbct.mpr.sliceSlider', area: 'cbct', nameKey: 'help.ctl.sliceSlider' },
	{ id: 'cbct.mpr.wheelScrub', area: 'cbct', nameKey: 'help.ctl.wheelScrub' },
	{ id: 'cbct.mpr.arrowScrub', area: 'cbct', nameKey: 'help.ctl.arrowSlice' },
	{ id: 'cbct.mpr.maximize', area: 'cbct', nameKey: 'cbct.maximizePane' },
	{ id: 'cbct.vol.orbit', area: 'cbct', nameKey: 'help.ctl.orbit' },
	{ id: 'cbct.vol.gizmo', area: 'cbct', nameKey: 'help.ctl.orientGizmo' },
	{ id: 'cbct.vol.selectTooth', area: 'cbct', nameKey: 'help.ctl.selectTooth' },
	{ id: 'cbct.vol.openTooth', area: 'cbct', nameKey: 'help.ctl.openToothConditions' },
	{ id: 'cbct.layers.toggle', area: 'cbct', nameKey: 'help.ctl.layerToggle' },
	{ id: 'cbct.reduceNoise', area: 'cbct', nameKey: 'cbct.reduceNoise' },
	{ id: 'cbct.window', area: 'cbct', nameKey: 'cbct.window' },
	{ id: 'cbct.level', area: 'cbct', nameKey: 'cbct.level' },
	{ id: 'cbct.pano.crosshair', area: 'cbct', nameKey: 'cbct.panoCrosshair' },
	{ id: 'cbct.pano.pan', area: 'cbct', nameKey: 'cbct.panoPan' },
	{ id: 'cbct.pano.ruler', area: 'cbct', nameKey: 'cbct.panoRuler' },
	{ id: 'cbct.pano.slab', area: 'cbct', nameKey: 'cbct.panoSlab' },
	{ id: 'cbct.pano.zoomFit', area: 'cbct', nameKey: 'cbct.panoZoomFit' },
	{ id: 'cbct.pano.overlays', area: 'cbct', nameKey: 'cbct.panoOverlays' },
	{ id: 'cbct.report.print', area: 'cbct', nameKey: 'cbct.printReport' },
	{ id: 'cbct.report.sign', area: 'cbct', nameKey: 'cbct.approveSign' },
	{ id: 'cbct.report.categoryChips', area: 'cbct', nameKey: 'help.ctl.categoryChips' },
	{ id: 'cbct.report.toothChart', area: 'cbct', nameKey: 'help.ctl.toothChart' },
	{ id: 'cbct.report.selectTeeth', area: 'cbct', nameKey: 'cbct.selectTeeth' },
	{ id: 'cbct.card.condition', area: 'cbct', nameKey: 'cbct.condition' },
	{ id: 'cbct.card.comment', area: 'cbct', nameKey: 'cbct.comment' },
	{ id: 'cbct.card.approve', area: 'cbct', nameKey: 'cbct.approve' },
	{ id: 'cbct.modal.sort', area: 'cbct', nameKey: 'help.ctl.conditionSort' },
	{ id: 'cbct.modal.close', area: 'cbct', nameKey: 'cbct.closeConditions' },

	// ── IOS (intraoral scan) viewer ─────────────────────────────────────────
	{ id: 'ios.back', area: 'ios', nameKey: 'viewer.back' },
	{ id: 'ios.runSegmentation', area: 'ios', nameKey: 'ios.runSegmentation' },
	{ id: 'ios.view.anterior', area: 'ios', nameKey: 'ios.anteriorView' },
	{ id: 'ios.view.posterior', area: 'ios', nameKey: 'ios.posteriorView' },
	{ id: 'ios.view.rightBuccal', area: 'ios', nameKey: 'ios.rightBuccal' },
	{ id: 'ios.view.leftBuccal', area: 'ios', nameKey: 'ios.leftBuccal' },
	{ id: 'ios.view.occlusalUpper', area: 'ios', nameKey: 'ios.occlusalUpper' },
	{ id: 'ios.view.occlusalLower', area: 'ios', nameKey: 'ios.occlusalLower' },
	{ id: 'ios.wireframe', area: 'ios', nameKey: 'ios.wireframe' },
	{ id: 'ios.measure', area: 'ios', nameKey: 'ios.measure' },
	{ id: 'ios.clearMeasure', area: 'ios', nameKey: 'ios.clearMeasurements' },
	{ id: 'ios.screenshot', area: 'ios', nameKey: 'ios.screenshot' },
	{ id: 'ios.resetView', area: 'ios', nameKey: 'ios.resetView' },
	{ id: 'ios.layers.all', area: 'ios', nameKey: 'ios.all' },
	{ id: 'ios.layers.upper', area: 'ios', nameKey: 'ios.upper' },
	{ id: 'ios.layers.lower', area: 'ios', nameKey: 'ios.lower' },
	{ id: 'ios.layers.toothToggle', area: 'ios', nameKey: 'help.ctl.layerToggle' },
	{ id: 'ios.toothChart', area: 'ios', nameKey: 'help.ctl.toothChart' },
	{ id: 'ios.selectTooth', area: 'ios', nameKey: 'help.ctl.selectTooth' },

	// ── Settings ────────────────────────────────────────────────────────────
	{ id: 'settings.theme', area: 'settings', nameKey: 'theme.label' },
	{ id: 'settings.language', area: 'settings', nameKey: 'lang.label' },
	{ id: 'settings.toothNumbering', area: 'settings', nameKey: 'settings.toothNumbering' },
	{ id: 'settings.measurementUnit', area: 'settings', nameKey: 'settings.measurementUnit' },
	{ id: 'settings.enable3d', area: 'settings', nameKey: 'settings.enable3d', experimental: true },

	// ── Account ─────────────────────────────────────────────────────────────
	{ id: 'account.name', area: 'account', nameKey: 'signup.fullName' },
	{ id: 'account.mobile', area: 'account', nameKey: 'account.mobile' },
	{ id: 'account.address', area: 'account', nameKey: 'account.address' },
	{ id: 'account.save', area: 'account', nameKey: 'account.save' },

	// ── Billing / subscription ──────────────────────────────────────────────
	{ id: 'billing.subscribe', area: 'billing', nameKey: 'billing.subscribe' },
	{ id: 'billing.cancel', area: 'billing', nameKey: 'billing.cancel' },
	{ id: 'billing.cancelled', area: 'billing', nameKey: 'billing.endsAtPeriodEnd' },
	{ id: 'modals.paywall.viewPlans', area: 'billing', nameKey: 'common.viewPlans' },
	{ id: 'modals.paywall.notNow', area: 'billing', nameKey: 'common.notNow' }
];

/** Ids of experimental controls that live inside an otherwise-core manual section
 *  (wholly-experimental sections are flagged at the section level — see manual.ts).
 *  Used to filter individual demos out of a core section for non-Labs viewers + the PDF. */
const EXPERIMENTAL_ITEM_IDS = new Set(INVENTORY.filter((i) => i.experimental).map((i) => i.id));
export function isExperimentalId(id: string): boolean {
	return EXPERIMENTAL_ITEM_IDS.has(id);
}
