# Full Server Provisioning Design

**Date:** 2026-07-18

## Objective

Turn every supported creation source into one complete, explicit workflow:

1. Select a server modpack in the in-app Modrinth or CurseForge browser, or drag/drop a local server pack.
2. Inspect the pack and determine its Minecraft, loader, loader-version, Java, file, and launch requirements.
3. Warn about unsupported or uncertain content while allowing an explicit user override.
4. Install the required Java runtime and trusted server distribution after user confirmation.
5. Collect runtime and gameplay settings.
6. Require the user to read and explicitly accept the Minecraft EULA.
7. Provision, validate, create, and start the server.
8. Expose configuration editors and honest runtime statistics after creation.

The supported loader set is Vanilla, Paper, Fabric, Forge, NeoForge, and Quilt.

## Current-State Findings

The existing UI, Electron bridge, SQLite backend, marketplace browser, process manager, settings editors, and test suite are a useful base, but the end-to-end creation path is incomplete:

- Local modpack preview does not inspect an archive manifest and currently defaults imported packs to Paper.
- A marketplace modpack is installed through the generic content-file path instead of being expanded as a server pack.
- CurseForge's server-pack relationship is not used.
- Modrinth `.mrpack` server-side environment metadata and layered overrides are not interpreted.
- Profile creation does not install the server distribution, install Java, collect EULA acceptance, write first-run settings, or start the server.
- Process startup assumes every loader can be launched as `java -jar server.jar nogui`.
- Saving `server.properties` reconstructs the file and discards comments and unknown formatting.
- Quilt is absent from the database loader constraint and UI/backend loader maps.

Passing unit tests therefore establish regression safety for implemented behavior, not completeness of this workflow.

## Chosen Architecture

Use a native provisioning pipeline in the existing Electron main process. Do not introduce Docker or execute a third-party installer CLI.

The pipeline has two top-level operations:

- **Plan:** inspect a source and produce a side-effect-free `ProvisioningPlan`.
- **Execute:** perform the approved plan as a resumable `ProvisioningJob`.

All sources normalize into the same plan. All loaders normalize into the same trusted launch specification. The renderer never constructs commands or writes installation files directly.

## Source Adapters

### Local files

Recognize and inspect:

- Modrinth `.mrpack` archives through `modrinth.index.json`.
- CurseForge server-pack archives through `manifest.json` and server-pack layout.
- Generic server ZIP archives using conservative structure inspection.

Unknown or ambiguous archives are reported as unverified. Users can explicitly continue, but the warning remains attached to the server profile. Pack-provided scripts are never executed.

### Modrinth

The marketplace shows modpack projects and versions. Version inspection downloads or reads the `.mrpack` index, excludes files whose server environment is `unsupported`, includes required server files, and asks about optional server files. General `overrides` are applied first and `server-overrides` second.

Reference: <https://support.modrinth.com/en/articles/8802351-modrinth-modpack-format-mrpack>

### CurseForge

The marketplace uses official API metadata to identify `isServerPack` and `serverPackFileId`. Dedicated server packs are preferred and visibly labeled. When no server pack exists, the UI warns that the selected file is not verified for dedicated-server use and requires explicit override.

Reference: <https://docs.curseforge.com/rest-api/>

## Provisioning Plan

A plan contains:

- normalized source identity and provider metadata;
- pack name and selected version;
- Minecraft version;
- loader and loader version;
- required Java major version;
- download artifacts, hashes, sizes, and allowed hosts;
- archive layers and destination paths;
- loader installation requirements;
- a trusted launch-specification template;
- detected server properties;
- optional files that require user choice;
- compatibility and integrity warnings;
- required disk space and target conflicts.

Planning performs no writes outside disposable inspection storage and creates no server profile.

## Provisioning Job

The backend persists each job and its current stage:

1. `planned`
2. `downloading`
3. `verifying`
4. `extracting`
5. `installingRuntime`
6. `installingLoader`
7. `writingConfiguration`
8. `awaitingEula`
9. `committing`
10. `starting`
11. `ready` or `failed`

Downloads, checks, extraction, runtime installation, and loader installation occur in a staging directory created beside the final target so the final rename stays on the same volume. The profile and final directory become authoritative only after validation succeeds.

A failed job stores a structured error code, public message, diagnostic detail, failed stage, retryability, and cleanup state. Restarting the application can resume a safe stage or offer cleanup. It must never report a server as successfully created while required provisioning is incomplete.

## Loader Adapters and Launch Specifications

Each adapter owns version discovery, trusted downloads, installation, validation, and launch generation:

- Vanilla uses Mojang version metadata and the official dedicated-server artifact.
- Paper uses PaperMC metadata and a selected stable build.
- Fabric uses Fabric metadata and its supported server launcher/installer flow.
- Forge uses the official installer and generated argument files for the selected Minecraft generation.
- NeoForge uses the official installer and generated argument files.
- Quilt uses Quilt metadata and its server installer/launcher flow.

The stored launch specification is data generated by application-owned adapters. It includes an executable selector, working directory, fixed arguments, JVM arguments, and server arguments. It cannot contain arbitrary shell syntax. Imported `.bat`, `.cmd`, `.ps1`, or `.sh` files may be displayed for diagnostics but are never executed automatically.

Legacy profiles without a launch specification retain the current `server.jar` behavior.

## Java Runtime Management

The runtime manager first scans compatible installed Java runtimes. If none match, it offers an application-managed Eclipse Temurin runtime with version, vendor, license, download size, checksum, and destination shown before confirmation.

Temurin is the default automated source because it is a compatible OpenJDK distribution, has stable cross-platform download APIs and checksums, and is provided under long-lived open-source terms. Users can still select compatible Oracle, Microsoft, Temurin, or other detected runtimes. The UI also links to Oracle and Temurin manual-download pages.

Managed runtimes live under application data and do not mutate the system `PATH`, registry-wide Java defaults, or system package manager.

References:

- <https://adoptium.net/docs/faq>
- <https://adoptium.net/installation/ci-scripts>
- <https://www.oracle.com/java/technologies/downloads/>

## EULA Gate

The review step links to the current Minecraft EULA and requires an unchecked-by-default confirmation control. The backend accepts EULA approval only as an explicit field on the approved provisioning request, records the confirmation time and terms URL, and writes `eula=true` during configuration.

Declining EULA leaves the job in `awaitingEula`; it may be saved but cannot start. No source adapter, retry, auto-start setting, or compatibility override can bypass this gate.

## Configuration

Before first start, the wizard supports:

- server name and target directory;
- minimum and maximum memory;
- port;
- game mode;
- difficulty;
- maximum players;
- MOTD;
- online mode;
- PVP;
- whitelist;
- view distance;
- simulation distance.

Pack-provided `server.properties` values remain authoritative unless the user explicitly changes a field. Property updates use a line-preserving merge that retains comments, blank lines, order, and unknown keys. Duplicate keys are handled deterministically and surfaced as a warning.

After creation, the normal settings view exposes the guided fields and the advanced editor exposes the complete properties file and other safe text configuration files. Changes that require a restart are labeled and never restart a running server silently.

## User Experience

The create-server entry page has four paths:

- discover a pack in Modrinth or CurseForge;
- drag/drop or select a local server pack;
- import an existing server folder;
- create a blank server.

The unified wizard contains:

1. Source
2. Compatibility
3. Java
4. Server configuration
5. Review and EULA
6. Install and start

Marketplace versions display `Server pack`, `Unverified`, `Client only`, Minecraft version, loader, release type, and download size as available. Dedicated server packs are the default. An unverified selection requires a second, specific acknowledgement.

The install screen reports every job stage, byte progress where measurable, current artifact, warnings, and actionable errors. Cancellation is allowed at safe boundaries and briefly disabled during final commit.

## Runtime Status and Statistics

The server overview reports only metrics that can be measured reliably:

- process status;
- CPU utilization;
- process memory;
- uptime;
- restart count;
- online player count when available.

TPS is displayed only when a supported integration can provide it. Otherwise it is explicitly marked unavailable; no value is fabricated. Existing metric history remains the persistence mechanism and gains explicit availability reasons where needed.

## Security

- Restrict downloads to HTTPS and adapter-approved hosts, including validated redirect destinations.
- Verify provider hashes when supplied and display an explicit integrity warning when none is available.
- Keep CurseForge credentials in the Electron main process and redact credentials and signed URLs from logs.
- Reject archive entries with absolute paths, parent traversal, device paths, unsafe symbolic links, excessive expansion ratios, excessive entry counts, or configured size limits.
- Validate target paths and show conflicts before any write.
- Never execute pack-supplied scripts or interpolate untrusted strings into a shell.
- Keep launch specifications structured and invoke processes without a shell.
- Keep Java installation application-local and unprivileged.

## Failure and Recovery

- Preserve exact stage, error, and diagnostics for every failure.
- Retry only stages known to be idempotent.
- Do not add silent fallbacks between loaders, Minecraft versions, Java versions, or package files.
- Keep partial downloads only when resumable and validated; otherwise remove them during explicit cleanup.
- Before commit, cleanup can remove the complete staging tree.
- During commit, use a same-volume atomic rename and a rollback name for an existing explicitly approved target.
- After commit, never delete user data automatically because startup failed.
- Persist compatibility overrides and continue to display them on the server overview.

## Database Migration

Create a new schema migration that:

- rebuilds the loader constraint to include `quilt`;
- adds a nullable structured launch specification to servers or an associated launch table;
- adds provisioning jobs and warning acknowledgements;
- adds source identity fields required for update checks;
- adds EULA confirmation metadata;
- preserves all existing server IDs, paths, settings, restart policies, and legacy launch behavior.

The migration is transactional and covered by a fixture built from the version-1 schema.

## Testing Strategy

Implementation follows test-driven development.

### Unit and contract tests

- Parse representative Modrinth, CurseForge, and generic server-pack fixtures.
- Apply server environment rules, optional-file decisions, and layered overrides.
- Map six loader adapters to official metadata and trusted launch specifications.
- Resolve required Java versions and choose installed or managed runtimes.
- Preserve properties comments, order, unknown keys, and explicit overrides.
- Reject traversal, unsafe links, oversized archives, bad hashes, unapproved redirects, and script execution.
- Enforce EULA and compatibility acknowledgement gates.
- Migrate a version-1 database to the new schema without data loss.

### Backend integration tests

- Execute complete jobs against local HTTP fixtures and temporary target directories.
- Verify each failure stage, retry, cancellation, cleanup, atomic commit, and restart recovery.
- Verify that credentials and signed URLs are absent from stored events and logs.
- Verify legacy servers still start with the legacy jar launch path.

### Renderer tests

- Exercise all four source paths and both marketplace providers.
- Verify server-pack badges, warnings, override confirmation, Java consent, configuration fields, EULA gate, progress, errors, and retry controls.
- Verify guided and advanced configuration behavior and unavailable-stat labels.

### Desktop smoke tests

- Run the packaged Electron bridge with a deterministic local fixture provider.
- Create and start a minimal test server process without reaching production provider APIs.
- Verify drag/drop routing, persisted job recovery, process output, stop, and relaunch.

### Completion gates

- Full Vitest suite passes.
- Electron/backend contract tests pass.
- TypeScript and Vite production build pass.
- Desktop smoke test passes on the current platform.
- A final requirement review covers correctness, side effects, performance, security, and maintainability.

## Out of Scope

- Silently accepting the EULA.
- Executing untrusted pack scripts.
- Pretending client-only packs are server-compatible.
- Docker as a runtime requirement.
- RCON or a public remote administration interface.
- Fabricating TPS or player metrics when unavailable.
