# Slice 9: personal themes

Status: implemented on 2026-09-16; see [implementation and verification notes](../implementation/slice-09-personal-themes.md). This slice precedes release readiness, now Slice 10.

## User outcome

A person opens Appearance from a personal menu in the header, chooses a palette and display mode, and sees the entire tracker update immediately. The choice belongs to their account across all Spaces and devices. Changing appearance preserves the open Task, keyboard focus, and unsaved drafts.

## Agreed choices

| Setting | Choices | Default |
|---|---|---|
| Palette | Nature, Neutral, Tokyo Night | Nature |
| Mode | System, Light, Dark | System |

Nature extends the current green palette with a light variant. Neutral uses grey surfaces with green accents. Tokyo Night adapts the original upstream Night and Light palettes. All three palettes provide both light and dark appearances, giving six rendered combinations.

System mode follows each device's light/dark preference, including changes while Dig is open. Store System as the preference; the resolved appearance is device-specific. A phone and laptop may therefore display different modes for the same account.

The chooser shows labelled previews and clearly identifies the selected palette and mode. A selection applies and saves immediately without a separate Apply button. Palette and mode remain independent controls.

Theme changes affect colours only. Fonts, text sizes, spacing, corners, and layout retain the shared design system. Custom colour editing, palette imports, arbitrary CSS, and Space-administered themes are outside this slice.

## Persistence and application

Persist the palette and mode against the authenticated identity. Apply a change to other tabs for that account in the current browser immediately. Other devices load the saved preference when Dig opens or reloads; this slice does not require a live theme feed between devices.

Use a local appearance cache to avoid a flash of the default theme during startup. Reconcile with the signed-in account's saved preference, including when accounts change in the same browser. Cached display settings must never overwrite a different account's preferences merely because that person signed in. Without a saved preference, use Nature and System.

Apply the theme across sign-in, the app shell, Board, dialogs, reports, settings, native controls, selection, and focus indicators. Theme selection must not reload the page or reconnect the Board. Failed persistence must be visible and recoverable rather than reported as saved.

## Palette source and readability

Use Dig's semantic `--dig-*` colour tokens to map the six palettes onto the existing UI. Browser light/dark control styling must follow the resolved mode. Palette changes do not change the meaning of warning, danger, selection, or focus states.

Tokyo Night's source is the [original project's colour palette](https://github.com/tokyo-night/tokyo-night-vscode-theme#color-palette), using Night for dark mode and Light for light mode. Preserve its recognisable backgrounds and blue/purple accents, while adjusting muted text, borders, warnings, and focus indicators where contrast requires it. Retain Enkia's copyright and the [MIT licence notice](https://github.com/tokyo-night/tokyo-night-vscode-theme/blob/master/LICENSE.txt) with the adapted palette. Storm, Moon, and the Neovim port's Day variant are outside this choice.

Built-in palettes need no theme-file importer. Base16 and design-token interchange formats remain possible later additions; they are not dependencies for this slice.

## Completion evidence

- All six palette/mode combinations cover every current screen, including errors, disabled controls, charts, and drag targets.
- Normal text meets at least 4.5:1 contrast; meaningful control boundaries and focus indicators meet at least 3:1 against adjacent colours. Check actual colour pairs, including hover and selection states.
- The chooser works by keyboard, shows selection without relying solely on colour, and remains usable on phones.
- Reload and sign-in restore account preferences; switching Spaces preserves them. A second browser receives the saved choice on its next load.
- Same-browser tabs update for the same account, while different accounts keep independent settings.
- System mode responds to operating-system changes; explicit Light or Dark stays fixed. Initial rendering uses the cached or default resolved appearance.
- Preference reads and changes enforce account ownership and validate palette/mode values through the real HTTP and database path. Save-failure recovery is exercised.
- Switching themes with a Task or comment draft open preserves its text, focus, and Board state.

Use [UI foundations](design-system.md) for shared components and [the vertical-slice plan](vertical-slice-plan.md) for delivery boundaries. Theme completion does not complete the release gates in Slice 10.
