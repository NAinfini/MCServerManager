# MC Server Manager design

MC Server Manager is the window someone keeps open on a second screen while friends play on a modpack server at home. It should feel like a modern game-platform desktop app, in the family of Steam and Discord: dark, calm and quick to read, with the running server as the subject. Minecraft is a light seasoning in small details, never the costume.

Use the semantic tokens in `src/styles/tokens.css` as the source of truth for colour, type, spacing and radius.

## Layout

A fixed server list on the left and one server workspace on the right. The workspace reads top to bottom:

1. **Header:** server icon, name, loader and version, status, then backup, restart and one primary lifecycle button (start when stopped, stop when running).
2. **Share bar:** the address friends use with a copy button, tunnel state, last and next backup. This is always visible because it is the question asked most often.
3. **Tabs:** Console, Players, Mods, Backups, Files, Automation, Settings, in that order. Keys `1` to `7` switch tabs unless focus is in a text field. Secondary views sit in a small switcher under the tabs and never become a second navigation column.
4. **Task area:** owns all remaining width. The console takes most of it, with a narrow rail for live numbers and who is online.

The console is the default tab. There is no overview page. Performance history, diagnostics and events live in the console's Health view. Application pages (Java, Logs, Settings) sit in the list's footer. Windows may narrow to 960px without page-level overflow; lists and logs scroll inside their own region.

## Visual language

Dark surfaces in three steps: list `--bg-sidebar`, canvas `--bg-app`, panels `--bg-panel`. The console sits on the darkest surface, `--bg-inset`. Separate regions with surface steps and hairlines. Shadows belong only to menus and dialogs.

Green is the one accent: the active tab underline, primary actions and running state. Red is stop and failure, amber is warning, blue is information. Neutral grey carries selection in lists. Every status has a text label as well as a colour.

Type is the system stack from `--font-sans`, with `--font-mono` reserved for logs, commands, addresses and versions users compare. Body text is 13px, secondary 12px, server name 20px semibold. Hierarchy comes from weight and surface, not from uppercase labels.

Controls are 32px tall with 6px corners. The primary lifecycle button is 36px. Panels use 8px corners, dialogs 12px. Do not nest panels.

**The Minecraft seasoning** is limited to pixel icons on the tabs (`PixelIcon`, drawn on a 16px grid with crisp edges), server and mod icons, and ordinary game vocabulary. Never add pixel fonts, bevelled buttons, block textures, landscape backgrounds, or Mojang assets. Mods and packs show their own icon when one exists.

## Interaction rules

- Dropping a pack anywhere opens one confirmation card: everything detected, with evidence, each editable value next to its own Change link, and warnings. EULA consent stays explicit but needs only the final button.
- Show pending operations, real completion, partial failures and restart requirements. A stopping server says it is stopping and offers force stop only after it has been given time.
- Review destructive actions with the affected names and scope. Restore previews describe archive contents.
- Detect changed files before saving, and keep binary files out of text editors.
- Preserve keyboard navigation, visible focus, labelled icon controls and reduced motion.
- Use real data. Unavailable values stay visibly unavailable; placeholders must never imply success.

## Validation

Check the primary flows in the dark theme and that the light theme stays legible. Check 960px and 1280px windows. Keep English and Simplified Chinese complete, since Chinese is the primary use. Verify with focused behaviour tests and the Playwright suite.
