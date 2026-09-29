// Bus driving physics on flat ground (run: node tests/bus-physics.test.mjs).
import assert from 'node:assert/strict';
import { Bus } from '../bus/src/busPhysics.js';
import { BUS_TYPES } from '../bus/src/busTypes.js';

const DT = 1 / 120;
const flat = { ground: () => 0 };

function run(bus, seconds, input, stopWhen, env = flat) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const inp = typeof input === 'function' ? input(bus, i * DT) : input;
    bus.step(DT, inp, env);
    bus.drainEvents();
    for (const v of [bus.x, bus.z, bus.u, bus.v, bus.r, bus.yaw, bus.rpm]) assert.ok(Number.isFinite(v), 'state must stay finite');
    if (stopWhen && stopWhen(bus, i * DT)) return i * DT;
  }
  return seconds;
}

const results = [];
const check = (name, fn) => {
  fn();
  results.push(name);
  console.log(`ok  ${name}`);
};

for (const id of ['solo', 'midi', 'electric', 'articulated']) {
  check(`${id}: 0-50 km/h in 6.5-12 s`, () => {
    const bus = new Bus(BUS_TYPES[id]);
    const t = run(bus, 30, { throttle: 1 }, (b) => b.kmh >= 50);
    console.log(`    0-50: ${t.toFixed(1)} s`);
    assert.ok(t > 6.5 && t < 12);
  });
}

check('solo: top speed governed at ~80 km/h', () => {
  const bus = new Bus(BUS_TYPES.solo);
  run(bus, 90, { throttle: 1 });
  console.log(`    top: ${bus.kmh.toFixed(1)} km/h, gear ${bus.gear + 1}, ${bus.rpm.toFixed(0)} rpm`);
  assert.ok(bus.kmh > 76 && bus.kmh < 83);
});

check('solo: full brake 50-0 within 15-21 m', () => {
  const bus = new Bus(BUS_TYPES.solo);
  bus.u = 50 / 3.6;
  const z0 = bus.z;
  run(bus, 10, { brake: 1 }, (b) => b.u <= 0);
  const d = bus.z - z0;
  console.log(`    braking distance: ${d.toFixed(1)} m`);
  assert.ok(d > 15 && d < 21);
  assert.equal(bus.u, 0);
});

check('solo: idle creep in D between 2 and 7 km/h, brake holds', () => {
  const bus = new Bus(BUS_TYPES.solo);
  run(bus, 20, {});
  console.log(`    creep: ${bus.kmh.toFixed(1)} km/h`);
  assert.ok(bus.kmh > 2 && bus.kmh < 7);
  run(bus, 5, { brake: 0.3 });
  assert.equal(bus.u, 0);
});

function turningCircle(spec) {
  const bus = new Bus(spec);
  // Creep at full lock and track the outer front corner.
  let minX = Infinity;
  let maxX = -Infinity;
  const tmp = [0, 0];
  const g = bus.geo;
  run(bus, 60, (b) => ({ steer: 1, throttle: b.kmh < 5 ? 0.25 : 0, brake: b.kmh > 6 ? 0.2 : 0 }), (b, t) => {
    if (t < 8) return false;
    b.localToWorld(-spec.width / 2, g.front, tmp);
    minX = Math.min(minX, tmp[0]);
    maxX = Math.max(maxX, tmp[0]);
    return false;
  });
  return maxX - minX;
}

check('solo: turning circle 22-24.5 m (real bus: 23 m)', () => {
  const d = turningCircle(BUS_TYPES.solo);
  console.log(`    turning circle: ${d.toFixed(1)} m`);
  assert.ok(d > 22 && d < 24.5);
});

check('midi: turning circle 16.5-19 m', () => {
  const d = turningCircle(BUS_TYPES.midi);
  console.log(`    turning circle: ${d.toFixed(1)} m`);
  assert.ok(d > 16.5 && d < 19);
});

check('solo: rear axle tracks inside the front axle (offtracking ~ L²/2R)', () => {
  const bus = new Bus(BUS_TYPES.solo);
  // Steady circle with front axle radius ~12 m at walking pace.
  const steer = Math.asin(bus.L / 12) / bus.spec.steerMax;
  let rf = 0;
  let rr = 0;
  const f = [0, 0];
  const r = [0, 0];
  const pts = [];
  run(bus, 70, (b) => ({ steer, throttle: b.kmh < 7 ? 0.3 : 0 }), (b, t) => {
    if (t > 30) {
      b.localToWorld(0, b.L, f);
      b.localToWorld(0, 0, r);
      pts.push([f[0], f[1], r[0], r[1]]);
    }
    return false;
  });
  // Circle centre from the mean of the rear-axle track.
  const cx = pts.reduce((s, p) => s + p[2], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[3], 0) / pts.length;
  rf = pts.reduce((s, p) => s + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length;
  rr = pts.reduce((s, p) => s + Math.hypot(p[2] - cx, p[3] - cz), 0) / pts.length;
  const expected = rf - Math.sqrt(rf * rf - bus.L * bus.L);
  console.log(`    front ${rf.toFixed(2)} m, rear ${rr.toFixed(2)} m, offtracking ${(rf - rr).toFixed(2)} m (geometric ${expected.toFixed(2)})`);
  assert.ok(Math.abs(rf - rr - expected) < 0.25);
});

check('solo: tail swings out when pulling away from the curb at full lock', () => {
  const bus = new Bus(BUS_TYPES.solo);
  const g = bus.geo;
  const tmp = [0, 0];
  const startRight = bus.localToWorld(-bus.spec.width / 2, g.rear)[0];
  let maxOut = 0;
  run(bus, 6, (b) => ({ steer: 1, throttle: b.kmh < 4 ? 0.3 : 0 }), (b) => {
    b.localToWorld(-b.spec.width / 2, g.rear, tmp);
    // right side is -x at yaw 0: swinging out means going further to -x
    maxOut = Math.max(maxOut, startRight - tmp[0]);
    return false;
  });
  console.log(`    tail swing: ${maxOut.toFixed(2)} m`);
  assert.ok(maxOut > 0.4 && maxOut < 1.3);
});

check('solo: stable lane change and hard steering at 50 km/h', () => {
  const bus = new Bus(BUS_TYPES.solo);
  bus.u = 50 / 3.6;
  let maxR = 0;
  run(bus, 8, (b, t) => ({ throttle: 0.4, steer: t < 1 ? t : t < 3 ? 1 : -1 }), (b) => {
    maxR = Math.max(maxR, Math.abs(b.r));
    return false;
  });
  console.log(`    max yaw rate ${maxR.toFixed(2)} rad/s, speed ${bus.kmh.toFixed(0)} km/h`);
  assert.ok(maxR < 1.2);
});

check('doors: open only at standstill, stop brake holds, releases after closing', () => {
  const bus = new Bus(BUS_TYPES.solo);
  bus.u = 5;
  assert.equal(bus.setDoor(0, true), false);
  run(bus, 6, { brake: 0.5 }, (b) => b.u === 0);
  assert.equal(bus.setDoor(0, true), true);
  run(bus, 3, {});
  assert.ok(bus.doors[0].open > 0.99 && bus.stopBrake);
  run(bus, 3, { throttle: 1 });
  assert.equal(bus.u, 0, 'stop brake must hold with open doors');
  bus.setDoor(0, false);
  run(bus, 3, {});
  assert.equal(bus.doors[0].open, 0);
  run(bus, 3, { throttle: 0.6 });
  assert.ok(!bus.stopBrake && bus.kmh > 5, 'bus drives off after closing the doors');
});

check('doors: closing on a passenger reopens the door', () => {
  const bus = new Bus(BUS_TYPES.solo);
  bus.setDoor(1, true);
  run(bus, 3, {});
  bus.doors[1].obstructed = true;
  bus.setDoor(1, false);
  let reversed = false;
  for (let i = 0; i < 240; i++) {
    bus.step(DT, {}, flat);
    if (bus.drainEvents().some((e) => e.type === 'doorReverse')) reversed = true;
  }
  assert.ok(reversed && bus.doors[1].target === 1);
});

check('kneeling lowers the bus and limits speed', () => {
  const bus = new Bus(BUS_TYPES.solo);
  bus.setKneel(true);
  run(bus, 3, { brake: 0.3 });
  assert.ok(bus.kneel > 0.99);
  bus.setDoor(0, true);
  run(bus, 3, {});
  bus.setDoor(0, false);
  run(bus, 3, {});
  run(bus, 4, { throttle: 1 });
  assert.ok(bus.kneel < 1, 'kneeling is raised when driving off');
});

check('parking brake holds against full throttle', () => {
  const bus = new Bus(BUS_TYPES.solo);
  bus.setParkingBrake(true);
  run(bus, 4, { throttle: 1 });
  assert.ok(bus.kmh < 0.5);
  assert.equal(bus.hold, 'parkingBrake');
});

check('reverse gear: slow, limited to 8 km/h', () => {
  const bus = new Bus(BUS_TYPES.solo);
  assert.ok(bus.setSelector('R'));
  run(bus, 10, { throttle: 1 });
  console.log(`    reverse: ${(bus.u * 3.6).toFixed(1)} km/h`);
  assert.ok(bus.u < -1 && bus.u > -2.6);
});

check('articulated: rear section follows, articulation bounded in a full-lock circle', () => {
  const bus = new Bus(BUS_TYPES.articulated);
  let maxPhi = 0;
  run(bus, 40, (b) => ({ steer: 1, throttle: b.kmh < 5 ? 0.3 : 0 }), (b) => {
    maxPhi = Math.max(maxPhi, Math.abs(b.articulation));
    return false;
  });
  console.log(`    max articulation ${((maxPhi * 180) / Math.PI).toFixed(0)}°`);
  assert.ok(maxPhi > 0.3 && maxPhi < 0.995, "steady full-lock circle stays below the stop");
  const d = turningCircle(BUS_TYPES.articulated);
  console.log(`    turning circle ${d.toFixed(1)} m`);
  assert.ok(d > 22 && d < 25);
});

check('articulated: reversing into a jackknife is stopped', () => {
  const bus = new Bus(BUS_TYPES.articulated);
  bus.setSelector('R');
  let hit = false;
  run(bus, 40, { throttle: 0.6, steer: 1 }, (b) => {
    if (b.hold === 'jackknife') hit = true;
    return hit;
  });
  assert.ok(hit);
  assert.ok(Math.abs(bus.articulation) <= 1.001);
});

check('curb detection reports wheels mounting the sidewalk', () => {
  const bus = new Bus(BUS_TYPES.solo);
  const env = { ground: (x) => (x < -1.8 ? 1 : 0) };
  let curb = 0;
  run(bus, 20, (b) => ({ throttle: 0.3, steer: -0.3 }), (b) => {
    for (const e of b.events) if (e.type === 'curb') curb++;
    return false;
  }, {
    ground: env.ground,
  });
  // events were drained in run(); re-run without draining to count
  const b2 = new Bus(BUS_TYPES.solo);
  let seen = 0;
  for (let i = 0; i < 2400; i++) {
    b2.step(DT, { throttle: 0.3, steer: -0.3 }, env);
    seen += b2.drainEvents().filter((e) => e.type === 'curb').length;
  }
  assert.ok(seen >= 1);
});

console.log(`\n${results.length} physics checks passed`);
