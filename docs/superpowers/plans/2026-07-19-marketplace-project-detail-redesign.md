# 市场项目详情页重设计实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将模组与整合包详情页升级为编辑式混合布局，同时保留现有版本选择、BBSMC 图片代理和创建服务器行为。

**Architecture:** 保持 `CreateServerMarketplaceBrowser` 的查询与选择状态不变，只重组详情分支的语义结构并增加少量纯展示辅助函数。继续由 `MarketplaceMarkdown` 负责安全正文渲染，所有视觉变化集中在现有 `src/styles.css`，不增加依赖或后端字段。

**Tech Stack:** React 19、TypeScript、TanStack Query、Vitest、Testing Library、vanilla CSS、现有 i18n JSON。

## Global Constraints

- 不新增字体、图片服务、动画库或设计依赖。
- 不改变 Modrinth/BBSMC 搜索、安装协议、EULA、服务端包警告和后台任务流程。
- 只使用 `:focus-visible`；鼠标点击不显示焦点框，键盘焦点始终可见。
- 详情页不产生横向画廊滚动；正文图片最大高度继续受限。
- 低于约 1100 px 可用宽度时切换单栏，版本区位于项目介绍之前。

---

## 文件结构

- `src/features/servers/CreateServerMarketplaceBrowser.tsx`：详情页语义结构、项目头部、统计带、截图区与版本栏内容。
- `src/features/servers/CreateServerMarketplaceBrowser.test.tsx`：详情结构、导航、外部链接、版本选择与空内容行为。
- `src/features/marketplace/MarketplaceMarkdown.tsx`：继续负责安全正文渲染；只增加介绍区需要的可访问标识时修改。
- `src/features/marketplace/MarketplaceMarkdown.test.tsx`：标题、折叠状态、清理和 BBSMC 图片代理回归。
- `src/i18n/locales/en.json`、`src/i18n/locales/zh-CN.json`：统计与章节标题。
- `src/styles.css`：编辑式项目头部、数据带、非对称画廊、正文、版本栏与响应式布局。
- `src/styles.test.mjs`：布局与无障碍 CSS 契约。

### Task 1: 项目头部与统计带

**Files:**
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.tsx:540-660`
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.test.tsx:300-430`
- Modify: `src/i18n/locales/en.json:645-665`
- Modify: `src/i18n/locales/zh-CN.json:563-583`
- Modify: `src/styles.css:3820-3970`
- Test: `src/features/servers/CreateServerMarketplaceBrowser.test.tsx`
- Test: `src/styles.test.mjs`

**Interfaces:**
- Consumes: `selectedDetails: ProjectDetails | null`、`provider: "Modrinth" | "BBSMC"`、`versions: ProjectVersion[]`。
- Produces: `.marketplace-project-hero`、`.marketplace-project-stats`、`.marketplace-project-stat`，供后续主体布局复用。

- [ ] **Step 1: 写组件失败测试**

在打开 `Lazy Survival` 详情后验证语义头部、标题、统计带和外部链接：

```tsx
const details = await screen.findByRole("article", { name: /lazy survival/i });
expect(details.querySelector("header.marketplace-project-hero")).toBeInTheDocument();
expect(within(details).getByRole("heading", { level: 2, name: /lazy survival/i })).toBeInTheDocument();
expect(within(details).getByLabelText(/project statistics/i)).toBeInTheDocument();
expect(within(details).getByText("6.9K")).toBeInTheDocument();
expect(within(details).getByText("47")).toBeInTheDocument();
```

- [ ] **Step 2: 运行组件测试并确认失败**

Run: `pnpm exec vitest run src/features/servers/CreateServerMarketplaceBrowser.test.tsx -t "renders an editorial project header"`

Expected: FAIL，当前详情没有 `banner`、二级项目标题或独立统计值。

- [ ] **Step 3: 写样式失败测试**

在 `src/styles.test.mjs` 增加：

```js
const hero = extractCssBlock(css, ".marketplace-project-hero");
const stats = extractCssBlock(css, ".marketplace-project-stats");
expect(hero).toMatch(/position:\s*relative/);
expect(hero).toMatch(/overflow:\s*hidden/);
expect(stats).toMatch(/display:\s*grid/);
expect(stats).toMatch(/font-variant-numeric:\s*tabular-nums/);
```

- [ ] **Step 4: 增加文案与最小结构**

新增以下 i18n 键：

```json
"marketplace.projectStats": "Project statistics",
"marketplace.stat.downloads": "Downloads",
"marketplace.stat.follows": "Follows",
"marketplace.stat.mods": "Mods",
"marketplace.stat.minecraft": "Minecraft"
```

中文对应为“项目统计”“下载”“关注”“模组”“Minecraft”。将现有 hero 与 badge 元数据替换为：

```tsx
<header className="marketplace-project-hero">
  <div className="marketplace-project-hero-ambient" aria-hidden="true">
    <MarketplaceProjectIcon project={selectedDetails} provider={provider} size="large" />
  </div>
  <div className="marketplace-project-hero-content">
    <MarketplaceProjectIcon project={selectedDetails} provider={provider} size="large" />
    <div className="marketplace-project-identity">
      <small className="meta-badge meta-badge-provider">{provider}</small>
      <div className="marketplace-pack-detail-title">
        <h2>{projectTitle(selectedDetails)}</h2>
        {/* 保留现有外部链接 */}
      </div>
      <p>{projectDescription(selectedDetails, noDescription)}</p>
    </div>
  </div>
</header>
<dl className="marketplace-project-stats" aria-label={t("marketplace.projectStats")}>
  {/* 以 dt/dd 分别渲染标签和值；未知 modCount 时不渲染 */}
</dl>
```

- [ ] **Step 5: 实现头部与统计带 CSS**

```css
.marketplace-project-hero {
  position: relative;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--bg-elevated);
}
.marketplace-project-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  font-variant-numeric: tabular-nums;
}
```

环境背景必须 `pointer-events: none`、低透明度并由遮罩覆盖；前景图标和文字使用现有主题色，标题 `text-wrap: balance`，简介 `max-width: 72ch`。

- [ ] **Step 6: 运行测试确认通过**

Run: `pnpm exec vitest run src/features/servers/CreateServerMarketplaceBrowser.test.tsx src/styles.test.mjs`

Expected: PASS。

### Task 2: 截图画廊与正文阅读体验

**Files:**
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.tsx:610-635`
- Modify: `src/features/marketplace/MarketplaceMarkdown.tsx:350-415`
- Modify: `src/i18n/locales/en.json:655-665`
- Modify: `src/i18n/locales/zh-CN.json:573-583`
- Modify: `src/styles.css:3940-4115`
- Test: `src/features/servers/CreateServerMarketplaceBrowser.test.tsx`
- Test: `src/features/marketplace/MarketplaceMarkdown.test.tsx`
- Test: `src/styles.test.mjs`

**Interfaces:**
- Consumes: `projectGallery(selectedDetails): string[]`、`MarketplaceMarkdown source: string`。
- Produces: `.marketplace-project-section`、`.marketplace-project-gallery-grid`、`.marketplace-project-about`。

- [ ] **Step 1: 写截图与介绍结构失败测试**

为 Modrinth 详情 fixture 加入两张 gallery 图片，然后验证：

```tsx
expect(within(details).getByRole("region", { name: /screenshots/i })).toBeInTheDocument();
expect(within(details).getByRole("region", { name: /about this project/i })).toBeInTheDocument();
expect(within(details).getAllByRole("img", { name: /project screenshot/i })).toHaveLength(2);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `pnpm exec vitest run src/features/servers/CreateServerMarketplaceBrowser.test.tsx -t "groups screenshots and project copy into editorial sections"`

Expected: FAIL，当前没有可见章节标题或截图替代文本。

- [ ] **Step 3: 增加章节文案与语义结构**

新增 `marketplace.aboutProject`（英文 `About this project`，中文 `项目介绍`），将截图与正文分别包裹：

```tsx
<section className="marketplace-project-section" aria-labelledby="marketplace-screenshots-title">
  <div className="marketplace-project-section-heading">
    <h3 id="marketplace-screenshots-title">{t("marketplace.screenshots")}</h3>
    <span>{gallery.length}</span>
  </div>
  <div className="marketplace-project-gallery-grid">...</div>
</section>
<section className="marketplace-project-section marketplace-project-about" aria-labelledby="marketplace-about-title">
  <h3 id="marketplace-about-title">{t("marketplace.aboutProject")}</h3>
  <MarketplaceMarkdown source={...} />
</section>
```

`MarketplaceGalleryImage` 接收 `alt`，生成“项目名 screenshot N”/“项目名 截图 N”，不改变 BBSMC 代理逻辑。

- [ ] **Step 4: 写并实现画廊/正文 CSS 契约**

失败测试要求：

```js
expect(gallery).toMatch(/grid-template-columns:\s*repeat\(2,/);
expect(gallery).toMatch(/overflow:\s*visible/);
expect(about).toMatch(/max-width:\s*76ch/);
expect(markdownHeading).toMatch(/font-size:\s*clamp/);
```

实现非对称网格：第一张在至少三张图片时跨两行，其余图片固定 `16 / 9`；一张图片最大宽度 `720px`。正文宽度 `76ch`，远端 `h1` 最大约 `22px`，不能超过页面 `h2`。

- [ ] **Step 5: 保留 Markdown 安全和折叠行为**

不改变 `sanitizeHtml` 允许/拒绝标签集合。运行：

`pnpm exec vitest run src/features/marketplace/MarketplaceMarkdown.test.tsx`

Expected: BBSMC 代理和 `details` 展开状态测试全部 PASS。

- [ ] **Step 6: 运行任务测试确认通过**

Run: `pnpm exec vitest run src/features/servers/CreateServerMarketplaceBrowser.test.tsx src/features/marketplace/MarketplaceMarkdown.test.tsx src/styles.test.mjs`

Expected: PASS。

### Task 3: 版本栏、响应式与完整验证

**Files:**
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.tsx:635-705`
- Modify: `src/styles.css:4115-4260`
- Modify: `src/styles.css:7180-7290`
- Test: `src/features/servers/CreateServerMarketplaceBrowser.test.tsx`
- Test: `src/styles.test.mjs`

**Interfaces:**
- Consumes: 现有 `versionInstallability`、`versionHasServerPack`、`selectVersion`。
- Produces: `.marketplace-version-rail` 和低于 1100 px 的单栏布局；不改变 `onSelect` payload。

- [ ] **Step 1: 写版本栏行为失败测试**

```tsx
const versionRail = within(details).getByRole("complementary", { name: /versions/i });
expect(within(versionRail).getByText("1")).toBeInTheDocument();
const versionButton = within(versionRail).getByRole("button", { name: /1\.0\.0/i });
expect(versionButton).toHaveClass("marketplace-install-version");
```

继续运行并保留“专用服务端包优先”“BBSMC 未验证确认”“外部网盘禁用”现有测试。

- [ ] **Step 2: 写响应式与焦点失败测试**

```js
const grid = extractCssBlock(css, ".marketplace-pack-detail-grid");
const narrow = extractCssBlock(css, "@media (max-width: 1100px)");
const focus = extractCssBlock(css, ".marketplace-install-version:focus-visible");
expect(grid).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(300px,\s*340px\)/);
expect(narrow).toMatch(/\.marketplace-pack-detail-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
expect(narrow).toMatch(/\.marketplace-pack-version-sidebar\s*\{[^}]*order:\s*-1/s);
expect(focus).toMatch(/border-color:\s*var\(--accent\)/);
```

- [ ] **Step 3: 实现版本栏视觉与响应式布局**

右栏增加分层表面、粘性标题和更明显的按钮状态；保持现有禁用逻辑。宽布局：

```css
.marketplace-pack-detail-grid {
  grid-template-columns: minmax(0, 1fr) minmax(300px, 340px);
}
.marketplace-install-version:focus-visible {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
}
```

窄布局中主网格改为单列，版本栏 `order: -1`、取消左边框并限制最大高度；不隐藏版本项。

- [ ] **Step 4: 运行全部相关测试**

Run: `pnpm exec vitest run src/features/servers/CreateServerMarketplaceBrowser.test.tsx src/features/marketplace/MarketplaceMarkdown.test.tsx src/styles.test.mjs electron/backend.test.mjs`

Expected: 所有测试 PASS，控制台无新增 React 警告。

- [ ] **Step 5: 运行生产验证**

Run: `npm run build`

Expected: `tsc && vite build` 退出码 0。

Run: `git diff --check`

Expected: 退出码 0，无空白错误。

- [ ] **Step 6: 完成强制复核**

逐项确认需求完整性、正确性、副作用、性能、安全和可维护性。重点检查：没有新增网络请求；BBSMC 图片仍通过受信任后端代理；正文仍经 `sanitizeHtml`；新视觉不会改变 `onSelect`、EULA 或安装流程。
