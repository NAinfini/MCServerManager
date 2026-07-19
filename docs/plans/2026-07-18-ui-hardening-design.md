# UI Hardening Design

## Context

The application-wide UI audit found release-blocking problems in the Java runtime panel, theme contrast, accessible names, wizard progress semantics, and sidebar context-menu keyboard behavior. The server creation, installation, EULA, and launch flows are already outside this change and must remain behaviorally unchanged.

## Goals

- Keep every Java runtime action and status inside the managed-runtime panel at supported window sizes and in both languages.
- Meet WCAG AA contrast for subtle text and marketplace metadata in dark and light themes.
- Give icon-only view controls accessible names without changing mouse focus behavior.
- Represent wizard progress semantically while keeping completed steps navigable.
- Make server and group context menus operable with a keyboard and return focus when they close.

## Non-goals

- Changing server provisioning, loader detection, EULA confirmation, or launch behavior.
- Reworking server-status polling or adding log virtualization; those require separate backend/API performance work.
- Redesigning the visual language or replacing the existing component system.

## Considered Approaches

### 1. Patch only the reported Java clipping

Add padding to the Java panel and stop. This is the smallest diff, but it leaves confirmed accessibility and theme failures in the same release surface.

### 2. Targeted UI hardening (selected)

Fix the confirmed issues with small component-level and token-level changes. Reuse the existing spacing scale and component vocabulary, add focused regression tests, and preserve all feature behavior. This covers the release risks without expanding into an architectural refactor.

### 3. Full design-system and performance refactor

Replace ad-hoc semantics, aggregate status queries, virtualize logs, and consolidate all color roles at once. This has a larger regression surface and mixes backend performance work with the UI defects, so it is deferred.

## Design

### Java managed-runtime panel

Keep the panel header unchanged. Wrap the description, action links, preparation button, errors, and install consent in a dedicated `.java-panel-body`. The body uses the existing spacing tokens, can shrink inside the grid, and wraps action rows instead of clipping them. Nested compatibility content loses redundant outer padding so the panel does not become a card inside a card.

### Theme and status tokens

Raise `--text-subtle` in each theme until normal text and placeholders meet 4.5:1 against their actual surfaces. Define the missing `--success` semantic token from the established running/success color role. Add light-theme metadata badge overrides with darker foregrounds and restrained tinted backgrounds; dark-theme badge styling remains unchanged.

### Accessible controls and wizard progress

Add localized accessible names to the card and table icon buttons while retaining the existing group label and `aria-pressed` state. Render wizard progress as an ordered list: completed navigable steps are buttons, while the active and future steps are non-interactive elements. The active item keeps `aria-current="step"`; no disabled control remains in the tab model.

### Sidebar context menu

Store the element that opened the menu, focus the first menu item after the menu mounts, and support Arrow Up, Arrow Down, Home, End, Escape, and Tab. Escape closes the menu and restores focus to its trigger. Server and group triggers expose `aria-haspopup="menu"` and an accurate `aria-expanded` value. Mouse behavior and drag-and-drop remain unchanged.

## Testing

- Component tests verify Java body grouping, localized icon names, semantic wizard steps, and context-menu focus navigation.
- CSS contract tests verify required tokens and contrast ratios in both themes.
- Existing focused tests, the full unit suite, type checking, production build, Electron smoke tests, and browser checks cover regressions.
- Browser verification includes Chinese and English, dark and light themes, narrow supported width, keyboard-only navigation, and pointer-versus-keyboard focus behavior.

## Risks and Mitigations

- Changing wizard markup may disturb header layout. Preserve existing class names and run the wizard header layout and progress tests.
- Stronger subtle text may reduce visual hierarchy. Change only the lowest text token and keep muted/main roles intact.
- Menu focus management can conflict with outside-click closing. Centralize closure and explicitly distinguish focus restoration from ordinary outside clicks.

