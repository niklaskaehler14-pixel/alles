// Drives every trip with the autopilot through the full simulation (physics, traffic,
// pedestrians, passengers, rules) and checks that a careful driver gets no faults.
// Run: node tests/bus-trips.test.mjs [tripId] [busType]
import assert from 'node:assert/strict';
import { LINES } from '../bus/src/lines.js';
import { driveTrip } from './bus-drive.mjs';

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
