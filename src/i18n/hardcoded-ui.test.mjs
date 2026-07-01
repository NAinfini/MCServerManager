import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const userVisiblePattern = /[A-Za-z]{3,}|[\u4e00-\u9fff]/;
const scannedAttributes = new Set(["aria-label", "title", "placeholder"]);
const allowedLiteralPatterns = [
  /^MC Server Manager$/,
  /^GitHub$/,
  /^Electron:/,
  /^Platform:/,
  /^Java$/,
  /^Hangar$/,
  /^N\/A$/,
  /^0\.1\.0-dev$/,
  /^ZIP$/,
  /^tar\.gz$/,
];

function collectTsxFiles(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const filePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTsxFiles(filePath, files);
    } else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      files.push(filePath);
    }
  }
  return files;
}

function isAllowedLiteral(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  return allowedLiteralPatterns.some((pattern) => pattern.test(normalized));
}

describe("i18n UI coverage", () => {
  it("does not leave user-facing JSX text hardcoded", () => {
    const violations = [];
    for (const filePath of collectTsxFiles(path.join(process.cwd(), "src"))) {
      const sourceText = fs.readFileSync(filePath, "utf8");
      const sourceFile = ts.createSourceFile(
        filePath,
        sourceText,
        ts.ScriptTarget.Latest,
        true,
        ts.ScriptKind.TSX,
      );
      const location = (node) => {
        const position = sourceFile.getLineAndCharacterOfPosition(node.pos);
        return `${path.relative(process.cwd(), filePath)}:${position.line + 1}`;
      };
      const check = (node, text, kind) => {
        const normalized = text.replace(/\s+/g, " ").trim();
        if (
          normalized &&
          userVisiblePattern.test(normalized) &&
          !isAllowedLiteral(normalized)
        ) {
          violations.push(`${location(node)} ${kind}: ${normalized}`);
        }
      };
      const visit = (node) => {
        if (ts.isJsxText(node)) {
          check(node, node.getText(sourceFile), "text");
        }
        if (
          ts.isJsxAttribute(node) &&
          scannedAttributes.has(node.name.getText(sourceFile)) &&
          node.initializer &&
          ts.isStringLiteral(node.initializer)
        ) {
          check(
            node,
            node.initializer.text,
            `attribute ${node.name.getText(sourceFile)}`,
          );
        }
        if (
          ts.isJsxExpression(node) &&
          node.expression &&
          ts.isStringLiteral(node.expression)
        ) {
          check(node, node.expression.text, "expression");
        }
        ts.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    expect(violations).toEqual([]);
  });
});
