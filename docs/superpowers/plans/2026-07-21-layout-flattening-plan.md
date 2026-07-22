# Layout Flattening Plan (2026-07-21)

## Problem

The shell stacks too many alternating split layers. Server-detail worst case:

```
.app-shell            rows: titlebar / body / statusbar
└ .app-body           cols: sidebar | main;  rows: runtime-bar / page   ← extra row
  └ main.page         page-header ("SMP Main" + Create Server) / content ← header 1
    └ .server-detail-panel                                               ← wrapper A
      └ .detail-panel  header ("SMP Main" again + Start/Stop/…) / body   ← header 2
        └ .server-detail-workspace   cols: tab rail | content
          └ .detail-tab-content      per-tab vertical splits
```

Symptoms: server name rendered twice, a full-width `TopRuntimeBar` row that
only ever shows a small badge, wrapper-in-wrapper panels, and a dashboard
that nests `.dashboard-workbench > .dashboard-status-rail/.dashboard-primary`
for what is a single vertical flow.

## Target structure

```
.app-shell            rows: titlebar / body / statusbar          (unchanged)
└ .app-body           cols: sidebar | main.page                  (single row)
  └ main.page         ONE context-aware header / content
    ├ overview:  summary-strip → batch actions → cards/table     (flat flow)
    └ detail:    .detail-panel (single header / workspace)
                 workspace = cols: tab rail | content            (unchanged)
```

## Changes

### 1. Delete the TopRuntimeBar row
- Remove `<TopRuntimeBar …>` from `AppShell.tsx`; delete
  `src/components/layout/TopRuntimeBar.tsx`.
- Move the running/crashed badges into `BottomStatusBar` (left group, before
  the Java item). `BottomStatusBar` gains optional `runningCount` /
  `crashedCount` props; AppShell already owns those values and renders it.
  Reuse the existing `runtime.running` / `runtime.crashed` i18n keys and the
  badge visual style (rename CSS classes `runtime-bar-badge*` →
  `status-bar-badge*`, keep colors). Badges appear only when count > 0,
  same as today.
- CSS: `.app-body` becomes a single-row grid
  (`grid-template-columns: var(--sidebar-width) minmax(0, 1fr)`, no
  `grid-template-rows`; keep `min-height: 0`, keep the collapsed variant).
  `.sidebar` drops `grid-row: 1 / -1`; `.page` drops `grid-column/grid-row`
  placements that referenced row 2. Delete `.runtime-bar*` rules.
- `src/styles/preview/shell.css` @media (max-width: 900px): drop
  `.runtime-bar` from the single-column override selector list.
- `src/styles.test.mjs`: update the contract that matches
  `\.runtime-bar,\s*\.sidebar,\s*\.page` to the new selector list; keep the
  `.app-body` min-height/grid contracts otherwise intact.

### 2. Merge the two detail headers into one
- `AppShell.tsx`: when `selectedServer` is set, do NOT render the generic
  `.page-header` section. Render `<ServerDetail server onBack={openServersOverview} />`
  directly (no `.server-detail-panel` wrapper div).
- `ServerDetail.tsx`: accept `onBack?: () => void`. Its `.detail-panel-header`
  becomes the only header: back chevron button (when `onBack` given) +
  server name + existing meta row + existing lifecycle actions/status badge.
  `aria-labelledby` for `main` in detail mode points at the detail header
  name element (give it `id="servers-title"` to keep the existing wiring, or
  update AppShell's aria-labelledby accordingly).
- The "Create Server" button is not rendered in detail mode (it remains on
  the overview header and in the sidebar flow). Keyboard/UX parity: back
  button keeps the `wizard.nav.back` aria-label currently used.
- CSS: delete `.server-detail-panel` rules; keep `.detail-panel` (contract
  test locks its `min-width/min-height: 0`). Ensure `.detail-panel` carries
  the panel surface (bg, radius, shadow) previously on the wrapper.

### 3. Flatten the dashboard overview
- `AppShell.tsx`: replace
  `.dashboard-workbench > aside.dashboard-status-rail > .summary-strip` and
  `.dashboard-primary` with a flat sequence inside the page:
  `section.summary-strip` (keep the aria-label on it) → `BatchActions` →
  cards/table. Remove the `aside` and both wrapper divs.
- `src/styles/preview/pages.css`: delete `.dashboard-workbench`,
  `.dashboard-status-rail`, `.dashboard-primary` rules; move whatever gap
  they provided into a `.page` content stack (e.g. `.page > * + *` margin or
  a `.dashboard-flow` class if a container is unavoidable — prefer zero new
  wrappers).
- Keep `.summary-strip` itself untouched (its item min-height rule moves off
  the deleted rail selector onto `.summary-strip > div`).

### 4. Do NOT touch
- Window titlebar / bottom status bar rows of `.app-shell`.
- The wizard page header block in AppShell (`.create-server-page`), the
  Java/Logger/Settings views (they own their headers already), and the
  vertical tab rail inside detail/settings.
- Electron/backend code, i18n keys other than usages noted above.

## Test/verification requirements (implementer must run all)
1. `pnpm tsc` — zero errors.
2. `pnpm vitest run` — full suite green. Expect to update:
   - `src/styles.test.mjs` responsive-shell contract (runtime-bar selector).
   - `src/components/layout/AppShell.test.tsx` if it queries the removed
     generic detail page-header or TopRuntimeBar output.
   Update assertions to describe the NEW structure; do not delete tests.
3. `pnpm build` — production build passes.
4. Do not start dev servers or Electron; visual review happens afterwards.

## Constraints
- Surgical changes only; no unrelated refactors or reformatting.
- No silent fallbacks; if something in this plan conflicts with reality,
  stop and report rather than improvising a workaround.
- Keep all functionality: batch actions, view mode toggle, create-server
  guard dialogs, drag/drop import, context menus, keyboard navigation.
