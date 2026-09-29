// The rule monitor must catch deliberate faults (run: node tests/bus-rules.test.mjs).
import assert from 'node:assert/strict';
import { driveTrip, city, statics } from './bus-drive.mjs';
import { Simulation } from '../bus/src/simulation.js';

const results = [];
function check(name, trip, profile, expected, opts = {}) {
  const { report, sim } = driveTrip(trip, opts.bus || 'solo', { profile, seed: opts.seed ?? 1, traffic: opts.traffic ?? 18, onStep: opts.onStep });
  const codes = report.faults.map((f) => f.code);
  console.log(`${name}: ${codes.join(', ') || 'none'} (grade ${report.grade})`);
  for (const code of expected) {
    const hit = code.endsWith('*') ? codes.some((c) => c.startsWith(code.slice(0, -1))) : codes.includes(code);
    assert.ok(hit, `${name}: expected fault ${code}`);
  }
  results.push(name);
  return { report, sim, codes };
}

check('careful driver', '1a', {}, []);
check('speeding', '3', { speedExcess: 22 }, ['speed*']);
check('right turn at 20 km/h', '1a', { rightTurnKmh: 20 }, ['rightTurnSpeed']);
check('never indicating', '1a', { noIndicator: true }, ['noIndicator', 'noIndicatorDepart']);
check('running red lights', '1a', { ignoreSignals: true }, ['redLight*'], { seed: 3 });
check('skipping stops', '1b', { skipStops: true }, ['skippedStop']);
check('leaving too early', '2a', { ignoreSchedule: true }, ['early']);

// Doors opened in the middle of the street (bus placed between two stops).
{
  const sim = new Simulation(city, statics, { tripId: '1a', traffic: 0, pedestrians: 0 });
  const p = sim.route.path.at(250);
  sim.bus.resetAtFront(p.x, p.z, p.yaw);
  for (let i = 0; i < 240; i++) sim.step(1 / 120, { brake: 0.4 });
  sim.command('doors');
  for (let i = 0; i < 360; i++) sim.step(1 / 120, { brake: 0.4 });
  const codes = sim.rules.faults.map((f) => f.code);
  console.log(`doors outside a stop: ${codes.join(', ')}`);
  assert.ok(codes.includes('doorsOutside'));
  results.push('doors outside');
}

// Driving over the curb.
{
  const sim = new Simulation(city, statics, { tripId: '1a', traffic: 0, pedestrians: 0 });
  const p = sim.route.path.at(250);
  sim.bus.resetAtFront(p.x, p.z, p.yaw);
  for (let i = 0; i < 1200; i++) sim.step(1 / 120, { throttle: 0.4, steer: -0.5 });
  const codes = sim.rules.faults.map((f) => f.code);
  console.log(`curb: ${codes.join(', ')}`);
  assert.ok(codes.includes('curb'));
  results.push('curb');
}

console.log(`\n${results.length} rule checks passed`);
