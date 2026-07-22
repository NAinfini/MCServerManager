# Beginner-Friendly UI Redesign — 2026-07-22

Authored by Fable from a live-app audit. **This spec supersedes MASTER.md and all prior
design guidelines in this repo.** Where they conflict, this document wins.

Goal: anyone who can use a computer can run a Minecraft server with this app.
Every page must answer three questions at a glance: *What is this? What's the one
thing I probably want to do? Where do I go next?*

---

## 1. Design tokens (styles.css `:root` rework)

### 1.1 Neutral ramp — ONE gray family, no tint drift
The current UI mixes green-tinted and neutral grays ("app gray is off"). Replace all
surface colors with a single neutral ramp:

| Token | Dark | Usage |
|---|---|---|
| `--bg-app` | `#131417` | window/page background (darkest large area) |
| `--bg-raised` | `#1b1d22` | sidebar, panels, cards — ALL raised surfaces share this |
| `--bg-inset` | `#0f1012` | terminal, code viewers, text inputs |
| `--bg-hover` | `#23252c` | hover rows/items |
| `--border-subtle` | `#282b33` | the only decorative border color |
| `--border-strong` | `#3a3e48` | focus/hover borders, dividers that must read |
| `--text-primary` | `#e8eaed` | |
| `--text-secondary` | `#a0a6b1` | |
| `--text-muted` | `#6d7380` | |

Accent mint `#3ecf8e` stays for primary actions, active nav, success. Status colors:
running = accent, stopped = `--text-muted`, crashed = `#f0565f`, warning = `#e5a13c`.
Light theme: keep existing hue direction but apply the same "one ramp" discipline.

### 1.2 Surface rules — kill card-on-card
- Max TWO surface levels visible in any view: page (`--bg-app`) + panel (`--bg-raised`).
  Inputs/terminals inside a panel use `--bg-inset`.
- A component gets **one** border, on its outermost edge only. Inside a panel, separate
  content with hairline dividers (`border-bottom: 1px solid var(--border-subtle)`) and
  spacing — never nested bordered boxes.
- Radius: panels/cards 10px, inputs/buttons 8px, badges pill.

---

## 2. Full-height layout system

Replace floating fixed-height boxes with flex chains that reach the viewport:

- `.page`, `.server-detail-workspace`, `.detail-tab-content`, and each tab panel become
  `display:flex; flex-direction:column; flex:1; min-height:0`.
- The scroll container is the *content region inside* a panel, not the page.
- Every detail tab (Console, Files, Content, Backups, Settings, Activity) fills the
  viewport height; no dead space below panels.

---

## 3. Server cards (dashboard) — the "two borders, no image" fix

- **Remove the left accent bar and any inner track outline.** One card = one 1px
  `--border-subtle` border on `--bg-raised`, radius 10px. Status is conveyed by badge
  + dot, never by extra borders.
- **Add cover art**: 48×48 rounded (8px) tile at card left. Deterministic gradient
  derived from the loader type (paper→teal, fabric→amber, forge→orange, neoforge→red,
  vanilla/other→slate) with the loader glyph (existing loader icon assets) centered,
  white at 90% opacity. Component: `ServerCover` in `src/components/ui/server-cover.tsx`;
  reuse it in sidebar rows (28px) and detail header (40px).
- Card layout: `[cover] name / loader · version · port` left; status badge top-right.
- Memory bar: only rendered while the server is **running** (live meaning). When
  stopped, show quiet text `RAM up to 8 GB` instead of a dead progress bar.
- Actions: labeled buttons, not icon-only — `Start` (primary when stopped/crashed),
  `Stop`, `Restart` (secondary, auto-disabled per status), overflow `⋯` menu for
  Backup / Open folder. Buttons get visible text labels; icons optional beside text.

---

## 4. Console tab — full-height terminal

- Terminal panel fills the whole tab (flex-1). **Delete the right "Server status /
  Recent warnings" column** — its data moves to a one-line strip in the panel toolbar:
  `● Stopped · 0 events` (dot colored by status). Warnings, when present, render as a
  dismissible amber banner above the output.
- Toolbar (top of panel): status strip left; search field + Clear / Copy / Refresh right.
- Output area: `--bg-inset`, monospace, fills remaining height, autoscroll.
- **Command bar docked at the panel bottom** (same panel, `border-top` divider, always
  visible): input + primary `Send` button. Disabled state keeps the existing explicit
  helper text ("Start the server before sending console commands.").
- Quick commands become plain-language chips directly above the command bar:
  `Who's online` (list), `Save world` (save-all), `Whitelist ▾` (dropdown: reload/on/off),
  `Stop server`. Each chip tooltip shows the real command it sends.

## 5. Files tab — full-height two-pane

- ONE panel containing two panes split by a vertical divider (no two separate bordered
  cards): left = browser (fixed 300px), right = editor (flex-1). Panel fills tab height.
- Top toolbar spans the whole panel: breadcrumb left, `Refresh` + `Open folder`
  (opens rootDir via existing shell command) right.
- File rows: type icon (folder/file), name, size right-aligned, hover `--bg-hover`.
- Editor pane: Monaco fills pane height (not fixed 360px). Empty state centered.

## 6. Content tab — one search, not three

- Panel with two internal tabs: **Installed** | **Browse**.
- *Installed*: table (name, type, version, actions), toolbar `Check updates` `Update all`
  + primary `Add content ▾` (menu: Browse online / Import file…). **Import uses the
  native file picker** (`show_open_dialog`) — no typed paths anywhere on this page.
- *Browse*: ONE search row: source select (Modrinth / Hangar / BBSMC), query input,
  loader + sort selects, `Search` button. Results as a grid/list below (icon, name,
  description, downloads, `Install` button) filling remaining height with scroll.
  CurseForge becomes an `Import downloaded file…` secondary button with file picker
  (API-less reality, but no path typing).
- Empty installed state: compact (max ~160px) with a `Browse content` button.

## 7. Backups tab — action first, config later

- Hero row (not a giant form): primary `Backup Now` + `Last backup: <relative time> ·
  <size>` (or "No backups yet").
- The red stdin banner becomes a neutral info note with plain language: "If the server
  is running, the app pauses world saving for a moment so the backup is safe." Style:
  info (blue-gray), small, with ⓘ icon.
- **Backup list is the main content**: full-height table (date, world, size, actions:
  Restore / Export / Delete).
- "Backup profiles" moves into a collapsed accordion at the bottom: **"Advanced:
  custom backup profiles"**. Inside: compact fields — name (normal width), mode select,
  include/exclude as 3-row textareas with placeholder `one path per line, e.g. world`,
  retention numeric defaulting to 5 with helper "How many backups to keep before the
  oldest is deleted." Row layout, not full-width monoliths.

## 8. Server Settings tab — sectioned, progressive disclosure

- Sticky chip nav at panel top: `Setup · General · Properties · Gamerules · Network ·
  Updates · Advanced` (anchor scroll within the panel).
- Setup checklist: items needing action render expanded with a **direct action button**
  (Java missing → `Open Java Runtimes` navigates there). Done items collapse to one
  compact `✓ label` row each.
- `Advanced` accordion (collapsed by default) contains: Tunnels, Server updates,
  Diagnostics, Profile import/export. Everything inside keeps function but gets compact
  field sizing per §7 style.
- Delete profile stays at the very bottom inside a subtle danger zone divider.

## 9. Beginner copy pass (en.json + zh-CN.json)

Rewrite user-facing jargon (keep domain-standard terms like port/RAM/mod):
- "Retention count" → "Backups to keep"; include/exclude labels get examples.
- Quick command labels per §4; tooltips carry the technical command.
- Status bar `Java: unset` → `Java: not set` and the whole segment becomes a button
  navigating to Java Runtimes when unset.
- Every empty state gains a next-step button (Content→Browse, Backups→Backup Now,
  Console→Start server, Java page→Prepare Java 21).
- Both locales must be updated together; no hardcoded strings in components.

## 10. Out of scope (unchanged)

Wizard flow/geometry, provisioning backend, IPC contracts, marketplace API clients,
process management logic, app Settings page IA (already sectioned; only token/spacing
polish applies), tests for unrelated features.

## 11. Test contract updates

`styles.test.mjs` locks many old values — update contracts to this spec (surface ramp,
single-border cards, full-height chains). Keep wizard connector geometry rules intact.
Update affected component tests (labels/markup). Everything green: `pnpm tsc`,
`pnpm vitest run`, `pnpm build`, both Electron smokes.
