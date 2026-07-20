# Inline Pages and Marketplace Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Java/设置迁入主内容区，修正创建市场布局，并让 BBSMC 默认显示公开整合包列表。

**Architecture:** `AppShell.activePage` 作为唯一普通页面状态；创建向导用语义容器启用已有满高样式；BBSMC 以空查询表示默认发现列表，并在前后端明确支持该语义。

**Tech Stack:** React 19、TypeScript、TanStack Query、Vitest、Electron CommonJS、CSS。

## Global Constraints

- EULA 必须由用户本人确认。
- BBSMC 仅公共直链版本可自动安装，外部网盘版本继续禁用并说明手动下载。
- 仅移除市场首页底部重复的“上一步”；其他向导步骤导航不变。
- 鼠标点击不显示焦点环，键盘 `:focus-visible` 保持不变。

---

### Task 1: Java 与设置主内容页

**Files:**
- Modify: `src/components/layout/AppShell.test.tsx`
- Modify: `src/components/layout/AppShell.tsx`
- Modify: `src/styles.css`

**Interfaces:**
- Consumes: `SidebarPage`、`JavaRuntimesView`、`SettingsView`。
- Produces: `activePage === "java" | "settings"` 的内联主内容渲染。

- [ ] **Step 1: Write the failing test**

将现有 Java/设置弹窗测试改为断言视图位于 `main` 内，并断言 `queryByRole("dialog")` 为 `null`。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/layout/AppShell.test.tsx`
Expected: FAIL，因为当前仍渲染 Radix Dialog。

- [ ] **Step 3: Write minimal implementation**

删除 `isJavaOpen`、`isSettingsOpen` 和两段 Dialog；侧栏选择直接设置 `activePage`；主内容分支渲染 `<JavaRuntimesView />` 或 `<SettingsView />`；删除未使用的 `.fullscreen-modal*` 样式。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/layout/AppShell.test.tsx`
Expected: PASS。

### Task 2: 创建市场高度与重复导航

**Files:**
- Modify: `src/features/servers/CreateServerWizard.test.tsx`
- Modify: `src/features/servers/CreateServerWizard.tsx`

**Interfaces:**
- Consumes: `CreateServerMarketplaceBrowser`、`onHeaderBackChange`。
- Produces: `.wizard-marketplace-step` 满高容器及仅顶部返回入口。

- [ ] **Step 1: Write the failing test**

打开市场后断言存在 `.wizard-marketplace-step`，页面内不存在名为“上一步”的底部按钮，并确认 `onHeaderBackChange` 收到函数。

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/features/servers/CreateServerWizard.test.tsx`
Expected: FAIL，因为当前没有包装容器且底部仍渲染按钮。

- [ ] **Step 3: Write minimal implementation**

用 `<div className="wizard-marketplace-step">` 包裹市场浏览器；当 `step === 0 && sourceView === "marketplace"` 时不渲染 `.wizard-nav-bar`。

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/features/servers/CreateServerWizard.test.tsx`
Expected: PASS。

### Task 3: BBSMC 默认公开整合包列表

**Files:**
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.test.tsx`
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.tsx`
- Modify: `electron/backend.test.mjs`
- Modify: `electron/backend.cjs`

**Interfaces:**
- Consumes: `searchBbsmcProjects(query, options)`。
- Produces: BBSMC 空查询默认列表；Modrinth 默认行为不变。

- [ ] **Step 1: Write the failing tests**

前端测试选择 BBSMC 后断言 `search_bbsmc_projects` 收到 `query: ""`；后端测试以空查询调用并断言请求 URL 含 `query=`、返回全部模拟 hits。

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run src/features/servers/CreateServerMarketplaceBrowser.test.tsx electron/backend.test.mjs`
Expected: FAIL，因为前端发送 `server`，后端对空查询直接返回空数组。

- [ ] **Step 3: Write minimal implementation**

将 `discoveryQueries.BBSMC` 改为 `""`；BBSMC 即使空查询也启用 TanStack 查询；移除后端空查询提前返回。

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run src/features/servers/CreateServerMarketplaceBrowser.test.tsx electron/backend.test.mjs`
Expected: PASS。

### Task 4: 综合验证与审查

**Files:**
- Review: all modified source and test files.

**Interfaces:**
- Consumes: Tasks 1–3 outputs.
- Produces: 可构建、类型正确且无回归的应用。

- [ ] **Step 1: Run focused tests**

Run: `pnpm exec vitest run src/components/layout/AppShell.test.tsx src/features/servers/CreateServerWizard.test.tsx src/features/servers/CreateServerMarketplaceBrowser.test.tsx electron/backend.test.mjs`
Expected: PASS。

- [ ] **Step 2: Run static verification**

Run: `pnpm tsc --noEmit`
Expected: exit 0。

- [ ] **Step 3: Run production build**

Run: `pnpm build`
Expected: exit 0。

- [ ] **Step 4: Review**

确认需求完整性、行为正确性、无无关改动、无性能/安全退化，并确认 BBSMC 安装限制未改变。
