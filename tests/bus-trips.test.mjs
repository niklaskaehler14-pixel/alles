// Drives every trip with the autopilot through the full simulation (physics, traffic,
// pedestrians, passengers, rules) and checks that a careful driver gets no faults.
// Run: node tests/bus-trips.test.mjs [tripId] [busType]
import assert from 'node:assert/strict';
import { buildCity } from '../bus/src/citymap.js';
import { buildLayout } from '../bus/src/layout.js';
import { StaticWorld } from '../bus/src/collision.js';
import { Simulation } from '../bus/src/simulation.js';
import { Autopilot } from '../bus/src/autopilot.js';
import { LINES } from '../bus/src/lines.js';
import { fmtClock } from '../bus/src/trip.js';

const city = buildCity();
const layout = buildLayout(city);
const statics = new StaticWorld(layout);
const DT = 1 / 120;

export function driveTrip(tripId, busType = 'solo', { daytime = 'day', seed = 1, traffic = 18, verbose = false } = {}) {
  const sim = new Simulation(city, statics, { tripId, busType, difficulty: 'normal', daytime, traffic, pedestrians: 40, seed });
  const ap = new Autopilot(city, sim.route, sim.bus);
  let t = 0;
  const limit = 50 * 60;
  let lastLog = 0;
  while (t < limit && !sim.trip.finished) {
    const input = ap.update(DT, { trip: sim.trip, t: sim.clock, traffic: sim.traffic, pedestrians: sim.peds.crossingPeds() });
    sim.indicator = ap.indicator;
    sim.lights = sim.night;
    sim.step(DT, input);
    for (const e of sim.drainEvents()) {
      if (e.type === 'curb' && verbose) console.log(`   curb wheel ${e.wheel} at (${e.x.toFixed(2)}, ${e.z.toFixed(2)}) v=${(e.speed * 3.6).toFixed(1)} steer=${sim.bus.steer.toFixed(2)} yaw=${sim.bus.yaw.toFixed(2)}`);
      if (e.type === 'fault' && verbose) {
        const f = sim.bus.frontPos();
        console.log(`   ${fmtClock(sim.clock)} FAULT ${e.fault.code} ${e.fault.detail} @ prog ${sim.trip.progress.toFixed(0)} (${f[0].toFixed(1)}, ${f[1].toFixed(1)}) v=${sim.bus.kmh.toFixed(1)} ap=${ap.state}`);
      }
    }
    t += DT;
    if (verbose && t - lastLog > 60) {
      lastLog = t;
      console.log(`   t=${t.toFixed(0)} prog ${sim.trip.progress.toFixed(0)}/${sim.route.endDist.toFixed(0)} stop ${sim.trip.current} ${sim.trip.nextStop?.name} v ${sim.bus.kmh.toFixed(1)} ap ${ap.state} onboard ${sim.trip.onboard.length}`);
    }
  }
  return { sim, report: sim.report(), time: t };
}

const only = process.argv[2];
const busArg = process.argv[3];
const trips = LINES.flatMap((l) => l.trips.map((t) => t.id)).filter((id) => !only || id === only);
const buses = busArg ? [busArg] : ['solo'];
let failures = 0;
for (const busType of buses) {
  for (const id of trips) {
    const t0 = Date.now();
    const { report, time, sim } = driveTrip(id, busType, { verbose: !!only });
    const faults = report.faults.map((f) => `${f.code}${f.detail ? ` (${f.detail})` : ''}`);
    console.log(`${id.padEnd(3)} ${busType.padEnd(11)} ${sim.trip.finished ? 'finished' : 'NOT FINISHED'} in ${(time / 60).toFixed(1)} min sim (${((Date.now() - t0) / 1000).toFixed(1)} s), grade ${report.grade} (${report.score}), ${report.transported} passengers, ${report.money.total} €, faults: ${faults.join(', ') || 'none'}`);
    try {
      assert.ok(sim.trip.finished, 'trip must be completed');
      assert.equal(report.faults.length, 0, 'a careful driver makes no faults');
      assert.ok(report.grade <= 2);
    } catch (e) {
      failures++;
      console.log(`   FAIL: ${e.message}`);
    }
  }
}
if (failures) process.exit(1);
console.log('all trips driven without faults');
