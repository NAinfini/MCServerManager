---
name: MC Server Manager
description: A precise native desktop studio for operating local Minecraft servers.
colors:
  command-blue: "#3478f6"
  command-blue-hover: "#4c8cff"
  operational-green: "#55c66a"
  caution-amber: "#e5a62d"
  incident-red: "#ed5c62"
  graphite-shell: "#0d131c"
  graphite-rail: "#101722"
  graphite-canvas: "#111823"
  graphite-surface: "#151e2a"
  graphite-control: "#1b2634"
  graphite-inset: "#090f17"
  text-primary: "#eef4fb"
  text-secondary: "#a3afbd"
  text-tertiary: "#758295"
  structure-line: "#263142"
  structure-line-strong: "#34435a"
typography:
  headline:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 600
    lineHeight: 1.43
  body:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.54
  label:
    fontFamily: "Segoe UI Variable Text, Segoe UI, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.5
  mono:
    fontFamily: "Cascadia Code, Cascadia Mono, JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  control: "6px"
  surface: "8px"
  overlay: "10px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.command-blue}"
    textColor: "#ffffff"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "34px"
  button-secondary:
    backgroundColor: "{colors.graphite-control}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "34px"
  input:
    backgroundColor: "{colors.graphite-inset}"
    textColor: "{colors.text-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 11px"
    height: "34px"
---

# Design System: MC Server Manager

## Overview

**Creative North Star: "Command Studio"**

MC Server Manager is a modern native desktop control surface, not a themed website and not a VS Code imitation. Its identity comes from operational precision and unmistakable Minecraft server semantics: server instances, loaders, worlds, ports, runtime state, console events, backups, and content are always visible as first-class product objects.

The signature composition is the **Adaptive Split Workbench**. A compact server rail establishes global scope, a short context bar carries server identity and real telemetry, and one dominant task canvas can pair with a resizable operational pane when simultaneous context improves the job. The split is adaptive rather than compulsory: long forms and focused workflows may close it.

**Key Characteristics:**

- Nearly flat graphite desktop surfaces with crisp semantic color.
- Dense, readable controls and real operational data.
- One dominant task canvas plus one optional contextual pane.
- Minecraft identity through server objects and loader/world signals, never decorative game scenery.
- Full-width task surfaces with no arbitrary content caps or empty columns.

## Colors

The palette is a cool graphite instrument panel with one interaction blue and an independent health vocabulary.

### Primary

- **Command Blue:** Selection, keyboard focus, links, and the primary action.

### Secondary

- **Operational Green:** Running and healthy state only.
- **Caution Amber:** Starting, degraded, or attention-required state.
- **Incident Red:** Crashes, destructive actions, and failures.

### Neutral

- **Graphite Shell:** Window chrome and the deepest application plane.
- **Graphite Rail:** Server inventory and global navigation.
- **Graphite Canvas:** The dominant task surface.
- **Graphite Surface:** Toolbars, tables, inspectors, and aligned data regions.
- **Graphite Inset:** Console, editor, and input wells.
- **Structure Line:** Reserved for true region boundaries and table rows.

**The Independent Signal Rule.** Interaction blue never means healthy; operational colors never indicate selection.

**The Incident Rarity Rule.** Amber and red appear only when the user must notice or act.

## Typography

**Display Font:** System UI sans-serif  
**Body Font:** System UI sans-serif  
**Label/Mono Font:** Cascadia-compatible monospace for console text and measured values only

**Character:** Clear, compact, and platform-native. Hierarchy comes from weight, spacing, and alignment; decorative capitalization and technical-costume monospace are excluded.

### Hierarchy

- **Headline:** Active server and top-level page identity.
- **Title:** Workbench regions and meaningful section headings.
- **Body:** Default controls and explanatory copy, with prose held near 70 characters where practical.
- **Label:** Compact field, table, and telemetry labels.
- **Mono:** Commands, log lines, paths, ports, timestamps, and measured values.

**The Operational Mono Rule.** Monospace is reserved for content the user may copy, compare, or diagnose.

## Layout

The desktop shell has four layers: native title bar, compact server rail, active workbench, and a low status bar. The expanded server rail is approximately 252px; its collapsed mode remains a complete icon route rather than disappearing.

Server detail uses a short identity-and-action bar, an embedded telemetry strip, one tab row, then the Adaptive Split Workbench. Its contextual pane defaults near 336px, is resizable between 280px and 440px, and collapses on focused form workflows or narrow windows. The active task always retains the majority of width.

Overview, console, files, content, backups, settings, and creation flows use the whole available canvas. Tables and lists are preferred to repeated cards. Forms use a single vertical reading axis; only tightly coupled short fields share a row.

**The One Split Rule.** A workbench may show one persistent vertical split. Nested left-right regions inside either side are prohibited.

**The No Empty Column Rule.** Space without a current operational purpose returns to the active task canvas.

## Elevation & Depth

Depth is tonal and structural. Persistent regions use adjacent graphite values and, when required, one low-contrast boundary. Shadows are reserved for menus, dialogs, and responsive context drawers that physically overlap the task.

**The Flat-at-Rest Rule.** Persistent surfaces never float, glow, or translate on hover.

## Shapes

Controls use restrained 6px corners; bounded work surfaces use 8px only when their silhouette needs clipping. Full-canvas regions and tables do not become rounded cards. Pills are reserved for compact filters and categorical tags.

Pixel or block geometry is allowed only in real Minecraft assets such as server covers, loader marks, player heads, and world icons. It is not a generic shape language for controls.

## Components

### Buttons

- **Shape:** compact native controls with 6px corners and a 34px standard height.
- **Primary:** command blue, reserved for the primary action in the current work area.
- **Secondary:** graphite control surface with a quiet structural edge.
- **Hover / Focus:** tonal change plus a visible 2px focus ring; no lift or glow.

### Status

- **Style:** a stable semantic dot and readable non-wrapping label.
- **Meaning:** green is healthy, amber is transitional, red is incident, gray is stopped.
- **Constraint:** status text never wraps, clips, or reuses the interaction accent.

### Inputs

- **Style:** graphite inset, clear structural edge, 6px corners, 34px default height.
- **Layout:** visible labels above controls and full error text below.
- **Focus:** a 2px command-blue ring with sufficient contrast.

### Navigation

- **Server rail:** compact server objects with cover, name, loader/version, and state.
- **Task tabs:** one horizontal row immediately above the active canvas.
- **Active state:** blue edge and tonal surface; no multicolor underline.

### Adaptive Split Workbench

- **Primary pane:** the active task and the only dominant surface.
- **Splitter:** keyboard-accessible and pointer-resizable with a subtle visible handle.
- **Context pane:** real runtime facts, telemetry, activity, alerts, players, or selection details.
- **Responsive:** becomes an overlay drawer before it can squeeze the primary task below usable width.

## Do's and Don'ts

### Do:

- **Do** make the current server, health, and primary action findable within seconds.
- **Do** use real backend values and show unavailable data honestly.
- **Do** let the active task reclaim width when context is closed.
- **Do** keep every existing server-management function intact.
- **Do** preserve keyboard focus, reduced motion, and dark/light contrast.

### Don't:

- **Don't** build the page from equal-sized metric cards or nested panels.
- **Don't** alternate repeated left-right and up-down subdivisions.
- **Don't** leave a permanent empty right column.
- **Don't** imitate Minecraft grass, dirt, inventory chrome, or game HUD decoration.
- **Don't** use gradients, glass, neon glow, oversized typography, or decorative gauges.
