# MC Server Manager design

MC Server Manager is a compact desktop tool for operating local Minecraft servers. The interface should make the current server, its state, and the next useful action immediately clear. The user-selected direction is a dense, readable management workspace.

## Navigation and layout

One sidebar contains the server inventory, the selected server's seven workspace sections, and application settings. Do not add a second vertical navigation rail inside the workspace. The expanded sidebar is 232px wide on a large window; explicit collapse keeps accessible icon buttons. Narrow windows keep readable navigation labels until the user collapses it.

The server header contains identity, loader/version, lifecycle actions, backup, and an explicit upgrade action. A compact connection row identifies the local Minecraft address and links to network settings. Never present localhost as an address friends can use remotely.

The active workspace occupies the remaining width. A single row of child views sits directly above it. Overview, Console, Players, Content, Files & backups, Automation, and Server settings are the primary sections. Overview contains performance, diagnostics, recent events, and online players; avoid repeating overview telemetry in its header.

Marketplace project details replace the browsing surface. Search controls and category filters return when the user goes back. Use a file tree/editor split only where both surfaces support the same task. Avoid permanent context columns and nested splits.

## Visual language

Use the semantic tokens in `src/styles/tokens.css` as the source of truth. Light mode uses a warm off-white canvas and white task surfaces; dark mode uses neutral graphite. Blue means interaction or selection. Green, amber, red, and gray communicate operational states and always have readable text.

Use Segoe UI Variable Text, Segoe UI, and platform sans-serif for interface text. Apply the font to the root; defining a token alone does not apply it. Use Cascadia-compatible monospace for paths, commands, logs, addresses, and values users compare. Body text is approximately 13px, secondary labels 11–12px, section titles 14px, and active server titles 22px. Hierarchy comes from weight, alignment, and spacing.

Use 4px spacing increments, 34–38px controls, restrained 6px control corners, and 8px bounded surfaces. Prefer aligned table rows and flat task regions to repeated cards. Persistent surfaces do not float or animate on hover. Reserve shadows for overlapping menus and dialogs.

## Interaction rules

- Show the current server and content compatibility before installation. Provider, Minecraft version, loader, dependencies, and selected version must be understandable before committing.
- Show pending operations, actual completion, partial failures, and restart requirements. Do not report a successful local update before its backend operation completes.
- Keep selection after a partial batch failure only for the failed items, so retry is deliberate.
- Review destructive actions with the actual affected names and scope. Restore previews describe archive contents, not a guessed world folder.
- Detect changed files before saving, and keep binary files out of text editors.
- Preserve keyboard navigation, visible focus, labeled icon controls, and reduced motion. Status must not depend on color alone.
- Keep narrow layouts free of page-level overflow. Tables and code regions may scroll within their task surface.
- Use real data. Unavailable values and backend errors remain visible; placeholders must never imply success.

## Validation

Check light and dark themes, the primary server workflows, marketplace list/detail transitions, and narrow desktop windows. Confirm actual computed fonts and overflow in a browser. Keep English and Simplified Chinese labels complete. Verify changes with focused behavior tests and the existing integration suite.
