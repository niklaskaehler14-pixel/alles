// Your bus company: money, fleet, reputation, unlocked lines and statistics (saved in the browser).

import { BUS_TYPES } from './busTypes.js';
import { LINES } from './mapdata.js';

const KEY = 'nordkamm-bus.company.v1';

export const LIVERIES = [
  { id: 'nordkamm', name: 'Nordkamm-Gelb', body: '#f2b705', skirt: '#2b2f36', stripe: '#1c5fa8', roof: '#f4f4f0' },
  { id: 'rot', name: 'Stadtrot', body: '#c8102e', skirt: '#2b2f36', stripe: '#f4f4f0', roof: '#f4f4f0' },
  { id: 'blau', name: 'Ozeanblau', body: '#1b5fa8', skirt: '#1d2127', stripe: '#9ad0ff', roof: '#eef2f5' },
  { id: 'gruen', name: 'Waldgrün', body: '#1f7a4d', skirt: '#1d2127', stripe: '#d8f0a0', roof: '#eef2f5' },
  { id: 'weiss', name: 'Verkehrsweiß', body: '#f2f2ee', skirt: '#3a3f47', stripe: '#e3342f', roof: '#f7f7f3' },
  { id: 'creme', name: 'Elfenbein', body: '#efe3c2', skirt: '#6d3b1f', stripe: '#b03a2e', roof: '#f6efdc' },
];

const DEFAULT = {
  name: 'Nordkamm Verkehrsbetriebe',
  money: 1500,
  owned: ['solo'],
  bus: 'solo',
  livery: 'nordkamm',
  trips: 0,
  km: 0,
  passengers: 0,
  grades: [],
  best: {},
  faults: {},
  history: [],
};

export class Company {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    this.data = this.#load();
  }

  #load() {
    try {
      const raw = this.storage && this.storage.getItem(KEY);
      const d = raw ? JSON.parse(raw) : {};
      const merged = { ...structuredClone(DEFAULT), ...d };
      if (!merged.owned.includes('solo')) merged.owned.push('solo');
      if (!BUS_TYPES[merged.bus]) merged.bus = 'solo';
      return merged;
    } catch {
      return structuredClone(DEFAULT);
    }
  }

  save() {
    try {
      this.storage && this.storage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage may be unavailable (private mode) */
    }
  }

  reset() {
    this.data = structuredClone(DEFAULT);
    this.save();
  }

  get money() {
    return this.data.money;
  }

  // Reputation 0..5 stars from the last grades (1 = best).
  get reputation() {
    const g = this.data.grades.slice(-10);
    if (!g.length) return 2.5;
    const avg = g.reduce((a, b) => a + b, 0) / g.length;
    return Math.max(0, Math.min(5, 6 - avg));
  }

  owns(id) {
    return this.data.owned.includes(id);
  }

  canBuy(id) {
    const t = BUS_TYPES[id];
    return t && !this.owns(id) && this.data.money >= t.price;
  }

  buy(id) {
    if (!this.canBuy(id)) return false;
    this.data.money -= BUS_TYPES[id].price;
    this.data.owned.push(id);
    this.data.bus = id;
    this.save();
    return true;
  }

  lineUnlocked(line) {
    return this.data.trips >= line.unlock;
  }

  get unlockedLines() {
    return LINES.filter((l) => this.lineUnlocked(l));
  }

  // Book a finished trip. Returns what changed (new unlocks etc.).
  book(tripId, report, busId) {
    const d = this.data;
    const before = LINES.filter((l) => this.lineUnlocked(l)).map((l) => l.id);
    d.money = Math.round(d.money + report.money.total);
    if (!report.aborted) {
      d.trips++;
      d.grades.push(report.grade);
      if (d.grades.length > 30) d.grades.shift();
    }
    d.km = Math.round((d.km + report.km) * 10) / 10;
    d.passengers += report.transported;
    const prev = d.best[tripId];
    if (!report.aborted && (!prev || report.score > prev.score)) d.best[tripId] = { score: report.score, grade: report.grade };
    for (const f of report.faults) d.faults[f.code] = (d.faults[f.code] || 0) + 1;
    d.history.unshift({ trip: tripId, bus: busId, grade: report.grade, score: report.score, money: report.money.total, date: Date.now() });
    d.history = d.history.slice(0, 12);
    this.save();
    const after = LINES.filter((l) => this.lineUnlocked(l)).map((l) => l.id);
    return { newLines: after.filter((id) => !before.includes(id)) };
  }
}
