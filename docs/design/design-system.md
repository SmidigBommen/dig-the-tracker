# Dig UI foundations

The Task dialog establishes the first shared UI components for Dig. The Board remains the working context behind it. Routine edits belong beside their values; secondary actions belong in the actions disclosure.

## Tokens

`src/ui/design-system.css` owns the palette, spacing, typography, radii, and focus treatment. Use its `--dig-*` variables when extending these components.

| Purpose | Token or rule |
|---|---|
| Backgrounds | Canvas, surface, raised surface, and hover surface |
| Text | Primary text for content; muted text for metadata and labels |
| Accent | Pale green for primary actions, selected tabs, and keyboard focus |
| Feedback | Warm red for destructive actions; amber for warnings |
| Spacing | 4, 8, 12, 16, 24, and 32 pixels |
| Typography | 14px body, 13px controls, 12px labels, 11px metadata, 24px Task title |
| Corners | 8px controls, 14px dialog |
| Controls | At least 34px high on desktop and 40px on narrow screens |

## Components

- `Button` provides primary, secondary, ghost, and danger variants. Its default type is `button`; form submission requires `type="submit"`. Keep destructive actions away from primary actions.
- `Dialog` traps keyboard focus, restores focus on close, locks background scrolling, and provides a sticky header. Opening a saved Task focuses the dialog. Creation focuses the title. Nested disclosures consume Escape before the dialog handles it.
- `AutoTextarea` grows with content and recalculates on viewport resize. Saved titles wrap visually and retain a single-line value. Descriptions preserve line breaks.
- `Tabs` provides a labeled tab list, arrow-key navigation, Home/End, and a labeled content panel.

These components own presentation and interaction. Task commands and draft state remain in `BoardSession`.

## Task dialog

The title leads, followed by compact Assignee, Column, and Tag properties. Changing Column saves directly at the end of the destination. Reordering within a Column remains available under `•••`. Mark complete is a header action; alternative closure Outcomes, duplicate references, closing comments, and archive/restore stay in the disclosure.

The description grows with its content. Save status sits beneath it. Subtasks stay near Task content. Comments and History share one activity area; switching tabs retains the comment draft. Conflicts and connection errors remain visible above activity. Archived Tasks stay read-only.

Typing `@` in a comment opens matching Members. Arrow keys and Enter choose a Member; Escape dismisses suggestions. Selection inserts the display name and binds the notification recipient by Member ID. Visible recipient chips show who will be notified and allow removal, including former Members on an existing comment. Recipient chips remain selected when text changes. Remove a chip to stop notifying that Member. Editing text or changing a display name cannot change the selected Member IDs; this also preserves existing separately stored mention bindings. Names in plain text alone do not identify notification recipients.

## Extending the system

Use one primary action per form. Keep labels visible, expose save state, and preserve keyboard focus during live updates. Use the shared palette for every control in a dialog. Check long titles, multiline descriptions, disabled states, conflicts, and narrow viewports when changing layouts. Add shared components when more than one view needs the same interaction; keep Task-specific behavior in `src/views`.
