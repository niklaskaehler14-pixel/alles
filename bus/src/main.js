// Nordkamm Linienbus: start-up, menus, the game loop and the glue between the simulation,
// the 3D views, sound, input and the HUD.
import * as THREE from 'three';
import { buildCity } from './citymap.js';
import { buildLayout } from './layout.js';
import { StaticWorld } from './collision.js';
import { CityView } from './cityView.js';
import { PropsView } from './propsView.js';
import { LandmarksView, landmarkBuildings } from './landmarks.js';
import { Environment } from './environment.js';
import { TrafficView } from './trafficView.js';
import { PeopleView } from './peopleView.js';
import { BusModel } from './busModel.js';
import { Simulation, FAULTS } from './simulation.js';
import { Autopilot } from './autopilot.js';
import { Input } from './input.js';
import { CameraRig, CAMERA_LABELS } from './camera.js';
import { BusAudio } from './audio.js';
import { Hud } from './hud.js';
import { Company, LIVERIES } from './company.js';
import { BUS_TYPES, BUS_ORDER } from './busTypes.js';
import { LINES, findTrip, buildRoute } from './lines.js';
import { DIFFICULTY, DAYTIME } from './trip.js';
import { QUALITY, PHYSICS_DT, ROAD } from './config.js';
import { euroText } from './tickets.js';
import { clamp, mulberry32 } from './util.js';

const $ = (id) => document.getElementById(id);
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------------------------------------------------------------- settings

const SETTINGS_KEY = 'nordkamm-bus.settings.v1';
const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const settings = {
  quality: coarse ? 'low' : 'medium',
  mirrors: !coarse,
  sound: true,
  volume: 0.8,
  camera: 'cockpit',
  touch: 'auto',
  tripId: '1a',
  daytime: 'day',
  difficulty: 'normal',
  traffic: 'normal',
};
try {
  Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'));
} catch {
  /* private mode: defaults */
}
const saveSettings = () => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
};
if (!QUALITY[settings.quality]) settings.quality = 'medium';
const Q = QUALITY[settings.quality];
const TRAFFIC_LEVELS = { few: { label: 'Wenig', f: 0.6 }, normal: { label: 'Normal', f: 1 }, many: { label: 'Viel', f: 1.4 } };
if (!TRAFFIC_LEVELS[settings.traffic]) settings.traffic = 'normal';
if (!DIFFICULTY[settings.difficulty]) settings.difficulty = 'normal';
if (!DAYTIME[settings.daytime]) settings.daytime = 'day';

const REFUSED = {
  doorsMoving: 'Türen öffnen nur im Stand',
  kneelMoving: 'Absenken nur im Stand',
  selectorMoving: 'Fahrtrichtung nur im Stand wechseln',
};

// ---------------------------------------------------------------- boot

const loadBar = $('load-bar');
const loadText = $('load-text');
async function progress(p, text) {
  loadBar.style.width = `${p}%`;
  loadText.textContent = text;
  await nextFrame();
}

function fail(err) {
  console.error(err);
  loadText.textContent = `Fehler beim Start: ${err && err.message ? err.message : err}`;
  loadText.style.color = 'var(--fault)';
  $('loading').hidden = false;
}
window.addEventListener('error', (e) => {
  if (!window.__bus || !window.__bus.ready) fail(e.error || e.message);
});

let W; // world and views

async function boot() {
  await progress(4, 'Schriften laden …');
  try {
    await Promise.race([document.fonts ? document.fonts.ready : Promise.resolve(), new Promise((r) => setTimeout(r, 2500))]);
  } catch {
    /* fonts are optional */
  }
  await progress(10, 'Stadtplan und Straßennetz …');
  const city = buildCity();
  await progress(22, 'Häuser, Bäume und Haltestellen …');
  const layout = buildLayout(city);
  const lmBuildings = landmarkBuildings(layout);
  layout.buildings.push(...lmBuildings);
  for (const b of lmBuildings) layout.boxes.push({ x: b.x, z: b.z, yaw: b.yaw, hl: b.d / 2, hw: b.w / 2, kind: 'building' });
  const statics = new StaticWorld(layout);

  await progress(34, 'Grafik starten …');
  const canvas = $('view');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  } catch (e) {
    throw new Error('WebGL ist in diesem Browser nicht verfügbar.');
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.shadowMap.enabled = Q.shadows > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, Q.drawDistance + 400);
  const env = new Environment(renderer, scene, { shadows: Q.shadows, drawDistance: Q.drawDistance });
  env.set(DAYTIME[settings.daytime].sky);

  await progress(46, 'Straßen und Gehwege …');
  const cityView = new CityView(city, layout, { shadows: Q.shadows > 0 });
  scene.add(cityView.group);
  await progress(62, 'Ampeln, Schilder, Bäume …');
  const propsView = new PropsView(city, layout, { shadows: Q.shadows > 0, treeDensity: Q.trees });
  scene.add(propsView.group);
  await progress(74, 'Bahnhof, Rathaus, Klinikum …');
  const landmarksView = new LandmarksView(layout, { shadows: Q.shadows > 0 });
  scene.add(landmarksView.group);
  await progress(84, 'Verkehr und Fahrgäste …');
  const trafficView = new TrafficView(60);
  const peopleView = new PeopleView(340);
  scene.add(trafficView.group, peopleView.group);

  W = { city, layout, statics, renderer, scene, camera, env, cityView, propsView, landmarksView, trafficView, peopleView };
  W.company = new Company();
  W.hud = new Hud(city, layout);
  W.input = new Input();
  W.input.bindLook(canvas);
  W.input.bindTouch($('touch'));
  W.rig = new CameraRig(camera);
  W.audio = new BusAudio();
  W.audio.volume = settings.volume;
  W.audio.muted = !settings.sound;

  // Mirror cameras render into textures shown on the mirror glasses.
  W.mirrorRT = [0, 1].map(() => new THREE.WebGLRenderTarget(192, 288, { samples: 0 }));
  W.mirrorCam = new THREE.PerspectiveCamera(34, 192 / 288, 0.4, 420);

  await progress(92, 'Linienbus bereitstellen …');
  enterMenu();
  // Warm-up render so shaders compile before the first real frame.
  renderFrame(0.016);
  await progress(100, 'Bereit');
  $('loading').hidden = true;
  window.__bus.ready = true;
  window.__bus.W = W;
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------- game state

const G = {
  mode: 'menu', // menu | drive
  sim: null,
  model: null,
  modelKey: '',
  autopilot: null,
  autoUsed: false,
  demo: false,
  paused: false,
  acc: 0,
  finishTimer: -1,
  reportShown: false,
  session: null,
  lastDrive: { throttle: 0, brake: 0, steer: 0 },
  hudTimer: 0,
  dashTimer: 0,
  signalTimer: 0,
  mirrorFlip: 0,
  menuAngle: 0,
  seatOrder: [],
  infoKey: '',
  lastToast: new Map(),
  stopCount: { board: 0, alight: 0 },
  time: 0,
};

function ensureModel(busType, liveryId) {
  const key = `${busType}/${liveryId}`;
  if (G.model && G.modelKey === key) return G.model;
  if (G.model) {
    W.scene.remove(G.model.root);
    G.model.dispose();
  }
  const livery = LIVERIES.find((l) => l.id === liveryId) || LIVERIES[0];
  const model = new BusModel(BUS_TYPES[busType], livery);
  if (settings.mirrors && Q.mirrors) model.setMirrorTextures(W.mirrorRT[0].texture, W.mirrorRT[1].texture);
  W.scene.add(model.root);
  G.model = model;
  G.modelKey = key;
  // Seats are filled in a scattered order, like real passengers do.
  const n = model.interiorSeats.length;
  const rng = mulberry32(n * 31 + 7);
  G.seatOrder = Array.from({ length: n }, (_, i) => i).sort(() => rng() - 0.5);
  return model;
}

function applyDaytime(daytime) {
  W.env.set(DAYTIME[daytime].sky);
  const night = W.env.preset.night;
  W.cityView.setNight(night);
  W.propsView.setNight(night);
  W.landmarksView.setNight(night);
}

function trafficCount() {
  return Math.round(Q.traffic * TRAFFIC_LEVELS[settings.traffic].f);
}

// Background scene for the menu: a parked bus at the main station, traffic going by.
function enterMenu() {
  G.mode = 'menu';
  G.paused = false;
  G.autopilot = null;
  G.session = null;
  W.hud.show(false);
  W.hud.closeMap();
  W.hud.hideReport();
  $('pause').hidden = true;
  $('touch').hidden = true;
  $('menu').hidden = false;
  applyDaytime(settings.daytime);
  G.sim = new Simulation(W.city, W.statics, {
    busType: W.company.data.bus,
    startStop: 'hbf-w',
    daytime: settings.daytime,
    traffic: trafficCount(),
    pedestrians: Q.pedestrians,
    seed: 5,
  });
  G.sim.bus.setParkingBrake(true);
  G.sim.bus.drainEvents();
  G.sim.drainEvents();
  const m = ensureModel(W.company.data.bus, W.company.data.livery);
  m.setDestination('', 'Betriebsfahrt');
  W.rig.set('orbit');
  W.camera.fov = 50;
  W.camera.updateProjectionMatrix();
  W.audio.suspend();
  renderMenu();
}

// ---------------------------------------------------------------- sessions

function startSession(opts) {
  const { tripId = null, demo = false } = opts;
  const busType = opts.busType || W.company.data.bus;
  const daytime = opts.daytime || settings.daytime;
  const difficulty = opts.difficulty || settings.difficulty;
  G.session = { tripId, demo, busType, daytime, difficulty, livery: W.company.data.livery };
  applyDaytime(daytime);
  const sim = new Simulation(W.city, W.statics, {
    tripId,
    busType,
    difficulty,
    daytime,
    traffic: trafficCount(),
    pedestrians: Q.pedestrians,
    seed: 1 + Math.floor(Math.random() * 9999),
    startStop: tripId ? undefined : 'depot-s',
  });
  G.sim = sim;
  G.mode = 'drive';
  G.paused = false;
  G.acc = 0;
  G.finishTimer = -1;
  G.reportShown = false;
  G.demo = demo;
  G.autoUsed = demo;
  G.autopilot = demo && sim.route ? new Autopilot(W.city, sim.route, sim.bus) : null;
  G.infoKey = '';
  G.stopCount = { board: 0, alight: 0 };
  const model = ensureModel(busType, W.company.data.livery);
  const found = tripId ? findTrip(tripId) : null;
  if (found) model.setDestination(found.line.id, found.trip.headsign);
  else model.setDestination('', 'Betriebsfahrt');
  W.hud.setup({ route: sim.route, trip: sim.trip, line: found && found.line, headsign: found && found.trip.headsign, free: !tripId });
  W.rig.set(demo ? 'chase' : settings.camera);
  W.rig.resetLook();
  $('menu').hidden = true;
  $('pause').hidden = true;
  W.hud.hideReport();
  W.hud.show(true);
  updateTouchVisibility();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  W.audio.setMuted(!settings.sound);
  W.audio.init().then(() => W.audio.resume());
  if (!demo) {
    const d = DIFFICULTY[difficulty];
    if (tripId) {
      W.hud.toast('info', 'Dienstbeginn', `${found.line.title}: Türen öffnen (Leertaste) und Fahrgäste einsteigen lassen. Zur Abfahrtszeit Türen schließen, ${d.engine === 'manual' ? 'Motor starten (I), ' : ''}Feststellbremse lösen (P), links blinken (Q) und los.`, 10000);
    } else {
      W.hud.toast('info', 'Freie Fahrt ab Betriebshof', 'Erkunde Nordkamm ohne Fahrplan. Esc öffnet die Pause.', 7000);
    }
  } else {
    W.hud.toast('info', 'Vorführfahrt', 'Der Autopilot fährt die Linie. Mit O oder im Pausenmenü übernimmst du.', 7000);
  }
}

function setAutopilot(on) {
  const sim = G.sim;
  if (!sim || !sim.route || !sim.trip) {
    W.hud.toast('info', 'Autopilot nur im Liniendienst');
    return;
  }
  if (on && !G.autopilot) {
    const ap = new Autopilot(W.city, sim.route, sim.bus);
    const st = sim.trip.nextStop;
    if (st && st.state === 'here') {
      if (sim.bus.doorsOpen) {
        ap.state = 'exchange';
        ap.timer = 1;
      } else if (st.served) {
        ap.state = 'closing';
        ap.timer = 0;
      }
    }
    G.autopilot = ap;
    G.autoUsed = true;
    W.hud.closeSale();
    W.hud.toast('info', 'Autopilot fährt', 'Diese Fahrt zählt jetzt als Vorführfahrt.');
  } else if (!on && G.autopilot) {
    G.autopilot = null;
    sim.indicator = 0;
    W.hud.toast('info', 'Du fährst wieder selbst');
    const sale = sim.trip.pendingSale;
    if (sale) openSale(sale);
  }
  $('p-auto').textContent = G.autopilot ? 'Selbst fahren' : 'Autopilot fahren lassen';
}

function openSale(sale) {
  const diff = G.sim.trip.diff;
  $('t-due-box').hidden = diff.hints === false;
  W.hud.openSale(sale, (fare, change) => {
    if (G.sim && G.sim.trip) G.sim.trip.sellTicket(fare.id, fare.price, change);
  });
}

function endSession() {
  const sim = G.sim;
  if (sim && sim.trip && !sim.trip.finished) {
    sim.trip.abort();
    showReport();
    return;
  }
  enterMenu();
}

function showReport() {
  const sim = G.sim;
  if (!sim || !sim.trip || G.reportShown) return;
  G.reportShown = true;
  const rep = sim.report();
  const found = findTrip(G.session.tripId);
  const demo = G.autoUsed;
  let unlocks = [];
  if (!demo) {
    const res = W.company.book(G.session.tripId, rep, G.session.busType);
    unlocks = res.newLines.map((id) => {
      const l = LINES.find((x) => x.id === id);
      return `Linie ${l.id} · ${l.title}`;
    });
  }
  const title = `Linie ${found.line.id} → ${found.trip.headsign} · ${BUS_TYPES[G.session.busType].name}`;
  W.hud.showReport(rep, { tripTitle: title, demo, unlocks, balance: W.company.money });
  // Next trip: the way back (or the ring again).
  const trips = found.line.trips;
  const idx = trips.findIndex((t) => t.id === G.session.tripId);
  const back = trips[(idx + 1) % trips.length];
  const btn = $('r-next');
  btn.textContent = back.id === G.session.tripId ? 'Nächste Runde' : `Rückfahrt nach ${back.headsign}`;
  btn.onclick = () => {
    settings.tripId = back.id;
    saveSettings();
    startSession({ ...G.session, tripId: back.id, demo: G.demo });
  };
  $('r-again').onclick = () => startSession({ ...G.session });
  $('r-menu').onclick = () => enterMenu();
  W.audio.good();
}

// ---------------------------------------------------------------- input handling

function handleTap(t) {
  if (G.mode !== 'drive') return;
  const sim = G.sim;
  const bus = sim.bus;
  if (t === 'pause') {
    if (W.hud.mapOpen) W.hud.closeMap();
    else if (!$('report').hidden) return;
    else setPaused(!G.paused);
    return;
  }
  if (t === 'map') {
    if (W.hud.mapOpen) W.hud.closeMap();
    else W.hud.openMap(bus, sim.trip);
    return;
  }
  if (G.paused || W.hud.mapOpen || !$('report').hidden) return;
  switch (t) {
    case 'doors':
    case 'kneel':
    case 'indicatorLeft':
    case 'indicatorRight':
    case 'hazard':
    case 'lights':
    case 'parkingBrake':
    case 'reverse':
    case 'neutral':
      sim.command(t);
      break;
    case 'door1':
    case 'door2':
    case 'door3': {
      const i = Number(t.slice(4)) - 1;
      if (i < bus.doors.length) sim.command('door', i);
      break;
    }
    case 'engine':
      if (!bus.engineOn) W.audio.starter();
      sim.command('engine');
      break;
    case 'camera':
      W.rig.next();
      W.hud.toast('info', `Kamera: ${CAMERA_LABELS[W.rig.mode]}`, '', 1400);
      break;
    case 'mirrors':
      settings.mirrors = !settings.mirrors;
      saveSettings();
      W.hud.toast('info', settings.mirrors ? 'Spiegel an' : 'Spiegel aus', '', 1400);
      break;
    case 'lookRight':
      W.rig.lookYaw = W.rig.lookYaw < -0.5 ? 0 : -1.25;
      break;
    case 'lookReset':
      W.rig.resetLook();
      break;
    case 'autopilot':
      setAutopilot(!G.autopilot);
      break;
    case 'confirm':
      if (W.hud.saleOpen) W.hud.issueTicket();
      break;
    default:
      break;
  }
}

function setPaused(p) {
  G.paused = p;
  $('pause').hidden = !p;
  $('p-quit-confirm').hidden = true;
  $('p-quit').hidden = false;
  $('p-auto').textContent = G.autopilot ? 'Selbst fahren' : 'Autopilot fahren lassen';
  $('p-auto').disabled = !(G.sim && G.sim.trip);
  $('p-sound').textContent = settings.sound ? 'Ton aus' : 'Ton an';
  if (p) W.audio.suspend();
  else {
    W.audio.resume();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }
}

// ---------------------------------------------------------------- simulation step

function stepSim(dt, inp) {
  const sim = G.sim;
  let drive = inp;
  if (G.autopilot && sim.trip) {
    drive = G.autopilot.update(dt, { trip: sim.trip, t: sim.clock, traffic: sim.traffic, pedestrians: sim.peds.list });
    sim.indicator = G.autopilot.indicator;
    if (sim.night) sim.lights = true;
  }
  // After the end of the trip the bus stays parked behind the report.
  if (G.reportShown) drive = { throttle: 0, brake: 1, steer: 0 };
  sim.horn = !!inp.horn && !G.reportShown;
  sim.step(dt, drive);
  G.lastDrive = drive;
}

function toastOnce(kind, title, sub, ms) {
  const now = performance.now();
  const last = G.lastToast.get(title) || 0;
  if (now - last < 1200) return;
  G.lastToast.set(title, now);
  W.hud.toast(kind, title, sub, ms);
}

function handleEvents() {
  const sim = G.sim;
  const A = W.audio;
  for (const e of sim.drainEvents()) {
    switch (e.type) {
      case 'doorOpen':
        A.doorOpen();
        break;
      case 'doorClose':
        A.doorClose();
        break;
      case 'doorReverse':
        toastOnce('info', 'Tür reversiert', 'Jemand stand im Türbereich.');
        break;
      case 'kneelDown':
      case 'kneelUp':
        A.kneel();
        break;
      case 'stopBrakeOff':
      case 'parkOn':
      case 'parkOff':
        A.airRelease();
        break;
      case 'curb':
        A.curb();
        break;
      case 'impact':
        A.crash(clamp(e.speed / 8, 0.25, 1));
        break;
      case 'crash':
        A.crash(clamp(e.speed / 6, 0.3, 1));
        break;
      case 'fault':
        A.fault();
        W.hud.fault(e.fault);
        break;
      case 'stopRequest':
        A.gong();
        W.hud.toast('info', 'Haltewunsch', 'Ein Fahrgast möchte an der nächsten Haltestelle aussteigen.');
        break;
      case 'arrive': {
        const q = e.stop.quality;
        if (q) W.hud.toast(q.score >= 85 ? 'good' : 'info', q.text, `${e.stop.name} · ${Math.abs(q.along).toFixed(1).replace('.', ',')} m vom Halteschild, ${Math.max(0, q.gap).toFixed(1).replace('.', ',')} m zum Bord`);
        break;
      }
      case 'ticketRequest':
        if (!G.autopilot && sim.trip.pendingSale) openSale(sim.trip.pendingSale);
        break;
      case 'sale':
        A.printer();
        A.coin();
        W.hud.toast(e.result.ok ? 'good' : 'info', e.result.text, '', 2600);
        break;
      case 'board':
        G.stopCount.board++;
        break;
      case 'alight':
        G.stopCount.alight++;
        break;
      case 'depart': {
        const { board, alight } = G.stopCount;
        if (board || alight) W.hud.toast('info', `${e.stop.last ? 'Endhaltestelle' : 'Abfahrt'} ${e.stop.name}`, `${board} eingestiegen · ${alight} ausgestiegen`, 3000);
        G.stopCount = { board: 0, alight: 0 };
        break;
      }
      case 'refused':
        toastOnce('info', e.text || REFUSED[e.reason] || 'Geht gerade nicht', '', 2200);
        break;
      case 'selector':
      case 'lights':
        A.click(true);
        break;
      case 'finished':
        G.finishTimer = 2.2;
        break;
      default:
        break;
    }
  }
}

// ---------------------------------------------------------------- per frame

const tmpV = new THREE.Vector3();
const focus = new THREE.Vector3();

function drawPeople() {
  const sim = G.sim;
  const pv = W.peopleView;
  pv.begin();
  const curb = ROAD.curbHeight;
  for (const p of sim.peds.list) pv.add(p.x, p.state === 'cross' ? 0 : curb, p.z, p.yaw, p.look, p.phase, p.moving, 'walk');
  const trip = sim.trip;
  if (trip) {
    for (const p of trip.people) {
      if (p.state === 'gone' || p.state === 'onboard') continue;
      pv.add(p.x, curb, p.z, p.yaw, p.look, p.phase, p.moving, p.moving ? 'walk' : 'stand', p);
    }
    // Passengers inside: seated first, the rest stand in the aisle.
    const model = G.model;
    const bus = sim.bus;
    const nSeats = model.interiorSeats.length;
    let seat = 0;
    let stand = 0;
    for (const p of trip.onboard) {
      const special = p.stroller || p.wheelchair;
      if (!special && seat < nSeats) {
        const i = G.seatOrder[seat++];
        model.seatWorld(i, tmpV);
        const yaw = model.sectionOfSeat(i) ? bus.yaw2 : bus.yaw;
        pv.add(tmpV.x, tmpV.y - 0.5, tmpV.z, yaw, p.look, 0, false, 'sit');
      } else if (model.standingSpots && model.standingSpots.length) {
        const j = stand++;
        model.standWorld(j, tmpV);
        const yaw = (model.sectionOfStand(j) ? bus.yaw2 : bus.yaw) + (j % 2 ? 1.4 : -1.4);
        pv.add(tmpV.x, tmpV.y, tmpV.z, yaw, p.look, 0, false, p.wheelchair ? 'sit' : 'stand', p);
      }
    }
  }
  pv.end();
}

function renderFrame(dt) {
  const sim = G.sim;
  const bus = sim.bus;
  const model = G.model;
  const night = W.env.preset.night;
  const braking = bus.brakePressure > 0.05 || (G.lastDrive.brake || 0) > 0.05 || bus.stopBrake;
  model.update({ bus, dt, indicator: sim.indicator, hazard: sim.hazard, lights: sim.lights, braking, reversing: bus.selector === 'R', night });
  model.body.updateMatrixWorld(true);
  if (model.trailer) model.trailer.updateMatrixWorld(true);
  const blinkOn = model.blink < 0.42;
  W.trafficView.update(sim.traffic.vehicles, dt, { lights: night > 0.3 });
  drawPeople();
  G.signalTimer -= dt;
  if (G.signalTimer <= 0) {
    W.propsView.updateSignals(sim.clock);
    G.signalTimer = 0.1;
  }
  W.cityView.update(dt, G.time);

  // Camera.
  if (G.mode === 'menu') {
    G.menuAngle += dt * 0.045;
    const c = bus.localToWorld(0, bus.geo.center);
    const a = bus.yaw + 2.2 + Math.sin(G.menuAngle) * 0.9;
    W.camera.position.set(c[0] + Math.sin(a) * 30, 9 + Math.sin(G.menuAngle * 0.7) * 3, c[1] + Math.cos(a) * 30);
    W.camera.lookAt(c[0] + Math.sin(bus.yaw) * 4, 2.6, c[1] + Math.cos(bus.yaw) * 4);
  } else {
    W.rig.update(dt, bus, model, W.input.look, { steer: bus.steer / bus.spec.steerMax });
  }
  focus.set(bus.x, 0, bus.z);
  W.env.update(dt, G.time, focus, W.camera);

  // Dashboard and passenger info screen at ~12 Hz.
  G.dashTimer -= dt;
  if (G.dashTimer <= 0 && G.mode === 'drive') {
    G.dashTimer = 0.08;
    model.drawDashboard({
      kmh: Math.abs(bus.kmh),
      over: Math.abs(bus.kmh) > (sim.rules.limit || 50) + 3,
      clock: clockText(sim.clock),
      gear: gearText(bus),
      doors: bus.doorsOpen,
      stopBrake: bus.stopBrake,
      request: !!(sim.trip && sim.trip.stopRequest),
      kneel: bus.kneel > 0.05,
      parking: bus.parkingBrake,
      retarder: bus.retarder > 0.05,
      indicator: sim.hazard ? 0 : sim.indicator,
      blinkOn,
    });
    const found = G.session && G.session.tripId ? findTrip(G.session.tripId) : null;
    const next = sim.trip && sim.trip.nextStop ? sim.trip.nextStop.name : 'Betriebsfahrt';
    const req = !!(sim.trip && sim.trip.stopRequest);
    const key = `${next}|${req}`;
    if (key !== G.infoKey) {
      G.infoKey = key;
      model.drawInfoScreen(found ? found.line.id : '', next, req, found ? found.line.color : '#ffb52e');
    }
  }

  const r = W.renderer;
  r.shadowMap.autoUpdate = true;
  r.render(W.scene, W.camera);

  // Mirrors (one per frame, alternating) in the driver's seat.
  if (G.mode === 'drive' && settings.mirrors && Q.mirrors && W.rig.mode === 'cockpit' && model.mirrorHeads) {
    const k = G.mirrorFlip++ % 2;
    const m = model.mirrorHeads[k];
    m.head.getWorldPosition(tmpV);
    const cam = W.mirrorCam;
    cam.position.copy(tmpV);
    const s = Math.sin(bus.yaw);
    const c = Math.cos(bus.yaw);
    const out = m.side * 0.9; // look back along the side, slightly outwards
    cam.lookAt(tmpV.x - s * 20 + c * out, tmpV.y - 1.1, tmpV.z - c * 20 - s * out);
    r.shadowMap.autoUpdate = false;
    r.setRenderTarget(W.mirrorRT[m.side > 0 ? 0 : 1]);
    r.render(W.scene, cam);
    r.setRenderTarget(null);
    r.shadowMap.autoUpdate = true;
  }

  // Sound.
  if (G.mode === 'drive' && !G.paused) {
    const load = bus.spec.engine === 'electric' ? Math.abs(bus.drive) / (bus.spec.driveForceCap || 20000) : bus.throttle;
    W.audio.update(dt, {
      rpm: bus.rpm,
      load: clamp(load, 0, 1),
      speed: Math.abs(bus.u),
      engine: bus.spec.engine,
      engineOn: bus.engineOn,
      horn: sim.horn,
      reversing: bus.selector === 'R' && bus.engineOn,
      blinkOn,
      blinking: sim.indicator !== 0 || sim.hazard,
      interior: W.rig.mode === 'cockpit',
    });
  }

  // HUD at ~12 Hz.
  G.hudTimer -= dt;
  if (G.hudTimer <= 0 && G.mode === 'drive') {
    G.hudTimer = 0.08;
    W.hud.update(hudSnapshot(blinkOn));
    W.hud.drawMinimap(bus, sim.traffic, sim.trip);
  }
}

function clockText(t) {
  const s = ((Math.floor(t) % 86400) + 86400) % 86400;
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}`;
}

function gearText(bus) {
  if (!bus.engineOn) return bus.selector;
  if (bus.selector !== 'D') return bus.selector;
  if (bus.spec.engine === 'electric') return 'D';
  return `D${Math.max(1, bus.gear + 1)}`;
}

function systemHint(sim) {
  const bus = sim.bus;
  if (G.autopilot) return 'Autopilot fährt · O oder Pause zum Übernehmen';
  if (!bus.engineOn) return bus.starter > 0 ? 'Motor startet …' : 'Motor starten: I';
  const readyToGo = sim.trip && sim.trip.nextStop && sim.trip.nextStop.served && bus.doorsFullyClosed;
  if (bus.hold === 'parkingBrake' || (bus.parkingBrake && readyToGo)) return 'Feststellbremse lösen: P';
  if (bus.hold === 'stopBrake') return 'Haltestellenbremse hält den Bus: erst alle Türen schließen';
  if (bus.selector === 'N') return 'Fahrstufe einlegen: N schaltet zurück auf D';
  if (sim.night && !sim.lights) return 'Licht einschalten: L';
  return '';
}

function hudSnapshot(blinkOn) {
  const sim = G.sim;
  const bus = sim.bus;
  const trip = sim.trip;
  let hint = systemHint(sim);
  if (!hint && W.hud.saleOpen) hint = 'Fahrkarte wählen, Rückgeld auszahlen, drucken (Enter)';
  if (!hint && trip && trip.diff.hints) hint = trip.hint;
  let nearStop = '';
  if (!trip) {
    let best = 1e9;
    for (const s of W.city.stops) {
      const d = Math.hypot(s.x - bus.x, s.z - bus.z);
      if (d < best) {
        best = d;
        nearStop = s.name;
      }
    }
    nearStop = best < 400 ? `Nähe ${nearStop}` : 'Freie Fahrt';
  }
  return {
    kmh: Math.abs(bus.kmh),
    limit: sim.rules.limit || 50,
    gear: gearText(bus),
    clock: sim.clock,
    indicator: sim.indicator,
    hazard: sim.hazard,
    blinkOn,
    doors: bus.doorsOpen,
    stopBrake: bus.stopBrake,
    parking: bus.parkingBrake,
    kneel: bus.kneel > 0.05,
    lights: sim.lights,
    engineOn: bus.engineOn,
    autopilot: !!G.autopilot,
    onboard: trip ? trip.onboard.length : 0,
    capacity: trip ? bus.spec.capacity : 0,
    points: sim.rules.points,
    cash: trip ? trip.revenue : 0,
    comfort: trip ? trip.comfort : 100,
    request: !!(trip && trip.stopRequest),
    hint,
    nearStop,
  };
}

let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
  last = now;
  tick(dt);
}

function tick(dt) {
  G.time += dt;
  const sim = G.sim;
  const inp = W.input.update(dt, Math.abs(sim.bus.u));
  for (const t of W.input.consume()) handleTap(t);
  if (G.mode === 'menu') {
    // Keep the city alive behind the menu.
    G.acc += dt;
    let n = 0;
    while (G.acc >= 1 / 30 && n < 4) {
      sim.step(1 / 30, { throttle: 0, brake: 1, steer: 0 });
      G.acc -= 1 / 30;
      n++;
    }
    if (n === 4) G.acc = 0;
    sim.drainEvents();
  } else {
    const running = !G.paused && !W.hud.mapOpen;
    if (running) {
      G.acc += dt;
      let n = 0;
      while (G.acc >= PHYSICS_DT && n < 16) {
        stepSim(PHYSICS_DT, inp);
        G.acc -= PHYSICS_DT;
        n++;
      }
      if (n === 16) G.acc = 0;
      handleEvents();
      if (G.finishTimer > 0) {
        G.finishTimer -= dt;
        if (G.finishTimer <= 0) showReport();
      }
      if (W.hud.saleOpen && (!sim.trip || !sim.trip.pendingSale)) W.hud.closeSale();
    }
  }
  renderFrame(dt);
}

// ---------------------------------------------------------------- menu UI

const menuState = { tab: 'drive' };

function stars(v) {
  const full = Math.round(v * 2) / 2;
  let s = '';
  for (let i = 1; i <= 5; i++) s += full >= i ? '★' : full >= i - 0.5 ? '⯪' : '☆';
  return s;
}

function renderMenu() {
  const c = W.company;
  const d = c.data;
  $('company-line').innerHTML = `<span>${esc(d.name)}</span><span>Konto <b>${euroText(d.money)}</b></span><span>Ruf <span class="stars" title="${c.reputation.toFixed(1)} von 5">${stars(c.reputation)}</span></span><span>Fahrten <b>${d.trips}</b></span>`;
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === menuState.tab));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== menuState.tab;
  renderTrips();
  renderOptions();
  renderCompany();
  renderFleet();
  renderSettings();
}

const routeCache = new Map();
function routeInfo(tripId) {
  if (!routeCache.has(tripId)) routeCache.set(tripId, buildRoute(W.city, tripId));
  return routeCache.get(tripId);
}

function renderTrips() {
  const board = $('trip-board');
  for (const el of board.querySelectorAll('.trip-row')) el.remove();
  const c = W.company;
  const diff = DIFFICULTY[settings.difficulty];
  let selectedOk = false;
  for (const line of LINES) {
    const open = c.lineUnlocked(line);
    for (const t of line.trips) {
      const r = routeInfo(t.id);
      const km = ((r.endDist - r.startDist) / 1000).toFixed(1).replace('.', ',');
      const min = Math.round((r.duration * diff.schedule) / 60);
      const best = c.data.best[t.id];
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'trip-row';
      btn.disabled = !open;
      btn.style.setProperty('--line', line.color);
      const first = W.city.stopById[t.stops[0]].name;
      btn.innerHTML = `<span class="line-chip" style="--line:${line.color}">${esc(line.id)}</span>
        <span class="trip-dest"><b>${esc(t.headsign)}</b><span>ab ${esc(first)} · ${km} km</span></span>
        <span class="trip-meta">${open ? `${t.stops.length} Halte · ${min} min${best ? `<br><span class="grade">Note ${best.grade}</span>` : ''}` : `<span class="trip-lock">ab ${line.unlock} ${line.unlock === 1 ? 'Fahrt' : 'Fahrten'}</span>`}</span>`;
      btn.setAttribute('aria-pressed', String(settings.tripId === t.id));
      if (settings.tripId === t.id && open) selectedOk = true;
      btn.addEventListener('click', () => {
        settings.tripId = t.id;
        saveSettings();
        renderTrips();
      });
      board.appendChild(btn);
    }
  }
  if (!selectedOk) {
    settings.tripId = '1a';
    for (const b of board.querySelectorAll('.trip-row')) b.setAttribute('aria-pressed', 'false');
    board.querySelector('.trip-row').setAttribute('aria-pressed', 'true');
  }
  const found = findTrip(settings.tripId);
  const stopsText = found.trip.stops.map((id) => W.city.stopById[id].name).join(' · ');
  $('trip-detail').innerHTML = `<p><b>Linie ${esc(found.line.id)} · ${esc(found.line.title)}</b></p><p class="small">${esc(found.line.blurb)}</p><p class="stops-inline">${esc(stopsText)}</p>`;
}

function seg(id, items, current, onPick) {
  const box = $(id);
  box.textContent = '';
  for (const [value, label, disabled] of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.disabled = !!disabled;
    b.setAttribute('aria-pressed', String(value === current));
    b.addEventListener('click', () => onPick(value));
    box.appendChild(b);
  }
}

function renderOptions() {
  seg('opt-daytime', Object.entries(DAYTIME).map(([k, v]) => [k, v.label]), settings.daytime, (v) => {
    settings.daytime = v;
    saveSettings();
    applyDaytime(v);
    G.sim.night = v === 'night';
    renderOptions();
  });
  seg('opt-difficulty', Object.entries(DIFFICULTY).map(([k, v]) => [k, v.label]), settings.difficulty, (v) => {
    settings.difficulty = v;
    saveSettings();
    renderOptions();
    renderTrips();
  });
  $('difficulty-note').textContent = DIFFICULTY[settings.difficulty].blurb;
  seg('opt-traffic', Object.entries(TRAFFIC_LEVELS).map(([k, v]) => [k, v.label]), settings.traffic, (v) => {
    settings.traffic = v;
    saveSettings();
    renderOptions();
  });
  const c = W.company;
  seg('opt-bus', BUS_ORDER.map((id) => [id, BUS_TYPES[id].name, !c.owns(id)]), c.data.bus, (v) => {
    c.data.bus = v;
    c.save();
    renderMenu();
    enterMenu();
  });
}

function renderCompany() {
  const c = W.company;
  const d = c.data;
  const avg = d.grades.length ? (d.grades.reduce((a, b) => a + b, 0) / d.grades.length).toFixed(1).replace('.', ',') : '–';
  $('company-stats').innerHTML = [
    [euroText(d.money), 'Kontostand'],
    [String(d.trips), 'Fahrten'],
    [`${String(d.km).replace('.', ',')} km`, 'Gefahren'],
    [String(d.passengers), 'Fahrgäste'],
    [avg, 'Notenschnitt'],
    [String(d.owned.length), 'Busse'],
  ]
    .map(([v, l]) => `<div class="stat"><b>${v}</b><span>${l}</span></div>`)
    .join('');
  $('company-history').innerHTML = d.history.length
    ? d.history
        .map((h) => {
          const f = findTrip(h.trip);
          const name = f ? `Linie ${f.line.id} → ${f.trip.headsign}` : h.trip;
          return `<li><span>${esc(name)} · Note ${h.grade}</span><span>${h.money >= 0 ? '+' : '−'}${euroText(Math.abs(h.money))}</span></li>`;
        })
        .join('')
    : '<li><span class="muted">Noch keine Fahrten. Tritt deinen ersten Dienst an!</span><span></span></li>';
  const faults = Object.entries(d.faults)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  $('company-faults').innerHTML = faults.length
    ? faults.map(([code, n]) => `<li><span>${esc(FAULTS[code] ? FAULTS[code].text : code)}</span><span>${n}×</span></li>`).join('')
    : '<li><span class="muted">Bisher fehlerfrei.</span><span></span></li>';
}

function renderFleet() {
  const c = W.company;
  const box = $('fleet');
  box.textContent = '';
  for (const id of BUS_ORDER) {
    const t = BUS_TYPES[id];
    const owned = c.owns(id);
    const active = c.data.bus === id;
    const card = document.createElement('div');
    card.className = `bus-card${active ? ' is-active' : ''}`;
    const doors = t.doors.length;
    card.innerHTML = `<header><h3>${esc(t.name)}</h3><span class="num">${owned ? (active ? 'im Einsatz' : 'im Depot') : euroText(t.price)}</span></header>
      <p>${esc(t.blurb)}</p>
      <div class="specs"><span>Länge <b>${String(t.length).replace('.', ',')} m</b></span><span>Plätze <b>${t.seats} + ${t.capacity - t.seats}</b></span><span>Leistung <b>${Math.round(t.power / 1000)} kW</b></span><span>Antrieb <b>${t.engine === 'electric' ? 'elektrisch' : 'Diesel'}</b></span><span>Türen <b>${doors}</b></span></div>`;
    const actions = document.createElement('div');
    actions.className = 'actions';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = owned ? 'btn' : 'btn primary';
    if (owned) {
      b.textContent = active ? 'Ausgewählt' : 'Einsetzen';
      b.disabled = active;
      b.addEventListener('click', () => {
        c.data.bus = id;
        c.save();
        enterMenu();
      });
    } else {
      b.textContent = c.canBuy(id) ? `Kaufen für ${euroText(t.price)}` : `Kostet ${euroText(t.price)}`;
      b.disabled = !c.canBuy(id);
      b.addEventListener('click', () => {
        if (c.buy(id)) enterMenu();
      });
    }
    actions.appendChild(b);
    card.appendChild(actions);
    box.appendChild(card);
  }
  const sw = $('liveries');
  sw.textContent = '';
  for (const l of LIVERIES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.title = l.name;
    b.setAttribute('aria-label', l.name);
    b.setAttribute('aria-pressed', String(c.data.livery === l.id));
    b.style.setProperty('--roof', l.roof);
    b.style.setProperty('--body', l.body);
    b.style.setProperty('--stripe', l.stripe);
    b.style.setProperty('--skirt', l.skirt);
    b.addEventListener('click', () => {
      c.data.livery = l.id;
      c.save();
      ensureModel(c.data.bus, l.id).setDestination('', 'Betriebsfahrt');
      renderFleet();
    });
    sw.appendChild(b);
  }
  const cur = LIVERIES.find((l) => l.id === c.data.livery) || LIVERIES[0];
  $('livery-name').textContent = `Aktuell: ${cur.name}`;
}

function renderSettings() {
  $('set-quality').value = settings.quality;
  $('set-mirrors').checked = !!settings.mirrors;
  $('set-mirrors').disabled = !Q.mirrors;
  $('set-sound').checked = !!settings.sound;
  $('set-volume').value = String(settings.volume);
  $('set-camera').value = settings.camera;
  $('set-touch').value = settings.touch;
}

function updateTouchVisibility() {
  const on = settings.touch === 'on' || (settings.touch === 'auto' && (coarse || W.input.usingTouch));
  document.body.classList.toggle('touch', on && G.mode === 'drive');
  $('touch').hidden = !(on && G.mode === 'drive');
}

function bindMenu() {
  for (const b of document.querySelectorAll('[data-tab]')) {
    b.addEventListener('click', () => {
      menuState.tab = b.dataset.tab;
      $('btn-reset-confirm').hidden = true;
      renderMenu();
    });
  }
  $('btn-start').addEventListener('click', () => startSession({ tripId: settings.tripId }));
  $('btn-demo').addEventListener('click', () => startSession({ tripId: settings.tripId, demo: true }));
  $('btn-free').addEventListener('click', () => startSession({ tripId: null }));
  $('btn-reset').addEventListener('click', () => {
    $('btn-reset-confirm').hidden = false;
  });
  $('btn-reset-confirm').addEventListener('click', () => {
    W.company.reset();
    $('btn-reset-confirm').hidden = true;
    enterMenu();
  });
  $('set-quality').addEventListener('change', (e) => {
    settings.quality = e.target.value;
    saveSettings();
    $('quality-note').textContent = 'Gespeichert. Die neue Grafikstufe gilt nach dem Neuladen der Seite.';
  });
  $('set-mirrors').addEventListener('change', (e) => {
    settings.mirrors = e.target.checked;
    saveSettings();
  });
  $('set-sound').addEventListener('change', (e) => {
    settings.sound = e.target.checked;
    saveSettings();
    W.audio.setMuted(!settings.sound);
  });
  $('set-volume').addEventListener('input', (e) => {
    settings.volume = Number(e.target.value);
    saveSettings();
    W.audio.volume = settings.volume;
    W.audio.setMuted(!settings.sound);
  });
  $('set-camera').addEventListener('change', (e) => {
    settings.camera = e.target.value;
    saveSettings();
  });
  $('set-touch').addEventListener('change', (e) => {
    settings.touch = e.target.value;
    saveSettings();
  });
  $('btn-reload').addEventListener('click', () => window.location.reload());

  // Pause menu.
  $('p-resume').addEventListener('click', () => setPaused(false));
  $('p-auto').addEventListener('click', () => {
    setAutopilot(!G.autopilot);
    setPaused(false);
  });
  $('p-camera').addEventListener('click', () => {
    W.rig.next();
    setPaused(false);
  });
  $('p-sound').addEventListener('click', () => {
    settings.sound = !settings.sound;
    saveSettings();
    W.audio.setMuted(!settings.sound);
    $('p-sound').textContent = settings.sound ? 'Ton aus' : 'Ton an';
  });
  $('p-quit').addEventListener('click', () => {
    if (G.sim && G.sim.trip && !G.sim.trip.finished) {
      $('p-quit').hidden = true;
      $('p-quit-confirm').hidden = false;
    } else {
      setPaused(false);
      enterMenu();
    }
  });
  $('p-quit-confirm').addEventListener('click', () => {
    G.paused = false;
    $('pause').hidden = true;
    endSession();
  });
  $('map-close').addEventListener('click', () => W.hud.closeMap());
  for (const b of document.querySelectorAll('[data-hud]')) b.addEventListener('click', () => handleTap(b.dataset.hud));
  W.hud.onCoin = () => W.audio.coin();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && G.mode === 'drive' && !G.paused && $('report').hidden) setPaused(true);
  });
  window.addEventListener('resize', () => {
    W.renderer.setSize(window.innerWidth, window.innerHeight, false);
    W.camera.aspect = window.innerWidth / window.innerHeight;
    W.camera.updateProjectionMatrix();
    if (W.hud.mapOpen && G.sim) W.hud.openMap(G.sim.bus, G.sim.trip);
  });
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !W.input.usingTouch) {
      W.input.usingTouch = true;
      updateTouchVisibility();
    }
  });
}

// ---------------------------------------------------------------- test hook

window.__bus = {
  ready: false,
  G,
  start: (opts) => startSession(opts),
  menu: () => enterMenu(),
  autopilot: (on) => setAutopilot(on),
  // Advance the simulation quickly without rendering every step (tests, demos).
  fastForward(seconds) {
    const n = Math.round(seconds / PHYSICS_DT);
    const idle = { throttle: 0, brake: 0, steer: 0 };
    for (let i = 0; i < n && G.mode === 'drive'; i++) {
      stepSim(PHYSICS_DT, idle);
      if (i % 12 === 0) handleEvents();
      if (G.sim.trip && G.sim.trip.finished && G.finishTimer < 0) G.finishTimer = 0.01;
    }
    handleEvents();
    if (G.finishTimer > 0 && G.sim.trip && G.sim.trip.finished) showReport();
  },
  state() {
    const sim = G.sim;
    const trip = sim && sim.trip;
    return {
      mode: G.mode,
      paused: G.paused,
      kmh: sim ? sim.bus.kmh : 0,
      clock: sim ? sim.clock : 0,
      progress: trip ? trip.progress : null,
      next: trip && trip.nextStop ? trip.nextStop.name : null,
      finished: trip ? trip.finished : null,
      faults: sim ? sim.rules.faults.map((f) => f.code) : [],
      report: !$('report').hidden,
      camera: W && W.rig.mode,
      calls: W ? W.renderer.info.render.calls : 0,
      triangles: W ? W.renderer.info.render.triangles : 0,
    };
  },
};

boot()
  .then(() => bindMenu())
  .catch(fail);
