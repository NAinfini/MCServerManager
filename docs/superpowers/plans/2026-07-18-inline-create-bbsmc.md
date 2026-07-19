# 主内容区创建服务器与 BBSMC 接入实施计划

> **面向代理执行者：** 必须使用 `executing-plans` 逐项执行本计划。所有步骤使用复选框跟踪，并严格遵循测试先行。

**目标：** 将创建服务器向导迁移到主内容区，并让用户能从 BBSMC 选择公共直链整合包完成服务器创建。

**架构：** `AppShell` 使用现有本地状态在服务器内容和内联创建页面之间切换，不增加路由依赖。`CreateServerWizard` 继续拥有步骤状态，只向父组件发布任务生命周期；市场浏览器通过提供商分发调用 Modrinth 或 BBSMC，后端 provisioning planner 独立重新验证 BBSMC 版本与 CDN URL。

**技术栈：** React 19、TypeScript、TanStack Query、Radix UI、Vitest、Testing Library、Electron、Node SQLite。

## 全局约束

- 创建服务器页面不得使用 Radix Dialog、Portal、遮罩层、焦点陷阱或 `role="dialog"`。
- 侧栏、窗口标题栏、顶部运行状态和底部状态栏必须保持可见。
- 未创建 provisioning job 的草稿离开前必须确认；job 创建后允许离开并后台继续。
- BBSMC 只自动处理 `https://cdn.bbsmc.net/` 公共直链；外部网盘链接不得进入下载计划。
- 所有可选择的 BBSMC 版本均按未验证服务端包处理，并要求确认 `PACK_UNVERIFIED`。
- 无 CurseForge API 密钥时不得把 CurseForge 加入创建来源。
- 保持鼠标无焦点框、键盘显示 `:focus-visible`。
- 不引入 React Router 或新的运行时依赖。

---

## 文件职责

- `src/features/servers/CreateServerMarketplaceBrowser.tsx`：创建流程中的提供商选择、项目浏览和版本可安装性。
- `src/features/servers/CreateServerMarketplaceBrowser.test.tsx`：BBSMC 下拉选项、命令分发、直链与网盘行为。
- `electron/backend.cjs`：BBSMC provisioning 计划和可信 CDN 边界。
- `electron/backend.test.mjs`：后端 BBSMC 计划、警告与 URL 拒绝回归。
- `src/features/servers/CreateServerWizard.tsx`：向导任务生命周期通知。
- `src/features/servers/CreateServerWizard.test.tsx`：`draft`、`running`、`complete` 生命周期。
- `src/components/layout/AppShell.tsx`：内联创建页面、离开守卫和侧栏导航协调。
- `src/components/layout/AppShell.test.tsx`：主内容语义、离开确认、任务开始后离开。
- `src/i18n/locales/en.json`、`src/i18n/locales/zh-CN.json`：放弃创建和 BBSMC 不可安装原因文本。
- `src/styles.css`、`src/styles.test.mjs`：内联页面布局与无模态约束。
- `electron/ui-smoke.cjs`：生产 Electron 中的内联创建页面和控制台错误验证。

---

### 任务 1：BBSMC 创建市场来源

**文件：**

- 修改：`src/features/servers/CreateServerMarketplaceBrowser.test.tsx`
- 修改：`src/features/servers/CreateServerMarketplaceBrowser.tsx`
- 修改：`src/i18n/locales/en.json`
- 修改：`src/i18n/locales/zh-CN.json`

**接口：**

- 使用：`searchBbsmcProjects(query, options)`、`getBbsmcProject(projectId)`、`listBbsmcVersions(projectId)`。
- 产出：`MarketplaceProvider = "Modrinth" | "BBSMC"`。
- 产出：`versionInstallability(provider, version): { installable: boolean; reason: "external" | "missing" | null }`。

- [ ] **步骤 1：先写 BBSMC 来源和命令分发失败测试**

在现有 mock 中增加 BBSMC fixture，并把“仅 Modrinth”测试改为：

```tsx
it("offers Modrinth and BBSMC discovery without CurseForge credentials", async () => {
  renderBrowser();
  await userEvent.click(screen.getByRole("combobox", { name: /providers/i }));
  expect(screen.getByRole("option", { name: /modrinth/i })).toBeInTheDocument();
  expect(screen.getByRole("option", { name: /bbsmc/i })).toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /curseforge/i })).not.toBeInTheDocument();
});

it("routes BBSMC search, details, and versions through BBSMC commands", async () => {
  renderBrowser();
  await selectProvider(/bbsmc/i);
  await userEvent.click(await screen.findByRole("button", { name: /public pack/i }));
  expect(invokeDesktopCommand).toHaveBeenCalledWith(
    "search_bbsmc_projects",
    expect.objectContaining({ input: expect.objectContaining({ projectType: "modpack" }) }),
  );
  expect(invokeDesktopCommand).toHaveBeenCalledWith(
    "get_bbsmc_project",
    { input: { projectId: "bbsmc-pack-1" } },
  );
  expect(invokeDesktopCommand).toHaveBeenCalledWith(
    "list_bbsmc_versions",
    { input: { projectId: "bbsmc-pack-1" } },
  );
});
```

- [ ] **步骤 2：运行测试并确认按预期失败**

运行：

```powershell
pnpm vitest run src/features/servers/CreateServerMarketplaceBrowser.test.tsx
```

预期：下拉菜单找不到 BBSMC，且没有调用 `search_bbsmc_projects`。

- [ ] **步骤 3：实现提供商分发**

在组件中导入 BBSMC API，扩展提供商并使用显式分发函数：

```tsx
type MarketplaceProvider = "Modrinth" | "BBSMC";

const providers: MarketplaceProvider[] = ["Modrinth", "BBSMC"];
const discoveryQueries: Record<MarketplaceProvider, string> = {
  Modrinth: "server",
  BBSMC: "server",
};

function searchProviderProjects(
  provider: MarketplaceProvider,
  query: string,
  options: MarketplaceSearchOptions,
) {
  return provider === "BBSMC"
    ? searchBbsmcProjects(query, options)
    : searchModrinthProjects("create-server", query, options);
}

function getProviderProject(provider: MarketplaceProvider, projectId: string) {
  return provider === "BBSMC"
    ? getBbsmcProject(projectId)
    : getModrinthProject(projectId);
}

function listProviderVersions(provider: MarketplaceProvider, projectId: string) {
  return provider === "BBSMC"
    ? listBbsmcVersions(projectId)
    : listModrinthVersions("create-server", projectId);
}
```

三个 TanStack Query 的 `queryFn` 必须调用这些分发函数，并继续把 `projectType: "modpack"`、加载器和排序传入搜索。

- [ ] **步骤 4：写公共直链和网盘版本失败测试**

```tsx
it("requires acknowledgement before selecting a public BBSMC file", async () => {
  const onSelect = vi.fn();
  renderBrowser(onSelect);
  await selectProvider(/bbsmc/i);
  await userEvent.click(await screen.findByRole("button", { name: /public pack/i }));
  await userEvent.click(await screen.findByRole("button", { name: /1\.0\.0/i }));
  expect(onSelect).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: /use unverified archive/i }));
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({ provider: "BBSMC", versionId: "bbsmc-version-1" }),
  );
});

it("disables BBSMC versions that only expose external disk links", async () => {
  renderBrowser();
  await selectProvider(/bbsmc/i);
  await userEvent.click(await screen.findByRole("button", { name: /disk pack/i }));
  const version = await screen.findByRole("button", { name: /external download required/i });
  expect(version).toBeDisabled();
});
```

- [ ] **步骤 5：运行测试并确认直链分类尚未实现**

运行同一步骤 2。预期：BBSMC 版本仍全部禁用或没有风险确认。

- [ ] **步骤 6：实现版本能力分类和文本**

```tsx
function isBbsmcPublicFile(version: ProjectVersion) {
  return version.files.some((file) => {
    try {
      return new URL(file.url || "").hostname.toLowerCase() === "cdn.bbsmc.net";
    } catch {
      return false;
    }
  });
}

function versionInstallability(
  provider: MarketplaceProvider,
  version: ProjectVersion,
) {
  if (provider === "Modrinth") {
    return { installable: true, reason: null } as const;
  }
  if (isBbsmcPublicFile(version)) {
    return { installable: true, reason: null } as const;
  }
  if (version.diskOnly || (version.diskUrls?.length ?? 0) > 0) {
    return { installable: false, reason: "external" } as const;
  }
  return { installable: false, reason: "missing" } as const;
}
```

版本行根据 `reason` 使用：

- `marketplace.externalDownloadRequired`
- 新增 `marketplace.noAutomaticDownload`

BBSMC 可安装版本不设置 `isServerPack`，因此沿用现有未验证确认流程。

- [ ] **步骤 7：运行组件测试并确认全部通过**

运行同一步骤 2。预期：该文件全部测试通过。

- [ ] **步骤 8：提交任务 1**

```powershell
git add src/features/servers/CreateServerMarketplaceBrowser.tsx src/features/servers/CreateServerMarketplaceBrowser.test.tsx src/i18n/locales/en.json src/i18n/locales/zh-CN.json
git commit -m "feat: add bbsmc to server creation marketplace"
```

---

### 任务 2：BBSMC provisioning 计划

**文件：**

- 修改：`electron/backend.test.mjs`
- 修改：`electron/backend.cjs`

**接口：**

- 使用：`getBbsmcVersion(versionId)`、`selectInstallableBbsmcFile(version)`、`validateProvisioningUrl(value, provider)`。
- 产出：`planBbsmcMarketplacePack(source)`，返回与现有 marketplace plan 相同结构。

- [ ] **步骤 1：写公共 CDN 计划失败测试**

在 marketplace provisioning describe 中加入：

```js
it("plans a public BBSMC archive as an unverified marketplace pack", async () => {
  const backend = createTestBackend();
  globalThis.fetch = vi.fn(async (url) => {
    expect(String(url)).toContain("/v2/version/bbsmc-version-1");
    return jsonResponse({
      id: "bbsmc-version-1",
      project_id: "bbsmc-pack-1",
      name: "BBSMC Public Pack",
      version_number: "1.0.0",
      loaders: ["quilt"],
      game_versions: ["1.21.4"],
      files: [{
        filename: "bbsmc-pack.mrpack",
        size: 2048,
        primary: true,
        url: "https://cdn.bbsmc.net/files/bbsmc-pack.mrpack",
        hashes: { sha1: "abc" },
      }],
    });
  });
  try {
    const plan = await backend.handle("plan_server_provisioning", {
      input: {
        source: {
          kind: "marketplaceModpack",
          provider: "BBSMC",
          projectId: "bbsmc-pack-1",
          versionId: "bbsmc-version-1",
        },
      },
    });
    expect(plan).toMatchObject({
      pack: { format: "bbsmc", versionId: "bbsmc-version-1" },
      minecraftVersion: "1.21.4",
      loaderType: "quilt",
      artifacts: [{
        provider: "bbsmc",
        filename: "bbsmc-pack.mrpack",
        url: "https://cdn.bbsmc.net/files/bbsmc-pack.mrpack",
      }],
      integrity: { status: "unverified" },
      warnings: [expect.objectContaining({
        code: "PACK_UNVERIFIED",
        requiresAcknowledgement: true,
      })],
    });
  } finally {
    backend.close();
  }
});
```

- [ ] **步骤 2：运行目标测试并确认提供商不受支持**

```powershell
pnpm vitest run electron/backend.test.mjs -t "plans a public BBSMC archive"
```

预期：失败信息包含 `unsupported marketplace provider: BBSMC`。

- [ ] **步骤 3：实现 BBSMC 计划和可信主机**

把 BBSMC CDN 加入现有安全白名单：

```js
const PROVISIONING_PROVIDER_HOSTS = Object.freeze({
  modrinth: new Set(["cdn.modrinth.com"]),
  curseforge: new Set([
    "edge.forgecdn.net",
    "media.forgecdn.net",
    "mediafilez.forgecdn.net",
  ]),
  bbsmc: new Set(["cdn.bbsmc.net"]),
});
```

实现计划函数：

```js
async function planBbsmcMarketplacePack(source) {
  const version = await getBbsmcVersion(
    trimRequired(source.versionId, "BBSMC version id is required"),
  );
  const file = selectInstallableBbsmcFile(version);
  ensureBbsmcFileIsDirect(file, version);
  const url = validateProvisioningUrl(file.url, "bbsmc");
  const minecraftVersion = version.gameVersions[0] || null;
  return {
    source,
    pack: {
      format: "bbsmc",
      name: version.name,
      versionId: version.id,
      releaseType: version.releaseType || null,
    },
    minecraftVersion,
    loaderType: normalizeMarketplaceLoaderType(version.loaders),
    loaderVersion: null,
    requiredJavaMajor: requiredJavaMajorForMinecraft(minecraftVersion),
    artifacts: [{
      provider: "bbsmc",
      projectId: version.projectId,
      versionId: version.id,
      filename: file.filename,
      size: file.size,
      url,
      hashes: file.hashes || {},
      environment: "server",
    }],
    optionalFiles: [],
    archiveLayers: [],
    properties: {},
    warnings: [unverifiedMarketplaceWarning(
      "BBSMC does not identify this archive as a dedicated server pack.",
    )],
    integrity: { status: "unverified" },
    estimatedBytes: file.size || 0,
  };
}
```

在 `planMarketplacePack` 中加入：

```js
if (provider === "bbsmc") return planBbsmcMarketplacePack(source);
```

- [ ] **步骤 4：写外部网盘和非允许域名失败测试**

```js
it.each([
  [{ disk_only: true, disk_urls: [{ platform: "baidu", url: "https://pan.baidu.com/s/1" }], files: [] }, /external disk/i],
  [{ files: [{ filename: "pack.zip", primary: true, url: "https://example.com/pack.zip" }] }, /not approved|external disk|direct public/i],
])("rejects an unsafe BBSMC marketplace source", async (versionFields, expected) => {
  const backend = createTestBackend();
  globalThis.fetch = vi.fn(async () => jsonResponse({
    id: "unsafe-version",
    project_id: "bbsmc-pack-1",
    name: "Unsafe Pack",
    version_number: "1.0.0",
    loaders: ["fabric"],
    game_versions: ["1.20.1"],
    ...versionFields,
  }));
  try {
    await expect(backend.handle("plan_server_provisioning", {
      input: { source: {
        kind: "marketplaceModpack",
        provider: "BBSMC",
        projectId: "bbsmc-pack-1",
        versionId: "unsafe-version",
      } },
    })).rejects.toThrow(expected);
  } finally {
    backend.close();
  }
});
```

- [ ] **步骤 5：运行 BBSMC 后端测试并确认通过**

```powershell
pnpm vitest run electron/backend.test.mjs -t "BBSMC"
```

预期：现有 BBSMC API、下载测试和新增规划测试全部通过。

- [ ] **步骤 6：提交任务 2**

```powershell
git add electron/backend.cjs electron/backend.test.mjs
git commit -m "feat: plan bbsmc server pack provisioning"
```

---

### 任务 3：向导任务生命周期

**文件：**

- 修改：`src/features/servers/CreateServerWizard.test.tsx`
- 修改：`src/features/servers/CreateServerWizard.tsx`

**接口：**

- 产出：`CreateServerWizardLifecycle = "draft" | "running" | "complete"`。
- 产出：可选 prop `onLifecycleChange?: (lifecycle: CreateServerWizardLifecycle) => void`。

- [ ] **步骤 1：写生命周期失败测试**

扩展现有“plans a selected local pack, enforces approvals, and creates a persisted job”测试，在原有完整用户操作中加入生命周期断言：

```tsx
it("publishes draft, running, and complete lifecycle states", async () => {
  const onLifecycleChange = vi.fn();
  vi.mocked(invokeDesktopCommand).mockResolvedValue({
    path: "C:/Packs/server.mrpack",
  });
  renderWizard({ onLifecycleChange });
  await waitFor(() => {
    expect(onLifecycleChange).toHaveBeenLastCalledWith("draft");
  });

  await userEvent.click(screen.getByRole("button", { name: /open modpack file/i }));
  await userEvent.click(screen.getByRole("checkbox", { name: /accept this compatibility warning/i }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await screen.findByText(/Java 21/i);
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("button", { name: "Next" }));
  await userEvent.click(screen.getByRole("checkbox", { name: /I accept the Minecraft EULA/i }));
  await userEvent.click(screen.getByRole("button", { name: /install and start/i }));
  await waitFor(() => {
    expect(onLifecycleChange).toHaveBeenCalledWith("running");
  });

  await waitFor(() => {
    expect(onLifecycleChange).toHaveBeenLastCalledWith("complete");
  });
});
```

复用该测试文件已有的步骤推进和 provisioning 命令 mock，不创建生产测试专用入口。

- [ ] **步骤 2：运行向导测试并确认 prop 不存在**

```powershell
pnpm vitest run src/features/servers/CreateServerWizard.test.tsx
```

预期：TypeScript 或断言失败，因为向导未发布生命周期。

- [ ] **步骤 3：实现最小生命周期通知**

```tsx
export type CreateServerWizardLifecycle = "draft" | "running" | "complete";

interface CreateServerWizardProps {
  onLifecycleChange?: (lifecycle: CreateServerWizardLifecycle) => void;
  // 保留现有 props
}
```

挂载时发布 `draft`；`executeJob` 收到已创建 job 后发布 `running`；job 到达 `ready` 后先发布 `complete` 再调用 `onCreated`。失败或取消 job 仍保持 `running`，因为 job 已持久化且离开不会丢失表单草稿。

- [ ] **步骤 4：运行向导测试并确认通过**

运行同一步骤 2。预期：全部通过。

- [ ] **步骤 5：提交任务 3**

```powershell
git add src/features/servers/CreateServerWizard.tsx src/features/servers/CreateServerWizard.test.tsx
git commit -m "feat: publish server creation lifecycle"
```

---

### 任务 4：把创建向导迁移到主内容区

**文件：**

- 修改：`src/components/layout/AppShell.test.tsx`
- 修改：`src/components/layout/AppShell.tsx`
- 修改：`src/i18n/locales/en.json`
- 修改：`src/i18n/locales/zh-CN.json`

**接口：**

- 使用：`CreateServerWizardLifecycle` 与 `onLifecycleChange`。
- 产出：`requestCreateServerExit(destination: () => void)`，统一处理所有离开入口。

- [ ] **步骤 1：把模态测试改为主内容失败测试**

```tsx
it("renders server creation in the main content area without a modal", async () => {
  renderShell();
  await userEvent.click(screen.getByRole("button", { name: /create server/i }));
  const main = screen.getByRole("main");
  expect(within(main).getByRole("heading", { name: "Create server" })).toBeInTheDocument();
  expect(within(main).getByRole("navigation", { name: "Wizard progress" })).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: "Create server" })).not.toBeInTheDocument();
  expect(document.querySelector(".dialog-backdrop")).toBeNull();
});
```

删除“模态内容位于 backdrop 外”等已经失效的断言，并保留市场下拉不会退出创建流程的交互测试，但查询范围改为 `<main>`。

- [ ] **步骤 2：写离开草稿确认失败测试**

```tsx
it("requires confirmation before leaving a creation draft", async () => {
  renderShell();
  await userEvent.click(screen.getByRole("button", { name: /create server/i }));
  await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
  const confirm = screen.getByRole("alertdialog", { name: /discard server creation/i });
  expect(confirm).toBeInTheDocument();
  await userEvent.click(within(confirm).getByRole("button", { name: /cancel/i }));
  expect(screen.getByRole("heading", { name: "Create server" })).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: /^settings$/i }));
  await userEvent.click(screen.getByRole("button", { name: /discard creation/i }));
  expect(await screen.findByRole("dialog", { name: "Settings" })).toBeInTheDocument();
});
```

- [ ] **步骤 3：运行 AppShell 测试并确认仍渲染 Dialog**

```powershell
pnpm vitest run src/components/layout/AppShell.test.tsx
```

预期：创建页面不存在于 main，且旧创建 dialog 仍存在。

- [ ] **步骤 4：实现内联页面与离开守卫**

在 `AppShell` 中：

```tsx
const [isCreateServerActive, setCreateServerActive] = useState(false);
const [createServerLifecycle, setCreateServerLifecycle] =
  useState<CreateServerWizardLifecycle>("draft");
const [pendingCreateExit, setPendingCreateExit] =
  useState<(() => void) | null>(null);

const resetCreateServer = useCallback(() => {
  setCreateServerActive(false);
  setCreateServerSourcePath(null);
  setCreateServerHeaderBack(null);
  setCreateServerHeaderHidden(false);
  setCreateServerProgress(null);
  setCreateServerLifecycle("draft");
}, []);

const requestCreateServerExit = useCallback((destination: () => void) => {
  if (!isCreateServerActive) {
    destination();
    return;
  }
  if (createServerLifecycle === "draft") {
    setPendingCreateExit(() => destination);
    return;
  }
  resetCreateServer();
  destination();
}, [createServerLifecycle, isCreateServerActive, resetCreateServer]);
```

所有侧栏页面和服务器选择入口先调用 `requestCreateServerExit`。创建页面直接在 `<main>` 中渲染：

```tsx
{isCreateServerActive ? (
  <section
    aria-labelledby="create-server-page-title"
    className="create-server-page"
  >
    <div className="create-server-page-header create-server-wizard-header">
      <div className="create-server-dialog-title-row">
        {createServerHeaderBack ? (
          <Button variant="ghost" onClick={createServerHeaderBack}>
            <ChevronLeft aria-hidden="true" size={15} />
            {t("wizard.nav.back")}
          </Button>
        ) : null}
        <div>
          <h1 id="create-server-page-title">{t("servers.create.title")}</h1>
          <p>{t("servers.create.description")}</p>
        </div>
      </div>
      {createServerProgress ? (
        <WizardStepIndicator
          currentStep={createServerProgress.currentStep}
          steps={createServerProgress.steps}
        />
      ) : null}
      <Button
        aria-label={t("servers.create.close")}
        className="icon-button"
        variant="ghost"
        onClick={() => requestCreateServerExit(openServersOverview)}
      >
        <X aria-hidden="true" size={16} />
      </Button>
    </div>
    <CreateServerWizard
      initialSourcePath={createServerSourcePath}
      showHeading={false}
      onHeaderHiddenChange={setCreateServerHeaderHidden}
      onHeaderBackChange={handleCreateServerHeaderBackChange}
      onLifecycleChange={setCreateServerLifecycle}
      onProgressChange={setCreateServerProgress}
      onCreated={() => {
        resetCreateServer();
        openServersOverview();
      }}
    />
  </section>
) : existingPageContent}
```

页面的 `aria-labelledby` 和 className 必须根据创建状态切换。移除创建流程的 `Dialog.Root`、`Dialog.Portal`、`Dialog.Overlay` 和 `Dialog.Content`。

- [ ] **步骤 5：加入放弃创建确认和本地化文本**

```tsx
<ConfirmDangerDialog
  confirmLabel={t("danger.labels.discardCreation")}
  description={t("danger.createServer.discard.description")}
  isOpen={pendingCreateExit !== null}
  title={t("danger.createServer.discard.title")}
  onCancel={() => setPendingCreateExit(null)}
  onConfirm={() => {
    const destination = pendingCreateExit;
    setPendingCreateExit(null);
    resetCreateServer();
    destination?.();
  }}
/>
```

新增文本：

```json
"danger.createServer.discard.title": "Discard server creation?",
"danger.createServer.discard.description": "Your current server creation choices have not been installed and will be lost.",
"danger.labels.discardCreation": "Discard creation"
```

```json
"danger.createServer.discard.title": "放弃创建服务器？",
"danger.createServer.discard.description": "当前创建选项尚未安装，离开后将丢失。",
"danger.labels.discardCreation": "放弃创建"
```

- [ ] **步骤 6：补充 job 开始后允许离开的测试**

让 `CreateServerWizard` mock 触发 `onLifecycleChange("running")`，随后点击侧栏设置，断言不出现放弃确认且设置页面打开。不得通过生产代码的测试专用 prop 绕过真实回调。

- [ ] **步骤 7：运行 AppShell 与向导测试**

```powershell
pnpm vitest run src/components/layout/AppShell.test.tsx src/features/servers/CreateServerWizard.test.tsx
```

预期：全部通过。

- [ ] **步骤 8：提交任务 4**

```powershell
git add src/components/layout/AppShell.tsx src/components/layout/AppShell.test.tsx src/i18n/locales/en.json src/i18n/locales/zh-CN.json
git commit -m "feat: show server creation in main content"
```

---

### 任务 5：内联布局契约与 Electron 验证

**文件：**

- 修改：`src/styles.test.mjs`
- 修改：`src/styles.css`
- 修改：`electron/ui-smoke.cjs`

**接口：**

- 使用：`.page-create-server`、`.create-server-page`、`.create-server-page-header`。
- 产出：创建页面占满主内容可用区域且不产生横向溢出。

- [ ] **步骤 1：写 CSS 契约失败测试**

在 `styles.test.mjs` 中断言：

```js
expect(styles).toMatch(/\.page-create-server\s*\{[^}]*overflow:\s*hidden;[^}]*padding:\s*0;/s);
expect(styles).toMatch(/\.create-server-page\s*\{[^}]*display:\s*flex;[^}]*min-height:\s*0;[^}]*height:\s*100%;/s);
expect(styles).not.toMatch(/\.create-server-dialog\s*\{/);
```

- [ ] **步骤 2：运行样式测试并确认失败**

```powershell
pnpm vitest run src/styles.test.mjs
```

预期：缺少内联页面规则，且仍存在 `.create-server-dialog`。

- [ ] **步骤 3：实现内联布局并清理失效样式**

```css
.page-create-server {
  overflow: hidden;
  padding: 0;
}

.create-server-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-panel);
}

.create-server-page-header {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: minmax(170px, 220px) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-4);
  padding: var(--space-4) var(--space-5);
  border-bottom: 1px solid var(--border-subtle);
}
```

把现有标题、步骤和响应式选择器从 `.create-server-dialog-header` 改为 `.create-server-page-header`，删除仅用于创建模态框尺寸、圆角和阴影的 `.create-server-dialog`。

- [ ] **步骤 4：更新 Electron UI smoke 的页面断言**

把等待条件从 `.create-server-dialog` 改为 `.create-server-page`，并加入：

```js
const inlineState = await window.webContents.executeJavaScript(`(() => ({
  createPage: Boolean(document.querySelector("main .create-server-page")),
  createDialog: Boolean(document.querySelector('[role="dialog"] .create-server-panel')),
  backdrop: Boolean(document.querySelector(".dialog-backdrop")),
}))()`);
if (!inlineState.createPage || inlineState.createDialog || inlineState.backdrop) {
  throw new Error(`Create server is not inline: ${JSON.stringify(inlineState)}`);
}
```

保留六步数量、两种视口几何、指针/键盘焦点和 renderer error 检查。

- [ ] **步骤 5：运行样式和目标前端测试**

```powershell
pnpm vitest run src/styles.test.mjs src/components/layout/AppShell.test.tsx src/features/servers/CreateServerMarketplaceBrowser.test.tsx
```

预期：全部通过。

- [ ] **步骤 6：提交任务 5**

```powershell
git add src/styles.css src/styles.test.mjs electron/ui-smoke.cjs
git commit -m "test: verify inline server creation layout"
```

---

### 任务 6：完整回归与审查

**文件：**

- 检查：本计划涉及的所有修改文件。

- [ ] **步骤 1：运行 TypeScript 检查**

```powershell
pnpm tsc
```

预期：退出码 0。

- [ ] **步骤 2：运行完整测试**

```powershell
pnpm vitest run
```

预期：所有测试文件和测试项通过，0 失败。

- [ ] **步骤 3：运行生产构建**

```powershell
pnpm build
```

预期：TypeScript 与 Vite 构建退出码 0。

- [ ] **步骤 4：运行 Electron 后端与 UI 冒烟测试**

```powershell
pnpm test:electron-smoke
pnpm test:electron-ui-smoke
```

预期：provisioning smoke 和 UI smoke 均通过；UI smoke 不报告 renderer error。

- [ ] **步骤 5：进行变更范围复审**

```powershell
git diff --check
git status --short
git diff main...HEAD --stat
```

逐项确认：

- 创建页面只在主内容区。
- 未开始安装的离开确认覆盖侧栏、返回和关闭入口。
- job 创建后离开不阻止后台任务。
- BBSMC 直链经过前后端双重检查。
- 外部网盘不能进入 artifact。
- EULA 仍由用户主动确认。
- 无 CurseForge API 密钥依赖。
- 没有无关重构或格式化。

- [ ] **步骤 6：提交必要的最终修正**

只有在步骤 1–5 发现并修复问题时执行：

```powershell
git add electron/backend.cjs electron/backend.test.mjs electron/ui-smoke.cjs src/components/layout/AppShell.tsx src/components/layout/AppShell.test.tsx src/features/servers/CreateServerMarketplaceBrowser.tsx src/features/servers/CreateServerMarketplaceBrowser.test.tsx src/features/servers/CreateServerWizard.tsx src/features/servers/CreateServerWizard.test.tsx src/i18n/locales/en.json src/i18n/locales/zh-CN.json src/styles.css src/styles.test.mjs
git commit -m "fix: address inline creation review"
```
