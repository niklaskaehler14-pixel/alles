// Drives one trip with the autopilot through the full simulation (shared by the tests).
import { buildCity } from '../bus/src/citymap.js';
import { buildLayout } from '../bus/src/layout.js';
import { StaticWorld } from '../bus/src/collision.js';
import { Simulation } from '../bus/src/simulation.js';
import { Autopilot } from '../bus/src/autopilot.js';
import { fmtClock } from '../bus/src/trip.js';

export const city = buildCity();
const layout = buildLayout(city);
export const statics = new StaticWorld(layout);
const DT = 1 / 120;
export function driveTrip(tripId, busType = 'solo', { daytime = 'day', seed = 1, traffic = 18, verbose = false, onStep = null, profile = {} } = {}) {
  const sim = new Simulation(city, statics, { tripId, busType, difficulty: 'normal', daytime, traffic, pedestrians: 40, seed });
  const ap = new Autopilot(city, sim.route, sim.bus, profile);
  let t = 0;
  const limit = 50 * 60;
  let lastLog = 0;
  while (t < limit && !sim.trip.finished) {
    const input = ap.update(DT, { trip: sim.trip, t: sim.clock, traffic: sim.traffic, pedestrians: sim.peds.list });
    sim.indicator = ap.indicator;
    sim.lights = sim.night;
    sim.step(DT, input);
    if (onStep) onStep(sim, ap, t);
    for (const e of sim.drainEvents()) {
      if (e.type === 'crash' && verbose) {
        const near = sim.traffic.vehicles.filter((v) => v.crashed > 0).map((v) => `${v.type} ${v.kind ? 'mv' + v.id + ' ' + city.movements[v.id].turn : 'lane' + v.id} (${v.x.toFixed(1)},${v.z.toFixed(1)}) yaw ${v.yaw.toFixed(2)}`);
        console.log(`   crash busFault=${e.busFault} rel=${e.speed.toFixed(2)} bus yaw ${sim.bus.yaw.toFixed(2)} u ${sim.bus.u.toFixed(2)} | ${near.join(' ; ')}`);
      }
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
  return { sim, ap, report: sim.report(), time: t };
}

