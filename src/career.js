// Career progress in the open world: XP and driver level, discovered places, smashed bonus boards
// and discovered roads. Saved in the browser (falls back to memory when storage is unavailable).

const CAREER_KEY = 'nordkamm.career.v1';

// Total XP needed to reach `level` (level 1 starts at 0).
export function xpForLevel(level) {
  let xp = 0;
  for (let l = 2; l <= level; l++) xp += 1500 + (l - 2) * 500;
  return xp;
}

export function levelForXp(xp) {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

export class Career {
  constructor() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(CAREER_KEY) || '{}') || {};
    } catch {
      saved = {};
    }
    this.xp = Number(saved.xp) || 0;
    this.found = new Set(Array.isArray(saved.found) ? saved.found : []);
    this.boards = new Set(Array.isArray(saved.boards) ? saved.boards : []);
    this.roads = typeof saved.roads === 'string' ? saved.roads : '';
    this.bestChain = Number(saved.bestChain) || 0;
    this.listeners = [];
  }

  get level() {
    return levelForXp(this.xp);
  }

  // Progress inside the current level: { level, into, need, fraction }.
  levelProgress() {
    const level = this.level;
    const base = xpForLevel(level);
    const next = xpForLevel(level + 1);
    return { level, into: this.xp - base, need: next - base, fraction: (this.xp - base) / (next - base) };
  }

  // Adds XP; returns the list of levels reached with this award.
  award(xp, reason = '') {
    const before = this.level;
    this.xp += Math.max(0, Math.round(xp));
    const after = this.level;
    const ups = [];
    for (let l = before + 1; l <= after; l++) ups.push(l);
    this.save();
    for (const fn of this.listeners) fn({ xp: Math.round(xp), reason, levelUps: ups });
    return ups;
  }

  onAward(fn) {
    this.listeners.push(fn);
  }

  discover(id) {
    if (this.found.has(id)) return false;
    this.found.add(id);
    this.save();
    return true;
  }

  smash(id) {
    if (this.boards.has(id)) return false;
    this.boards.add(id);
    this.save();
    return true;
  }

  save() {
    try {
      localStorage.setItem(CAREER_KEY, JSON.stringify({ xp: this.xp, found: [...this.found], boards: [...this.boards], roads: this.roads, bestChain: this.bestChain }));
    } catch {
      /* storage may be unavailable */
    }
  }
}
