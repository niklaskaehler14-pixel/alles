// World generation and full-lap driving checks without a browser.
// Run: node tests/world.test.mjs
import assert from 'node:assert/strict';
import { WorldData } from '../src/worldgen.js';
import { AIDriver } from '../src/ai.js';
import { Vehicle } from '../src/vehicle.js';
import { ROAD, WORLD } from '../src/config.js';
import { clamp, wrapAngle, formatTime } from '../src/util.js';

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
