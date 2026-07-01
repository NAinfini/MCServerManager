# MC Server Manager Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first standalone Tauri desktop version of MC Server Manager with tray runtime, server profiles, process supervision, console logs, Java checks, world backups, file editing, marketplace foundations, and update checks.

**Architecture:** The React/Tauri desktop app owns both the visible window and the tray background runtime. Rust owns filesystem access, process lifecycle, SQLite persistence, downloads, backup operations, and provider adapters. The frontend talks to Rust through typed Tauri commands and renders state through TanStack Query plus event streams.

**Tech Stack:** Tauri v2, Rust, React, TypeScript, Vite, SQLite, sqlx, pnpm, Radix Primitives, Tailwind CSS, CVA, Lucide React, Motion, TanStack Query, Zustand, React Hook Form, Zod, Monaco Editor, xterm.js, Vitest, Testing Library.

---

## Source Design

Use `docs/plans/2026-07-01-mc-server-manager-design.md` as the source of truth.

Key constraints:

- No machine-wide service in the first version.
- Tray runtime owns managed Java processes.
- App state lives in per-user AppData/XDG data.
- No RCON in the first version.
- Do not install updates while any managed server is running.
- Default backup scope is world-only.
- Marketplace remains in MVP, but marketplace and backup UI are scoped to the selected server instead of the main sidebar.
- Creating a server supports blank server, existing folder import, marketplace modpack, and local modpack file.
- Include scheduled tasks, structured server properties editing, player-list management, resource history, server update management, backup profiles, desktop notifications, profile import/export, diagnostics, and mod/plugin update policies.
- CurseForge is manual/local import only until API-key handling is added.
- BBSMC supports only public free resources and must be isolated, rate-limited, and disable-able.
- No telemetry.

## Task 1: Scaffold Tauri React TypeScript App

**Files:**
- Create: `package.json`
- Create: `pnpm-lock.yaml`
- Create: `index.html`
- Create: `vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/styles.css`
- Create: `src-tauri/Cargo.toml`
- Create: `src-tauri/tauri.conf.json`
- Create: `src-tauri/src/main.rs`
- Create: `src-tauri/src/lib.rs`
- Create: `src-tauri/capabilities/default.json`

**Step 1: Scaffold into a temporary directory**

Run:

```powershell
pnpm create tauri-app mcsm-scaffold
```

Interactive choices:

```text
language: TypeScript / JavaScript
package manager: pnpm
UI template: React
UI flavor: TypeScript
```

Expected: a temporary `mcsm-scaffold` directory containing a Tauri v2 React app.

**Step 2: Move scaffolded files into the repo root**

Copy the scaffold contents into `C:\Users\nainf\OneDrive\Documents\GitHub\MCServerManager` without deleting `docs/` or `.git/`.

Expected: root contains `package.json`, `src/`, and `src-tauri/`.

**Step 3: Add required frontend dependencies**

Run:

```powershell
pnpm add @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-tabs @radix-ui/react-tooltip @radix-ui/react-popover @radix-ui/react-switch @radix-ui/react-slider @radix-ui/react-select @radix-ui/react-scroll-area lucide-react motion clsx tailwind-merge class-variance-authority @tanstack/react-query zustand react-hook-form zod @hookform/resolvers @tanstack/react-table @tanstack/react-virtual @monaco-editor/react xterm
pnpm add -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom tailwindcss @tailwindcss/vite prettier
```

Expected: dependencies install without peer dependency errors.

**Step 4: Add required Rust dependencies**

Run:

```powershell
cd src-tauri
cargo add serde serde_json thiserror tokio --features tokio/full
cargo add sqlx --features sqlite,runtime-tokio-rustls,macros,migrate
cargo add directories uuid chrono tracing tracing-subscriber zip walkdir sha2 reqwest --features reqwest/json,reqwest/rustls-tls
cd ..
```

Expected: `src-tauri/Cargo.toml` includes persistence, async, tracing, archive, hash, and HTTP dependencies.

**Step 5: Verify scaffold runs**

Run:

```powershell
pnpm tauri dev
```

Expected: app window opens with scaffold UI.

**Step 6: Commit**

```powershell
git add package.json pnpm-lock.yaml index.html vite.config.ts tsconfig.json tsconfig.node.json src src-tauri
git commit -m "chore: scaffold tauri react app"
```

## Task 2: Establish App Layout, Styling, And Tests

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/styles.css`
- Create: `src/components/layout/AppShell.tsx`
- Create: `src/components/layout/Sidebar.tsx`
- Create: `src/components/ui/button.tsx`
- Create: `src/components/ui/status-badge.tsx`
- Create: `src/lib/cn.ts`
- Create: `src/test/setup.ts`
- Modify: `vite.config.ts`

**Step 1: Write failing component tests**

Create `src/components/layout/AppShell.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

describe("AppShell", () => {
  it("renders the main navigation regions", () => {
    render(<AppShell />);
    expect(screen.getByRole("navigation", { name: /primary/i })).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
  });
});
```

**Step 2: Run test to verify it fails**

Run:

```powershell
pnpm vitest run src/components/layout/AppShell.test.tsx
```

Expected: FAIL because `AppShell` does not exist.

**Step 3: Implement minimal clean professional desktop shell**

Create a left sidebar, top server status strip, main content region, and placeholder server overview. Use custom CSS variables and avoid generic SaaS card nesting.

**Step 4: Run tests**

Run:

```powershell
pnpm vitest run
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src vite.config.ts
git commit -m "feat: add desktop app shell"
```

## Task 3: Add Rust App State, Data Directory, And SQLite

**Files:**
- Create: `src-tauri/src/app_state.rs`
- Create: `src-tauri/src/db.rs`
- Create: `src-tauri/migrations/0001_initial.sql`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/main.rs`

**Step 1: Write failing Rust tests**

Create `src-tauri/src/app_state.rs` with tests first:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_data_dir_uses_app_name() {
        let path = app_data_dir_for("MCServerManager").unwrap();
        assert!(path.to_string_lossy().contains("MCServerManager"));
    }
}
```

Expected initially: FAIL because `app_data_dir_for` does not exist.

**Step 2: Run failing test**

Run:

```powershell
cd src-tauri
cargo test app_data_dir_uses_app_name
cd ..
```

Expected: FAIL.

**Step 3: Implement app data directory and SQLite connection**

Implement:

- `app_data_dir_for(app_name: &str) -> Result<PathBuf, AppError>`
- `Database::connect(app_data_dir: &Path) -> Result<SqlitePool, AppError>`
- migration runner using `sqlx::migrate!()`

**Step 4: Add initial schema**

`src-tauri/migrations/0001_initial.sql` should create:

```sql
CREATE TABLE servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  root_dir TEXT NOT NULL,
  minecraft_version TEXT,
  loader_type TEXT NOT NULL,
  loader_version TEXT,
  java_path TEXT,
  server_port INTEGER,
  min_memory_mb INTEGER,
  max_memory_mb INTEGER,
  auto_start INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE server_restart_policies (
  server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  cooldown_seconds INTEGER NOT NULL DEFAULT 30
);

CREATE TABLE managed_processes (
  id TEXT PRIMARY KEY,
  server_id TEXT REFERENCES servers(id) ON DELETE SET NULL,
  pid INTEGER,
  command TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  exited_at TEXT,
  exit_code INTEGER
);

CREATE TABLE process_events (
  id TEXT PRIMARY KEY,
  server_id TEXT,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

**Step 5: Run tests**

Run:

```powershell
cd src-tauri
cargo test
cd ..
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src-tauri
git commit -m "feat: add app state and sqlite foundation"
```

## Task 4: Add Server Profile CRUD

**Files:**
- Create: `src-tauri/src/profiles.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/features/servers/api.ts`
- Create: `src/features/servers/types.ts`
- Create: `src/features/servers/ServerList.tsx`
- Create: `src/features/servers/ServerCreateForm.tsx`
- Create: `src/features/servers/CreateServerWizard.tsx`
- Modify: `src/App.tsx`

**Step 1: Write Rust tests for profile validation**

Test cases:

- rejects empty name
- rejects root path that does not exist for import
- accepts a marketplace modpack creation source without requiring an existing server profile
- defaults restart policy
- persists and lists a created profile

**Step 2: Run failing Rust tests**

Run:

```powershell
cd src-tauri
cargo test profiles
cd ..
```

Expected: FAIL until profile repository exists.

**Step 3: Implement Tauri commands**

Expose:

```rust
#[tauri::command]
async fn create_server_profile(input: CreateServerProfileInput, state: State<'_, AppState>) -> Result<ServerProfile, AppError>;

#[tauri::command]
async fn list_server_profiles(state: State<'_, AppState>) -> Result<Vec<ServerProfile>, AppError>;

#[tauri::command]
async fn update_server_profile(input: UpdateServerProfileInput, state: State<'_, AppState>) -> Result<ServerProfile, AppError>;

#[tauri::command]
async fn delete_server_profile(id: String, state: State<'_, AppState>) -> Result<(), AppError>;
```

**Step 4: Implement frontend list and create wizard**

Use React Hook Form + Zod. The first form fields:

- source: blank server, existing folder, marketplace modpack, local modpack file
- name
- root directory
- loader type
- Minecraft version
- Java path
- port
- min/max memory

Marketplace modpack source opens a modpack picker and creates a new server profile from the selected pack.

**Step 5: Run verification**

Run:

```powershell
pnpm vitest run
cd src-tauri
cargo test
cd ..
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add server profile management"
```

## Task 5: Add Tray Runtime And Close Behavior

**Files:**
- Create: `src-tauri/src/tray.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src/features/app/CloseBehaviorDialog.tsx`
- Modify: `src/App.tsx`

**Step 1: Write behavior checklist test**

Add frontend tests verifying the close dialog offers:

- minimize to tray
- quit app
- cancel

**Step 2: Implement tray**

Use Tauri tray APIs to:

- show app
- hide app
- quit app
- show running server count in tooltip if supported

**Step 3: Implement close prompt**

When the window close event fires:

- if no servers are running, allow normal close or minimize based on user preference
- if servers are running, warn that quitting stops supervision
- allow minimize to tray

**Step 4: Verify manually**

Run:

```powershell
pnpm tauri dev
```

Expected:

- closing the window prompts user
- minimize keeps app in tray
- tray menu restores window

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add tray runtime close behavior"
```

## Task 6: Add Process Supervisor With Fake Java Server Test

**Files:**
- Create: `src-tauri/src/process/mod.rs`
- Create: `src-tauri/src/process/supervisor.rs`
- Create: `src-tauri/src/process/fake_java_server.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/features/console/ConsoleView.tsx`
- Create: `src/features/servers/ServerActions.tsx`

**Step 1: Create fake Java server fixture**

The fake process must:

- print startup log lines
- read stdin
- exit on `stop`
- echo received commands
- optionally exit with code 1 to simulate crash

**Step 2: Write failing Rust tests**

Tests:

- starts a managed process and records pid
- sends `stop` and records clean exit
- detects unexpected exit as crash
- does not treat user stop as crash

**Step 3: Run failing tests**

Run:

```powershell
cd src-tauri
cargo test process
cd ..
```

Expected: FAIL.

**Step 4: Implement supervisor**

Implement:

- `start_server(server_id)`
- `stop_server(server_id)`
- `restart_server(server_id)`
- stdout/stderr event capture
- stdin command send
- exit status tracking
- crash classification

**Step 5: Add frontend controls and console**

Use xterm.js for live log output. Keep command input explicit and visible.

**Step 6: Verify**

Run:

```powershell
cd src-tauri
cargo test process
cd ..
pnpm vitest run
```

Expected: PASS.

**Step 7: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add process supervisor and console"
```

## Task 7: Add Restart Policy And Reattach Detection

**Files:**
- Modify: `src-tauri/src/process/supervisor.rs`
- Modify: `src-tauri/src/profiles.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Modify: `src/features/servers/ServerCreateForm.tsx`
- Modify: `src/features/servers/ServerActions.tsx`

**Step 1: Write failing tests**

Tests:

- crashed process restarts when policy enabled
- restart stops after max attempts
- cooldown is respected
- app restart can mark likely previous process as externally running

**Step 2: Implement restart policy**

Use profile settings:

- enabled
- max attempts
- cooldown seconds

**Step 3: Implement conservative reattach**

Use stored pid, command, root directory, and process existence check. If confidence is low, mark `external_running`.

**Step 4: Verify**

Run:

```powershell
cd src-tauri
cargo test process restart
cd ..
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add restart policy and process reattach"
```

## Task 7A: Add Per-Server Players Tab

**Files:**
- Create: `src-tauri/src/players.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/features/players/PlayersView.tsx`
- Create: `src/features/players/PlayerActionDialog.tsx`
- Modify: `src/features/servers/ServerDetail.tsx`

**Step 1: Write failing tests**

Tests:

- lists known players from available server files when present
- disables player actions when the server is stopped
- sends `op <player>` through managed stdin after confirmation
- sends `deop <player>` through managed stdin after confirmation
- sends `ban <player>` through managed stdin after confirmation
- sends `pardon <player>` through managed stdin after confirmation
- sends `kick <player>` through managed stdin after confirmation
- does not expose an editable per-player command editor

**Step 2: Implement player commands**

Expose Tauri commands:

```rust
#[tauri::command]
async fn list_players(server_id: String, state: State<'_, AppState>) -> Result<PlayerState, AppError>;

#[tauri::command]
async fn apply_player_action(input: PlayerActionInput, state: State<'_, AppState>) -> Result<PlayerActionResult, AppError>;
```

Player actions use the managed process stdin path. Do not add RCON.

**Step 3: Implement Players UI**

Use a table with:

- username
- UUID when known
- online/offline/banned/op state
- first seen
- last seen
- action buttons

Action buttons open normal confirmation dialogs. Do not show a raw command builder or editable command preview.

**Step 4: Verify**

Run:

```powershell
cd src-tauri
cargo test players
cd ..
pnpm vitest run
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add per-server players tab"
```

## Task 8: Add Java Manager

**Files:**
- Create: `src-tauri/src/java.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/features/java/JavaRuntimesView.tsx`
- Create: `src/features/java/javaApi.ts`

**Step 1: Write failing Rust tests**

Tests:

- parses `java -version` output for Java 8
- parses Java 17 output
- parses Java 21 output
- rejects unknown output

**Step 2: Implement Java scan**

Search:

- configured Java path
- `JAVA_HOME`
- PATH `java`
- common Windows install directories
- common Linux install directories

**Step 3: Implement compatibility warnings**

Map Minecraft version ranges to Java major requirements in a data structure. Keep this easy to update.

**Step 4: Add download prompt**

Show download options and require explicit confirmation before app-managed download.

**Step 5: Verify**

Run:

```powershell
cd src-tauri
cargo test java
cd ..
pnpm vitest run
```

Expected: PASS.

**Step 6: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add java runtime manager"
```

## Task 9: Add Vanilla And Paper Loader Providers

**Files:**
- Create: `src-tauri/src/loaders/mod.rs`
- Create: `src-tauri/src/loaders/vanilla.rs`
- Create: `src-tauri/src/loaders/paper.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/features/loaders/LoaderSelect.tsx`

**Step 1: Write failing provider tests**

Tests:

- Vanilla provider returns server jar URL for a known version fixture
- Paper provider selects a build from metadata fixture
- providers return normalized launch command

**Step 2: Implement provider trait**

```rust
trait LoaderProvider {
    fn loader_type(&self) -> LoaderType;
    async fn resolve(&self, input: LoaderResolveInput) -> Result<ResolvedLoader, AppError>;
    async fn install(&self, input: LoaderInstallInput) -> Result<InstalledLoader, AppError>;
}
```

**Step 3: Implement Vanilla and Paper**

Use HTTP only through provider methods. Keep fixtures for tests.

**Step 4: Verify**

Run:

```powershell
cd src-tauri
cargo test loaders
cd ..
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add vanilla and paper loader providers"
```

## Task 10: Add World-Only Backup And Restore

**Files:**
- Create: `src-tauri/src/backup.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Create: `src/features/backups/ServerBackupsView.tsx`
- Create: `src/features/backups/backupApi.ts`

**Step 1: Write failing backup tests**

Tests:

- selects only active world directory by default
- sends `save-off`, `save-all flush`, copy, `save-on` in order when stdin is available
- attempts `save-on` after copy failure
- restore requires explicit target

**Step 2: Implement backup archive**

Create zip archives in app data backup directory:

```text
AppData/MCServerManager/backups/<server-id>/<timestamp>.zip
```

**Step 3: Implement restore**

Restore should:

- require confirmation
- stop server or warn if running
- replace target world directory
- record audit event

**Step 4: Verify**

Run:

```powershell
cd src-tauri
cargo test backup
cd ..
pnpm vitest run
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add world backup and restore"
```

## Task 11: Add Safe File Editor

**Files:**
- Create: `src-tauri/src/files.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/features/files/FileBrowser.tsx`
- Create: `src/features/files/FileEditor.tsx`
- Create: `src/features/files/fileApi.ts`

**Step 1: Write failing path safety tests**

Tests:

- blocks `..` traversal
- blocks symlink escape
- blocks binary files
- opens large files read-only
- creates edit backup before save

**Step 2: Implement Rust file commands**

Expose:

- `list_server_files(server_id, relative_path)`
- `read_server_text_file(server_id, relative_path)`
- `write_server_text_file(server_id, relative_path, content)`

**Step 3: Implement Monaco editor UI**

Only show save for writable text files. Show warnings for large files.

**Step 4: Verify**

Run:

```powershell
cd src-tauri
cargo test files
cd ..
pnpm vitest run
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add safe server file editor"
```

## Task 12: Add Update Check With Running-Server Guard

**Files:**
- Create: `src-tauri/src/app_updates.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`
- Create: `src/features/settings/UpdateStatus.tsx`

**Step 1: Write failing tests**

Tests:

- update install is blocked when any managed server is running
- update check can run while servers are running
- stable channel is the only channel

**Step 2: Configure Tauri updater plugin**

Configure updater but keep installer disabled until release signing/artifact publishing is set up.

**Step 3: Implement UI**

Show:

- current version
- last check result
- update available
- blocked because servers are running

**Step 4: Verify**

Run:

```powershell
cd src-tauri
cargo test app_updates
cd ..
pnpm vitest run
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add guarded update checks"
```

## Task 13: Add Local JAR Import And Metadata Parsing

**Files:**
- Create: `src-tauri/src/content/mod.rs`
- Create: `src-tauri/src/content/jar_metadata.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Create: `src/features/content/InstalledContentView.tsx`
- Create: `src/features/content/LocalImportDialog.tsx`

**Step 1: Write fixture tests**

Fixtures:

- Fabric `fabric.mod.json`
- Forge `META-INF/mods.toml`
- NeoForge `META-INF/neoforge.mods.toml`
- Paper `paper-plugin.yml`
- Bukkit `plugin.yml`

Tests:

- reads mod/plugin id
- reads version
- reads loader/environment when available
- warns on unknown jar

**Step 2: Implement import**

Copy local JARs into the correct server folder:

- mods for Forge/NeoForge/Fabric
- plugins for Paper

Keep original file hash and source path.

**Step 3: Implement warnings**

Warn but allow continue for:

- unknown metadata
- client-only content
- loader mismatch
- duplicate id/name

**Step 4: Verify**

Run:

```powershell
cd src-tauri
cargo test content
cd ..
pnpm vitest run
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add local content import"
```

## Task 14: Add Per-Server Modrinth Marketplace Provider

**Files:**
- Create: `src-tauri/src/content/providers/modrinth.rs`
- Modify: `src-tauri/src/content/mod.rs`
- Create: `src/features/marketplace/ServerMarketplaceView.tsx`
- Create: `src/features/marketplace/ProjectDetails.tsx`
- Create: `src/features/marketplace/InstallDialog.tsx`

**Step 1: Write provider fixture tests**

Use saved JSON fixtures for:

- search response
- project details
- versions
- dependencies

Tests:

- filters by Minecraft version and loader
- defaults filters from the selected server profile
- surfaces required dependencies
- surfaces incompatible dependencies as warnings
- verifies hash when available

**Step 2: Implement provider interface**

```rust
trait MarketplaceProvider {
    async fn search(&self, query: SearchQuery) -> Result<Vec<ProjectSummary>, AppError>;
    async fn project(&self, id: &str) -> Result<ProjectDetails, AppError>;
    async fn versions(&self, id: &str, filter: VersionFilter) -> Result<Vec<ProjectVersion>, AppError>;
    async fn download(&self, version: ProjectVersion) -> Result<DownloadedFile, AppError>;
}
```

**Step 3: Implement install with change journal**

Record added/replaced files before installation completes. Install actions always target the selected server.

**Step 4: Verify**

Run:

```powershell
cd src-tauri
cargo test modrinth
cd ..
pnpm vitest run
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add modrinth marketplace provider"
```

## Task 15: Add Hangar Provider And CurseForge Manual Import

**Files:**
- Create: `src-tauri/src/content/providers/hangar.rs`
- Create: `src-tauri/src/content/providers/curseforge_manual.rs`
- Modify: `src-tauri/src/content/mod.rs`
- Modify: `src/features/marketplace/ServerMarketplaceView.tsx`

**Step 1: Write provider tests**

Tests:

- Hangar plugin search fixture maps to plugin summaries
- CurseForge manual import records source as manual
- CurseForge manual import does not claim dependency resolution

**Step 2: Implement Hangar**

Support Paper plugin search/details/install where public metadata allows it.

**Step 3: Implement CurseForge manual import**

Allow:

- local file import
- user pasted known download URL

Do not add CurseForge full browsing or dependency resolution.

**Step 4: Verify**

Run:

```powershell
cd src-tauri
cargo test hangar curseforge
cd ..
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add hangar and curseforge manual import"
```

## Task 16: Add BBSMC Public Free Provider

**Files:**
- Create: `src-tauri/src/content/providers/bbsmc.rs`
- Modify: `src-tauri/src/content/mod.rs`
- Modify: `src/features/marketplace/ServerMarketplaceView.tsx`

**Step 1: Write parser fixture tests**

Use static saved HTML/JSON fixtures. Do not hit live BBSMC in tests.

Tests:

- parses public project summary
- parses public file metadata
- refuses login-only resource fixture
- refuses paid/restricted resource fixture
- rate limiter is invoked before request

**Step 2: Implement provider isolation**

Provider must be disable-able from settings. All failures surface as provider errors.

**Step 3: Implement one-click public install**

Only install when:

- no login is required
- no paid marker is present
- public file URL is available

**Step 4: Verify**

Run:

```powershell
cd src-tauri
cargo test bbsmc
cd ..
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add bbsmc public provider"
```

## Task 17: Add Forge, NeoForge, And Fabric Providers

**Files:**
- Create: `src-tauri/src/loaders/fabric.rs`
- Create: `src-tauri/src/loaders/forge.rs`
- Create: `src-tauri/src/loaders/neoforge.rs`
- Modify: `src-tauri/src/loaders/mod.rs`
- Modify: `src/features/loaders/LoaderSelect.tsx`

**Step 1: Write fixture tests**

Tests:

- Fabric provider resolves installer metadata
- Forge provider generates expected server install command
- NeoForge provider generates expected server install command
- all providers write into controlled server directory

**Step 2: Implement Fabric**

Generate server launch layout and command without touching unrelated files.

**Step 3: Implement Forge and NeoForge**

Run installer in controlled server directory. Surface installer failures clearly.

**Step 4: Verify**

Run:

```powershell
cd src-tauri
cargo test loaders
cd ..
```

Expected: PASS.

**Step 5: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add forge neoforge and fabric loaders"
```

## Task 18: Add Modpack Import

**Files:**
- Create: `src-tauri/src/content/modpacks.rs`
- Modify: `src-tauri/src/content/mod.rs`
- Create: `src/features/content/ModpackImportDialog.tsx`

**Step 1: Write fixture tests**

Fixtures:

- Modrinth `.mrpack`
- CurseForge manifest zip
- generic server pack zip

Tests:

- parses manifest
- creates new server profile by default
- supports create-server wizard source for marketplace modpacks
- warns before replacing existing server
- warns for client-only content

**Step 2: Implement import**

Modpack import must create a rollback snapshot or new profile before writing.

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test modpacks
cd ..
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add modpack import"
```

## Task 19: Add Tunnel Provider Management

**Files:**
- Create: `src-tauri/src/tunnels.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Create: `src/features/tunnels/TunnelProvidersView.tsx`
- Create: `src/features/tunnels/TunnelBindingEditor.tsx`

**Step 1: Write failing tests**

Tests:

- custom command starts when bound server starts
- shared tunnel is not stopped while another server needs it
- playit process detection reports status without owning process
- failed tunnel start is visible

**Step 2: Implement tunnel model**

Support:

- custom command
- monitor-only process detection
- playit detection
- shared process reference tracking

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test tunnels
cd ..
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add tunnel provider management"
```

## Task 19A: Add Scheduled Tasks

**Files:**
- Create: `src-tauri/src/tasks.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Create: `src/features/tasks/ScheduledTasksView.tsx`
- Create: `src/features/tasks/TaskEditorDialog.tsx`

**Step 1: Write failing tests**

Tests:

- schedules start, stop, restart, world backup, safe stdin command, server update check, and content update check tasks
- marks missed runs after tray downtime instead of silently replaying them
- blocks command tasks when the server is stopped
- records failed runs as visible events

**Step 2: Implement scheduler**

The tray runtime owns task execution. Tasks are per server and cannot run after the tray runtime is fully closed.

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test tasks
cd ..
pnpm vitest run src/features/tasks
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add scheduled server tasks"
```

## Task 19B: Add Structured Server Properties Editor

**Files:**
- Create: `src-tauri/src/server_properties.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Create: `src/features/config/ServerPropertiesEditor.tsx`
- Modify: `src/features/servers/ServerDetail.tsx`

**Step 1: Write failing tests**

Tests:

- parses valid `server.properties`
- preserves unknown keys and comments when saving common edits
- validates port, numeric, boolean, and required string fields
- creates a local edit backup before writing
- rejects paths outside the server directory

**Step 2: Implement editor**

Provide structured controls for common properties and keep raw text editing in the Files tab as a fallback.

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test server_properties
cd ..
pnpm vitest run src/features/config
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add server properties editor"
```

## Task 19C: Add Structured Player Lists

**Files:**
- Create: `src-tauri/src/player_lists.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/features/players/PlayersView.tsx`
- Create: `src/features/players/PlayerListsView.tsx`

**Step 1: Write failing tests**

Tests:

- reads `ops.json`, `whitelist.json`, `banned-players.json`, and `banned-ips.json`
- shows invalid JSON as a visible error
- writes list changes only inside the server directory
- disables command-only actions when the server is stopped
- requires confirmation for op, deop, ban, and unban

**Step 2: Implement list management**

Use structured list UI for valid Mojang list files. Keep raw text access available through Files.

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test player_lists
cd ..
pnpm vitest run src/features/players
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add structured player lists"
```

## Task 19D: Add Resource Monitoring History

**Files:**
- Create: `src-tauri/src/metrics.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Create: `src/features/performance/PerformanceHistoryView.tsx`
- Modify: `src/features/servers/ServerOverview.tsx`

**Step 1: Write failing tests**

Tests:

- samples CPU, memory, disk, uptime, restart count, and player count when available
- stores bounded metric history
- shows unavailable metrics explicitly
- overlays crash, backup, install, update, and restart events

**Step 2: Implement metrics**

Keep sampling lightweight and local. Do not collect telemetry.

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test metrics
cd ..
pnpm vitest run src/features/performance
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add resource history"
```

## Task 19E: Add Server Update Manager

**Files:**
- Create: `src-tauri/src/server_updates.rs`
- Modify: `src-tauri/src/loaders/mod.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Create: `src/features/updates/ServerUpdatesView.tsx`
- Modify: `src/features/servers/ServerDetail.tsx`

**Step 1: Write failing tests**

Tests:

- checks stable updates for Vanilla and Paper
- reports Forge, NeoForge, and Fabric update availability without unsafe replacement
- blocks install while server is running
- creates rollback snapshot before replacing executable files
- records update history and failure details

**Step 2: Implement updates**

Use provider metadata and stable channels only. Do not auto-install updates.

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test server_updates
cd ..
pnpm vitest run src/features/updates
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add server update manager"
```

## Task 19F: Add Backup Profiles

**Files:**
- Modify: `src-tauri/src/backups.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Modify: `src/features/backups/ServerBackupsView.tsx`
- Create: `src/features/backups/BackupProfilesView.tsx`

**Step 1: Write failing tests**

Tests:

- world-only remains default for new servers
- world plus configs includes selected config files only
- full server folder requires explicit opt-in
- custom include/exclude rules are validated inside the server directory
- retention is applied per profile

**Step 2: Implement profiles**

Expose backup profiles in the per-server Backups tab. Keep Backup Now defaulting to active world.

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test backups
cd ..
pnpm vitest run src/features/backups
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add backup profiles"
```

## Task 19G: Add Desktop Notifications

**Files:**
- Create: `src-tauri/src/notifications.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Create: `src/features/settings/NotificationSettings.tsx`
- Modify: `src/features/settings/SettingsView.tsx`

**Step 1: Write failing tests**

Tests:

- crash, auto-restart failed, backup failed, task failed, update available, and tunnel stopped events can create notifications
- noisy informational notifications are disabled by default
- notification preferences persist
- no telemetry or remote delivery is used

**Step 2: Implement notifications**

Use local OS desktop notifications through Tauri. Show inline app events even if desktop notifications are disabled.

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test notifications
cd ..
pnpm vitest run src/features/settings
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add desktop notifications"
```

## Task 19H: Add Profile Import And Export

**Files:**
- Create: `src-tauri/src/profile_io.rs`
- Modify: `src-tauri/src/lib.rs`
- Create: `src/features/profiles/ProfileImportExport.tsx`
- Modify: `src/features/servers/CreateServerWizard.tsx`
- Modify: `src/features/servers/ServerDetail.tsx`

**Step 1: Write failing tests**

Tests:

- exports server metadata, loader settings, restart policy, scheduled tasks, backup profiles, tunnel bindings, and installed content index
- excludes worlds, backups, logs, secrets, and local Java absolute path by default
- validates missing directories, Java runtimes, and providers on import
- lets the user remap paths before creating a profile

**Step 2: Implement profile IO**

Use a versioned JSON format and explicit import warnings. Do not copy world data by default.

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test profile_io
cd ..
pnpm vitest run src/features/profiles src/features/servers
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add profile import export"
```

## Task 19I: Add Diagnostics And Health Checks

**Files:**
- Create: `src-tauri/src/diagnostics.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Create: `src/features/diagnostics/DiagnosticsView.tsx`
- Modify: `src/features/servers/ServerDetail.tsx`

**Step 1: Write failing tests**

Tests:

- detects Java mismatch, missing jar, EULA not accepted, port in use, low disk, bad permissions, memory over-allocation, recent crash, provider outage, and tunnel stopped
- returns pass/warn/fail results with visible explanations
- does not mutate settings automatically
- records diagnostic run history

**Step 2: Implement diagnostics**

Diagnostics are explicit user-run checks and may also be suggested after startup failure.

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test diagnostics
cd ..
pnpm vitest run src/features/diagnostics
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add server diagnostics"
```

## Task 19J: Add Content Update Policies

**Files:**
- Modify: `src-tauri/src/content/mod.rs`
- Modify: `src-tauri/migrations/0001_initial.sql`
- Create: `src/features/content/ContentUpdatePolicyView.tsx`
- Modify: `src/features/marketplace/ServerMarketplaceView.tsx`

**Step 1: Write failing tests**

Tests:

- supports manual only, notify only, batch update after confirmation, pin current version, and ignore update
- severe compatibility warnings require install-anyway confirmation
- never auto-installs mods, plugins, or modpacks
- records ignored update and pinned version state

**Step 2: Implement policies**

Apply server defaults with per-item overrides. Keep updates scoped to the selected server.

**Step 3: Verify**

Run:

```powershell
cd src-tauri
cargo test content
cd ..
pnpm vitest run src/features/content src/features/marketplace
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src src-tauri
git commit -m "feat: add content update policies"
```

## Task 20: Add App Settings Theme And i18n Foundation

**Files:**
- Create: `src/i18n/index.ts`
- Create: `src/i18n/locales/en.json`
- Create: `src/i18n/locales/zh-CN.json`
- Create: `src/features/settings/LocalizationSettings.tsx`
- Create: `src/features/settings/ThemeSettings.tsx`
- Modify: `src/App.tsx`

**Step 1: Write tests**

Tests:

- default language loads
- Chinese language loads
- missing key falls back visibly
- theme setting supports system, light, and dark
- theme and language controls are rendered in Settings, not the top runtime bar

**Step 2: Implement minimal i18n and theme settings**

Use a small local dictionary abstraction first. Do not introduce a heavy i18n framework unless needed.

Theme controls live in App Settings. Do not add theme or language controls to the top runtime bar.

**Step 3: Verify**

Run:

```powershell
pnpm vitest run
```

Expected: PASS.

**Step 4: Commit**

```powershell
git add src
git commit -m "feat: add theme settings and localization"
```

## Task 21: Final MVP Verification

**Files:**
- Modify: `README.md`
- Create: `LICENSE`
- Create: `.github/workflows/ci.yml`

**Step 1: Add MIT license**

Create `LICENSE` with MIT license text.

**Step 2: Add README**

Document:

- project status
- prerequisites
- dev commands
- no telemetry
- marketplace provider limitations
- no RCON first version
- backups are world-only by default

**Step 3: Add CI**

Run:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    strategy:
      matrix:
        os: [windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - uses: dtolnay/rust-toolchain@stable
      - run: pnpm install --frozen-lockfile
      - run: pnpm vitest run
      - run: cargo test
        working-directory: src-tauri
```

**Step 4: Run full local verification**

Run:

```powershell
pnpm vitest run
cd src-tauri
cargo test
cd ..
pnpm tauri build
```

Expected:

- frontend tests pass
- Rust tests pass
- desktop app builds

**Step 5: Commit**

```powershell
git add README.md LICENSE .github/workflows/ci.yml
git commit -m "chore: add project docs license and ci"
```

## Execution Notes

- Do not skip failing tests before implementation.
- Keep commits small and aligned to task boundaries.
- Do not add public remote management.
- Do not add RCON.
- Do not add telemetry.
- Do not install updates while servers are running.
- Do not broaden backups beyond world-only unless the design doc changes.
- Backup profiles may broaden scope only when the user explicitly selects a non-default profile.
- Do not add Marketplace or Backups as main sidebar destinations; keep them scoped to the selected server.
- Do not expose a per-player command editor; player actions use normal confirmations.
- Do not auto-run missed scheduled tasks after downtime.
- Do not auto-update server jars, mods, plugins, or modpacks.
- Do not let diagnostics mutate settings automatically.
- Do not execute marketplace-provided commands.
- Treat BBSMC parsing as disable-able and high maintenance risk.
- Use explicit errors instead of silent fallbacks.
