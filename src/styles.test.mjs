import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path) => readFileSync(resolve(process.cwd(), path), "utf8");
const app = read("src/App.tsx");
const tokens = read("src/styles/tokens.css");
const css = read("src/styles/app.css");

function block(source, selector) {
  const start = source.indexOf(selector);
  if (start < 0) return "";
  const opening = source.indexOf("{", start);
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(opening + 1, index);
  }
  return "";
}

describe("single design system", () => {
  it("loads tokens before one consolidated application stylesheet", () => {
    const tokenImport = app.indexOf('import "./styles/tokens.css";');
    const appImport = app.indexOf('import "./styles/app.css";');
    expect(tokenImport).toBeGreaterThan(-1);
    expect(appImport).toBeGreaterThan(tokenImport);
    expect(app).not.toContain("styles.css");
    expect(app).not.toContain("styles/preview");
  });

  it("defines theme tokens in one source only", () => {
    expect(tokens).toMatch(/:root\s*\{/);
    expect(tokens).toMatch(/\[data-theme="light"\]\s*\{/);
    expect(css).not.toMatch(/(^|\n)\s*:root\s*\{/);
    expect(css).not.toMatch(/(^|\n)\s*\[data-theme="light"\]\s*\{/);
  });

  it("exports the agreed spacing, type, control and breakpoint scales", () => {
    for (const value of ["4px", "8px", "12px", "16px", "20px", "24px", "32px", "40px"]) {
      expect(tokens).toContain(value);
    }
    expect(tokens).toMatch(/--control-width-number:\s*112px/);
    expect(tokens).toMatch(/--control-width-select:\s*260px/);
    expect(tokens).toMatch(/--control-width-text:\s*440px/);
    expect(tokens).toMatch(/--control-width-long:\s*640px/);
    expect(tokens).toMatch(/--bp-sm:\s*720px/);
    expect(tokens).toMatch(/--bp-md:\s*880px/);
    expect(tokens).toMatch(/--bp-lg:\s*1100px/);
    expect(tokens).toMatch(/--bp-xl:\s*1280px/);
  });
});

describe("interaction and responsive contracts", () => {
  it("uses focus-visible, explicit transitions and reduced-motion", () => {
    expect(css).toMatch(/:focus-visible/);
    expect(css).not.toMatch(/transition:\s*all\b/);
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
  });

  it("uses only the four agreed responsive breakpoints", () => {
    const widths = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map(
      (match) => Number(match[1]),
    );
    expect(widths.every((width) => [720, 880, 1100, 1280].includes(width))).toBe(true);
    expect(new Set(widths)).toEqual(new Set([720, 880, 1100]));
  });

  it("keeps form controls bounded by content needs", () => {
    expect(block(css, ".field-control")).toMatch(
      /max-width:\s*var\(--control-width-text\)/,
    );
    expect(block(css, '.field-control[type="number"]')).toMatch(
      /max-width:\s*var\(--control-width-number\)/,
    );
    expect(block(css, "select.field-control")).toMatch(
      /max-width:\s*var\(--control-width-select\)/,
    );
  });

  it("keeps page shells and workbench children shrinkable", () => {
    expect(css).toMatch(/\.page\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.server-workspace-main\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.data-table-scroll|\.structured-table-scroll/);
  });

  it("provides visible sortable table affordances", () => {
    expect(css).toMatch(/\.data-table-sort/);
  });
});
