// Camera rig: chase (near/far), cockpit, bonnet and a slow orbit for the menu.
import * as THREE from 'three';
import { clamp, damp, wrapAngle } from './util.js';

export const CAMERA_MODES = ['chase', 'far', 'cockpit', 'hood'];
export const CAMERA_LABELS = { chase: 'Verfolger', far: 'Verfolger weit', cockpit: 'Cockpit', hood: 'Motorhaube' };

export class CameraRig {
  constructor(camera) {
    this.camera = camera;
    this.mode = 'chase';
    this.heading = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.shake = 0;
    this.orbit = 0;
    this.initialised = false;
    this.headX = 0;
    this.headY = 0;
    this.headZ = 0;
    this.tmp = new THREE.Vector3();
  }

  setMode(mode) {
    this.mode = mode;
    this.initialised = false;
  }

  next() {
    const i = CAMERA_MODES.indexOf(this.mode);
    this.setMode(CAMERA_MODES[(i + 1) % CAMERA_MODES.length]);
    return this.mode;
  }

  get interior() {
    return this.mode === 'cockpit';
  }

  addShake(v) {
    this.shake = Math.min(1.2, this.shake + v);
  }

  // car: Vehicle state; model: CarModel (for cockpit attachment)
  update(dt, car, ground, { lookBack = false, menu = false } = {}) {
    const cam = this.camera;
    const speed = car.speed;
    const fwdX = Math.sin(car.yaw);
    const fwdZ = Math.cos(car.yaw);
    this.shake = Math.max(0, this.shake - dt * 2.5);
    const t = performance.now() / 1000;
    const rumble = (car.rumble || 0) * clamp(speed / 30, 0, 1) * 0.05 + clamp((speed - 45) / 40, 0, 1) * 0.012;
    const shakeAmp = this.shake * 0.12 + rumble;
    const sx = (Math.sin(t * 37.1) + Math.sin(t * 23.7)) * shakeAmp * 0.5;
    const sy = (Math.sin(t * 41.3) + Math.sin(t * 29.1)) * shakeAmp * 0.5;

    if (menu) {
      this.orbit += dt * 0.12;
      const r = 7.8;
      const a = car.yaw + 0.9 + this.orbit;
      const px = car.x + Math.sin(a) * r;
      const pz = car.z + Math.cos(a) * r;
      const gy = ground(px, pz);
      cam.position.set(px, Math.max(gy + 1.1, car.y + 1.4), pz);
      cam.lookAt(car.x, car.y + 0.75, car.z);
      cam.fov = 42;
      cam.near = 0.1;
      cam.updateProjectionMatrix();
      this.initialised = false;
      return;
    }

    if (this.mode === 'chase' || this.mode === 'far') {
      const far = this.mode === 'far';
      const dist = (far ? 8.8 : 6.1) + clamp(speed / 60, 0, 1) * (far ? 1.6 : 1.1);
      const height = far ? 2.9 : 2.05;
      // Follow the travel direction partly so drifts show the car's side.
      const forward = car.forwardSpeed > 2;
      const velHeading = forward ? Math.atan2(car.vx, car.vz) : car.yaw;
      const blend = clamp(speed / 12, 0, 1) * 0.55;
      let target = car.yaw + clamp(wrapAngle(velHeading - car.yaw), -0.9, 0.9) * blend;
      if (lookBack) target += Math.PI;
      if (!this.initialised) this.heading = target;
      this.heading += wrapAngle(target - this.heading) * (1 - Math.exp(-(lookBack ? 30 : 5.5) * dt));
      const hx = Math.sin(this.heading);
      const hz = Math.cos(this.heading);
      const wantX = car.x - hx * dist;
      const wantZ = car.z - hz * dist;
      let wantY = car.y + height;
      const gy = ground(wantX, wantZ);
      wantY = Math.max(wantY, gy + 1.2);
      if (!this.initialised) {
        this.pos.set(wantX, wantY, wantZ);
        this.initialised = true;
      }
      this.pos.x = damp(this.pos.x, wantX, 14, dt);
      this.pos.z = damp(this.pos.z, wantZ, 14, dt);
      this.pos.y = damp(this.pos.y, wantY, car.onGround ? 8 : 3, dt);
      cam.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
      this.look.set(car.x + fwdX * 2.2, car.y + (far ? 1.0 : 0.95), car.z + fwdZ * 2.2);
      cam.lookAt(this.look);
      cam.fov = damp(cam.fov, (far ? 58 : 62) + clamp(speed / 80, 0, 1) * 16, 4, dt);
      cam.near = 0.2;
    } else {
      // Cockpit and bonnet: attached to the car, with head motion from g-forces.
      const cockpit = this.mode === 'cockpit';
      const ax = clamp(car.axLocal / 9.81, -1.5, 1.5);
      const ay = clamp(car.ayLocal / 9.81, -1.5, 1.5);
      this.headX = damp(this.headX, -ay * (cockpit ? 0.035 : 0.01), 6, dt);
      this.headZ = damp(this.headZ, -ax * (cockpit ? 0.03 : 0.01), 6, dt);
      this.headY = damp(this.headY, 0, 6, dt);
      const local = cockpit ? [0.37 + this.headX, 1.07 + sy * 0.5, -0.52 + this.headZ] : [0, 1.13 + sy * 0.3, 0.55];
      const m = car.model ? car.model.chassis.matrixWorld : null;
      if (m) {
        car.model.root.updateMatrixWorld(true);
        this.tmp.set(local[0], local[1], local[2]).applyMatrix4(car.model.chassis.matrixWorld);
        cam.position.copy(this.tmp);
        const lookYaw = (lookBack ? Math.PI : 0) + (cockpit ? -car.steerAngle * 0.25 : 0);
        const lx = Math.sin(lookYaw) * 10;
        const lz = Math.cos(lookYaw) * 10;
        this.tmp.set(local[0] + lx, local[1] - (cockpit ? 0.62 : 0.55), local[2] + lz).applyMatrix4(car.model.chassis.matrixWorld);
        cam.up.set(0, 1, 0);
        cam.lookAt(this.tmp);
        // Keep the horizon tilted with the car body.
        const roll = (car.roll || 0) + (car.susRoll || 0);
        cam.rotateZ(-roll * 0.8);
      }
      cam.fov = damp(cam.fov, (cockpit ? 60 : 62) + clamp(speed / 80, 0, 1) * 7, 4, dt);
      cam.near = 0.05;
      this.initialised = false;
    }
    cam.updateProjectionMatrix();
  }
}
