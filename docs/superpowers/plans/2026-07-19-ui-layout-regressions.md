# UI Layout Regressions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Java 页面、空日志工作区、紧凑控件及市场卡片和详情图片的布局回归。

**Architecture:** 保留现有数据查询与组件边界，只增加稳定的语义类名，并在预览样式层修正规则。市场列表由独立滚动容器承载内容高度行，响应式切换三列、两列和一列；卡片封面及详情截图完整显示原图。

**Tech Stack:** React 19、TypeScript、Radix UI、CSS、Vitest、Testing Library。

## Global Constraints

- 不修改 Java 安装、日志查询、设置持久化或 Electron IPC。
- 不增加依赖。
- 保留 `:focus-visible` 键盘焦点行为。
- 1100px 以下保持单列响应式布局。
- 市场卡片宽屏三列、中屏两列、窄屏一列。
- 市场图片不得裁切或拉伸。

---

### Task 1: Java 运行时平衡网格

**Files:**
- Modify: `src/features/java/JavaRuntimesView.tsx`
- Modify: `src/styles/preview/pages.css`
- Test: `src/features/java/JavaRuntimesView.test.tsx`
- Test: `src/styles.test.mjs`

**Interfaces:**
- Consumes: `JavaRuntimesView` 当前的四个条件面板。
- Produces: `.java-panel-managed`、`.java-panel-installed`、`.java-panel-compatibility`、`.java-panel-failures`。

- [ ] **Step 1: 写失败测试**

断言组件输出稳定角色类名，并断言 CSS 使用 `minmax(280px, 1fr) minmax(0, 2fr)`，兼容性与失败面板跨整行。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm vitest run src/features/java/JavaRuntimesView.test.tsx src/styles.test.mjs`
Expected: FAIL，因为角色类名和新网格尚不存在。

- [ ] **Step 3: 最小实现**

为各面板添加语义类名，将 `.java-layout` 改成一比二的两列布局；兼容性和失败面板设置 `grid-column: 1 / -1`，窄屏恢复 `grid-column: auto`。

- [ ] **Step 4: 运行测试**

Run: `pnpm vitest run src/features/java/JavaRuntimesView.test.tsx src/styles.test.mjs`
Expected: PASS。

### Task 2: 空日志工作区

**Files:**
- Modify: `src/features/logger/AppLoggerView.tsx`
- Modify: `src/styles/preview/pages.css`
- Test: `src/features/logger/AppLoggerView.test.tsx`

**Interfaces:**
- Consumes: `groupedLogs: GroupedLogEntry[]` 与 `selectedGroup`。
- Produces: 始终存在的 `.logger-filter-rail`、`.app-log-list`，以及空数据时的 `.app-log-workspace-empty`。

- [ ] **Step 1: 写失败测试**

模拟 `list_app_logs` 返回空数组，断言筛选侧栏、日志列表和空状态存在，详情面板不存在。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm vitest run src/features/logger/AppLoggerView.test.tsx`
Expected: FAIL，因为当前空数据分支不渲染工作区。

- [ ] **Step 3: 最小实现**

把空状态移入 `.app-log-list`；无查询错误时始终渲染工作区。没有详情时添加 `.app-log-workspace-empty`，其宽屏网格为 `148px minmax(0, 1fr)`。

- [ ] **Step 4: 运行测试**

Run: `pnpm vitest run src/features/logger/AppLoggerView.test.tsx src/styles.test.mjs`
Expected: PASS。

### Task 3: 紧凑开关控件

**Files:**
- Modify: `src/styles/preview/components.css`
- Test: `src/styles.test.mjs`

**Interfaces:**
- Consumes: `.switch-root` 与 `.checkbox-root` Radix 控件类名。
- Produces: 仅普通按钮匹配的预览按钮高度规则。

- [ ] **Step 1: 写失败测试**

断言按钮高度选择器使用低优先级 `button:where(:not(.switch-root):not(.checkbox-root))`，且不再以裸 `button` 选择器应用最小高度。

- [ ] **Step 2: 运行失败测试**

Run: `pnpm vitest run src/styles.test.mjs`
Expected: FAIL，因为当前规则匹配所有按钮。

- [ ] **Step 3: 最小实现**

将选择器改为：

```css
button:where(:not(.switch-root):not(.checkbox-root)),
.button {
  min-height: var(--preview-button-height);
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm vitest run src/styles.test.mjs`
Expected: PASS。

### Task 4: 市场卡片与详情图片

**Files:**
- Modify: `src/styles/preview/components.css`
- Modify: `src/styles/preview/pages.css`
- Modify: `src/styles.css`
- Test: `src/styles.test.mjs`

- [ ] **Step 1: 写并运行失败测试**

断言按钮规则为低优先级、卡片网格使用内容高度与三/二/一列断点、详情图片使用 `contain`；运行 `pnpm vitest run src/styles.test.mjs`，预期旧样式失败。

- [ ] **Step 2: 最小实现并复测**

修正按钮选择器、卡片网格和画廊图片规则；运行 `pnpm vitest run src/styles.test.mjs src/features/servers/CreateServerMarketplaceBrowser.test.tsx`，预期通过。

### Task 5: 完整验证

**Files:**
- Verify only.

**Interfaces:**
- Consumes: Tasks 1–4 的最终代码。
- Produces: 测试、构建和浏览器验收证据。

- [ ] **Step 1: 完整测试**

Run: `pnpm vitest run`
Expected: 所有测试通过。

- [ ] **Step 2: 生产构建**

Run: `pnpm build`
Expected: TypeScript 与 Vite 构建退出码为 0。

- [ ] **Step 3: 浏览器验收**

在 760px、1280px 与 1920px 宽度检查 Java、空日志、设置页和市场页；确认无横向溢出、市场图片完整、Switch 为胶囊形、鼠标不显示焦点环、键盘焦点仍可见。

- [ ] **Step 4: 差异检查**

Run: `git diff --check`
Expected: 退出码为 0。
