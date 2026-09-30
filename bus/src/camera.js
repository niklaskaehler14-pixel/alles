// Camera modes: driver's seat (look around), chase, free orbit, top view and right mirror.
import * as THREE from 'three';
import { clamp, damp, wrapAngle } from './util.js';

export const CAMERA_MODES = ['cockpit', 'chase', 'orbit', 'top', 'door'];
export const CAMERA_LABELS = { cockpit: 'Fahrersitz', chase: 'Verfolger', orbit: 'Frei', top: 'Von oben', door: 'Türseite' };

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'cockpit';
    this.lookYaw = 0;
    this.lookPitch = -0.2;
    this.orbitYaw = 2.4;
    this.orbitPitch = 0.45;
    this.orbitDist = 26;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.tmp = new THREE.Vector3();
    this.smoothYaw = null;
    this.autoLook = 0;
  }

  set(mode) {
    this.mode = mode;
    this.smoothYaw = null;
    this.snap = true; // jump straight to the new view instead of flying there
    this.camera.fov = mode === 'cockpit' ? 72 : 55;
    this.camera.near = mode === 'cockpit' ? 0.08 : 0.25;
    this.camera.updateProjectionMatrix();
  }

  next() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.set(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  // look: {dx, dy} from pointer drags (consumed here).
  update(dt, bus, model, look, { steer = 0, turnLook = true } = {}) {
    const cam = this.camera;
    const yaw = bus.yaw;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const len = bus.spec.length;
    if (this.mode === 'cockpit') {
      this.lookYaw = clamp(this.lookYaw - look.dx * 0.004, -2.4, 2.4);
      this.lookPitch = clamp(this.lookPitch - look.dy * 0.003, -0.7, 0.5);
      // Glance into the turn a little when steering hard at low speed.
      const want = turnLook ? clamp(steer * 0.35, -0.35, 0.35) * (Math.abs(bus.u) < 6 ? 1 : 0.3) : 0;
      this.autoLook = damp(this.autoLook, want, 2.5, dt);
      model.body.updateMatrixWorld(true);
      model.driverEye.getWorldPosition(this.pos);
      cam.position.copy(this.pos);
      const ay = yaw + this.lookYaw + this.autoLook;
      const pitch = this.lookPitch - bus.pitch * 0.5;
      this.target.set(this.pos.x + Math.sin(ay) * Math.cos(pitch), this.pos.y + Math.sin(pitch), this.pos.z + Math.cos(ay) * Math.cos(pitch));
      cam.up.set(Math.cos(yaw) * bus.roll * 0.4, 1, -Math.sin(yaw) * bus.roll * 0.4).normalize();
      cam.lookAt(this.target);
      cam.up.set(0, 1, 0);
    } else if (this.mode === 'chase') {
      if (this.smoothYaw === null) this.smoothYaw = yaw;
      this.smoothYaw += wrapAngle(yaw - this.smoothYaw) * (1 - Math.exp(-dt * 2.2));
      const sy = Math.sin(this.smoothYaw);
      const sc = Math.cos(this.smoothYaw);
      const back = len * 1.1 + 6 + (look.zoom || 0) * 1.5;
      const center = bus.localToWorld(0, bus.geo.center);
      this.pos.set(center[0] - sy * back, 6.2 + back * 0.12, center[1] - sc * back);
      this.#avoidBuildings(center);
      if (this.snap) cam.position.copy(this.pos);
      else cam.position.lerp(this.pos, 1 - Math.exp(-dt * 6));
      this.snap = false;
      this.target.set(center[0] + fx * 8, 1.8, center[1] + fz * 8);
      cam.lookAt(this.target);
    } else if (this.mode === 'orbit') {
      this.orbitYaw -= look.dx * 0.006;
      this.orbitPitch = clamp(this.orbitPitch + look.dy * 0.004, 0.05, 1.45);
      this.orbitDist = clamp(this.orbitDist + (look.zoom || 0) * 2, 8, 70);
      look.zoom = 0;
      const center = bus.localToWorld(0, bus.geo.center);
      const a = yaw + this.orbitYaw;
      const d = this.orbitDist;
      this.pos.set(center[0] + Math.sin(a) * Math.cos(this.orbitPitch) * d, 1.5 + Math.sin(this.orbitPitch) * d, center[1] + Math.cos(a) * Math.cos(this.orbitPitch) * d);
      this.#avoidBuildings(center);
      cam.position.copy(this.pos);
      cam.lookAt(center[0], 1.4, center[1]);
    } else if (this.mode === 'top') {
      const center = bus.localToWorld(0, bus.geo.center + 2);
      const h = 34 + (look.zoom || 0) * 3;
      cam.position.set(center[0] - fx * 6, h, center[1] - fz * 6);
      cam.up.set(fx, 0, fz);
      cam.lookAt(center[0] + fx * 2, 0, center[1] + fz * 2);
      cam.up.set(0, 1, 0);
    } else if (this.mode === 'door') {
      // Right side, looking back along the doors (like the right mirror).
      const p = bus.localToWorld(-bus.spec.width / 2 - 1.6, bus.geo.front + 1.2);
      cam.position.set(p[0], 2.6, p[1]);
      const q = bus.localToWorld(-bus.spec.width / 2 - 0.3, bus.geo.front - len);
      cam.lookAt(q[0], 0.6, q[1]);
    }
    look.dx = 0;
    look.dy = 0;
  }

  // Keep the camera out of houses: pull it in along the line to the bus (and a bit up).
  // `blocked(x, z)` is set by the game (building footprints).
  #avoidBuildings(center) {
    if (!this.blocked) return;
    const cx = center[0];
    const cz = center[1];
    let t = 1;
    for (let k = 1; k <= 12; k++) {
      const f = k / 12;
      if (this.blocked(cx + (this.pos.x - cx) * f, cz + (this.pos.z - cz) * f)) {
        t = Math.max(0.2, (k - 1.5) / 12);
        break;
      }
    }
    if (t < 1) {
      this.pos.x = cx + (this.pos.x - cx) * t;
      this.pos.z = cz + (this.pos.z - cz) * t;
      this.pos.y += (1 - t) * 5;
    }
  }

  resetLook() {
    this.lookYaw = 0;
    this.lookPitch = -0.2;
  }
}
