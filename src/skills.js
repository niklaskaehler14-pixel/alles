// Skill chains in free roam: drifts, near misses, jumps, top speed, slipstream and smashed boards
// add up while the chain stays alive. Every new skill raises the multiplier; the chain is banked
// after a few quiet seconds and lost on a crash.

export const SKILLS = {
  drift: 'Drift',
  near: 'Beinahe-Crash',
  air: 'Luftsprung',
  bigAir: 'Riesensprung',
  speed: 'Vollgas',
  draft: 'Windschatten',
  wreck: 'Zerstörung',
};

const BANK_AFTER = 3.2; // seconds without a new skill
const MAX_MULT = 10;

export class SkillChain {
  constructor({ onBank, onBreak } = {}) {
    this.onBank = onBank || (() => {});
    this.onBreak = onBreak || (() => {});
    this.traffic = new Map(); // per traffic car: previous longitudinal offset
    this.reset();
  }

  reset() {
    this.points = 0;
    this.mult = 1;
    this.timer = 0;
    this.active = false;
    this.feed = []; // latest skills: { kind, name, points, age }
    this.running = {}; // continuous skills currently scoring
    this.air = 0;
    this.traffic.clear();
  }

  get total() {
    return Math.round(this.points * this.mult);
  }

  // A discrete skill event (or the start of a continuous one): raises the multiplier.
  #event(kind, points, name = SKILLS[kind]) {
    this.active = true;
    this.mult = Math.min(MAX_MULT, this.mult + (this.feed.length || this.points > 0 ? 1 : 0));
    this.points += points;
    this.timer = BANK_AFTER;
    this.feed.unshift({ kind, name, points, age: 0 });
    if (this.feed.length > 4) this.feed.length = 4;
  }

  // Continuous scoring for a skill that is already running.
  #continue(kind, points) {
    if (!this.running[kind]) {
      this.running[kind] = true;
      this.#event(kind, points);
      return;
    }
    this.points += points;
    this.timer = BANK_AFTER;
    if (this.feed[0] && this.feed[0].kind === kind) this.feed[0].points += points;
    else this.feed.unshift({ kind, name: SKILLS[kind], points, age: 0 });
    if (this.feed.length > 4) this.feed.length = 4;
  }

  add(kind, points, name) {
    this.#event(kind, points, name);
  }

  crash() {
    if (!this.active || this.points < 1) {
      this.reset();
      return;
    }
    const lost = this.total;
    this.reset();
    this.onBreak(lost);
  }

  // v: player vehicle, traffic: [{ x, z, yaw, speed }], drift: game drift state (points this frame).
  update(dt, v, traffic, driftDelta, enabled = true) {
    for (const f of this.feed) f.age += dt;
    if (!enabled) {
      this.running = {};
      return;
    }
    // Drift (the game's drift scoring feeds its points in).
    if (driftDelta > 0) this.#continue('drift', driftDelta);
    else this.running.drift = false;
    // Top speed above 200 km/h
    if (v.speed > 55.6 && v.onGround) this.#continue('speed', 90 * dt);
    else this.running.speed = false;
    // Air time
    if (!v.onGround) this.air += dt;
    else {
      if (this.air > 0.6) {
        const big = this.air > 1.8;
        this.#event(big ? 'bigAir' : 'air', Math.round(150 + this.air * 450), big ? SKILLS.bigAir : SKILLS.air);
      }
      this.air = 0;
    }
    // Traffic: near misses and slipstream
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    let drafting = false;
    for (let i = 0; i < traffic.length; i++) {
      const t = traffic[i];
      const dx = t.x - v.x;
      const dz = t.z - v.z;
      const along = dx * fx + dz * fz; // positive: car ahead
      const side = Math.abs(dx * fz - dz * fx);
      const prev = this.traffic.get(i);
      this.traffic.set(i, along);
      if (prev === undefined) continue;
      // Passed the car (it went from ahead to behind or the other way) close beside it.
      const rel = Math.abs(v.speed - t.speed * Math.cos(t.yaw - v.yaw));
      if (Math.sign(prev) !== Math.sign(along) && side > 1.9 && side < 3.8 && rel > 9 && v.speed > 12) this.#event('near', 250);
      const aligned = Math.cos(t.yaw - v.yaw) > 0.94;
      if (aligned && along > 3 && along < 16 && side < 1.8 && v.speed > 24) drafting = true;
    }
    if (drafting) this.#continue('draft', 110 * dt);
    else this.running.draft = false;

    if (this.active) {
      const busy = this.running.drift || this.running.speed || this.running.draft || !v.onGround;
      if (!busy) this.timer -= dt;
      if (this.timer <= 0) {
        const total = this.total;
        this.reset();
        if (total > 0) this.onBank(total);
      }
    }
  }
}
