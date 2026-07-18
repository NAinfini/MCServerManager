# Full Server Provisioning Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a complete server-pack workflow from local drag/drop or in-app Modrinth/CurseForge discovery through compatibility checks, Java installation, configuration, explicit EULA acceptance, provisioning, and startup for Vanilla, Paper, Fabric, Forge, NeoForge, and Quilt.

**Architecture:** Add a native, resumable provisioning subsystem behind the existing Electron command bridge. Source adapters produce a side-effect-free plan; a persisted job executes that plan in a same-volume staging directory; loader adapters produce structured launch specifications that the existing process manager can execute without a shell. Existing profiles keep their legacy `server.jar` path.

**Tech Stack:** Electron CommonJS backend, Node.js 22 APIs, SQLite `DatabaseSync`, React 19, TypeScript, TanStack Query, React Hook Form, Zod, Vitest, Testing Library, `yauzl` for streamed ZIP reads, and `yazl` for deterministic test fixtures.

---

## Working Rules

- Follow strict red-green-refactor for every behavior change.
- Keep provider HTTP calls injectable in tests; never call production APIs from automated tests.
- Never execute shell syntax or pack-supplied scripts.
- Run focused tests after every step and the full suite before each milestone commit.
- Preserve unrelated changes in the worktree.

### Task 1: Add ZIP tooling and provisioning contracts

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `electron/provisioning/contracts.cjs`
- Create: `electron/provisioning/archive.cjs`
- Create: `electron/provisioning/archive.test.mjs`

**Step 1: Add the archive dependencies**

Run:

```powershell
pnpm add yauzl
pnpm add -D yazl
```

Expected: `package.json` and `pnpm-lock.yaml` record the packages without changing unrelated dependency versions.

**Step 2: Write failing archive-safety tests**

Generate ZIPs in the test with `yazl`. Cover normal UTF-8 entries, `../escape`, absolute paths, drive/device paths, excessive entry count, excessive uncompressed bytes, high expansion ratio, and symbolic-link metadata.

```js
it("rejects entries that escape the destination", async () => {
  const archive = await zipFixture([["../escape.txt", "bad"]]);
  await expect(inspectZip(archive, DEFAULT_ARCHIVE_LIMITS)).rejects.toMatchObject({
    code: "ARCHIVE_UNSAFE_PATH",
  });
});
```

**Step 3: Verify red**

Run: `pnpm exec vitest run electron/provisioning/archive.test.mjs`

Expected: FAIL because `archive.cjs` does not yet export `inspectZip`, `readJsonEntry`, and `extractZipLayers`.

**Step 4: Implement contracts and streamed archive inspection**

Export immutable constants and constructors from `contracts.cjs`:

```js
const SUPPORTED_LOADERS = Object.freeze([
  "vanilla", "paper", "fabric", "forge", "neoForge", "quilt",
]);
const JOB_STAGES = Object.freeze([
  "planned", "downloading", "verifying", "extracting",
  "installingRuntime", "installingLoader", "writingConfiguration",
  "awaitingEula", "committing", "starting", "ready", "failed",
]);
```

Use `yauzl.openPromise()` and `for await (const entry of zip.eachEntry())`. Validate before opening a stream, enforce cumulative limits while streaming, reject links and encrypted/unsupported entries, normalize paths with POSIX separators, and write only below the resolved destination.

**Step 5: Verify green**

Run: `pnpm exec vitest run electron/provisioning/archive.test.mjs`

Expected: PASS.

**Step 6: Commit**

```powershell
git add package.json pnpm-lock.yaml electron/provisioning/contracts.cjs electron/provisioning/archive.cjs electron/provisioning/archive.test.mjs
git commit -m "feat: add safe provisioning archive reader"
```

### Task 2: Preserve `server.properties` while applying explicit settings

**Files:**
- Create: `electron/provisioning/properties.cjs`
- Create: `electron/provisioning/properties.test.mjs`
- Modify: `electron/backend.cjs`
- Modify: `electron/backend.test.mjs`

**Step 1: Write failing merge tests**

Cover comments, blank lines, unknown keys, CRLF/LF preservation, duplicate keys, values containing `=`, additions, and explicit-only overrides.

```js
it("updates only explicitly supplied keys", () => {
  const input = "# pack config\nmotd=Pack MOTD\ncustom-key=keep\n";
  expect(mergeProperties(input, { "server-port": "25570" }).raw).toBe(
    "# pack config\nmotd=Pack MOTD\ncustom-key=keep\nserver-port=25570\n",
  );
});
```

**Step 2: Verify red**

Run: `pnpm exec vitest run electron/provisioning/properties.test.mjs`

Expected: FAIL because `mergeProperties` is missing.

**Step 3: Implement the line-preserving merge**

Return `{ raw, entries, warnings }`; update the final active occurrence of a duplicate key, preserve all other lines, and append new keys in input order. Reject invalid keys containing whitespace, `=`, CR, or LF.

**Step 4: Route backend saves through the merge**

Change `saveServerProperties` to merge updates into the existing raw file instead of reconstructing every line. Keep the current bridge input shape compatible.

**Step 5: Verify focused and backend tests**

Run:

```powershell
pnpm exec vitest run electron/provisioning/properties.test.mjs electron/backend.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add electron/provisioning/properties.cjs electron/provisioning/properties.test.mjs electron/backend.cjs electron/backend.test.mjs
git commit -m "fix: preserve server properties during updates"
```

### Task 3: Migrate persistence for Quilt, launch specs, sources, EULA, and jobs

**Files:**
- Modify: `electron/backend.cjs`
- Modify: `electron/backend.test.mjs`
- Modify: `src/features/servers/types.ts`

**Step 1: Write failing version-1 migration tests**

Build a version-1 database fixture, insert an existing Paper profile and restart policy, open it through `createBackend`, and assert:

- schema version becomes 2;
- existing profile fields remain unchanged;
- `quilt` can be inserted;
- launch spec is nullable for the legacy row;
- provisioning/source/EULA tables exist.

**Step 2: Verify red**

Run: `pnpm exec vitest run electron/backend.test.mjs -t "schema version 2"`

Expected: FAIL with schema version 1 or the loader constraint rejecting Quilt.

**Step 3: Implement transactional schema version 2**

Rebuild `servers` inside a transaction so the loader check includes `quilt`. Add `launch_spec_json` and `compatibility_warning_json`. Add:

```sql
CREATE TABLE provisioning_jobs (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
  stage TEXT NOT NULL,
  plan_json TEXT NOT NULL,
  progress_json TEXT NOT NULL,
  staging_dir TEXT,
  target_dir TEXT NOT NULL,
  error_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE server_sources (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  project_id TEXT,
  version_id TEXT,
  source_path TEXT,
  metadata_json TEXT NOT NULL
);
CREATE TABLE server_eula_acceptances (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  terms_url TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);
```

Map `quilt` in backend loader maps and extend `LoaderType`.

**Step 4: Verify green and full backend regression**

Run: `pnpm exec vitest run electron/backend.test.mjs`

Expected: PASS.

**Step 5: Commit**

```powershell
git add electron/backend.cjs electron/backend.test.mjs src/features/servers/types.ts
git commit -m "feat: persist provisioning and quilt profiles"
```

### Task 4: Parse local Modrinth and CurseForge server packs

**Files:**
- Create: `electron/provisioning/sources.cjs`
- Create: `electron/provisioning/sources.test.mjs`
- Modify: `electron/backend.cjs`
- Modify: `electron/backend.test.mjs`

**Step 1: Write failing source-adapter tests**

Create deterministic `.mrpack` and CurseForge ZIP fixtures in the test. Assert:

- Minecraft and loader dependencies are detected;
- Quilt is normalized to `quilt`;
- Modrinth `server: unsupported` files are excluded;
- optional server files are returned as user decisions;
- `overrides` is applied before `server-overrides`;
- CurseForge `manifest.json` metadata is normalized;
- generic ZIPs become `unverified` with a warning;
- client-only archives require a compatibility acknowledgement.

**Step 2: Verify red**

Run: `pnpm exec vitest run electron/provisioning/sources.test.mjs`

Expected: FAIL because `planLocalPack` is missing.

**Step 3: Implement `planLocalPack`**

Return a serializable plan with:

```js
{
  source, pack, minecraftVersion, loaderType, loaderVersion,
  requiredJavaMajor, artifacts, archiveLayers, optionalFiles,
  properties, warnings, integrity, estimatedBytes,
}
```

Do not create a profile or write into the final target.

**Step 4: Replace placeholder preview behavior**

Route `preview_modpack_import_command` through the adapter and add a `plan_server_provisioning` bridge command for local sources. Keep the old preview response fields during migration.

**Step 5: Verify green**

Run:

```powershell
pnpm exec vitest run electron/provisioning/sources.test.mjs electron/backend.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add electron/provisioning/sources.cjs electron/provisioning/sources.test.mjs electron/backend.cjs electron/backend.test.mjs
git commit -m "feat: inspect local server modpacks"
```

### Task 5: Return server-aware Modrinth and CurseForge marketplace plans

**Files:**
- Modify: `electron/backend.cjs`
- Modify: `electron/backend.test.mjs`
- Modify: `src/features/marketplace/marketplaceApi.ts`
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.tsx`
- Modify: `src/features/servers/CreateServerMarketplaceBrowser.test.tsx`

**Step 1: Write failing backend provider tests**

Inject provider fetch responses and assert:

- Modrinth version files preserve `.mrpack`, hashes, size, release type, and server compatibility metadata;
- CurseForge files preserve `isServerPack`, `serverPackFileId`, loader type, hashes, download size, and release type;
- a client file with `serverPackFileId` resolves to the server-pack file;
- a file without a server pack remains selectable only as unverified.

**Step 2: Verify red**

Run: `pnpm exec vitest run electron/backend.test.mjs -t "server pack metadata"`

Expected: FAIL because current provider mapping discards those fields.

**Step 3: Implement provider normalization and planning**

Add a marketplace source branch to `plan_server_provisioning`. Use the provider's actual downloadable pack file; do not call generic `installRemoteContent` for modpacks.

**Step 4: Write failing renderer badge/filter tests**

Assert server packs are labeled and sorted first, Quilt is filterable, and unverified selections open a specific acknowledgement dialog.

**Step 5: Implement the marketplace UX**

Keep Modrinth and CurseForge in the creation browser. Remove BBSMC from this server-creation path without removing it from general content browsing.

**Step 6: Verify green**

Run:

```powershell
pnpm exec vitest run electron/backend.test.mjs src/features/servers/CreateServerMarketplaceBrowser.test.tsx
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add electron/backend.cjs electron/backend.test.mjs src/features/marketplace/marketplaceApi.ts src/features/servers/CreateServerMarketplaceBrowser.tsx src/features/servers/CreateServerMarketplaceBrowser.test.tsx
git commit -m "feat: discover dedicated server packs"
```

### Task 6: Add six trusted loader adapters and structured launch specs

**Files:**
- Create: `electron/provisioning/loaders.cjs`
- Create: `electron/provisioning/loaders.test.mjs`
- Modify: `electron/backend.cjs`
- Modify: `electron/backend.test.mjs`
- Modify: `src/features/loaders/loaderBranding.ts`
- Modify: `src/features/loaders/LoaderSelect.tsx`
- Modify: `src/features/loaders/LoaderSelect.test.tsx`
- Add: `public/brand/quilt-logo.svg`

**Step 1: Write failing adapter tests**

For Vanilla, Paper, Fabric, Forge, NeoForge, and Quilt, provide local metadata fixtures and assert version discovery, approved hosts, installer artifacts, validation outputs, and structured launch specs. Cover legacy jar mode and modern Forge/NeoForge argument-file mode.

```js
expect(spec).toEqual({
  executable: { kind: "java" },
  jvmArgs: ["@user_jvm_args.txt", "@libraries/.../win_args.txt"],
  serverArgs: ["nogui"],
  workingDirectory: ".",
});
```

**Step 2: Verify red**

Run: `pnpm exec vitest run electron/provisioning/loaders.test.mjs`

Expected: FAIL because the registry and Quilt adapter do not exist.

**Step 3: Implement the adapter registry**

Adapters expose `listMinecraftVersions`, `listLoaderVersions`, `buildInstallPlan`, `install`, and `validate`. Network and process execution are injected. Installers run with `shell: false`; arguments are arrays.

**Step 4: Route loader catalog commands through the registry**

Preserve existing response types. Add Quilt branding and selection.

**Step 5: Verify green**

Run:

```powershell
pnpm exec vitest run electron/provisioning/loaders.test.mjs electron/backend.test.mjs src/features/loaders/LoaderSelect.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add electron/provisioning/loaders.cjs electron/provisioning/loaders.test.mjs electron/backend.cjs electron/backend.test.mjs src/features/loaders public/brand/quilt-logo.svg
git commit -m "feat: provision six server loaders"
```

### Task 7: Install application-managed Temurin runtimes with consent

**Files:**
- Create: `electron/provisioning/runtimes.cjs`
- Create: `electron/provisioning/runtimes.test.mjs`
- Modify: `electron/backend.cjs`
- Modify: `electron/backend.test.mjs`
- Modify: `src/features/java/javaApi.ts`
- Modify: `src/features/java/JavaRuntimesView.tsx`
- Modify: `src/features/java/JavaRuntimesView.test.tsx`

**Step 1: Write failing runtime tests**

Assert Java requirements for supported Minecraft versions, compatible installed-runtime selection, correct Adoptium OS/architecture request, explicit-consent enforcement, SHA-256 verification, app-local extraction, executable validation, and cleanup after bad hashes.

**Step 2: Verify red**

Run: `pnpm exec vitest run electron/provisioning/runtimes.test.mjs`

Expected: FAIL because runtime planning/install is missing.

**Step 3: Implement runtime planning and install**

Managed runtimes install below `<userData>/runtimes/temurin/<major>/<os>-<arch>/`. Never update system `PATH` or registry. Return metadata including vendor, version, path, license URL, checksum, and managed status.

**Step 4: Add bridge commands and renderer consent UI**

Add `plan_java_runtime` and `install_java_runtime`. Reuse detected runtimes first. Show Oracle and Temurin manual links without making Oracle the automated source.

**Step 5: Verify green**

Run:

```powershell
pnpm exec vitest run electron/provisioning/runtimes.test.mjs electron/backend.test.mjs src/features/java/JavaRuntimesView.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add electron/provisioning/runtimes.cjs electron/provisioning/runtimes.test.mjs electron/backend.cjs electron/backend.test.mjs src/features/java
git commit -m "feat: install managed Temurin runtimes"
```

### Task 8: Persist and execute resumable provisioning jobs

**Files:**
- Create: `electron/provisioning/jobs.cjs`
- Create: `electron/provisioning/jobs.test.mjs`
- Modify: `electron/backend.cjs`
- Modify: `electron/backend.test.mjs`

**Step 1: Write failing job-state tests**

Cover stage ordering, persisted progress, same-parent staging, download failure, hash failure, safe cancellation, app restart recovery, idempotent retry, atomic commit, existing-target conflict, and post-commit startup failure.

**Step 2: Verify red**

Run: `pnpm exec vitest run electron/provisioning/jobs.test.mjs`

Expected: FAIL because `createJob`, `executeJob`, `retryJob`, `cancelJob`, and `listRecoverableJobs` are missing.

**Step 3: Implement the executor**

Inject filesystem, downloader, archive, runtime registry, loader registry, clock, and ID generator. Persist before and after each stage. Wrap failures as:

```js
{
  code, stage, message, detail, retryable, cleanupRequired,
}
```

Do not silently change artifacts, versions, loaders, or Java versions after a failure.

**Step 4: Add backend commands**

Add `create_provisioning_job`, `get_provisioning_job`, `list_provisioning_jobs`, `run_provisioning_job`, `retry_provisioning_job`, and `cancel_provisioning_job`.

**Step 5: Verify green**

Run:

```powershell
pnpm exec vitest run electron/provisioning/jobs.test.mjs electron/backend.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add electron/provisioning/jobs.cjs electron/provisioning/jobs.test.mjs electron/backend.cjs electron/backend.test.mjs
git commit -m "feat: execute resumable server provisioning jobs"
```

### Task 9: Enforce configuration, compatibility, EULA, and atomic profile creation

**Files:**
- Modify: `electron/provisioning/jobs.cjs`
- Modify: `electron/provisioning/jobs.test.mjs`
- Modify: `electron/backend.cjs`
- Modify: `electron/backend.test.mjs`
- Modify: `src/features/servers/types.ts`

**Step 1: Write failing gate tests**

Assert that execution cannot enter `committing` without:

- explicit acknowledgement for every required compatibility warning;
- explicit EULA acceptance;
- valid memory ordering and port;
- a validated Java runtime;
- a validated loader launch spec.

Also assert EULA acceptance writes `eula=true`, stores the terms URL and timestamp, and cannot be inferred from `autoStart`.

**Step 2: Verify red**

Run: `pnpm exec vitest run electron/provisioning/jobs.test.mjs -t "EULA"`

Expected: FAIL because the gate is missing.

**Step 3: Implement explicit configuration mapping**

Map only supplied values to Minecraft keys:

```js
{
  serverPort: "server-port",
  gameMode: "gamemode",
  difficulty: "difficulty",
  maxPlayers: "max-players",
  motd: "motd",
  onlineMode: "online-mode",
  pvp: "pvp",
  whiteList: "white-list",
  viewDistance: "view-distance",
  simulationDistance: "simulation-distance",
}
```

Create the server profile and source/EULA records in one database transaction only after the file commit succeeds. If database commit fails, restore the prior target name.

**Step 4: Verify green**

Run:

```powershell
pnpm exec vitest run electron/provisioning/jobs.test.mjs electron/backend.test.mjs
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add electron/provisioning/jobs.cjs electron/provisioning/jobs.test.mjs electron/backend.cjs electron/backend.test.mjs src/features/servers/types.ts
git commit -m "feat: gate server creation on explicit approval"
```

### Task 10: Start structured launch specs and keep legacy startup working

**Files:**
- Modify: `electron/backend.cjs`
- Modify: `electron/backend.test.mjs`
- Modify: `src/features/servers/setupApi.ts`
- Modify: `src/features/servers/ServerSetupChecklist.tsx`
- Modify: `src/features/servers/ServerSetupChecklist.test.tsx`

**Step 1: Write failing process tests**

Assert exact spawn executable, arguments, working directory, `shell: false`, memory argument placement, and environment for jar and arg-file specs. Assert malformed or shell-like specs are rejected. Keep a regression test for a legacy `server.jar` profile.

**Step 2: Verify red**

Run: `pnpm exec vitest run electron/backend.test.mjs -t "launch specification"`

Expected: FAIL because startup still hardcodes `server.jar`.

**Step 3: Implement launch-spec validation and startup**

Resolve only application-recognized Java paths and target-relative files. Reject CR/LF, shell operators, absolute pack-controlled executables, and arguments outside configured limits.

**Step 4: Generalize readiness checks**

Replace the UI/backend `serverJar` concept with `serverRuntime`, while keeping compatibility fields for legacy callers. Readiness requires a valid launch spec or legacy `server.jar`, compatible Java, and EULA acceptance.

**Step 5: Verify green**

Run:

```powershell
pnpm exec vitest run electron/backend.test.mjs src/features/servers/ServerSetupChecklist.test.tsx
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add electron/backend.cjs electron/backend.test.mjs src/features/servers/setupApi.ts src/features/servers/ServerSetupChecklist.tsx src/features/servers/ServerSetupChecklist.test.tsx
git commit -m "feat: start provisioned loader runtimes"
```

### Task 11: Replace the create wizard with the unified six-step flow

**Files:**
- Create: `src/features/servers/provisioningApi.ts`
- Create: `src/features/servers/ProvisioningProgress.tsx`
- Create: `src/features/servers/ProvisioningProgress.test.tsx`
- Modify: `src/features/servers/CreateServerWizard.tsx`
- Modify: `src/features/servers/CreateServerWizard.test.tsx`
- Modify: `src/features/servers/DropDetectionModal.tsx`
- Modify: `src/features/servers/DropImportOverlay.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`
- Modify: `src/styles.css`

**Step 1: Write failing wizard flow tests**

Cover all four entry paths and assert the steps Source, Compatibility, Java, Server configuration, Review and EULA, and Install and start. Test explicit compatibility acknowledgement, Java consent, all guided configuration fields, unchecked EULA, progress, retry, cancellation, successful start, and persisted job recovery.

**Step 2: Verify red**

Run: `pnpm exec vitest run src/features/servers/CreateServerWizard.test.tsx`

Expected: FAIL because the current four-step wizard creates a profile before provisioning.

**Step 3: Implement typed provisioning API**

Define serializable TypeScript types matching backend plans/jobs. Keep command errors visible through `invokeDesktopCommandWithErrorHandling`.

**Step 4: Implement the six-step state machine**

Planning must complete before compatibility UI. Profile creation must be removed from the old early mutation. The final action creates/runs a job and polls its persisted state. EULA remains unchecked on every fresh plan.

**Step 5: Route drag/drop through planning**

Drop and file-picker paths use the identical planning command. Multiple dropped paths remain rejected with a clear message unless a future plan explicitly supports them.

**Step 6: Verify green**

Run:

```powershell
pnpm exec vitest run src/features/servers/CreateServerWizard.test.tsx src/features/servers/ProvisioningProgress.test.tsx
```

Expected: PASS with no accessibility warnings.

**Step 7: Commit**

```powershell
git add src/features/servers src/i18n/locales/en.json src/i18n/locales/zh-CN.json src/styles.css
git commit -m "feat: add guided server provisioning flow"
```

### Task 12: Complete guided configuration and honest runtime statistics

**Files:**
- Modify: `src/features/servers/ServerProfileSettings.tsx`
- Modify: `src/features/servers/ServerProfileSettings.test.tsx`
- Modify: `src/features/config/ServerPropertiesEditor.tsx`
- Modify: `src/features/config/ServerPropertiesEditor.test.tsx`
- Modify: `electron/backend.cjs`
- Modify: `electron/backend.test.mjs`
- Modify: `src/features/performance/PerformanceHistoryView.tsx`
- Modify: `src/features/performance/PerformanceHistoryView.test.tsx`
- Modify: `src/i18n/locales/en.json`
- Modify: `src/i18n/locales/zh-CN.json`

**Step 1: Write failing settings tests**

Assert all guided gameplay fields load from properties, save only changed values, preserve advanced content, and mark restart-required changes without restarting.

**Step 2: Write failing metric-availability tests**

Assert CPU, memory, uptime, restart count, and player count show measured values; absent values show a reason; TPS is unavailable unless a real provider returns it.

**Step 3: Verify red**

Run:

```powershell
pnpm exec vitest run src/features/servers/ServerProfileSettings.test.tsx src/features/config/ServerPropertiesEditor.test.tsx src/features/performance/PerformanceHistoryView.test.tsx
```

Expected: FAIL on the new fields and availability labels.

**Step 4: Implement guided properties and stat availability**

Reuse the line-preserving property merge. Do not synthesize TPS. Keep sampling overhead bounded and reuse existing metric storage.

**Step 5: Verify green**

Run the same focused command plus `pnpm exec vitest run electron/backend.test.mjs`.

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/features/servers/ServerProfileSettings.tsx src/features/servers/ServerProfileSettings.test.tsx src/features/config src/features/performance electron/backend.cjs electron/backend.test.mjs src/i18n/locales
git commit -m "feat: complete server configuration and statistics"
```

### Task 13: Add recovery UI, documentation, and desktop smoke coverage

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `PRODUCT.md`
- Modify: `PRODUCT.zh-CN.md`
- Modify: `docs.test.mjs`
- Create: `electron/provisioning-smoke.test.mjs`
- Modify: `package.json`

**Step 1: Write failing recovery and documentation tests**

Assert app startup lists unfinished jobs and exposes Resume/Cleanup. Update documentation contract tests so the first-server flow describes automatic trusted provisioning, explicit EULA, managed Java, supported loaders, and server-pack warnings.

**Step 2: Verify red**

Run:

```powershell
pnpm exec vitest run src/App.test.tsx docs.test.mjs electron/provisioning-smoke.test.mjs
```

Expected: FAIL because recovery UI, docs, and smoke script are missing.

**Step 3: Implement recovery UI and deterministic smoke fixture**

The smoke test uses local fixture URLs and a fake Java-compatible child process; it must not contact production APIs or accept the EULA implicitly. Add `test:electron-smoke` to `package.json`.

**Step 4: Update product documentation**

Remove obsolete claims that the user must always provide `server.jar`. Document automatic source selection, explicit approvals, remaining provider limitations, and the security rule against pack scripts.

**Step 5: Verify green**

Run:

```powershell
pnpm exec vitest run src/App.test.tsx docs.test.mjs electron/provisioning-smoke.test.mjs
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src/App.tsx src/App.test.tsx README.md README.zh-CN.md PRODUCT.md PRODUCT.zh-CN.md docs.test.mjs electron/provisioning-smoke.test.mjs package.json
git commit -m "test: cover server provisioning recovery"
```

### Task 14: Final verification and mandatory engineering review

**Files:**
- Review all files changed on `codex/full-server-provisioning`

**Step 1: Run whitespace and repository checks**

Run:

```powershell
git diff --check main...HEAD
git status --short
```

Expected: no whitespace errors; only intentional files are changed.

**Step 2: Run the complete test suite**

Run: `pnpm exec vitest run`

Expected: every test file and test passes with zero failures.

**Step 3: Run the production build**

Run: `pnpm run build`

Expected: TypeScript and Vite exit 0.

**Step 4: Run desktop smoke verification**

Run: `npm run test:electron-smoke`

Expected: deterministic local provisioning, start, output, stop, and recovery checks pass.

**Step 5: Review requirements and risks**

Record evidence for:

- requirement completeness across local, Modrinth, and CurseForge sources;
- correctness of all six loader paths and legacy startup;
- side effects and rollback behavior;
- network, archive, credential, EULA, and command-injection security;
- download/extraction and metrics performance;
- migration and adapter maintainability.

Any discovered defect requires a new failing regression test before its fix.

**Step 6: Commit final review-only corrections if required**

```powershell
git add <only-reviewed-files>
git commit -m "fix: address provisioning verification findings"
```

Do not create an empty commit when no correction is needed.
