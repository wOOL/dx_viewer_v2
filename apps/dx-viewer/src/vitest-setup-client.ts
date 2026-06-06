// Component tests mount a single component in isolation, so the root layout's
// svelte-i18n init() never runs — `$_()` would throw "message without setting
// the initial locale". Importing the i18n module initialises it (en default,
// bundled catalogs) before any component renders.
import '$lib/i18n';
