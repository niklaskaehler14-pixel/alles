// Driving-physics sanity checks on flat ground (run: node tests/physics.test.mjs).
import assert from 'node:assert/strict';
import { Vehicle } from '../src/vehicle.js';

const DT = 1 / 120;
const flat = (x, z, w, out) => {
  out.h = 0;
  out.surface = 0;
  return out;
};
const grass = (x, z, w, out) => {
  out.h = 0;
  out.surface = 1;
  return out;
};

function run(car, seconds, input, ground = flat, stopWhen) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    car.step(DT, input, ground);
    car.drainEvents();
    for (const v of [car.x, car.z, car.vx, car.vz, car.yaw, car.yawRate, car.rpm]) assert.ok(Number.isFinite(v), 'state must stay finite');
    if (stopWhen && stopWhen(car, i * DT)) return i * DT;
  }
  return seconds;
}

const results = [];
const check = (name, fn) => {
  fn();
  results.push(name);
};

check('0-100 km/h between 3.5 and 6.5 s', () => {
  const car = new Vehicle();
  const t = run(car, 15, { throttle: 1 }, flat, (c) => c.speed * 3.6 >= 100);
  console.log(`  0-100 km/h: ${t.toFixed(2)} s`);
  assert.ok(t > 3.5 && t < 6.5);
});

check('top speed between 250 and 320 km/h', () => {
  const car = new Vehicle();
  run(car, 70, { throttle: 1 });
  const kmh = car.speed * 3.6;
  console.log(`  top speed: ${kmh.toFixed(0)} km/h, gear ${car.gear}, rpm ${car.rpm.toFixed(0)}`);
  assert.ok(kmh > 250 && kmh < 320);
  assert.equal(car.gear, 6);
});

check('100-0 km/h braking distance 30-45 m', () => {
  const car = new Vehicle();
  car.vz = 100 / 3.6;
  const z0 = car.z;
  run(car, 10, { brake: 1 }, flat, (c) => c.speed < 0.1);
  const d = car.z - z0;
  console.log(`  braking distance: ${d.toFixed(1)} m`);
  assert.ok(d > 30 && d < 45);
});

check('steady full-lock cornering at 100 km/h stays stable', () => {
  const car = new Vehicle();
  car.vz = 100 / 3.6;
  let maxDrift = 0;
  run(car, 6, { throttle: 0.45, steer: 1 }, flat, (c) => {
    maxDrift = Math.max(maxDrift, Math.abs(c.driftAngle));
    return false;
  });
  console.log(`  cornering: speed ${(car.speed * 3.6).toFixed(0)} km/h, lat acc ${(car.ayLocal / 9.81).toFixed(2)} g, max slip ${(maxDrift * 57.3).toFixed(1)} deg`);
  assert.ok(maxDrift < 0.35, 'car should not spin under steady cornering');
  assert.ok(car.yawRate < 0, 'steering right turns right');
});

check('high speed lane change does not spin', () => {
  const car = new Vehicle();
  car.vz = 200 / 3.6;
  let maxDrift = 0;
  for (const steer of [1, -1, 1, 0]) {
    run(car, 0.6, { throttle: 0.6, steer }, flat, (c) => {
      maxDrift = Math.max(maxDrift, Math.abs(c.driftAngle));
      return false;
    });
  }
  console.log(`  lane change @200: max slip ${(maxDrift * 57.3).toFixed(1)} deg, end speed ${(car.speed * 3.6).toFixed(0)}`);
  assert.ok(maxDrift < 0.3);
});

check('handbrake at speed rotates the car (drift)', () => {
  const car = new Vehicle();
  car.vz = 80 / 3.6;
  let maxDrift = 0;
  run(car, 1.2, { steer: -1, handbrake: true }, flat, (c) => {
    maxDrift = Math.max(maxDrift, Math.abs(c.driftAngle));
    return false;
  });
  console.log(`  handbrake: max drift ${(maxDrift * 57.3).toFixed(1)} deg`);
  assert.ok(maxDrift > 0.25);
});

check('reverse gear engages from standstill', () => {
  const car = new Vehicle();
  run(car, 3, { brake: 1 });
  assert.equal(car.gear, -1);
  assert.ok(car.forwardSpeed < -3, `reverse speed ${car.forwardSpeed}`);
  run(car, 3, { throttle: 1 });
  assert.ok(car.gear >= 1);
});

check('grass is slower than asphalt', () => {
  const a = new Vehicle();
  const b = new Vehicle();
  run(a, 8, { throttle: 1 });
  run(b, 8, { throttle: 1 }, grass);
  console.log(`  8s full throttle: asphalt ${(a.speed * 3.6).toFixed(0)} vs grass ${(b.speed * 3.6).toFixed(0)} km/h`);
  assert.ok(b.speed < a.speed * 0.9);
});

check('frontal crash bounces back', () => {
  const car = new Vehicle();
  car.vz = 30;
  const impact = car.collide(0, -1, 0.2, 1.4);
  assert.ok(impact > 29);
  assert.ok(car.vz < 0);
});

check('car jumps over a crest and lands', () => {
  const car = new Vehicle();
  car.vz = 45;
  // Ramp up then a drop
  const ramp = (x, z, w, out) => {
    out.surface = 0;
    out.h = z < 20 ? 0 : z < 40 ? (z - 20) * 0.15 : Math.max(0, 3 - (z - 40) * 0.5);
    return out;
  };
  let flew = false;
  let landed = false;
  run(car, 3, { throttle: 1 }, ramp, (c) => {
    if (!c.onGround) flew = true;
    if (flew && c.onGround) landed = true;
    return landed;
  });
  assert.ok(flew && landed);
});

console.log(`\n${results.length} physics checks passed.`);
