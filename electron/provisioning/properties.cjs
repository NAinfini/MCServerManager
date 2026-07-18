const { provisioningError } = require("./contracts.cjs");

function normalizeUpdates(updates) {
  if (Array.isArray(updates)) {
    return updates.map((entry) => [String(entry?.key ?? ""), String(entry?.value ?? "")]);
  }
  return Object.entries(updates || {}).map(([key, value]) => [key, String(value ?? "")]);
}

function validateUpdate(key, value) {
  if (!key || /[\s=\r\n]/.test(key)) {
    throw provisioningError(
      "INVALID_PROPERTY_KEY",
      `Invalid server property key: ${JSON.stringify(key)}`,
    );
  }
  if (/[\r\n]/.test(value)) {
    throw provisioningError(
      "INVALID_PROPERTY_VALUE",
      `Server property value must be a single line: ${key}`,
    );
  }
}

function parsePropertyLine(line) {
  const trimmed = line.trimStart();
  if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("!")) {
    return null;
  }
  const separator = line.indexOf("=");
  if (separator < 1) return null;
  const key = line.slice(0, separator).trim();
  if (!key) return null;
  return { key, value: line.slice(separator + 1), separator };
}

function entriesFromLines(lines) {
  return lines
    .map(parsePropertyLine)
    .filter(Boolean)
    .map(({ key, value }) => ({ key, value }));
}

function mergeProperties(rawInput, requestedUpdates) {
  const raw = String(rawInput ?? "");
  const newline = raw.includes("\r\n") ? "\r\n" : "\n";
  const hadTrailingNewline = raw.endsWith("\n");
  const lines = raw === "" ? [] : raw.split(/\r?\n/);
  if (hadTrailingNewline) lines.pop();

  const occurrences = new Map();
  lines.forEach((line, index) => {
    const property = parsePropertyLine(line);
    if (!property) return;
    const indexes = occurrences.get(property.key) || [];
    indexes.push(index);
    occurrences.set(property.key, indexes);
  });

  const warnings = [];
  for (const [key, indexes] of occurrences) {
    if (indexes.length > 1) {
      warnings.push({
        code: "DUPLICATE_PROPERTY",
        key,
        count: indexes.length,
        message: `Property ${key} appears ${indexes.length} times; the final value is active.`,
      });
    }
  }

  let appended = false;
  for (const [key, value] of normalizeUpdates(requestedUpdates)) {
    validateUpdate(key, value);
    const indexes = occurrences.get(key);
    if (indexes?.length) {
      const index = indexes[indexes.length - 1];
      const property = parsePropertyLine(lines[index]);
      lines[index] = `${lines[index].slice(0, property.separator + 1)}${value}`;
    } else {
      lines.push(`${key}=${value}`);
      occurrences.set(key, [lines.length - 1]);
      appended = true;
    }
  }

  const mergedRaw =
    lines.length === 0
      ? ""
      : `${lines.join(newline)}${hadTrailingNewline || appended ? newline : ""}`;
  return {
    raw: mergedRaw,
    entries: entriesFromLines(lines),
    warnings,
  };
}

module.exports = { mergeProperties };
