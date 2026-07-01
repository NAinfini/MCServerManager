# MC Server Manager UI Specification

## Design Goal

Build a clean professional desktop control surface for managing local Minecraft servers. The UI should feel calm, precise, and operational. It should not look like a generic SaaS dashboard, a game launcher, or a marketing page.

The interface is for repeated use: starting servers, reading logs, fixing failures, installing content, and checking backups. Density is acceptable when hierarchy is clear.

## Visual Direction

Name: **Clean Ops Desktop**

Principles:

- Professional desktop utility, not playful game UI.
- Dense but readable.
- Clear server state before decoration.
- Strong contrast for logs, warnings, and destructive actions.
- No oversized hero sections.
- No nested cards.
- No purple/blue gradient theme.
- No decorative blobs, orbs, or bokeh.
- Motion is functional: panel reveal, status changes, progress, command confirmation.

Reference direction:

- The provided server-detail screenshot is close to the target structure.
- Keep its strong desktop shell, left server sidebar, tabbed detail page, top action row, status cards, console density, and right-side operational panels.
- Improve it with first-class light and dark themes, a dedicated Players tab, explicit i18n, and stricter destructive action confirmations.

## App Frame

Minimum useful window:

```text
width: 1180px
height: 720px
```

Ideal desktop target:

```text
width: 1440px
height: 900px
```

Primary layout:

```text
┌─────────────────────────────────────────────────────────────┐
│ Top runtime bar, 48px                                       │
├───────────────┬─────────────────────────────────────────────┤
│ Sidebar       │ Active page                                 │
│ 248px         │                                             │
│               │                                             │
└───────────────┴─────────────────────────────────────────────┘
```

Frame rules:

- Left sidebar width: `248px`.
- Top runtime bar height: `48px`.
- Page padding: `24px`.
- Dense page padding option: `16px`.
- Main content max width: none for operational pages.
- Settings max width: `920px`.
- Dialog max width: `560px` for normal dialogs, `760px` for install/backup detail dialogs.
- Border radius: `6px` default, `8px` maximum for panels.

## Color Tokens

Use semantic tokens, not raw colors in components.

```css
:root {
  --bg-app: #f4f2ed;
  --bg-panel: #fbfaf7;
  --bg-panel-muted: #eeeae2;
  --bg-elevated: #ffffff;

  --text-main: #171717;
  --text-muted: #66625a;
  --text-subtle: #8a857a;
  --text-inverse: #f7f3ea;

  --border-subtle: #ded8cd;
  --border-strong: #b9b0a1;

  --accent: #256f5b;
  --accent-hover: #1f5f4e;
  --accent-soft: #dcebe5;

  --running: #16835f;
  --starting: #a66a00;
  --stopped: #77736b;
  --crashed: #b42318;
  --warning: #b26a00;
  --info: #2b627c;

  --danger: #b42318;
  --danger-hover: #921b12;
  --danger-soft: #f6d8d4;

  --console-bg: #10110f;
  --console-text: #e7e1d3;
  --console-muted: #9b9485;
  --console-success: #83d6a3;
  --console-warning: #e0b15d;
  --console-error: #ff8a7a;
}
```

Light mode and dark mode are both first-class. The app should support `system`, `light`, and `dark` theme settings.

Dark theme tokens:

```css
[data-theme="dark"] {
  --bg-app: #0e1316;
  --bg-panel: #151b1f;
  --bg-panel-muted: #1b2328;
  --bg-elevated: #202a30;

  --text-main: #f1f4f2;
  --text-muted: #b6c0ba;
  --text-subtle: #78847e;
  --text-inverse: #10130f;

  --border-subtle: #2b363d;
  --border-strong: #3e4c54;

  --accent: #4ea37f;
  --accent-hover: #5fb891;
  --accent-soft: #173126;

  --running: #5ac486;
  --starting: #e3a93c;
  --stopped: #8b9490;
  --crashed: #ef6358;
  --warning: #e3a93c;
  --info: #6caac3;

  --danger: #ef6358;
  --danger-hover: #ff7b6f;
  --danger-soft: #3a1d1c;

  --console-bg: #0a0d0e;
  --console-text: #dce5dc;
  --console-muted: #879188;
  --console-success: #80d99a;
  --console-warning: #f0bf65;
  --console-error: #ff7f73;
}
```

## Typography

Use a distinctive but restrained font stack:

```css
--font-sans: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
--font-mono: "JetBrains Mono", "Cascadia Mono", ui-monospace, monospace;
```

Type scale:

```text
Page title: 24px / 32px, weight 650
Section title: 16px / 24px, weight 650
Panel title: 14px / 20px, weight 650
Body: 14px / 20px, weight 400
Small: 12px / 16px, weight 450
Metric: 22px / 28px, weight 650
Console: 12px / 18px, mono
```

Rules:

- Letter spacing is `0`.
- Do not scale font size with viewport width.
- Long server names truncate in navigation but show full name in tooltips.
- Button labels must fit without wrapping at minimum window size.

## Navigation

Sidebar sections:

```text
Servers
Java Runtimes
Tunnel Providers
Event Log
Settings
```

Marketplace and Backups are not primary sidebar destinations. They live inside each server detail page so installs and restores always have an explicit server context.

Sidebar server list:

Each server row:

```text
[status dot] Server name
             loader · mc version · port
```

Status dot:

- running: green filled dot
- starting/stopping: amber pulsing dot
- stopped: gray ring
- crashed: red filled dot with alert icon
- external running: blue outlined dot

Sidebar behavior:

- Server rows are 56px tall.
- Active row has left accent rail `3px`.
- Running servers sort above stopped servers by default.
- Crashed servers pin to top until acknowledged.

Top runtime bar:

Left:

- app name
- tray/runtime status

Center:

- global active server count
- running process count
- pending warning count

Right:

- update status
- settings shortcut

Theme and language controls do not live in the top runtime bar. They belong in App Settings.

## Primary Screens

### Server Overview

Purpose: show all servers and immediate health.

Layout:

```text
Header: "Servers" + Create Server button
Summary strip: Running / Stopped / Crashed / Backup freshness
Server table/list
```

Server row columns:

- status
- name
- loader
- Minecraft version
- port
- memory setting
- tunnel status
- last backup
- actions

Actions:

- start
- stop
- restart
- open console
- backup
- more menu

Empty state:

Title: "No servers yet"
Body: "Create a new Minecraft server or import an existing folder."
Actions: "Create Server", "Import Folder"

Create Server wizard:

```text
Step 1: Choose source
  - Blank server
  - Import existing folder
  - Marketplace modpack
  - Local modpack file

Step 2: Choose loader/version or modpack
Step 3: Choose server folder, Java runtime, memory, port
Step 4: Review warnings and create
```

Marketplace modpack source:

- Opens a modpack-focused marketplace picker in the wizard.
- Filters by provider, Minecraft version, loader, and server-compatible packs.
- Shows warnings but allows continue.
- Creates a new server profile from the selected modpack.

### Server Detail

Purpose: manage one server.

Layout:

```text
Header: server name, status, quick actions
Tabs: Overview | Console | Files | Backups | Mods/Plugins | Players | Tasks | Performance | Tunnels | Settings
```

Header contents:

- server name
- loader badge
- Minecraft version
- Java status
- port
- memory
- tunnel status
- last backup age

Quick actions:

- Start
- Stop
- Restart
- Backup
- More

Danger rules:

- Stop and Restart require confirmation only if a backup/install operation is active.
- Delete server always requires confirmation.

### Console Tab

Purpose: read logs and send commands through stdin.

Layout:

```text
Toolbar: status, uptime, players, search, clear view, copy
Console area: xterm
Command input: full width
```

Console toolbar:

- process status
- uptime
- restart attempt counter
- last exit code
- player count when available

Console colors:

- info: console text
- warning: console warning
- error/crash: console error
- command input echo: console success

Command input rules:

- placeholder: "Send command to server stdin"
- Enter sends command.
- Up/Down cycles command history.
- Do not label this as RCON.

### Players Tab

Purpose: inspect and manage online and known players for the selected server.

Layout:

```text
Toolbar: online count, search, filter, refresh
Online players table
Known players / ban list / op list tabs
Player detail side panel with status and action buttons
```

Player row columns:

- avatar/head placeholder
- username
- UUID when known
- status: online/offline/banned/op
- ping if available
- first seen
- last seen
- actions

Actions:

- op
- deop
- ban
- unban
- kick
- copy UUID

List tabs:

- Online
- Known
- Operators
- Whitelist
- Banned players
- Banned IPs

Rules:

- No RCON in the first version. Player actions must use managed server stdin commands where possible.
- Do not expose a per-player command editor/commander.
- The UI may show the action consequence, but not a raw editable command preview.
- Ban, unban, op, and deop require confirmation.
- Actions are disabled when the server is stopped.
- If player data is unavailable, show a clear unavailable state instead of fake values.

Confirmation copy:

```text
OP player: "Grant operator privileges to {player} on {server}?"
Ban player: "Ban {player} from {server}? This sends a server command and may affect the active world immediately."
Unban player: "Remove {player} from the ban list on {server}?"
Kick player: "Kick {player} from {server}?"
```

Players tab states:

- server running with online players
- server running with no online players
- server stopped
- player list unavailable
- command pending
- command failed

### Server Tasks Tab

Purpose: schedule server-specific automation owned by the tray runtime.

Layout:

```text
Toolbar: Create Task, pause all, next run summary
Task table
Task detail/editor side panel
Recent task runs
```

Task types:

- start server
- stop server
- restart server
- world backup
- safe stdin command
- check server update
- check mod/plugin updates

Task row columns:

- enabled
- name
- type
- schedule
- next run
- last result
- actions

Rules:

- Missed tasks are shown as missed, not silently replayed.
- Command tasks are disabled when the server is stopped.
- Failed runs create Event Log entries and optional desktop notifications.
- Destructive task edits require confirmation when they affect running servers.

### Files Tab

Purpose: edit safe text files inside server directory.

Layout:

```text
Left file tree: 280px
Editor header: path, file size, readonly status
Editor: Monaco
Bottom status: encoding, modified state, last save
```

File tree:

- folders first
- common files pinned: `server.properties`, `eula.txt`, `ops.json`, `whitelist.json`
- binary files visible but not editable

Editor states:

- editable text file
- readonly large file
- blocked binary file
- blocked path escape
- save failed

Save behavior:

- Save button disabled until modified.
- Save creates local edit backup.
- Save error stays visible until dismissed.

### Content Tab

Purpose: manage installed mods/plugins and open marketplace in server context.

Layout:

```text
Installed content header
Filter row
Installed content table
Warnings drawer
```

Columns:

- enabled
- name
- type
- provider
- version
- loader/environment
- warnings
- actions

Warnings:

- client-only on server
- loader mismatch
- MC version mismatch
- duplicate id
- unknown metadata
- unverified source

Actions:

- enable/disable
- update
- remove
- reveal file
- view metadata

### Server Marketplace Tab

Purpose: browse and install mods/plugins/modpacks for the selected server.

Layout:

```text
Search bar
Provider filters
Content type filters
Loader/version filters
Results grid/list
Details side panel
```

Context rules:

- Always show the target server in the header.
- Default filters come from the selected server's Minecraft version and loader.
- Install actions target the selected server only.
- Global marketplace browsing is not a main sidebar item in the first version.

Filters:

- provider: Modrinth, Hangar, BBSMC, Local, CurseForge manual
- type: mod, plugin, modpack
- loader: Vanilla, Paper, Forge, NeoForge, Fabric
- Minecraft version
- environment: server, client, both, unknown

Result item:

```text
Icon
Name
Summary
Provider badge
Downloads/follows if available
Supported loaders
Supported versions
Warning count
Install button
```

Install dialog:

- selected server
- selected version
- target folder
- required dependencies
- optional dependencies
- warnings
- rollback/change journal notice
- final "Install anyway" action if warnings exist

Update policy controls:

- server default: manual only, notify only, batch update after confirmation
- item override: pin current version, ignore specific update
- visible warning when an update changes Minecraft version, loader, or environment metadata
- no automatic install without explicit confirmation

BBSMC provider states:

- available
- rate limited
- disabled
- parsing failed
- restricted resource blocked

### Server Backups Tab

Purpose: create, inspect, and restore per-server backups.

Layout:

```text
Header: backup policy summary + Backup Now
Backup profile selector
Backup list
Restore detail panel
```

Context rules:

- Backups are shown per selected server.
- Global backup browsing is not a main sidebar item in the first version.
- Backup Now always acts on the selected server's active world directory by default.
- Backup profiles can opt into broader scope, but world-only remains the default.

Backup profile types:

- World only
- World plus configs
- Full server folder
- Custom include/exclude

Backup row:

- timestamp
- server
- world name
- size
- type: manual/scheduled/pre-install/startup
- status
- actions

Live backup warning:

Text: "Live backup uses save-off, save-all flush, copies the world, then save-on. If any step fails, the app will try to restore saving and show the error."

Restore confirmation:

- selected backup
- target server
- target world directory
- warning that current world will be replaced
- require typing server name for destructive restore

### Server Performance Tab

Purpose: inspect current and historical resource usage for the selected server.

Layout:

```text
Summary cards: CPU, memory, disk, players, uptime, restarts
Timeline chart
Event overlay
Retention settings link
```

Chart tracks:

- CPU
- memory
- player count
- restart events
- crash events
- backup/install/update events

Rules:

- Current values belong on Overview.
- Historical trends belong on Performance.
- Sampling retention must be bounded.
- Missing metrics should show an unavailable state, not zero.

### Server Settings Tab

Purpose: edit server-specific configuration and maintenance settings.

Sections:

- Launch
- Java and memory
- Restart policy
- Server properties
- Server updates
- Diagnostics
- Danger zone

Server properties editor:

- structured controls for common `server.properties` keys
- inline validation for ports, booleans, numbers, and required strings
- raw text fallback through Files tab
- save creates a local edit backup

Server updates:

- current server jar/build
- available stable version/build
- changelog link when available
- pre-update rollback snapshot status
- install disabled while server is running

Diagnostics:

- run checks button
- pass/warn/fail result list
- checks: Java, jar/loader files, EULA, port in use, permissions, disk space, memory allocation, recent crash, provider status, tunnel status
- no automatic setting changes from diagnostics

Profile import/export:

- export action lives in server More menu and Server Settings.
- export dialog shows included metadata and excluded data.
- excluded by default: world files, backups, logs, tunnel secrets, local Java absolute path.
- import flow is available from Create Server and validates missing paths/providers before creating the profile.

### Java Runtimes

Purpose: inspect installed Java and resolve compatibility.

Layout:

```text
Installed runtimes table
Compatibility panel
Download options panel
```

Runtime row:

- version
- vendor if detected
- architecture
- path
- compatible servers
- actions

Download flow:

- show missing requirement
- show official download link
- user confirms app-managed download
- progress
- installation path
- assign to server

### Tunnel Providers

Purpose: define and monitor tunnel commands/processes.

Layout:

```text
Provider list
Binding list
Process status panel
```

Provider types:

- custom command
- playit process detection
- ngrok command
- cloudflared command

Binding row:

- server
- provider
- lifecycle policy
- shared process indicator
- current status

Shared tunnel warning:

If a tunnel is bound to multiple servers, stopping one server must not stop the tunnel while another bound server is running.

### Settings

Sections:

- General
- Startup and tray
- Language
- Theme
- Updates
- Notifications
- Marketplace providers
- Paths
- About

Important controls:

- launch at login
- close button behavior
- language: English, Chinese
- theme: system, light, dark
- notification toggles for crash, backup failure, task failure, updates, and tunnel stopped
- provider enable/disable
- update check
- no telemetry statement

## Internationalization

Languages:

- English
- Chinese
- Later: more locale files without changing component structure

Rules:

- No hardcoded user-facing strings in feature components.
- Every page title, button, warning, menu item, toast, empty state, and confirmation dialog must use i18n keys.
- Player action confirmations must be localized and should describe the consequence without exposing an editable command preview.
- Dates and numbers should use the selected locale.
- Layout must tolerate longer Chinese and English strings without overlapping.

Example keys:

```text
servers.title
servers.create
servers.create.source.marketplaceModpack
server.tabs.players
server.tabs.tasks
server.tabs.performance
players.actions.op
players.actions.ban
players.confirm.op
players.confirm.ban
tasks.create
backups.profile.worldOnly
content.updatePolicy.notifyOnly
diagnostics.run
settings.theme.system
settings.language.title
settings.notifications.title
```

## Component Rules

Buttons:

- Primary: filled accent, only for main action.
- Secondary: neutral border.
- Ghost: toolbar and low-emphasis actions.
- Danger: filled danger only for destructive confirmation.
- Icon buttons require tooltip.

Badges:

- loader badge
- provider badge
- warning badge
- status badge

Tables:

- Row height: `44px`.
- Header height: `36px`.
- Sticky header for long lists.
- Virtualize large content lists.

Dialogs:

- Use Radix Dialog.
- Destructive dialogs use danger accent.
- Warning dialogs list exact consequences.
- Do not hide errors inside expandable advanced sections.

Menus:

- Use Radix DropdownMenu.
- Separate destructive actions with a separator.
- Destructive menu items use danger text.

Tabs:

- Use Radix Tabs.
- Tabs are compact: height `40px`.
- Preserve selected tab per server.

Toasts:

- Use for non-blocking success/failure.
- Errors with required action should be inline, not only toast.

## Motion

Use Motion sparingly:

- Page enter: 120ms fade + 4px vertical lift.
- Dialog open: 140ms scale from 0.98 to 1.
- Status change: 160ms color transition.
- Progress bars: smooth width transition.
- Console output: no per-line animation.

Respect reduced motion.

## Accessibility

Requirements:

- All icon-only buttons have accessible labels and tooltips.
- All dialogs trap focus.
- Dangerous confirmations are keyboard reachable.
- Color is never the only state indicator.
- Console has readable contrast.
- Tables support keyboard row focus.
- Forms show inline validation text.

## Empty, Loading, And Error States

Every page needs:

- loading skeleton or progress state
- empty state with next action
- recoverable error state
- retry action when provider/network calls fail

Provider errors must name the provider:

```text
Modrinth request failed
BBSMC parser disabled
Hangar returned no compatible versions
```

## Implementation Mapping

Initial component files:

```text
src/components/layout/AppShell.tsx
src/components/layout/Sidebar.tsx
src/components/layout/TopRuntimeBar.tsx
src/components/ui/button.tsx
src/components/ui/badge.tsx
src/components/ui/dialog.tsx
src/components/ui/dropdown-menu.tsx
src/components/ui/tabs.tsx
src/components/ui/tooltip.tsx
src/components/ui/table.tsx
src/features/servers/ServerOverview.tsx
src/features/servers/ServerDetail.tsx
src/features/servers/CreateServerWizard.tsx
src/features/console/ConsoleView.tsx
src/features/players/PlayersView.tsx
src/features/players/PlayerActionDialog.tsx
src/features/players/PlayerListsView.tsx
src/features/files/FileBrowser.tsx
src/features/files/FileEditor.tsx
src/features/marketplace/ServerMarketplaceView.tsx
src/features/content/ContentUpdatePolicyView.tsx
src/features/backups/ServerBackupsView.tsx
src/features/backups/BackupProfilesView.tsx
src/features/tasks/ScheduledTasksView.tsx
src/features/performance/PerformanceHistoryView.tsx
src/features/config/ServerPropertiesEditor.tsx
src/features/updates/ServerUpdatesView.tsx
src/features/diagnostics/DiagnosticsView.tsx
src/features/java/JavaRuntimesView.tsx
src/features/tunnels/TunnelProvidersView.tsx
src/features/profiles/ProfileImportExport.tsx
src/features/settings/SettingsView.tsx
src/features/settings/NotificationSettings.tsx
```

First UI slice:

1. App shell
2. Sidebar server list
3. Server overview
4. Server detail header
5. Console placeholder
6. Players tab placeholder
7. Tasks tab placeholder
8. Theme, language, and notification settings placeholder

Do not implement marketplace UI before the base shell, server list, and server detail layout are stable.
