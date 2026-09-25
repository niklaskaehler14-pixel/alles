// World generation and full-lap driving checks without a browser.
// Run: node tests/world.test.mjs
import assert from 'node:assert/strict';
import { WorldData } from '../src/worldgen.js';
import { AIDriver } from '../src/ai.js';
import { Vehicle } from '../src/vehicle.js';
import { ROAD, WORLD } from '../src/config.js';
import { clamp, wrapAngle, formatTime } from '../src/util.js';
import { RoadGraph, RoadDiscovery } from '../src/navigation.js';
import { xpForLevel, levelForXp, Career } from '../src/career.js';
import { SkillChain } from '../src/skills.js';

const t0 = performance.now();
const world = new WorldData().generateAll();
const tr = world.track;
console.log(`world generated in ${(performance.now() - t0).toFixed(0)} ms: track ${(tr.length / 1000).toFixed(2)} km, ${world.trees.length} trees, ${world.buildings.length} buildings, ${world.lamps.length} lamps`);

// --- world sanity
assert.ok(tr.length > 7000 && tr.length < 9500, 'track length');
assert.ok(world.trees.length > 5000, 'enough trees');
assert.ok(world.buildings.length > 50, 'city has buildings');
for (let i = 0; i < tr.count; i++) {
  assert.ok(tr.h[i] > WORLD.waterLevel + 2, `road above water at sample ${i}`);
  const g = Math.abs(tr.h[(i + 1) % tr.count] - tr.h[i]) / tr.spacing;
  assert.ok(g < 0.1, `gradient ${g.toFixed(3)} at ${i}`);
}
// No obstacle on the road surface
for (const c of world.colliders.circles) {
  const q = tr.nearest(c.x, c.z, -1, {});
  if (q.index >= 0) assert.ok(q.dist > ROAD.halfTotal + c.r - 0.2 || c.kind === 'pole', `${c.kind} blocks the road at ${c.x.toFixed(0)},${c.z.toFixed(0)}`);
}
for (const b of world.colliders.boxes) {
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const q = tr.nearest(cx, cz, -1, {});
  if (q.index >= 0) assert.ok(q.dist > ROAD.halfTotal + 4, `building too close to the road at ${cx.toFixed(0)},${cz.toFixed(0)}`);
}
// Deterministic generation
const again = new WorldData().generateAll();
assert.equal(again.trees.length, world.trees.length);
assert.equal(again.heightfield.heights[12345], world.heightfield.heights[12345]);
// Open-world layout: every activity exists and the off-road runs are drivable.
assert.equal(world.routes.length, 9);
assert.equal(world.driftZones.length, 3);
assert.equal(world.speedTraps.length, 4);
assert.equal(world.ramps.length, 4);
assert.equal(world.speedZones.length, 3);
assert.ok(world.bonusBoards.length >= 12, 'bonus boards placed');
assert.equal(world.landmarks.length, 7);
assert.ok(world.festival && world.festival.gates.length === 2, 'festival with two entrances');
// Scenery stays off the roads (the pass torii spans the touge, its pillars stand beside it).
for (const road of [world.track, ...world.branches]) {
  for (const b of world.bonusBoards) {
    const q = road.nearest(b.x, b.z, -1, {}, 2);
    if (q.index >= 0) assert.ok(q.dist > (road.halfTotal || ROAD.halfTotal) + 1, `bonus board ${b.id} on ${road.id || 'circuit'}`);
  }
}
for (const r of world.routes) {
  assert.ok(r.checkpoints.length >= 5, `${r.name} has checkpoints`);
  for (let i = 1; i < r.points.length; i++) {
    const a = r.points[i - 1];
    const b = r.points[i];
    if (a.road && b.road) continue; // road legs follow the circuit
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    let prev = world.heightfield.get(a.x, a.z);
    for (let t = 5; t <= d; t += 5) {
      const h = world.heightfield.get(a.x + ((b.x - a.x) * t) / d, a.z + ((b.z - a.z) * t) / d);
      assert.ok(h > WORLD.waterLevel + 1, `${r.name} leg ${i} runs through water`);
      // The lake run ends with a steep drop down to the beach, everything else stays moderate.
      assert.ok(Math.abs(h - prev) / 5 < (r.id === 'run-lake' ? 0.45 : 0.3), `${r.name} leg ${i} too steep`);
      prev = h;
    }
  }
}
for (const r of world.ramps) {
  const fx = Math.sin(r.yaw);
  const fz = Math.cos(r.yaw);
  const lip = world.groundHeight(r.x + fx * (r.length - 0.2), r.z + fz * (r.length - 0.2), null);
  const base = world.heightfield.get(r.x + fx * (r.length - 0.2), r.z + fz * (r.length - 0.2));
  assert.ok(lip - base > 2.3, `${r.name} lip is raised`);
}
console.log('world checks passed');

// --- AI race: 5 cars, 2 laps
const DT = 1 / 60;
const skills = [0.975, 0.96, 0.95, 0.935, 0.92];
const ais = skills.map((skill, i) => {
  const a = new AIDriver(tr, world, { skill, lane: [1.6, -1.6, 0.8, -0.8, 0][i] });
  a.placeAt(tr.startS - 10 - i * 7, i % 2 ? -2.6 : 2.6);
  return a;
});
const laps = ais.map(() => ({ lap: 0, prev: null, times: [], start: 0, maxLat: 0 }));
let time = 0;
const L = tr.length;
while (time < 900 && laps.some((l) => l.lap <= 2)) {
  for (let i = 0; i < ais.length; i++) {
    const a = ais[i];
    a.update(DT, ais, { race: true });
    const st = laps[i];
    const rs = tr.wrapS(a.s - tr.startS);
    if (st.prev !== null && st.prev > L * 0.75 && rs < L * 0.25) {
      if (st.lap >= 1) st.times.push(time - st.start);
      st.lap++;
      st.start = time;
    }
    st.prev = rs;
    if (time > 5) st.maxLat = Math.max(st.maxLat, Math.abs(a.lateral));
    assert.ok(Number.isFinite(a.x) && Number.isFinite(a.y), 'AI state finite');
  }
  time += DT;
}
laps.forEach((l, i) => console.log(`AI ${i}: laps ${l.times.map(formatTime).join(', ')}, max lateral ${l.maxLat.toFixed(1)} m`));
for (const l of laps) {
  assert.ok(l.times.length >= 2, 'every AI finishes two laps');
  for (const t of l.times) assert.ok(t > 120 && t < 300, `lap time ${t.toFixed(1)} s is plausible`);
  assert.ok(l.maxLat < ROAD.halfTotal + 1, `AI stays on the road (max ${l.maxLat.toFixed(1)} m)`);
}
console.log('AI race checks passed');

// --- Player physics on the real terrain: an autopilot drives one lap
const car = new Vehicle();
const hints = [-1, -1, -1, -1];
const qTmp = {};
const ground = (x, z, w, out) => {
  const q = tr.nearest(x, z, hints[w], qTmp);
  if (q.index >= 0) hints[w] = q.index;
  out.h = world.groundHeight(x, z, q);
  out.surface = world.surfaceAt(x, z, out.h, q);
  return out;
};
const start = tr.pointAt(tr.startS + 5, 0, {});
car.reset(start.x, start.h, start.z, start.heading);
car.groundY = start.h;
const pilot = new AIDriver(tr, world, { skill: 0.93 });
let idx = start.index;
let s0 = null;
let driven = 0;
let airTime = 0;
let offRoad = 0;
let maxSpeed = 0;
let lastS = tr.wrapS(tr.startS + 5);
const q = {};
for (let step = 0; step < 120 * 400 && driven < L; step++) {
  const n = tr.nearest(car.x, car.z, idx, q);
  if (n.index >= 0) idx = n.index;
  const look = 10 + car.speed * 0.5;
  const p = tr.pointAt(n.s + look, clamp(-n.lateral * 0.3, -2, 2), {});
  const alpha = wrapAngle(Math.atan2(p.x - car.x, p.z - car.z) - car.yaw);
  pilot.s = n.s;
  pilot.speed = car.speed;
  const target = pilot.speed === 0 ? 30 : Math.min(80, (() => {
    let v = 95;
    for (let d = 0; d <= 220; d += 10) {
      const k = Math.abs(tr.curvatureAt(n.s + d)) + 1e-4;
      v = Math.min(v, Math.sqrt(Math.sqrt((0.85 * 9.81) / k) ** 2 + 2 * 6 * d));
    }
    return v;
  })());
  const input = {
    steer: clamp(-alpha * 3.2, -1, 1),
    analogSteer: true,
    throttle: car.speed < target ? 1 : 0,
    brake: car.speed > target + 1 ? clamp((car.speed - target) / 2.5, 0, 1) : 0,
  };
  car.step(1 / 120, input, ground);
  car.drainEvents();
  assert.ok(Number.isFinite(car.x) && Number.isFinite(car.y) && Number.isFinite(car.vx), 'car state finite');
  if (!car.onGround) airTime += 1 / 120;
  if (Math.abs(n.lateral) > ROAD.halfTotal) offRoad += 1 / 120;
  maxSpeed = Math.max(maxSpeed, car.speed);
  const rs = n.s;
  let ds = rs - lastS;
  if (ds < -L / 2) ds += L;
  if (ds > L / 2) ds -= L;
  if (s0 === null) s0 = rs;
  driven += ds;
  lastS = rs;
}
console.log(`autopilot lap: driven ${(driven / 1000).toFixed(2)} km, top ${(maxSpeed * 3.6).toFixed(0)} km/h, airtime ${airTime.toFixed(2)} s, off-road ${offRoad.toFixed(1)} s`);
assert.ok(driven >= L, 'player car can complete a full lap');
assert.ok(offRoad < 5, `autopilot stays on the road (${offRoad.toFixed(1)} s off)`);
assert.ok(airTime < 3, 'no excessive jumps on the circuit');
console.log('player lap checks passed');

// --- Branch roads: drivable profiles, no obstacles, and the autopilot drives each one end to end
assert.ok(world.branches.length >= 3, 'branch roads exist');
for (const road of world.branches) {
  for (let i = 1; i < road.count; i++) {
    const g = Math.abs(road.h[i] - road.h[i - 1]) / road.spacing;
    assert.ok(g < 0.105, `${road.id}: gradient ${(g * 100).toFixed(1)}% at ${i}`);
    assert.ok(road.h[i] > WORLD.waterLevel + 2, `${road.id} above water at ${i}`);
  }
  for (const c of world.colliders.circles) {
    if (c.kind === 'pole' || c.kind === 'rail') continue;
    const q = road.nearest(c.x, c.z, -1, {}, 2);
    if (q.index >= 0) assert.ok(q.dist > road.halfTotal + c.r - 0.2, `${c.kind} blocks ${road.id} at ${c.x.toFixed(0)},${c.z.toFixed(0)}`);
  }
}
for (const road of world.branches) {
  const v = new Vehicle();
  const hint = [-1, -1, -1, -1];
  const gq = {};
  const gnd = (x, z, w, out) => {
    const q = tr.nearest(x, z, hint[w], gq);
    if (q.index >= 0) hint[w] = q.index;
    out.h = world.groundHeight(x, z, q);
    out.surface = world.surfaceAt(x, z, out.h, q);
    return out;
  };
  for (const dir of [1, -1]) {
    const s0 = dir > 0 ? 25 : road.length - 25;
    const p0 = road.pointAt(s0, 0, {});
    v.reset(p0.x, world.groundHeight(p0.x, p0.z, tr.nearest(p0.x, p0.z, -1, {})), p0.z, dir > 0 ? p0.heading : p0.heading + Math.PI);
    let air = 0;
    let off = 0;
    let top = 0;
    let bump = 0;
    let s = s0;
    const rq = {};
    for (let step = 0; step < 120 * 300; step++) {
      const n = road.nearest(v.x, v.z, -1, rq, 3);
      if (n.index >= 0) s = n.s;
      if (dir > 0 ? s > road.length - 30 : s < 30) break;
      const look = 6 + v.speed * 0.45;
      const p = road.pointAt(s + dir * look, 0, {});
      const alpha = wrapAngle(Math.atan2(p.x - v.x, p.z - v.z) - v.yaw);
      let target = 70;
      for (let d = 0; d <= 160; d += 6) {
        const k = Math.abs(road.curvatureAt(s + dir * d)) + 1e-4;
        target = Math.min(target, Math.sqrt((road.surface ? 0.55 : 0.8) * 9.81 / k + 2 * 5 * d));
      }
      const vy0 = v.vy;
      v.step(1 / 120, { steer: clamp(-alpha * 3, -1, 1), analogSteer: true, throttle: v.speed < target ? 1 : 0, brake: v.speed > target + 1 ? clamp((v.speed - target) / 3, 0, 1) : 0 }, gnd);
      v.drainEvents();
      assert.ok(Number.isFinite(v.x) && Number.isFinite(v.y), 'car state finite');
      if (!v.onGround) air += 1 / 120;
      if (n.index >= 0 && Math.abs(n.lateral) > road.halfTotal + 1) off += 1 / 120;
      bump = Math.max(bump, Math.abs(v.vy - vy0) * 120);
      top = Math.max(top, v.speed);
    }
    const done = dir > 0 ? s > road.length - 60 : s < 60;
    console.log(`${road.name} ${dir > 0 ? 'hin' : 'zurück'}: ${done ? 'durch' : `stecken bei ${s.toFixed(0)} m`}, top ${(top * 3.6).toFixed(0)} km/h, air ${air.toFixed(2)} s, off-road ${off.toFixed(1)} s`);
    assert.ok(done, `${road.id} drivable ${dir > 0 ? 'forwards' : 'backwards'}`);
    assert.ok(air < 1, `${road.id}: no jumps (${air.toFixed(2)} s airborne)`);
    assert.ok(off < 3, `${road.id}: autopilot stays on the road`);
  }
}
console.log('branch road checks passed');

// --- GPS routing over the road network
const graph = new RoadGraph(world);
const pass = world.landmarks.find((l) => l.id === 'lm-pass');
const fest = world.festival;
for (const [name, a, b] of [
  ['start -> pass', [tr.x[tr.startIndex], tr.z[tr.startIndex]], [pass.x, pass.z]],
  ['festival -> lighthouse', [fest.x, fest.z], [world.lighthouse.x, world.lighthouse.z]],
  ['gravel -> city', [world.branches[2].x[400], world.branches[2].z[400]], [-700, -600]],
]) {
  const r = graph.route(a[0], a[1], b[0], b[1]);
  const straight = Math.hypot(b[0] - a[0], b[1] - a[1]);
  console.log(`route ${name}: ${(r.length / 1000).toFixed(2)} km over ${r.points.length} points (straight ${(straight / 1000).toFixed(2)} km)`);
  assert.ok(r.points.length > 10 && r.length >= straight * 0.99 && r.length < straight * 4, `${name}: plausible route`);
  // Consecutive route points are close together (it follows the roads).
  for (let i = 1; i < r.points.length; i++) {
    const d = Math.hypot(r.points[i][0] - r.points[i - 1][0], r.points[i][1] - r.points[i - 1][1]);
    assert.ok(d < 60 || i === 1 || i === r.points.length - 1, `${name}: gap of ${d.toFixed(0)} m in the route`);
  }
}
// Discovered roads survive a save/load round trip.
const disc = new RoadDiscovery(world);
disc.visit(tr.x[100], tr.z[100], 40);
disc.visit(pass.x, pass.z, 40);
const reloaded = new RoadDiscovery(world, disc.save());
assert.ok(disc.count > 3 && reloaded.count === disc.count, 'road discovery round trip');
console.log('navigation checks passed');

// --- Career levels and skill chains
assert.equal(levelForXp(0), 1);
assert.equal(levelForXp(xpForLevel(2)), 2);
assert.equal(levelForXp(xpForLevel(5) - 1), 4);
const career = new Career();
const ups = career.award(xpForLevel(3) + 10, 'test');
assert.deepEqual(ups, [2, 3]);
let banked = 0;
let broken = 0;
const chain = new SkillChain({ onBank: (t) => (banked = t), onBreak: (t) => (broken = t) });
const drifter = { x: 0, z: 0, yaw: 0, speed: 30, onGround: true };
for (let i = 0; i < 60; i++) chain.update(1 / 60, drifter, [], 20); // one second of drifting
assert.ok(chain.active && chain.points > 1000, 'drift feeds the chain');
drifter.onGround = false;
for (let i = 0; i < 60; i++) chain.update(1 / 60, drifter, [], 0); // one second in the air
drifter.onGround = true;
chain.update(1 / 60, drifter, [], 0);
assert.ok(chain.mult >= 2, 'a second skill raises the multiplier');
for (let i = 0; i < 60 * 4; i++) chain.update(1 / 60, drifter, [], 0);
assert.ok(banked > 0 && !chain.active, 'quiet chain gets banked');
for (let i = 0; i < 30; i++) chain.update(1 / 60, drifter, [], 20);
chain.crash();
assert.ok(broken > 0 && !chain.active, 'a crash breaks the chain');
console.log('career and skill checks passed');
