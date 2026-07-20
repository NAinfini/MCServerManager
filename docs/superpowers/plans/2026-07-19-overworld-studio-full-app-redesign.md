# Overworld Studio Full-App Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 MC Server Manager 的现有 React/Electron 界面统一为已批准的 Overworld Studio 双主题设计，同时保留完整服务器创建、管理、市场、Java 和日志能力。

**Architecture:** 继续使用 `AppShell` 的页面状态、Zustand 的服务器标签状态、TanStack Query 的数据边界和现有 Electron command API。视觉系统集中在 `src/styles.css` 的语义变量和页面布局类中，行为变更仅扩展现有 React 组件；不引入路由库或新 UI 框架。

**Tech Stack:** React 19、TypeScript 5.8、Vite 7、Electron 39、Radix UI、TanStack Query、Zustand、Vitest、Testing Library。

## Global Constraints

- 全局侧栏只保留服务器、Java 运行时、应用日志和设置；市场只能出现在创建或编辑模组包上下文。
- 支持浅色、深色、跟随系统；两种主题功能和状态含义一致。
- EULA 只能由用户明确确认，不能默认勾选或自动接受。
- BBSMC 公共直链可选择；外部网盘版本禁用直接安装并说明手动下载；不伪造关注数。
- 命令建议第一阶段标为内置命令目录，不声称来自当前服务端。
- 只使用 `:focus-visible` 提供键盘焦点；鼠标点击不保留同样焦点环。
- 不新增 CurseForge API 密钥，不改写数据库、安装器或进程管理契约。

---

### Task 1: Theme Tokens and App Shell

**Files:**
- Modify: `src/styles.css`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/components/layout/Sidebar.tsx`
- Test: `src/components/layout/AppShell.test.tsx`
- Test: `src/styles.test.mjs`

**Interfaces:**
- Consumes: existing `ThemeSetting`, `activePage`, `selectedServerId`, `useSidebarStore`.
- Produces: semantic CSS variables, stable `.app-shell/.app-body/.page` grid, global navigation without marketplace.

- [ ] **Step 1: Write failing shell and style contract tests**

```tsx
it("renders only the approved global destinations", () => {
  renderShell();
  expect(screen.getByRole("button", { name: /servers/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /java/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /logs/i })).toBeVisible();
  expect(screen.getByRole("button", { name: /settings/i })).toBeVisible();
  expect(screen.queryByRole("button", { name: /market/i })).not.toBeInTheDocument();
});
```

```js
expect(css).toMatch(/--surface-raised:/);
expect(css).toMatch(/\.app-body\s*\{[^}]*min-height:\s*0/s);
expect(css).toMatch(/\.page\s*\{[^}]*min-width:\s*0/s);
expect(css).not.toMatch(/body\s*\{[^}]*min-height:\s*720px/s);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run src/components/layout/AppShell.test.tsx src/styles.test.mjs`

Expected: FAIL because semantic variables and the new shell contracts are absent.

- [ ] **Step 3: Implement semantic tokens and shell structure**

```css
:root {
  --canvas: #121816;
  --surface: #171f1c;
  --surface-raised: #1d2723;
  --border-subtle: #303d37;
  --text-primary: #edf1ef;
  --text-secondary: #87968f;
  --accent: #69c294;
  --accent-warm: #d2b968;
  --danger: #df7b71;
  --focus-ring: #e1c86e;
}

[data-theme="light"] {
  --canvas: #f2f1eb;
  --surface: #faf8f2;
  --surface-raised: #ffffff;
  --border-subtle: #d4d0c5;
  --text-primary: #25322c;
  --text-secondary: #6f7873;
}

.app-body,
.page {
  min-width: 0;
  min-height: 0;
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run src/components/layout/AppShell.test.tsx src/styles.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit checkpoint**

```bash
git add src/styles.css src/components/layout/AppShell.tsx src/components/layout/Sidebar.tsx src/components/layout/AppShell.test.tsx src/styles.test.mjs
git commit -m "feat: establish Overworld Studio app shell"
```

### Task 2: Dashboard and Server Workspace

**Files:**
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/features/servers/ServerCardView.tsx`
- Modify: `src/features/servers/ServerList.tsx`
- Modify: `src/features/servers/ServerDetail.tsx`
- Modify: `src/features/console/ConsoleView.tsx`
- Modify: `src/features/console/CommandSuggestions.tsx`
- Modify: `src/styles.css`
- Test: `src/features/servers/ServerDetail.test.tsx`
- Test: `src/features/console/ConsoleView.test.tsx`
- Test: `src/features/console/CommandSuggestions.test.tsx`

**Interfaces:**
- Consumes: `ServerProfile`, `ServerDetailTab`, `MC_COMMANDS`, process queries.
- Produces: fixed server identity header, six-tab workspace, console side rail, keyboard-complete command picker.

- [ ] **Step 1: Write failing server workspace and command keyboard tests**

```tsx
it("keeps all six server workspaces available", () => {
  render(<ServerDetail server={server} />);
  for (const name of [/console/i, /files/i, /content/i, /backups/i, /settings/i, /activity/i]) {
    expect(screen.getByRole("tab", { name })).toBeVisible();
  }
});

it("accepts a highlighted command with Tab", async () => {
  render(<ConsoleView serverId="server-1" />);
  const input = screen.getByLabelText(/command/i);
  await user.type(input, "/wh");
  await user.keyboard("{Tab}");
  expect(input).toHaveValue("/whitelist");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run src/features/servers/ServerDetail.test.tsx src/features/console/ConsoleView.test.tsx src/features/console/CommandSuggestions.test.tsx`

Expected: FAIL because Tab selection and redesigned workspace semantics are missing.

- [ ] **Step 3: Add focused command suggestion API**

```ts
interface CommandSuggestionSelection {
  command: string;
  method: "keyboard" | "pointer";
}

interface CommandSuggestionsProps {
  input: string;
  visible: boolean;
  sourceLabel: string;
  onSelect: (selection: CommandSuggestionSelection) => void;
}
```

Handle `Tab`, `ArrowUp`, `ArrowDown`, `Enter`, and `Escape` in the input-owned keyboard path so only the active console captures keys. Render the source label as the localized equivalent of “Built-in command catalog”.

- [ ] **Step 4: Implement workspace layout and styles**

```css
.server-detail-workspace {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
}

.console-workspace {
  min-height: 0;
  grid-template-columns: minmax(0, 1fr) 18rem;
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm vitest run src/features/servers/ServerDetail.test.tsx src/features/console/ConsoleView.test.tsx src/features/console/CommandSuggestions.test.tsx`

Expected: PASS.

### Task 3: Create Wizard and Contextual Marketplace

**Files:**
- Modify: `src/features/servers/CreateServerWizard.tsx`
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.tsx`
- Modify: `src/features/marketplace/ServerMarketplaceView.tsx`
- Modify: `src/features/marketplace/ProjectDetails.tsx`
- Modify: `src/features/marketplace/MarketplaceMarkdown.tsx`
- Modify: `src/styles.css`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Test: `src/features/servers/CreateServerWizard.test.tsx`
- Test: `src/features/servers/CreateServerMarketplaceBrowser.test.tsx`
- Test: `src/features/marketplace/MarketplaceMarkdown.test.tsx`

**Interfaces:**
- Consumes: existing `MarketplaceCreateSelection`, provider queries, BBSMC installability fields, wizard lifecycle.
- Produces: contextual market tabs, big-card results, safe detail layout, unchanged provisioning selection contract.

- [ ] **Step 1: Write failing contextual market tests**

```tsx
it("renders marketplace as a source inside the create wizard", async () => {
  renderWizard();
  await user.click(screen.getByRole("button", { name: /browse marketplace/i }));
  expect(screen.getByRole("searchbox")).toBeVisible();
  expect(screen.getByTestId("marketplace-card-grid")).toBeVisible();
});

it("keeps external-only BBSMC versions unavailable", () => {
  renderMarketplaceWith(bbsmcExternalVersion);
  expect(screen.getByRole("button", { name: /manual download/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run src/features/servers/CreateServerWizard.test.tsx src/features/servers/CreateServerMarketplaceBrowser.test.tsx src/features/marketplace/MarketplaceMarkdown.test.tsx`

Expected: FAIL because grid semantics and contextual source tabs are missing.

- [ ] **Step 3: Implement large card result structure**

```tsx
<div className="marketplace-card-grid" data-testid="marketplace-card-grid">
  {projects.map((project) => (
    <article className="marketplace-project-card" key={project.id}>
      <MarketplaceProjectIcon project={project} provider={provider} />
      <div className="marketplace-project-card-body">…</div>
    </article>
  ))}
</div>
```

Do not render a featured banner or global market navigation. Do not render missing BBSMC follower data as zero.

- [ ] **Step 4: Implement detail media and version constraints**

```css
.marketplace-gallery-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.marketplace-version-row {
  min-width: 0;
  grid-template-columns: minmax(0, 1fr) auto;
}

.marketplace-markdown img {
  max-width: 100%;
  height: auto;
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm vitest run src/features/servers/CreateServerWizard.test.tsx src/features/servers/CreateServerMarketplaceBrowser.test.tsx src/features/marketplace/MarketplaceMarkdown.test.tsx`

Expected: PASS.

### Task 4: Settings Side Menu and Themes

**Files:**
- Modify: `src/features/settings/SettingsView.tsx`
- Modify: `src/features/settings/SettingsView.test.tsx`
- Modify: `src/i18n/index.ts`
- Modify: `src/i18n/index.test.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: existing `SettingsSection`, preferences persistence, `ThemeSetting`.
- Produces: permanent local side menu, visual theme cards, unchanged saved preference payload.

- [ ] **Step 1: Write failing side-menu and theme tests**

```tsx
it("uses a secondary side navigation for settings categories", () => {
  render(<SettingsView />);
  const nav = screen.getByRole("navigation", { name: /settings categories/i });
  expect(within(nav).getByRole("button", { name: /appearance/i })).toBeVisible();
  expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test and verify RED**

Run: `pnpm vitest run src/features/settings/SettingsView.test.tsx src/i18n/index.test.tsx`

Expected: FAIL until navigation semantics and visual selectors match the approved layout.

- [ ] **Step 3: Implement local menu and theme previews**

```tsx
<nav className="settings-nav" aria-label={t("settings.nav.aria")}>
  {NAV_ITEMS.map(({ key, icon: Icon, labelKey }) => (
    <button aria-current={activeSection === key ? "page" : undefined} onClick={() => setActiveSection(key)}>
      <Icon aria-hidden="true" />
      <span>{t(labelKey)}</span>
    </button>
  ))}
</nav>
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run src/features/settings/SettingsView.test.tsx src/i18n/index.test.tsx`

Expected: PASS.

### Task 5: Java Runtimes and App Logs

**Files:**
- Modify: `src/features/java/JavaRuntimesView.tsx`
- Modify: `src/features/java/JavaRuntimesView.test.tsx`
- Modify: `src/features/logger/AppLoggerView.tsx`
- Modify: `src/features/logger/AppLoggerView.test.tsx`
- Modify: `src/styles.css`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`

**Interfaces:**
- Consumes: existing runtime queries and install mutations, logger query/filter/clear commands.
- Produces: runtime compatibility dashboard and three-pane grouped log experience without backend contract changes.

- [ ] **Step 1: Write failing Java and logger structure tests**

```tsx
it("keeps managed install consent and official Java link distinct", () => {
  render(<JavaRuntimesView />);
  expect(screen.getByRole("checkbox", { name: /Temurin/i })).not.toBeChecked();
  expect(screen.getByRole("link", { name: /Oracle Java/i })).toBeVisible();
});

it("opens the selected long log message in a detail pane", async () => {
  render(<AppLoggerView />);
  await user.click(screen.getByText(longError));
  expect(screen.getByRole("complementary", { name: /log details/i })).toHaveTextContent(longError);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run src/features/java/JavaRuntimesView.test.tsx src/features/logger/AppLoggerView.test.tsx`

Expected: FAIL because logger detail selection and revised runtime structure are absent.

- [ ] **Step 3: Implement main-content Java cards and logger selection**

```ts
const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null);
const selectedEntry = entries.find((entry) => entry.id === selectedEntryId) ?? entries[0] ?? null;
```

Group only entries with the same level, source, message, and stack signature; otherwise preserve separate rows.

- [ ] **Step 4: Apply clipping-safe layouts**

```css
.java-runtime-path,
.logger-entry-message {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.logger-layout {
  min-height: 0;
  grid-template-columns: 10rem minmax(0, 1fr) 21rem;
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `pnpm vitest run src/features/java/JavaRuntimesView.test.tsx src/features/logger/AppLoggerView.test.tsx`

Expected: PASS.

### Task 6: Safety States, Accessibility, and Responsive Contracts

**Files:**
- Modify: `src/components/ui/ConfirmDangerDialog.tsx`
- Modify: `src/features/servers/CreateServerWizard.tsx`
- Modify: `src/styles.css`
- Modify: `src/styles.test.mjs`
- Test: `src/features/servers/CreateServerWizard.test.tsx`
- Test: `src/components/ui/ConfirmDangerDialog.test.tsx`

**Interfaces:**
- Consumes: existing draft/running/complete lifecycle and Radix Dialog focus management.
- Produces: explicit EULA gating, draft-exit confirmation, background-task messaging, focus-visible contracts.

- [ ] **Step 1: Write failing safety tests**

```tsx
it("does not enable installation before explicit EULA consent", async () => {
  renderWizardAtReview();
  expect(screen.getByRole("button", { name: /install and start/i })).toBeDisabled();
  await user.click(screen.getByRole("checkbox", { name: /EULA/i }));
  expect(screen.getByRole("button", { name: /install and start/i })).toBeEnabled();
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `pnpm vitest run src/features/servers/CreateServerWizard.test.tsx src/components/ui/ConfirmDangerDialog.test.tsx src/styles.test.mjs`

Expected: FAIL for missing new safety and style contracts.

- [ ] **Step 3: Implement safety copy and CSS contracts**

```css
:where(button, a, input, select, textarea):focus { outline: none; }
:where(button, a, input, select, textarea):focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 2px;
}

@media (max-width: 1100px) {
  .marketplace-card-grid { grid-template-columns: 1fr; }
  .marketplace-detail-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `pnpm vitest run src/features/servers/CreateServerWizard.test.tsx src/components/ui/ConfirmDangerDialog.test.tsx src/styles.test.mjs`

Expected: PASS.

### Task 7: Full Regression and Electron Visual Smoke

**Files:**
- Modify only files required by failures proven in this task.
- Test: all existing Vitest and Electron smoke suites.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: verified production build and desktop behavior.

- [ ] **Step 1: Run complete renderer and backend tests**

Run: `pnpm vitest run`

Expected: all tests PASS with zero unhandled errors.

- [ ] **Step 2: Run production build**

Run: `pnpm build`

Expected: TypeScript and Vite exit 0.

- [ ] **Step 3: Run Electron smoke tests**

Run: `pnpm test:electron-smoke`

Run: `pnpm test:electron-ui-smoke`

Expected: both exit 0.

- [ ] **Step 4: Perform browser visual matrix**

Verify at 1280×720, 1440×900, and 1920×1080 in both light and dark modes:

```text
Dashboard → Server detail → Console autocomplete
Create server → Marketplace → Project detail → EULA
Settings → Appearance → Java runtimes → App logs
```

Expected: no clipped labels, horizontal page scroll, unexplained empty footer space, nested media scrollbars, or mouse-only focus rings.

- [ ] **Step 5: Run final diff checks**

Run: `git diff --check`

Run: `git status --short`

Expected: no whitespace errors; only intentional redesign files are modified.
