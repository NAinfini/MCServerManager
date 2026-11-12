"use strict";
/*
 * Retention for automatic restore points: the newest `keepRecent`, plus the
 * newest point of each of the last `keepDaily` days, plus the newest point of
 * each of the last `keepWeekly` weeks (weeks start on Monday). Pure: it only
 * decides, the caller deletes.
 */
const DEFAULT_POLICY = Object.freeze({
  keepRecent: 8,
  keepDaily: 5,
  keepWeekly: 2,
});

/* With no cap set, restore points may use this many times the world's size. */
const AUTO_CAP_WORLD_MULTIPLE = 5;

function capBytesFor(maxTotalMb, newestLogicalBytes) {
  if (maxTotalMb) return maxTotalMb * 1024 * 1024;
  return newestLogicalBytes > 0
    ? newestLogicalBytes * AUTO_CAP_WORLD_MULTIPLE
    : Infinity;
}

/* Drops the oldest automatic points until storage fits. `automatic` is newest
   first. The newest point always stays: a backup set that fits the cap but
   cannot restore anything would be worse than one over it. */
async function pruneToCap({ automatic, capBytes, measureBytes, remove }) {
  const removed = [];
  for (const point of [...automatic].slice(1).reverse()) {
    if ((await measureBytes()) <= capBytes) break;
    await remove(point.id);
    removed.push(point.id);
  }
  return removed;
}

function normalizePolicy(input = {}) {
  const policy = { ...DEFAULT_POLICY };
  for (const key of Object.keys(DEFAULT_POLICY)) {
    if (input[key] === undefined || input[key] === null) continue;
    const value = Number(input[key]);
    if (!Number.isInteger(value) || value < 0 || value > 1000)
      throw new RangeError(`${key} must be a whole number from 0 to 1000`);
    policy[key] = value;
  }
  if (policy.keepRecent < 1)
    throw new RangeError("keepRecent must be at least 1");
  return policy;
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function weekKey(date) {
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return dayKey(monday);
}

/* items: [{ id, createdAt }]. Returns { keep: [ids], remove: [ids] }, each
   newest first. Items with an unreadable date are always kept. */
function selectRetention(items, policyInput) {
  const policy = normalizePolicy(policyInput);
  const dated = [];
  const keep = new Set();
  for (const item of items) {
    const time = new Date(item.createdAt).getTime();
    if (Number.isNaN(time)) keep.add(item.id);
    else dated.push({ id: item.id, time, date: new Date(time) });
  }
  dated.sort((a, b) => b.time - a.time);
  dated.slice(0, policy.keepRecent).forEach((item) => keep.add(item.id));
  for (const [limit, keyOf] of [
    [policy.keepDaily, dayKey],
    [policy.keepWeekly, weekKey],
  ]) {
    const seen = new Set();
    for (const item of dated) {
      const key = keyOf(item.date);
      if (seen.has(key)) continue;
      if (seen.size >= limit) break;
      seen.add(key);
      keep.add(item.id);
    }
  }
  const ordered = dated.map((item) => item.id);
  return {
    keep: ordered.filter((id) => keep.has(id)),
    remove: ordered.filter((id) => !keep.has(id)),
  };
}

module.exports = {
  AUTO_CAP_WORLD_MULTIPLE,
  DEFAULT_POLICY,
  capBytesFor,
  normalizePolicy,
  pruneToCap,
  selectRetention,
};
