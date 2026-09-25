// Nordkamm GT: game bootstrap, modes, race logic and the main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { QUALITY, ROAD, WORLD } from './config.js';
import { WorldData } from './worldgen.js';
import { WorldView, TIME_PRESETS } from './world.js';
import { Vehicle } from './vehicle.js';
import { CarModel } from './carModel.js';
import { AIDriver } from './ai.js';
import { Effects } from './effects.js';
import { GameAudio } from './audio.js';
import { Input } from './input.js';
import { Hud, drawGauge } from './hud.js';
import { CameraRig, CAMERA_LABELS, CAMERA_MODES } from './camera.js';
import { StaticColliders } from './collision.js';
import { carPaintTexture } from './textures.js';
import { OpenWorld } from './openworld.js';
import { Career } from './career.js';
import { SkillChain } from './skills.js';
import { Gps } from './gps.js';
import { WorldMap } from './worldmap.js';
import { PhotoMode } from './photo.js';
import { renderTerrainRaster, roadPolylines } from './maprender.js';
import { clamp, formatTime } from './util.js';

const PAINTS = [
  { name: 'Rennrot', color: '#c1121f', stripe: '#f4f4f0' },
  { name: 'Nachtblau', color: '#1b2f6b', stripe: '#f2a541' },
  { name: 'Arktisweiß', color: '#e4e7ea', stripe: '#c1121f' },
  { name: 'Signalorange', color: '#ee6a1c', stripe: '#15171b' },
  { name: 'Britisch Grün', color: '#15452f', stripe: '#e8dcb5' },
  { name: 'Graphit', color: '#30343b', stripe: '#f2a541' },
  // Unlocked with the driver level in the open world.
  { name: 'Sakura-Pink', color: '#f29bbf', stripe: '#ffffff', level: 2 },
  { name: 'Mitternachtslila', color: '#3b1f6b', stripe: '#29e3ff', level: 3 },
  { name: 'Neongrün', color: '#58d43a', stripe: '#111111', level: 4 },
  { name: 'Kaminari-Gelb', color: '#f2c230', stripe: '#1a1a1a', level: 6 },
  { name: 'Chromsilber', color: '#b9c0c7', stripe: '#c1121f', level: 8 },
  { name: 'Festival-Gold', color: '#c9a227', stripe: '#111111', level: 10 },
];

const RIVALS = [
  { name: 'Mara Lind', color: '#2458d6', stripe: '#ffffff', number: 11, skill: 0.975 },
  { name: 'Jonas Weber', color: '#eeeeea', stripe: '#1d1d1d', number: 23, skill: 0.96 },
  { name: 'Ayla Demir', color: '#1f8a4c', stripe: '#f2d64b', number: 4, skill: 0.95 },
  { name: 'Tomasz Nowak', color: '#f2b705', stripe: '#111111', number: 58, skill: 0.935 },
  { name: 'Sven Haag', color: '#6a2c91', stripe: '#f4f4f0', number: 31, skill: 0.92 },
];

const PLAYER_SLOT = 4;
const STORAGE_KEY = 'nordkamm.settings.v1';
const BEST_KEY = 'nordkamm.bestlap.v1';

const isTouch = (() => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  } catch {
    return false;
  }
})();

const DEFAULTS = { mode: 'race', laps: 2, time: 'evening', quality: isTouch ? 'low' : 'high', gearbox: 'auto', paint: 0, camera: 'chase', muted: false };

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

function storeSettings(s) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* storage may be unavailable */
  }
}

function loadBest() {
  try {
    const v = Number(localStorage.getItem(BEST_KEY));
    return v > 0 ? v : Infinity;
  } catch {
    return Infinity;
  }
}

function storeBest(t) {
  try {
    localStorage.setItem(BEST_KEY, String(t));
  } catch {
    /* ignore */
  }
}

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

const SpeedShader = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 0 }, uVignette: { value: 0.32 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uStrength; uniform float uVignette; varying vec2 vUv;
    void main(){
      vec2 dir = vUv - vec2(0.5, 0.54);
      float d = length(dir);
      vec4 c = texture2D(tDiffuse, vUv);
      if (uStrength > 0.001) {
        float amt = uStrength * smoothstep(0.12, 0.7, d);
        vec4 acc = c;
        for (int i = 1; i < 8; i++) {
          acc += texture2D(tDiffuse, vUv - dir * (float(i) / 7.0) * amt * 0.07);
        }
        c = acc / 8.0;
      }
      c.rgb *= 1.0 - smoothstep(0.42, 0.95, d) * uVignette;
      gl_FragColor = c;
    }`,
};

class Game {
  constructor() {
    this.settings = loadSettings();
    if (!QUALITY[this.settings.quality]) this.settings.quality = DEFAULTS.quality;
    this.career = new Career();
    if (!this.#paintUnlocked(this.settings.paint)) this.settings.paint = 0;
    this.state = 'loading';
    this.mode = 'race';
    this.bestLap = loadBest();
    this.acc = 0;
    this.last = performance.now();
    this.frameCount = 0;
    this.fps = { time: 0, frames: 0, value: 60 };
    this.vIn = { throttle: 0, brake: 0, steer: 0, handbrake: false, analogSteer: false, manual: false, shiftUp: false, shiftDown: false };
    this.pen = { nx: 0, nz: 0, depth: 0 };
    this.wheelHints = [-1, -1, -1, -1];
    this.qTmp = {};
    this.playerQ = {};
    this.playerIdx = -1;
    this.drift = { active: false, points: 0, mult: 1, timer: 0, idle: 0, total: 0 };
    this.headlightsManual = null;
    this.rivals = [];
    this.ai = [];
    this.race = null;
    this.wrongWay = 0;
    this.respawnTimer = 0;
    this.toastTimer = 0;
    this.portraitDismissed = false;
    this.groundFn = (x, z, w, out) => {
      const q = this.data.track.nearest(x, z, this.wheelHints[w], this.qTmp);
      if (q.index >= 0) this.wheelHints[w] = q.index;
      out.h = this.data.groundHeight(x, z, q);
      out.surface = this.data.surfaceAt(x, z, out.h, q);
      return out;
    };
    this.cameraGround = (x, z) => this.data.heightfield.get(x, z);
  }

  // ------------------------------------------------------------------ boot
  async boot() {
    const fill = document.getElementById('load-fill');
    const text = document.getElementById('load-text');
    const steps = 18;
    let done = 0;
    const step = async (label, fn) => {
      text.textContent = label + ' …';
      await nextFrame();
      await fn();
      done++;
      fill.style.width = `${Math.round((done / steps) * 100)}%`;
    };
    try {
      this.#createRenderer();
    } catch (e) {
      console.error(e);
      document.getElementById('loading').hidden = true;
      document.getElementById('error').hidden = false;
      return;
    }
    // Signs, number plates and gauges are painted onto canvases: load the fonts first.
    await step('Schriften', async () => {
      try {
        const fonts = ['900 64px "Big Shoulders Display"', '600 32px "Barlow"', '700 32px "Chivo Mono"'];
        await Promise.race([Promise.all(fonts.map((f) => document.fonts.load(f))), new Promise((r) => setTimeout(r, 2500))]);
      } catch {
        /* fall back to system fonts */
      }
    });
    this.data = new WorldData();
    await step('Straßen werden vermessen', () => {
      this.data.buildTrack();
      this.data.buildRoads();
    });
    await step('Gelände wird geformt', () => {
      this.data.buildTerrain();
      this.data.placeGuardRails();
    });
    await step('Stadt wird geplant', () => {
      this.data.placeCity();
      this.data.placeLamps();
    });
    await step('Open World wird geplant', () => {
      this.data.planActivities();
      this.data.planLandmarks();
    });
    await step('Wald wird gepflanzt', () => {
      this.data.placeVegetation();
      this.data.placeBillboards();
    });
    const q = QUALITY[this.settings.quality];
    this.world = new WorldView({ renderer: this.renderer, scene: this.scene, data: this.data, quality: q });
    await step('Himmel und Licht', () => this.world.buildSky());
    await step('Gelände', () => this.world.buildTerrain());
    await step('Straße und Start', () => this.world.buildRoad());
    await step('Stadt', () => this.world.buildCity());
    await step('Bäume und Felsen', () => this.world.buildVegetation());
    await step('Laternen, See, Berge', () => {
      this.world.buildLamps();
      this.world.buildWater();
      this.world.buildBackdrop();
    });
    await step('Festival und Sehenswürdigkeiten', () => this.world.buildScenery());
    await step('Autos', () => this.#createCars());
    await step('Checkpoints, Zonen, Schanzen', () => {
      this.openWorld = new OpenWorld(this);
      this.openWorld.build();
    });
    let mapRaster = null;
    let mapLines = null;
    await step('Karte wird gezeichnet', () => {
      mapRaster = renderTerrainRaster(this.data, this.settings.quality === 'low' ? 1024 : 2048);
      mapLines = roadPolylines(this.data);
    });
    await step('Tageszeit', () => this.world.setTimeOfDay(this.settings.time));
    this.effects = new Effects(this.scene);
    this.audio = new GameAudio();
    this.audio.muted = this.settings.muted;
    this.input = new Input();
    this.hud = new Hud(document.getElementById('hud'), this.data, { raster: mapRaster, lines: mapLines });
    this.gps = new Gps(this);
    this.worldMap = new WorldMap(this, mapRaster, mapLines);
    this.photo = new PhotoMode(this);
    this.skills = new SkillChain({
      onBank: (total) => {
        this.hud.skillResult(total, true);
        if (total > this.career.bestChain) this.career.bestChain = total;
        this.career.award(Math.round(total * 0.2), 'Skill-Kette');
      },
      onBreak: (lost) => this.hud.skillResult(lost, false),
    });
    this.career.onAward(({ xp, reason, levelUps }) => this.#onAward(xp, reason, levelUps));
    this.rig = new CameraRig(this.camera);
    this.rig.setMode(CAMERA_MODES.includes(this.settings.camera) ? this.settings.camera : 'chase');
    this.#setupPost();
    this.#placeMenuScene();
    await step('Shader werden vorbereitet', async () => {
      try {
        this.rig.update(0.016, this.vehicle, this.cameraGround, { menu: true });
        if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
      } catch (e) {
        console.warn(e);
      }
    });
    this.#setupUI();
    document.getElementById('loading').hidden = true;
    this.#enterMenu();
    this.#onResize();
    window.addEventListener('resize', () => this.#onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && (this.state === 'running' || this.state === 'countdown')) this.pause();
    });
    window.claude?.hot?.snapshot?.(() => ({ settings: this.settings }));
    this.last = performance.now();
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  #createRenderer() {
    const canvas = document.getElementById('view');
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    if (!renderer.getContext()) throw new Error('WebGL fehlt');
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.6;
    const q = QUALITY[this.settings.quality];
    renderer.shadowMap.enabled = q.shadows > 0;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.pixelRatio = this.maxPixelRatio;
    renderer.setPixelRatio(this.pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.2, 7000);
    this.scene.add(this.camera);
  }

  #setupPost() {
    const q = QUALITY[this.settings.quality];
    this.usePost = q.post;
    if (this.composer) {
      this.composer.renderTarget1?.dispose();
      this.composer.renderTarget2?.dispose();
      this.composer.dispose?.();
      this.speedPass = null;
      this.bloom = null;
    }
    if (!this.usePost) {
      this.composer = null;
      return;
    }
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, rt);
    composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.3, 0.5, 0.93);
    this.bloom.enabled = q.bloom;
    composer.addPass(this.bloom);
    this.speedPass = new ShaderPass(SpeedShader);
    composer.addPass(this.speedPass);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  #createCars() {
    const paint = PAINTS[this.settings.paint] || PAINTS[0];
    this.vehicle = new Vehicle();
    this.playerModel = new CarModel({ color: paint.color, stripe: paint.stripe, number: 7, plate: 'NK·GT 7', detail: 'high' });
    this.vehicle.model = this.playerModel;
    this.scene.add(this.playerModel.root);
    // Headlight beams for the player car.
    this.beams = [];
    for (const sd of [1, -1]) {
      const spot = new THREE.SpotLight('#fff3e0', 0, 150, 0.42, 0.45, 1.5);
      spot.position.set(sd * 0.55, 0.65, 2.0);
      spot.target.position.set(sd * 0.9, -0.6, 22);
      this.playerModel.chassis.add(spot, spot.target);
      this.beams.push(spot);
    }
    this.rivalModels = RIVALS.map((r) => {
      const m = new CarModel({ color: r.color, stripe: r.stripe, number: r.number, plate: `NK·${r.number}`, detail: 'low' });
      this.scene.add(m.root);
      return m;
    });
  }

  setPaint(i) {
    const p = PAINTS[i] || PAINTS[0];
    const mat = this.playerModel.paint;
    const old = mat.map;
    mat.map = carPaintTexture(p.color, p.stripe, 7);
    mat.needsUpdate = true;
    this.playerModel.paintPlain.color.set(p.color);
    if (old) old.dispose();
  }

  // ------------------------------------------------------------------ UI
  #setupUI() {
    const $ = (id) => document.getElementById(id);
    // Track thumbnail and facts
    const thumb = $('track-thumb');
    const tctx = thumb.getContext('2d');
    const tr = this.data.track;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let hMin = Infinity;
    let hMax = -Infinity;
    for (let i = 0; i < tr.count; i++) {
      minX = Math.min(minX, tr.x[i]);
      maxX = Math.max(maxX, tr.x[i]);
      minZ = Math.min(minZ, tr.z[i]);
      maxZ = Math.max(maxZ, tr.z[i]);
      hMin = Math.min(hMin, tr.h[i]);
      hMax = Math.max(hMax, tr.h[i]);
    }
    const span = Math.max(maxX - minX, maxZ - minZ);
    const pad = 16;
    const sc = (thumb.width - pad * 2) / span;
    const px = (x) => pad + (x - minX) * sc + ((span - (maxX - minX)) * sc) / 2;
    const pz = (z) => pad + (z - minZ) * sc + ((span - (maxZ - minZ)) * sc) / 2;
    tctx.clearRect(0, 0, thumb.width, thumb.height);
    tctx.lineJoin = 'round';
    for (const [w, c] of [
      [9, 'rgba(242,165,65,0.18)'],
      [4, '#e6eef3'],
    ]) {
      tctx.strokeStyle = c;
      tctx.lineWidth = w;
      tctx.beginPath();
      for (let i = 0; i <= tr.count; i += 6) {
        const k = i % tr.count;
        if (i === 0) tctx.moveTo(px(tr.x[k]), pz(tr.z[k]));
        else tctx.lineTo(px(tr.x[k]), pz(tr.z[k]));
      }
      tctx.closePath();
      tctx.stroke();
    }
    tctx.fillStyle = '#f2a541';
    tctx.beginPath();
    tctx.arc(px(tr.x[tr.startIndex]), pz(tr.z[tr.startIndex]), 6, 0, Math.PI * 2);
    tctx.fill();
    $('fact-length').textContent = `${(tr.length / 1000).toFixed(1).replace('.', ',')} km`;
    $('fact-climb').textContent = `${Math.round(hMax - hMin)} m`;
    let corners = 0;
    let inCorner = false;
    for (let i = 0; i < tr.count; i++) {
      const tight = Math.abs(tr.curv[i]) > 1 / 200;
      if (tight && !inCorner) corners++;
      inCorner = tight;
    }
    $('fact-corners').textContent = String(corners);
    this.#refreshBest();

    // Mode buttons
    const modes = [...document.querySelectorAll('#modes .mode')];
    const syncModes = () => {
      modes.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === this.settings.mode)));
      $('laps-group').hidden = this.settings.mode !== 'race';
    };
    modes.forEach((b) =>
      b.addEventListener('click', () => {
        this.settings.mode = b.dataset.mode;
        storeSettings(this.settings);
        syncModes();
        this.#placeMenuScene();
        this.audio.click();
      }),
    );
    syncModes();

    // Segmented settings (menu and pause share the quality control)
    const syncSeg = () => {
      document.querySelectorAll('.seg[data-setting]').forEach((seg) => {
        const key = seg.dataset.setting;
        seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(String(this.settings[key]) === b.dataset.value)));
      });
    };
    document.querySelectorAll('.seg[data-setting]').forEach((seg) => {
      seg.querySelectorAll('button').forEach((b) =>
        b.addEventListener('click', () => {
          const key = seg.dataset.setting;
          const val = key === 'laps' ? Number(b.dataset.value) : b.dataset.value;
          this.settings[key] = val;
          storeSettings(this.settings);
          syncSeg();
          this.audio.click();
          if (key === 'time') {
            this.world.setTimeOfDay(val);
            this.#applyLights();
          }
          if (key === 'quality') this.#applyQuality();
        }),
      );
    });
    syncSeg();

    // Paint swatches (the last ones unlock with the driver level)
    this.#buildSwatches();

    $('start-btn').addEventListener('click', () => this.start());
    $('resume-btn').addEventListener('click', () => this.resume());
    $('restart-btn').addEventListener('click', () => {
      this.#hidePause();
      this.start();
    });
    $('menu-btn').addEventListener('click', () => {
      this.#hidePause();
      this.#enterMenu();
    });
    $('camera-btn').addEventListener('click', () => this.#cycleCamera());
    $('sound-btn').addEventListener('click', () => {
      this.settings.muted = !this.settings.muted;
      storeSettings(this.settings);
      this.audio.setMuted(this.settings.muted);
      this.#syncPauseLabels();
    });
    $('lights-btn').addEventListener('click', () => {
      this.headlightsManual = !this.#headlightsOn();
      this.#applyLights();
      this.#syncPauseLabels();
    });
    $('again-btn').addEventListener('click', () => {
      $('results').hidden = true;
      this.start();
    });
    $('results-menu-btn').addEventListener('click', () => {
      $('results').hidden = true;
      this.#enterMenu();
    });
    $('btn-camera').addEventListener('click', () => this.#cycleCamera());
    $('btn-pause').addEventListener('click', () => this.pause());
    $('btn-map').addEventListener('click', () => this.input.taps.add('map'));
    $('photo-btn').addEventListener('click', () => this.openPhoto());
    $('abort-btn').addEventListener('click', () => {
      this.openWorld.cancelRun();
      this.resume();
    });
    $('portrait-ok').addEventListener('click', () => {
      this.portraitDismissed = true;
      $('portrait').hidden = true;
    });
    this.input.bindTouch(document.getElementById('touch'));
    if (isTouch) {
      document.body.classList.add('touch');
      $('keys-help').hidden = true;
    }
  }

  #paintUnlocked(i) {
    const p = PAINTS[i];
    return !!p && (!p.level || this.career.level >= p.level);
  }

  #buildSwatches() {
    const sw = document.getElementById('swatches');
    sw.textContent = '';
    PAINTS.forEach((p, i) => {
      const b = document.createElement('button');
      const open = this.#paintUnlocked(i);
      b.className = 'swatch';
      b.style.background = `linear-gradient(135deg, ${p.color} 60%, ${p.stripe} 60%)`;
      b.title = open ? p.name : `${p.name} · ab Stufe ${p.level}`;
      b.setAttribute('aria-label', b.title);
      b.setAttribute('aria-pressed', String(i === this.settings.paint));
      if (!open) {
        b.classList.add('locked');
        b.dataset.level = String(p.level);
      }
      b.addEventListener('click', () => {
        if (!this.#paintUnlocked(i)) {
          this.audio.click();
          return;
        }
        this.settings.paint = i;
        storeSettings(this.settings);
        sw.querySelectorAll('.swatch').forEach((s, k) => s.setAttribute('aria-pressed', String(k === i)));
        this.setPaint(i);
        this.audio.click();
      });
      sw.appendChild(b);
    });
  }

  // XP notices, level-ups and paint unlocks.
  #onAward(xp, reason, levelUps) {
    if (xp > 0 && reason) this.hud.feed(reason, xp);
    for (const level of levelUps) {
      const paint = PAINTS.find((p) => p.level === level);
      this.hud.banner('Stufe erreicht', `Stufe ${level}`, paint ? `Neue Lackierung: ${paint.name}` : 'Weiter so!', 3.6);
      this.audio.chime();
    }
    if (levelUps.length) this.#buildSwatches();
  }

  #refreshBest() {
    document.getElementById('fact-best').textContent = Number.isFinite(this.bestLap) ? formatTime(this.bestLap) : 'noch keine';
  }

  #syncPauseLabels() {
    document.getElementById('abort-btn').hidden = !this.openWorld?.runActive;
    document.getElementById('sound-btn').textContent = `Ton: ${this.settings.muted ? 'aus' : 'an'}`;
    document.getElementById('lights-btn').textContent = `Licht: ${this.#headlightsOn() ? 'an' : 'aus'}`;
    document.getElementById('camera-btn').textContent = `Kamera: ${CAMERA_LABELS[this.rig.mode]}`;
  }

  #cycleCamera() {
    const m = this.rig.next();
    this.settings.camera = m;
    storeSettings(this.settings);
    this.playerModel.setCockpit(m === 'cockpit');
    this.#toast(`Kamera: ${CAMERA_LABELS[m]}`);
    this.#syncPauseLabels();
  }

  #toast(text) {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.hidden = false;
    this.toastTimer = 1.6;
  }

  #applyQuality() {
    const q = QUALITY[this.settings.quality];
    this.maxPixelRatio = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.pixelRatio = this.maxPixelRatio;
    this.renderer.setPixelRatio(this.pixelRatio);
    const wantShadows = q.shadows > 0;
    if (this.renderer.shadowMap.enabled !== wantShadows || (wantShadows && this.world.sunLight.shadow.mapSize.x !== q.shadows)) {
      this.renderer.shadowMap.enabled = wantShadows;
      const sun = this.world.sunLight;
      sun.castShadow = wantShadows;
      if (wantShadows) {
        sun.shadow.mapSize.set(q.shadows, q.shadows);
        if (sun.shadow.map) {
          sun.shadow.map.dispose();
          sun.shadow.map = null;
        }
        const e = 75;
        Object.assign(sun.shadow.camera, { left: -e, right: e, top: e, bottom: -e, near: 10, far: 900 });
        sun.shadow.camera.updateProjectionMatrix();
        sun.shadow.bias = -0.0004;
        sun.shadow.normalBias = 0.04;
      }
      this.scene.traverse((o) => {
        if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => (m.needsUpdate = true));
        if (o.isInstancedMesh) o.castShadow = wantShadows && o.geometry.attributes.position.count > 200;
      });
    }
    this.world.quality = q;
    this.#setupPost();
    this.#applyLights();
    this.#onResize();
  }

  // ------------------------------------------------------------------ scene placement
  #gridSlot(k) {
    const tr = this.data.track;
    const row = Math.floor(k / 2);
    const col = k % 2;
    return { s: tr.startS - 8 - row * 9 - col * 4.5 - 2.2, lateral: col ? -2.6 : 2.6 };
  }

  #placeVehicle(s, lateral) {
    const tr = this.data.track;
    const p = tr.pointAt(s, lateral, {});
    this.wheelHints.fill(p.index);
    const q = tr.nearest(p.x, p.z, p.index, {});
    const y = this.data.groundHeight(p.x, p.z, q);
    this.vehicle.reset(p.x, y, p.z, p.heading);
    this.vehicle.groundY = y;
    this.playerIdx = p.index;
  }

  // Put the player car on the ground at (x, z) facing `heading`, at rest.
  placeCar(x, z, heading) {
    const tr = this.data.track;
    const q = tr.nearest(x, z, -1, {});
    const y = this.data.groundHeight(x, z, q);
    this.vehicle.reset(x, y, z, heading);
    this.vehicle.groundY = y;
    this.wheelHints.fill(q.index >= 0 ? q.index : -1);
    if (q.index >= 0) this.playerIdx = q.index;
    this.effects.trails.clear();
  }

  #placeMenuScene() {
    // Player car on the grid, rivals around it: a static showroom.
    const mode = this.settings.mode;
    if (mode === 'race') {
      const slot = this.#gridSlot(PLAYER_SLOT);
      this.#placeVehicle(slot.s, slot.lateral);
    } else if (mode === 'free' && this.data.festival) {
      // Open world starts at the festival.
      const f = this.data.festival.spawn;
      this.placeCar(f.x, f.z, f.heading);
    } else this.#placeVehicle(this.data.track.startS - 14, 0);
    this.ai = [];
    this.rivalModels.forEach((m, i) => {
      const drv = new AIDriver(this.data.track, this.data, { name: RIVALS[i].name, color: RIVALS[i].color });
      if (mode === 'race') {
        const k = i < PLAYER_SLOT ? i : i + 1;
        const slot = this.#gridSlot(k);
        drv.placeAt(slot.s, slot.lateral);
        m.root.visible = true;
      } else m.root.visible = false;
      drv.update(0.016, [], { frozen: true });
      m.update(drv);
    });
    this.playerModel.update(this.vehicle);
    this.effects?.reset();
  }

  // ------------------------------------------------------------------ state transitions
  #enterMenu() {
    this.state = 'menu';
    document.getElementById('menu').hidden = false;
    document.getElementById('hud').hidden = true;
    document.getElementById('touch').hidden = true;
    document.getElementById('pause').hidden = true;
    document.getElementById('results').hidden = true;
    this.playerModel.setCockpit(false);
    this.world.setStartLights('off');
    this.#placeMenuScene();
    this.#refreshBest();
    this.audio?.silence();
    this.#applyLights();
    this.openWorld?.setEnabled(false);
    this.worldMap?.hide();
    this.gps?.clear();
    const t = this.openWorld?.totals();
    if (t) document.getElementById('stars-tag').textContent = `★ ${t.stars}/${t.max} · Stufe ${this.career.level}`;
  }

  start() {
    // Browser features that may be refused or never settle must not block the start.
    this.audio
      .init()
      .then(() => this.audio.setMuted(this.settings.muted))
      .catch(() => {});
    if (isTouch && !this.portraitDismissed && window.innerHeight > window.innerWidth) document.getElementById('portrait').hidden = false;
    try {
      if (isTouch && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
    } catch {
      /* optional */
    }
    try {
      navigator.wakeLock
        ?.request('screen')
        .then((lock) => (this.wakeLock = lock))
        .catch(() => {});
    } catch {
      /* optional */
    }
    this.mode = this.settings.mode;
    document.getElementById('menu').hidden = true;
    document.getElementById('results').hidden = true;
    document.getElementById('hud').hidden = false;
    document.getElementById('touch').hidden = !isTouch;
    this.hud.resize();
    this.effects.reset();
    this.drift = { active: false, points: 0, mult: 1, timer: 0, idle: 0, total: 0 };
    this.wrongWay = 0;
    this.respawnTimer = 0;
    this.input.enabled = true;
    this.input.clearTaps();
    this.playerModel.setCockpit(this.rig.mode === 'cockpit');
    this.rig.initialised = false;
    const tr = this.data.track;
    this.ai = [];
    if (this.mode === 'race') {
      const slot = this.#gridSlot(PLAYER_SLOT);
      this.#placeVehicle(slot.s, slot.lateral);
      this.rivalModels.forEach((m, i) => {
        const r = RIVALS[i];
        const drv = new AIDriver(tr, this.data, { name: r.name, color: r.color, skill: r.skill, lane: [1.6, -1.6, 0.8, -0.8, 0][i] });
        const k = i < PLAYER_SLOT ? i : i + 1;
        const slot2 = this.#gridSlot(k);
        drv.placeAt(slot2.s, slot2.lateral);
        drv.model = m;
        m.root.visible = true;
        this.ai.push(drv);
      });
    } else if (this.mode === 'time') {
      this.#placeVehicle(tr.startS - 14, 0);
      this.rivalModels.forEach((m) => (m.root.visible = false));
    } else {
      const f = this.data.festival.spawn;
      this.placeCar(f.x, f.z, f.heading);
      // Light traffic in both directions.
      const plan = [
        [600, 1],
        [2300, 1],
        [4600, 1],
        [1500, -1],
        [5600, -1],
      ];
      this.rivalModels.forEach((m, i) => {
        const [off, dir] = plan[i];
        const drv = new AIDriver(tr, this.data, { name: RIVALS[i].name, color: RIVALS[i].color, skill: 0.72, direction: dir, speedCap: 24 + i * 1.5, lane: -3.2 });
        drv.placeAt(tr.startS + off, -3.2 * dir);
        drv.speed = 18;
        drv.model = m;
        m.root.visible = true;
        this.ai.push(drv);
      });
    }
    // Race bookkeeping
    const entries = [{ name: 'Du', color: PAINTS[this.settings.paint]?.color || '#c1121f', player: true, obj: this.vehicle }];
    if (this.mode === 'race') this.ai.forEach((a) => entries.push({ name: a.name, color: a.color, player: false, obj: a }));
    this.race = {
      laps: this.mode === 'race' ? this.settings.laps : Infinity,
      time: 0,
      started: false,
      entries: entries.map((e) => ({ ...e, lap: 0, mask: 0x3ff, prevS: null, progress: 0, finished: false, finishTime: 0, lapStart: 0, bestLap: Infinity, lastLap: 0 })),
      finishOrder: 0,
      countdown: 0,
      lightsOn: 0,
      goAt: 0,
    };
    // Grid order until the first line crossing.
    for (const e of this.race.entries) {
      const q0 = tr.nearest(e.obj.x, e.obj.z, -1, {});
      if (q0.index >= 0) e.progress = tr.wrapS(q0.s - tr.startS);
      e.startProgress = e.progress;
    }
    this.vehicle.gear = this.mode === 'free' ? 1 : 0;
    this.openWorld.setEnabled(this.mode === 'free');
    document.getElementById('btn-map').hidden = this.mode !== 'free';
    this.worldMap.hide();
    this.gps.clear();
    this.skills.reset();
    this.hud.setLevel(this.career.levelProgress());
    this.levelShown = this.career.xp;
    this.#applyLights();
    if (this.mode === 'free') {
      this.state = 'running';
      this.race.started = true;
      this.world.setStartLights('off');
      this.hud.banner('Willkommen beim', 'Nordkamm Festival', `Stufe ${this.career.level} · M öffnet die Karte`, 3.4);
      this.career.discover('lm-festival');
    } else {
      this.state = 'countdown';
      this.world.setStartLights(0);
      this.race.goAt = 5 * 0.8 + 0.8 + Math.random() * 0.8;
      this.hud.message(this.mode === 'race' ? `${this.settings.laps} ${this.settings.laps === 1 ? 'Runde' : 'Runden'}` : 'Zeitfahren', 1.4, 'info');
    }
    this.#syncPauseLabels();
  }

  // ------------------------------------------------------------------ world map and fast travel
  openMap() {
    if (this.mode !== 'free' || this.state !== 'running') return;
    this.prevState = this.state;
    this.state = 'map';
    this.audio.silence();
    this.input.clearTaps();
    this.worldMap.show();
  }

  closeMap() {
    if (this.state !== 'map') return;
    this.worldMap.hide();
    this.state = 'running';
    this.input.clearTaps();
    this.last = performance.now();
    this.acc = 0;
  }

  canFastTravel(item) {
    if (this.mode !== 'free') return { ok: false, reason: 'Nur in der Open World' };
    if (this.openWorld.runActive) return { ok: false, reason: 'Nicht während eines Laufs' };
    if (item.kind === 'festival') return { ok: true };
    if (item.kind === 'board') return { ok: false, reason: 'Bonusschilder findest du nur auf eigene Faust' };
    const allBoards = this.career.boards.size >= this.data.bonusBoards.length;
    if (item.spot) return allBoards ? { ok: true } : { ok: false, reason: 'Schnellreise an jeden Ort: alle Bonusschilder zerstören' };
    if (this.career.found.has(item.id) || allBoards) return { ok: true };
    return { ok: false, reason: 'Schnellreise erst, wenn du einmal dort warst' };
  }

  // Fade out, put the car on the nearest road next to the target, fade in.
  fastTravel(item) {
    let pose = item.travel;
    if (!pose || pose.onRoad) {
      const p = this.gps.graph.project(pose ? pose.x : item.x, pose ? pose.z : item.z, 250);
      if (p) {
        const r = p.road.pointAt(p.s, 0, {});
        const fwd = pose ? Math.cos(r.heading - pose.heading) >= 0 : true;
        pose = { x: r.x, z: r.z, heading: fwd ? r.heading : r.heading + Math.PI };
      } else if (this.data.heightfield.get(item.x, item.z) > 1.5) pose = { x: item.x, z: item.z, heading: 0 };
      else {
        this.hud.message('Dort ist kein Land', 1.4, 'warn');
        return;
      }
    }
    this.closeMap();
    this.openWorld.cancelRun(true);
    this.skills.reset();
    this.drift.active = false;
    this.drift.points = 0;
    const fade = document.getElementById('fade');
    fade.hidden = false;
    void fade.offsetWidth;
    fade.classList.add('on');
    this.state = 'paused';
    this.prevState = 'running';
    setTimeout(() => {
      this.placeCar(pose.x, pose.z, pose.heading);
      this.vehicle.gear = 1;
      this.rig.initialised = false;
      this.state = 'running';
      this.last = performance.now();
      this.acc = 0;
      fade.classList.remove('on');
      setTimeout(() => (fade.hidden = true), 400);
      this.hud.message(item.name, 1.6, 'info');
    }, 380);
  }

  // Photo mode: pause the game and hand the camera to the orbit controls.
  openPhoto() {
    if (this.state === 'paused') this.#hidePause();
    else if (this.state === 'running' || this.state === 'countdown') this.prevState = this.state;
    else return;
    this.state = 'photo';
    this.audio.silence();
    this.input.clearTaps();
    this.photo.open();
  }

  closePhoto() {
    if (this.state !== 'photo') return;
    this.photo.close();
    this.rig.initialised = false;
    this.state = this.prevState || 'running';
    this.input.clearTaps();
    this.last = performance.now();
    this.acc = 0;
  }

  onBoardSmashed(board) {
    const n = this.career.boards.size;
    const total = this.data.bonusBoards.length;
    this.skills.add('wreck', 400);
    this.career.award(1000, `Bonusschild ${n}/${total}`);
    if (n === total) this.hud.banner('Alle Bonusschilder', 'Schnellreise überall', 'Du kannst jetzt an jede Stelle der Karte reisen', 4);
  }

  pause() {
    if (this.state === 'map') this.closeMap();
    if (this.state !== 'running' && this.state !== 'countdown') return;
    this.prevState = this.state;
    this.state = 'paused';
    document.getElementById('pause').hidden = false;
    this.#syncPauseLabels();
    this.audio.silence();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.#hidePause();
    this.state = this.prevState || 'running';
    this.last = performance.now();
    this.acc = 0;
  }

  #hidePause() {
    document.getElementById('pause').hidden = true;
  }

  #headlightsOn() {
    if (this.headlightsManual !== null) return this.headlightsManual;
    return (TIME_PRESETS[this.settings.time]?.night || 0) > 0;
  }

  #applyLights() {
    const on = this.#headlightsOn();
    const night = TIME_PRESETS[this.settings.time]?.night || 0;
    for (const b of this.beams) b.intensity = on ? 40 + night * 110 : 0;
    this.playerModel.setLights({ headlights: on });
    for (const m of this.rivalModels) m.setLights({ headlights: night > 0 });
    if (this.bloom) {
      // Bloom only for real light sources: sunlit paint and facades stay below the threshold.
      this.bloom.threshold = night > 0.9 ? 1.0 : night > 0 ? 4 : 5;
      this.bloom.strength = 0.28 + night * 0.35;
    }
  }

  // ------------------------------------------------------------------ simulation
  #holdOnGrid() {
    const v = this.vehicle;
    v.x = this.gridPose.x;
    v.z = this.gridPose.z;
    v.yaw = this.gridPose.yaw;
    v.vx = v.vz = 0;
    v.yawRate = 0;
  }

  #simulate(dt) {
    const input = this.input.state;
    const v = this.vehicle;
    const vin = this.vIn;
    const finished = this.state === 'finished';
    vin.throttle = finished && this.resultsShown ? 0 : input.throttle;
    vin.brake = finished && this.resultsShown ? 0.4 : input.brake;
    vin.steer = input.steer;
    vin.handbrake = input.handbrake;
    vin.analogSteer = input.analogSteer;
    vin.manual = this.settings.gearbox === 'manual';
    vin.shiftUp = this.input.consume('shiftUp');
    vin.shiftDown = this.input.consume('shiftDown');
    // Held in place during a race start or an open-world run countdown (engine can be revved).
    const counting = this.state === 'countdown' || !!this.openWorld?.holding;
    if (counting && !this.gridPose) this.gridPose = { x: v.x, z: v.z, yaw: v.yaw };
    if (!counting) this.gridPose = null;
    if (counting) {
      v.gear = 0;
      vin.shiftUp = vin.shiftDown = false;
    } else if (v.gear === 0 && this.state !== 'countdown') v.gear = 1;

    const step = 1 / 120;
    this.acc += dt;
    let n = 0;
    while (this.acc >= step && n < 10) {
      v.step(step, vin, this.groundFn);
      vin.shiftUp = vin.shiftDown = false;
      if (counting) this.#holdOnGrid();
      else this.#collideStatic(v);
      this.acc -= step;
      n++;
    }
    if (n >= 10) this.acc = 0;

    // Vehicle events -> sound / camera
    const events = v.drainEvents();
    if (events) {
      for (const e of events) {
        if (e.type === 'shift') this.audio.shift();
        else if (e.type === 'land') {
          this.audio.land(e.strength);
          this.rig.addShake(Math.min(0.8, e.strength / 10));
        } else if (e.type === 'blowoff') this.audio.blowoff(e.strength);
      }
    }

    // World limits and water
    const lim = WORLD.half - 40;
    if (Math.abs(v.x) > lim || Math.abs(v.z) > lim) {
      const nx = Math.abs(v.x) > lim ? -Math.sign(v.x) : 0;
      const nz = Math.abs(v.z) > lim ? -Math.sign(v.z) : 0;
      const depth = Math.max(Math.abs(v.x) - lim, Math.abs(v.z) - lim);
      v.collide(nx, nz, depth, 0, 0.1);
    }
    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.#respawn();
    } else if (v.y < WORLD.waterLevel - 0.8 && v.onGround) {
      this.hud.message('Ab ins Wasser!', 1.2, 'warn');
      this.respawnTimer = 1.1;
      this.drift.active = false;
      this.drift.points = 0;
    }

    // Computer cars
    const player = this.vehicle;
    const all = [player, ...this.ai];
    const playerProgress = this.race?.entries[0]?.progress ?? 0;
    for (let i = 0; i < this.ai.length; i++) {
      const a = this.ai[i];
      let rubber = 1;
      if (this.mode === 'race') {
        const e = this.race.entries[i + 1];
        const gap = e.progress - playerProgress;
        rubber = clamp(1 - (gap / 1500) * 0.06, 0.93, 1.05);
        if (e.finished) rubber = 0.6;
      }
      a.update(dt, all, { race: this.mode === 'race', rubber, frozen: this.state === 'countdown' });
    }
    this.#collideCars();
  }

  #collideStatic(v) {
    const items = this.data.colliders.query(v.x, v.z, 3.6);
    if (!items.length) return;
    const fx = Math.sin(v.yaw);
    const fz = Math.cos(v.yaw);
    const pen = this.pen;
    for (const off of [-1.4, 0, 1.4]) {
      for (const it of items) {
        const cx = v.x + fx * off;
        const cz = v.z + fz * off;
        if (!StaticColliders.penetration(it, cx, cz, 0.95, pen)) continue;
        const impact = v.collide(pen.nx, pen.nz, pen.depth, off);
        if (impact > 1.5) this.#impact(impact, cx - pen.nx * 0.95, v.y, cz - pen.nz * 0.95, pen.nx, pen.nz);
      }
    }
  }

  #collideCars() {
    const v = this.vehicle;
    const circles = (c, out) => {
      const fx = Math.sin(c.yaw);
      const fz = Math.cos(c.yaw);
      out[0] = c.x - fx * 1.35;
      out[1] = c.z - fz * 1.35;
      out[2] = c.x;
      out[3] = c.z;
      out[4] = c.x + fx * 1.35;
      out[5] = c.z + fz * 1.35;
      return out;
    };
    const A = new Float32Array(6);
    const B = new Float32Array(6);
    const cars = [v, ...this.ai];
    for (let i = 0; i < cars.length; i++) {
      for (let j = i + 1; j < cars.length; j++) {
        const a = cars[i];
        const b = cars[j];
        if (Math.abs(a.x - b.x) > 6 || Math.abs(a.z - b.z) > 6 || Math.abs(a.y - b.y) > 3) continue;
        circles(a, A);
        circles(b, B);
        let best = null;
        for (let p = 0; p < 3; p++) {
          for (let q = 0; q < 3; q++) {
            const dx = A[p * 2] - B[q * 2];
            const dz = A[p * 2 + 1] - B[q * 2 + 1];
            const d = Math.hypot(dx, dz);
            const depth = 1.9 - d;
            if (depth > 0 && (!best || depth > best.depth)) best = { nx: d > 1e-4 ? dx / d : 1, nz: d > 1e-4 ? dz / d : 0, depth, p, cx: (A[p * 2] + B[q * 2]) / 2, cz: (A[p * 2 + 1] + B[q * 2 + 1]) / 2 };
          }
        }
        if (!best) continue;
        const { nx, nz, depth } = best;
        a.x += (nx * depth) / 2;
        a.z += (nz * depth) / 2;
        b.x -= (nx * depth) / 2;
        b.z -= (nz * depth) / 2;
        const avx = a.vx;
        const avz = a.vz;
        const bvx = b.vx;
        const bvz = b.vz;
        const rel = (avx - bvx) * nx + (avz - bvz) * nz;
        if (rel >= 0) continue;
        const imp = (-(1 + 0.3) * rel) / 2;
        const applyTo = (car, sign) => {
          if (car instanceof Vehicle) {
            car.vx += nx * imp * sign;
            car.vz += nz * imp * sign;
            car.yawRate += (Math.random() - 0.5) * imp * 0.04;
          } else {
            const nvx = car.vx + nx * imp * sign;
            const nvz = car.vz + nz * imp * sign;
            car.speed = Math.max(0, nvx * Math.sin(car.yaw) + nvz * Math.cos(car.yaw));
            car.yaw += (Math.random() - 0.5) * 0.02 * imp;
            car.bump = 0.6;
          }
        };
        applyTo(a, 1);
        applyTo(b, -1);
        if ((a === v || b === v) && -rel > 1.5) this.#impact(-rel, best.cx, v.y, best.cz, a === v ? nx : -nx, a === v ? nz : -nz);
      }
    }
  }

  #impact(strength, x, y, z, nx, nz) {
    const now = performance.now();
    if (now - (this.lastImpact || 0) < 120) return;
    this.lastImpact = now;
    this.audio.crash(strength);
    this.rig.addShake(Math.min(1, strength / 18));
    this.effects.sparkBurst(x, y, z, nx, nz, strength);
    if (this.mode === 'free' && strength > 4) this.skills.crash();
    else if (this.drift.active && this.drift.points > 50) this.hud.message('Drift verloren', 1.2, 'warn');
    this.drift.active = false;
    this.drift.points = 0;
    this.drift.timer = 0;
  }

  #respawn() {
    const pose = this.openWorld?.respawnPose();
    if (pose) {
      this.placeCar(pose.x, pose.z, pose.heading);
      this.hud.message('Zurück zum letzten Tor', 1, 'info');
      return;
    }
    const v = this.vehicle;
    const tr = this.data.track;
    let q = tr.nearest(v.x, v.z, this.playerIdx, {});
    if (q.index < 0) q = tr.nearest(v.x, v.z, tr.indexOf(v.x, v.z), {});
    // In the open world the nearest road may be a branch (touge, lake road, gravel road).
    if (this.mode === 'free') {
      let best = null;
      for (const road of this.data.branches) {
        const b = road.nearest(v.x, v.z, -1, {}, 8);
        if (b.index >= 0 && (!best || b.dist < best.q.dist)) best = { road, q: b };
      }
      if (best && (q.index < 0 || best.q.dist < q.dist)) {
        const { road, q: b } = best;
        // Keep the direction of travel along the road.
        const fwd = Math.sin(v.yaw) * b.tx + Math.cos(v.yaw) * b.tz >= 0;
        const s = clamp(b.s, 12, road.length - 12);
        const p = road.pointAt(s, clamp(b.lateral, -2, 2), {});
        this.placeCar(p.x, p.z, fwd ? p.heading : p.heading + Math.PI);
        this.hud.message('Zurück auf die Straße', 1, 'info');
        return;
      }
    }
    const s = q.index >= 0 ? q.s : tr.startS;
    const lateral = q.index >= 0 ? clamp(q.lateral, -3, 3) : 0;
    this.#placeVehicle(s, lateral);
    this.effects.trails.clear();
    this.hud.message('Zurück auf der Strecke', 1, 'info');
  }

  // ------------------------------------------------------------------ race logic
  #updateRace(dt) {
    const race = this.race;
    if (!race) return;
    const tr = this.data.track;
    const L = tr.length;
    if (this.state === 'countdown') {
      race.countdown += dt;
      const lights = Math.min(5, Math.floor(race.countdown / 0.8));
      if (lights !== race.lightsOn && race.countdown < race.goAt) {
        race.lightsOn = lights;
        this.world.setStartLights(lights);
        if (lights > 0) {
          this.audio.beep(false);
          this.hud.message(String(6 - lights), 0.7);
        }
      }
      if (race.countdown >= race.goAt) {
        this.state = 'running';
        race.started = true;
        this.world.setStartLights('green');
        this.audio.beep(true);
        this.hud.message('Los!', 1, 'go');
        this.vehicle.gear = 1;
        this.greenTimer = 3;
      }
      return;
    }
    if (this.greenTimer > 0) {
      this.greenTimer -= dt;
      if (this.greenTimer <= 0) this.world.setStartLights('off');
    }
    race.time += dt;

    // Player track position
    const v = this.vehicle;
    const q = tr.nearest(v.x, v.z, this.playerIdx, this.playerQ);
    if (q.index >= 0) this.playerIdx = q.index;

    for (const e of race.entries) {
      let s;
      let valid = true;
      if (e.player) {
        s = q.index >= 0 ? q.s : null;
        valid = q.index >= 0 && q.dist < 60;
      } else s = e.obj.s;
      if (s === null || !valid) continue;
      const rs = tr.wrapS(s - tr.startS);
      if (e.prevS !== null) {
        if (e.prevS > L * 0.75 && rs < L * 0.25) {
          // Crossed the line forwards
          if (e.mask === 0x3ff) {
            if (e.lap >= 1) {
              const lapTime = race.time - e.lapStart;
              e.lastLap = lapTime;
              e.bestLap = Math.min(e.bestLap, lapTime);
              if (e.player) this.#onPlayerLap(lapTime);
            }
            e.lap++;
            e.lapStart = race.time;
            if (e.lap > race.laps && !e.finished) {
              e.finished = true;
              e.finishTime = race.time;
              e.finishOrder = ++race.finishOrder;
              if (e.player) this.#onPlayerFinish(e);
            } else if (e.player && this.mode === 'race' && e.lap === race.laps && race.laps > 1) this.hud.message('Letzte Runde', 1.6, 'info');
          }
          e.mask = 1;
        } else if (e.prevS < L * 0.25 && rs > L * 0.75) {
          // Crossed backwards: this lap has to be driven again
          e.mask = 0x3ff;
          if (e.lap > 0) e.lap--;
        }
      }
      e.mask |= 1 << Math.min(9, Math.floor((rs / L) * 10));
      e.prevS = rs;
      e.progress = e.lap * L + rs;
    }

    // Wrong-way warning
    if (this.mode !== 'free' && q.index >= 0 && q.dist < 30) {
      const fwd = Math.sin(v.yaw) * q.tx + Math.cos(v.yaw) * q.tz;
      if (fwd < -0.3 && v.speed > 6) this.wrongWay += dt;
      else this.wrongWay = 0;
      if (this.wrongWay > 1.2) {
        this.hud.message('Falsche Richtung', 1.2, 'warn');
        this.wrongWay = -1;
      }
    }
  }

  #positions() {
    const list = [...this.race.entries];
    list.sort((a, b) => {
      if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.progress - a.progress;
    });
    return list;
  }

  #onPlayerLap(t) {
    if (t < this.bestLap) {
      const first = !Number.isFinite(this.bestLap);
      this.bestLap = t;
      storeBest(t);
      this.hud.message(first ? `Runde ${formatTime(t)}` : 'Neue Bestzeit!', 1.8, 'go');
      this.audio.chime();
    } else this.hud.message(formatTime(t), 1.5, 'info');
  }

  #onPlayerFinish(e) {
    if (this.mode !== 'race') return;
    const pos = this.#positions().indexOf(e) + 1;
    this.state = 'finished';
    this.hud.message(pos === 1 ? 'Sieg!' : `Platz ${pos}`, 2.5, pos === 1 ? 'go' : 'info');
    this.audio.chime();
    this.resultsShown = false;
    setTimeout(() => this.#showResults(), 3200);
  }

  #showResults() {
    if (this.state !== 'finished') return;
    this.resultsShown = true;
    const body = document.getElementById('results-body');
    body.textContent = '';
    const list = this.#positions();
    const L = this.data.track.length;
    const leader = list[0];
    list.forEach((e, i) => {
      const tr = document.createElement('tr');
      if (e.player) tr.className = 'me';
      let time;
      const gap = (t) => `+${t.toFixed(3).replace('.', ',')} s`;
      if (e.finished) time = i === 0 ? formatTime(e.finishTime) : gap(e.finishTime - leader.finishTime);
      else {
        // Still racing: estimate the arrival from the remaining distance and average pace.
        const remaining = (this.race.laps + 1) * L - e.progress;
        const pace = Math.max(20, (e.progress - e.startProgress) / Math.max(1, this.race.time));
        const eta = this.race.time + remaining / pace;
        time = `≈ ${gap(Math.max(0, eta - (leader.finished ? leader.finishTime : eta)))}`;
      }
      const cells = [String(i + 1), e.name, time, Number.isFinite(e.bestLap) ? formatTime(e.bestLap) : '–'];
      cells.forEach((c, k) => {
        const td = document.createElement('td');
        if (k === 1) {
          const dot = document.createElement('span');
          dot.className = 'dot';
          dot.style.background = e.color;
          td.appendChild(dot);
          td.appendChild(document.createTextNode(c));
        } else td.textContent = c;
        if (k >= 2) td.className = 't';
        tr.appendChild(td);
      });
      body.appendChild(tr);
    });
    const me = list.findIndex((e) => e.player) + 1;
    document.getElementById('results-title').textContent = me === 1 ? 'Sieg!' : `Platz ${me} von ${list.length}`;
    document.getElementById('results').hidden = false;
  }

  // ------------------------------------------------------------------ drift scoring (free mode)
  #updateDrift(dt) {
    const v = this.vehicle;
    const d = this.drift;
    const ang = Math.abs(v.driftAngle) * 57.3;
    d.delta = 0;
    if (v.onGround && v.speed > 9 && ang > 12 && ang < 110 && this.respawnTimer <= 0) {
      d.active = true;
      d.timer += dt;
      d.idle = 0;
      d.mult = Math.min(5, 1 + Math.floor(d.timer / 2));
      d.delta = ang * v.speed * dt * 0.6 * d.mult;
      d.points += d.delta;
    } else if (d.active) {
      d.idle += dt;
      if (d.idle > 0.8) {
        d.total += d.points;
        d.active = false;
        d.points = 0;
        d.timer = 0;
        d.mult = 1;
      }
    }
  }

  // ------------------------------------------------------------------ taps and per-frame UI
  #handleTaps() {
    const inp = this.input;
    if (this.state === 'map') {
      // Map open: M, Esc/Start and B close it, everything else belongs to the map.
      if (inp.consume('map') || inp.consume('pause') || inp.consume('reset')) this.closeMap();
      return;
    }
    if (this.state === 'photo') {
      if (inp.consume('photo') || inp.consume('pause') || inp.consume('reset')) this.closePhoto();
      inp.clearTaps();
      return;
    }
    if (inp.consume('photo')) {
      this.openPhoto();
      return;
    }
    if (inp.consume('pause')) {
      if (this.state === 'paused') this.resume();
      else if (this.state === 'running' || this.state === 'countdown') this.pause();
    }
    if (this.state === 'menu' || this.state === 'loading') {
      inp.clearTaps();
      return;
    }
    if (inp.consume('camera')) this.#cycleCamera();
    if (inp.consume('lights')) {
      this.headlightsManual = !this.#headlightsOn();
      this.#applyLights();
      this.#toast(`Licht ${this.#headlightsOn() ? 'an' : 'aus'}`);
    }
    if (inp.consume('map')) {
      if (this.mode === 'free') this.openMap();
      else this.hud.bigMap = !this.hud.bigMap;
    }
    if (inp.consume('reset') && this.state === 'running' && this.respawnTimer <= 0) this.#respawn();
  }

  #updateEffects(dt) {
    const v = this.vehicle;
    const night = this.world.night > 0.9;
    const sn = Math.sin(v.yaw);
    const cs = Math.cos(v.yaw);
    for (let w = 2; w < 4; w++) {
      const [fo, lo] = v.wheelOffsets[w];
      const x = v.x + sn * fo + cs * lo;
      const z = v.z + cs * fo - sn * lo;
      const y = v.wheelHeights[w];
      const surf = v.wheelSurface[w];
      const asphalt = surf === 0;
      const skid = v.onGround ? v.skid : 0;
      this.effects.skid(w, x, y, z, v.yaw, asphalt && v.onGround, skid);
      if (asphalt) this.effects.wheelEmit(x, y, z, v.vx, v.vz, skid > 0.25 ? skid : 0, 0, night);
      else if (v.onGround && v.speed > 6) this.effects.wheelEmit(x, y, z, v.vx, v.vz, clamp(v.speed / 30, 0, 1) * 0.6 + skid * 0.4, surf, night);
    }
    this.effects.update(dt);
  }

  #nearestTraffic() {
    let best = null;
    const v = this.vehicle;
    for (const a of this.ai) {
      const dx = a.x - v.x;
      const dz = a.z - v.z;
      const d = Math.hypot(dx, dz);
      if (!best || d < best.dist) {
        const side = dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw);
        best = { dist: d, rpm: a.rpm, pan: d > 0.1 ? -side / d : 0 };
      }
    }
    return best;
  }

  #updateHud(dt) {
    const v = this.vehicle;
    this.hud.drawGauge(v);
    if (this.frameCount % 2 === 0) {
      const cars = this.ai.map((a) => ({ x: a.x, z: a.z, color: a.color }));
      const markers = this.openWorld.enabled ? this.openWorld.markers() : [];
      if (this.gps.active) markers.push({ kind: 'waypoint', x: this.gps.target.x, z: this.gps.target.z, target: true });
      this.hud.drawMinimap(v, cars, markers, this.gps.active && this.gps.route ? this.gps.route.points : null, dt * 2);
    }
    if (this.mode === 'free') {
      this.hud.showSkills(this.skills, 3.2);
      if (this.levelShown !== this.career.xp) {
        this.levelShown = this.career.xp;
        this.hud.setLevel(this.career.levelProgress());
      }
    }
    const race = this.race;
    if (race) {
      const me = race.entries[0];
      const pos = this.mode === 'race' ? this.#positions().indexOf(me) + 1 : 1;
      const lapTime = me.lap >= 1 && race.started ? race.time - me.lapStart : 0;
      this.hud.setRace({
        mode: this.mode,
        position: pos,
        total: race.entries.length,
        lap: Math.max(1, me.lap),
        laps: race.laps,
        lapTime: this.state === 'finished' ? me.lastLap : lapTime,
        bestLap: this.mode === 'time' ? this.bestLap : me.bestLap,
      });
    }
    this.hud.update(dt);
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) document.getElementById('toast').hidden = true;
    }
    // In-car instrument cluster
    if (this.rig.mode === 'cockpit' && this.frameCount % 2 === 0 && this.playerModel.gaugeCanvas) {
      const c = this.playerModel.gaugeCanvas;
      drawGauge(c.getContext('2d'), c.width, c.height, { rpm: v.rpm, speed: v.speed, gear: v.gear, limiter: v.limiter > 0, cluster: true });
      this.playerModel.gaugeTex.needsUpdate = true;
    }
  }

  // ------------------------------------------------------------------ frame
  frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    this.tick(dt);
    const v = this.vehicle;
    // Test hook: a fixed camera (position, target) for automated overview screenshots.
    if (this.debugCamera) {
      const c = this.debugCamera;
      this.camera.position.set(c.pos[0], c.pos[1], c.pos[2]);
      this.camera.lookAt(c.look[0], c.look[1], c.look[2]);
      this.camera.fov = c.fov || 55;
      this.camera.far = 9000;
      this.camera.updateProjectionMatrix();
    }
    this.world.setShadowFocus(this.state === 'menu' ? v : { x: v.x + Math.sin(v.yaw) * 20, y: v.y, z: v.z + Math.cos(v.yaw) * 20 });
    this.world.update(dt, this.camera);
    if (this.speedPass) {
      const s = this.state === 'running' && QUALITY[this.settings.quality].speedBlur && this.rig.mode !== 'cockpit' ? clamp((v.speed - 38) / 45, 0, 1) * 0.9 : 0;
      this.speedPass.uniforms.uStrength.value = s;
    }
    // The world map covers the whole screen: no need to render the 3D scene behind it.
    if (this.state !== 'map') this.renderFrame(dt);
    this.#adaptResolution(dt);
  }

  renderFrame(dt = 0.016) {
    if (this.state === 'photo') {
      this.photo.apply(this.camera);
      if (this.speedPass) this.speedPass.uniforms.uStrength.value = 0;
    }
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  // Advance the game without rendering (used by automated tests to fast-forward).
  simulateFor(seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds; t += dt) this.tick(dt);
  }

  tick(dt) {
    this.frameCount++;
    this.input.poll();
    this.#handleTaps();
    const v = this.vehicle;
    if (this.state === 'map') {
      this.worldMap.gamepad(dt, this.input);
      return;
    }
    if (this.state === 'photo') return;

    if (this.state === 'menu') {
      this.rig.update(dt, v, this.cameraGround, { menu: true });
      this.playerModel.update(v);
    } else if (this.state === 'running' || this.state === 'countdown' || this.state === 'finished') {
      this.#simulate(dt);
      this.#updateRace(dt);
      if (this.mode === 'free') {
        this.#updateDrift(dt);
        this.openWorld.update(dt, v, this.playerQ);
        const traffic = this.ai.map((a) => ({ x: a.x, z: a.z, yaw: a.yaw, speed: a.speed }));
        this.skills.update(dt, v, traffic, this.drift.delta || 0, this.state === 'running' && !this.openWorld.holding && this.respawnTimer <= 0);
        this.gps.update(dt, v, true);
      }
      this.playerModel.update(v);
      const braking = v.gear > 0 ? v.brake : v.gear < 0 ? v.throttle : 0;
      this.playerModel.setLights({ headlights: this.#headlightsOn(), brake: braking > 0.05 ? 1 : 0, reverse: v.gear < 0 });
      for (const a of this.ai) {
        a.model.update(a);
        a.model.setLights({ headlights: this.world.night > 0, brake: a.brake > 0.1 ? 1 : 0 });
      }
      this.#updateEffects(dt);
      this.rig.update(dt, v, this.cameraGround, { lookBack: this.input.state.lookBack });
      const onCurb = this.#onCurb();
      this.audio.update(dt, v, { interior: this.rig.interior, onCurb, horn: this.input.state.horn, traffic: this.#nearestTraffic() });
      this.#updateHud(dt);
    }
  }

  #onCurb() {
    const q = this.playerQ;
    const tr = this.data.track;
    if (!q || q.index < 0 || !tr.curbFlags || !tr.curbFlags[q.index]) return false;
    const l = Math.abs(q.lateral);
    return l > ROAD.half - 1.6 && l < ROAD.half + 0.9;
  }

  #adaptResolution(dt) {
    if (navigator.webdriver) return; // keep automated screenshots deterministic
    const f = this.fps;
    f.time += dt;
    f.frames++;
    if (f.time < 2) return;
    f.value = f.frames / f.time;
    f.time = 0;
    f.frames = 0;
    if (this.state !== 'running') return;
    let pr = this.pixelRatio;
    // Trade resolution for frame rate, but never drop so far that the image turns to mush.
    const floor = Math.min(this.maxPixelRatio, 0.85);
    if (f.value < 40 && pr > floor) pr = Math.max(floor, pr - 0.1);
    else if (f.value > 55 && pr < this.maxPixelRatio) pr = Math.min(this.maxPixelRatio, pr + 0.1);
    if (Math.abs(pr - this.pixelRatio) > 0.01) {
      this.pixelRatio = pr;
      this.renderer.setPixelRatio(pr);
      this.#onResize();
    }
  }

  #onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
    this.effects?.setViewportHeight(h * this.renderer.getPixelRatio(), this.camera.fov);
  }
}

const game = new Game();
window.__nordkamm = game;
const boot = () => game.boot().catch((e) => {
  console.error(e);
  const box = document.getElementById('error');
  document.getElementById('error-text').textContent = `Beim Laden ist ein Fehler aufgetreten: ${e.message}`;
  document.getElementById('loading').hidden = true;
  box.hidden = false;
});
if (window.claude?.hot?.ready) window.claude.hot.ready(() => boot());
else boot();
