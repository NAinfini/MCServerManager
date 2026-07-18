# Product

[简体中文](PRODUCT.zh-CN.md)

## Register

product

## Users

People running Minecraft servers from a local desktop machine. They need to create profiles, start and stop servers, inspect logs, manage files, check Java compatibility, and keep backups without switching between terminal commands and folders.

## Product Purpose

MC Server Manager is a desktop control surface for local Minecraft server operations. Success means users can see server health at a glance, take common actions quickly, and understand failures without digging through raw runtime state.

## Brand Personality

Operational, calm, technical.

## Anti-references

Avoid marketing-page visuals, oversized hero sections, decorative gradients, toy-like Minecraft imitation, and low-density forms that force long scrolling for routine operations.

## Design Principles

- Keep status visible before configuration detail.
- Use familiar desktop tool patterns over decorative novelty.
- Prefer compact, aligned controls for repeated server operations.
- Make errors explicit and recoverable.
- Explain beginner setup through one resumable flow: source, compatibility, Java, configuration, explicit EULA confirmation, installation, and start readiness.
- Preserve keyboard and screen-reader access in every control without using browser-default focus outlines.
- Require explicit confirmation for destructive or interrupting actions.

## Accessibility & Inclusion

Target WCAG AA contrast, reduced motion, and color-independent status labels. Keyboard navigation should remain functional, but default focus outlines are intentionally suppressed to preserve the app's desktop visual style.

## Release Policy

- Tagged releases publish Windows, Linux, and macOS artifacts through GitHub Actions.
- macOS CI artifacts are unsigned until signing credentials are configured.
- Release metadata must stay aligned with the updater behavior and published assets.

## Update & Content Policy

- App updates are checked from GitHub Releases and installed only after user confirmation.
- App update installation is blocked while managed servers are running.
- Server provisioning begins only after a user selects, drops, imports, discovers, or configures a source through Modrinth and CurseForge or a local entry path.
- Vanilla, Paper, Forge, NeoForge, Fabric, and Quilt use explicit loader adapters with approved artifact hosts and output validation.
- Dedicated server packs are preferred; unverified archives require a visible server-pack warning and acknowledgement.
- Managed Eclipse Temurin installation requires separate user consent and does not alter the system `PATH`.
- Users must read the Minecraft terms and provide explicit EULA confirmation; acceptance is never inferred or preselected.
- Pack extraction removes pack-provided scripts before any loader installation, and pack scripts are never executed.
- Installed content updates are manual: detect updates, then update all or update individual items.
