# Slice 9: personal themes

Implemented on 2026-09-16 against [the agreed scope](../design/slice-09-personal-themes.md).

## User behavior

Open the personal menu beside your name, then Appearance. Choose Nature, Neutral, or Tokyo Night independently of System, Light, or Dark mode. Labelled previews and native radio selection work with keyboard navigation. Changes apply immediately and save to the account across every Space. System follows each device’s appearance while explicit modes remain fixed.

The current browser’s tabs update immediately for the same account. Another device restores the saved preference when Dig opens or reloads. Changing colours preserves the open Task, comment drafts, focus, and Board feed. Save failures retain the local selection, show an unsaved message, and offer Retry; closing the chooser leaves a visible route back to the error.

## Ownership and persistence

`IdentityModule.appearance` owns reads and changes. The additive `202609160001_personal_appearance` migration creates `team.identity_appearance`, keyed by authenticated identity with constrained palette/mode values and an integer revision. An absent row represents Nature/System at revision zero. Existing identities require no backfill, and existing Board data is untouched.

`GET /api/appearance` and `POST /api/appearance` use the session identity, never a browser-supplied account ID. Changes validate Origin, CSRF, exact preference fields, and expected revision. Session resolution and the preference operation share a transaction. Compare-and-set writes protect concurrent devices; repeating an uncertain write of the current values succeeds without incrementing the revision. A stale different selection returns a typed conflict containing the current revision.

`AppearanceSession` owns display, persistence status, and synchronization through `AppearanceTransport`. It serializes this tab’s saves and coalesces intermediate choices. Per-choice logical clocks, with operation-ID tie breaking, order concurrent tab selections. Database revisions order persisted writes separately; a newer choice’s failure remains visible even if an older request has already advanced the known revision. Conflicts require an explicit Retry using the latest known revision.

The blocking `public/appearance-init.js` applies whitelisted cached palette/mode values before the application loads. It performs no account write. Account-specific caches prevent a different person’s browser cache from becoming their saved preference. Reads reconcile against the authenticated account without publishing a write. Storage events are scoped to identity, and old-account asynchronous responses are discarded. Local storage failures leave account persistence available; remembering the last Space is also optional.

The Vite API proxy excludes shared contract source modules so the development browser can import the appearance validator. Production bundles the contract normally.

## Colour system and attribution

`src/ui/palettes.css` maps all six combinations to the existing semantic tokens. Fonts, spacing, radii, and layout remain shared. Native control mode, text selection, focus, feedback, chart colours, and meter fills follow the resolved palette. Comment fields use strong boundaries in every palette.

Tokyo Night adapts Enkia’s original [Night and Light colour palettes](https://github.com/tokyo-night/tokyo-night-vscode-theme#color-palette). Muted text, borders, hover colours, and feedback colours are adjusted for contrast. The original MIT notice is retained in `public/licenses/tokyo-night.txt` and distributed at `/licenses/tokyo-night.txt`.

## Verification

The final full suite passed 172 tests across 33 files against disposable PostgreSQL. Production build, lint, and diff checks passed. Standards review found no hard violations; scope review identified two tab-ordering failures, both fixed with regression coverage and re-reviewed.

- Public IdentityModule and real HTTP/PostgreSQL tests cover defaults, persistence across sign-ins, account isolation, revoked sessions, CSRF/Origin, closed value validation, uncertain retries, and stale writes.
- A real HTTP/PostgreSQL browser integration test covers selection, reload, Space changes, draft/focus preservation, and unchanged Board feed count.
- Controller and chooser tests cover rapid selections, failed-save retry, account switching during requests, keyboard controls, OS changes, stale events, and concurrent tab choices with conflict and offline failures.
- Local Chrome checked all six palettes at 1440px and 320px across Board, chooser, drag target, Task, creation, Search, Flow, Workload, workflow settings, Space management, sign-in, setup, and long content: 168 initial screen captures plus 48 final captures covering Inbox, Task Archive, comment fields, and meter colours, with no horizontal document overflow or page errors. Columns remained on one row.
- Real Chrome tabs verified automatic storage events, retained comment text/focus, no Board reconnection, System changes, fixed modes, cached colours before the application module loaded, reload without preference writes, and account saving with local storage blocked.
- 186 computed colour-pair checks passed. Checked normal text has a minimum 4.70:1 ratio; strong control boundaries have a minimum 3.19:1. Decorative separators and disabled controls are excluded; this is not a full accessibility certification.

Release readiness, export, and deployment gates remain Slice 10. This slice adds no theme importer, custom CSS, or Space-managed appearance.
