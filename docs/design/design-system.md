# Dig UI foundations

Dig uses a shared control scale and six personal colour palettes across the app shell, Board, Task dialogs, reports, and Space settings. The Board remains the working context behind a Task dialog. Routine edits belong beside their values; secondary actions belong in the actions disclosure.

## Tokens

`src/ui/palettes.css` owns Nature, Neutral, and Tokyo Night in light and dark modes. `src/ui/design-system.css` owns spacing, typography, radii, and focus treatment. Use its `--dig-*` variables when extending these components.

| Purpose | Token or rule |
|---|---|
| Backgrounds | Canvas, recessed Columns and fields, surface cards, raised controls, and hover surface |
| Text | Primary text for content; muted text for metadata and labels |
| Accent | Green (Nature/Neutral) or blue (Tokyo Night) for primary actions, selected tabs, keyboard focus, and drop targets |
| Feedback | Warm red for destructive actions; amber for warnings |
| Spacing | 4, 8, 12, 16, 24, and 32 pixels |
| Typography | 15px body, 14px controls, 13px labels, 12px metadata, 24px Task title; page headings scale from 26 to 32px |
| Corners | 8px controls, 14px dialog |
| Controls | Shared buttons and fields are at least 40px high on desktop and 44px on narrow screens; phone form fields use 16px text |

All colours belong in the shared tokens. Canvas, Columns, and cards have distinct surfaces, so the hierarchy remains visible without heavy shadows. Use `--dig-border-strong` for field boundaries. Reserve amber for warnings and warm red for destructive actions; an Active Column within its WIP limit uses the active token and a neutral limit label.

Across all six palettes, checked text pairs have at least 4.70:1 contrast, including muted labels, selected and hover surfaces, feedback, and primary-button text. Strong control boundaries have at least 3.19:1 contrast against adjacent field and surface colours. Focus uses the accent token. These are computed token-pair checks, not a full accessibility certification; disabled controls and decorative separators are excluded.

## Components

- `Button` provides primary, secondary, ghost, and danger variants. Its default type is `button`; form submission requires `type="submit"`. Keep destructive actions away from primary actions.
- `Dialog` traps keyboard focus, restores focus on close, locks background scrolling, and provides a sticky header. Opening a saved Task focuses the dialog. Creation focuses the title. Nested disclosures consume Escape before the dialog handles it.
- `AutoTextarea` grows with content and recalculates on viewport resize. Saved titles wrap visually and retain a single-line value. Descriptions preserve line breaks.
- `Tabs` provides a labeled tab list, arrow-key navigation, Home/End, and a labeled content panel.

These components own presentation and interaction. Task commands and draft state remain in `BoardSession`.

The app shell's existing `primary-button`, `quiet-button`, and `danger-button` classes share the same button rules. Do not give them a separate palette or size scale. Global text selection, focus outlines, native options, and scrollbars also use the tokens.

## Layout and readability

The Space name and Member/time-zone metadata form one heading group. Space administration uses the same control size as Board actions; Leave Space is a quiet destructive action after the ordinary actions.

Board Columns always stay in one horizontally scrolling row. Cards use 15px titles, 12px keys and tags, and 24px assignee avatars. Long content wraps inside its card. Keep visible Column borders and an accent outline plus selected surface on the current drop target.

On phones, header controls wrap, Task properties stack, and search and workload rows put age beneath the Task text. Tables scroll inside their own region. Chart dates and peak labels are HTML text so they retain their size when the chart shrinks. Keep native form controls large enough to avoid automatic text-field zoom on phones.

## Task dialog

The title leads, followed by compact Assignee, Column, and Tag properties. Changing Column saves directly at the end of the destination. Reordering within a Column remains available under `•••`. Mark complete is a header action; alternative closure Outcomes, duplicate references, closing comments, and archive/restore stay in the disclosure.

The description grows with its content. Save status sits beneath it. Subtasks stay near Task content. Comments and History share one activity area; switching tabs retains the comment draft. Conflicts and connection errors remain visible above activity. Archived Tasks stay read-only.

Typing `@` in a comment opens matching Members. Arrow keys and Enter choose a Member; Escape dismisses suggestions. Selection inserts the display name and binds the notification recipient by Member ID. Visible recipient chips show who will be notified and allow removal, including former Members on an existing comment. Recipient chips remain selected when text changes. Remove a chip to stop notifying that Member. Editing text or changing a display name cannot change the selected Member IDs; this also preserves existing separately stored mention bindings. Names in plain text alone do not identify notification recipients.

## Extending the system

Use one primary action per form. Keep labels visible, expose save state, and preserve keyboard focus during live updates. Use the shared palette for every control in a dialog. Check long titles, multiline descriptions, disabled states, conflicts, and narrow viewports when changing layouts. Add shared components when more than one view needs the same interaction; keep Task-specific behavior in `src/views`.

## Personal themes

Personal menu → Appearance uses labelled palette previews and native radio groups for Palette and Mode. Choices apply and save immediately. System follows the device; Light and Dark remain fixed. Theme changes affect colour tokens only, preserving layout, fonts, open work, and focus. Keep every new screen on the semantic tokens and verify all six combinations. Persistence and recovery belong to `AppearanceSession`; see [Slice 9 notes](../implementation/slice-09-personal-themes.md).

Tokyo Night adapts the original Enkia Night and Light palettes with readability adjustments. The distributed MIT attribution is in `public/licenses/tokyo-night.txt`.
