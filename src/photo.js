// Photo mode: the game freezes, the HUD disappears and a free orbit camera frames the car.
// Drag to orbit, wheel or pinch to change the distance, a slider for the field of view.
import { clamp } from './util.js';

export class PhotoMode {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('photo');
    this.active = false;
    this.yaw = 0;
    this.pitch = 0.18;
    this.dist = 7;
    this.fov = 45;
    this.height = 0.8;
    this.pointers = new Map();
    this.$ = (id) => document.getElementById(id);
    this.#bind();
  }

  open() {
    const g = this.game;
    this.active = true;
    this.root.hidden = false;
    document.getElementById('hud').hidden = true;
    document.getElementById('touch').hidden = true;
    // Start behind the car, slightly to the side.
    this.yaw = g.vehicle.yaw + Math.PI + 0.55;
    this.pitch = 0.16;
    this.dist = 7.5;
    this.fov = 45;
    this.$('photo-fov').value = String(this.fov);
    this.$('photo-shot').hidden = true;
  }

  close() {
    this.active = false;
    this.root.hidden = true;
    this.pointers.clear();
    document.getElementById('hud').hidden = false;
    document.getElementById('touch').hidden = !document.body.classList.contains('touch');
  }

  // Places the camera for this frame (called instead of the chase camera).
  apply(camera) {
    const v = this.game.vehicle;
    const cy = (v.renderY ?? v.y) + this.height;
    const cp = Math.cos(this.pitch);
    const x = v.x + Math.sin(this.yaw) * cp * this.dist;
    const z = v.z + Math.cos(this.yaw) * cp * this.dist;
    // Never below the ground.
    const y = Math.max(cy + Math.sin(this.pitch) * this.dist, this.game.cameraGround(x, z) + 0.4);
    camera.position.set(x, y, z);
    camera.up.set(0, 1, 0);
    camera.lookAt(v.x, cy, v.z);
    camera.fov = this.fov;
    camera.near = 0.1;
    camera.updateProjectionMatrix();
  }

  // Renders one frame and returns it as a JPEG data URL (the drawing buffer is read right away).
  capture() {
    const g = this.game;
    g.renderFrame();
    try {
      return g.renderer.domElement.toDataURL('image/jpeg', 0.92);
    } catch {
      return null;
    }
  }

  #bind() {
    const surface = this.$('photo-surface');
    surface.addEventListener('pointerdown', (e) => {
      surface.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinch = this.pointers.size === 2 ? this.#spread() : 0;
    });
    surface.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      if (this.pointers.size === 2) {
        p.x = e.clientX;
        p.y = e.clientY;
        const d = this.#spread();
        if (this.pinch > 0) this.dist = clamp(this.dist * (this.pinch / d), 2.5, 30);
        this.pinch = d;
        return;
      }
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this.yaw -= dx * 0.008;
      this.pitch = clamp(this.pitch + dy * 0.006, -0.05, 1.35);
    });
    const end = (e) => {
      this.pointers.delete(e.pointerId);
      this.pinch = 0;
    };
    surface.addEventListener('pointerup', end);
    surface.addEventListener('pointercancel', end);
    surface.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.dist = clamp(this.dist * Math.exp(e.deltaY * 0.0012), 2.5, 30);
      },
      { passive: false },
    );
    this.$('photo-fov').addEventListener('input', (e) => (this.fov = Number(e.target.value)));
    this.$('photo-close').addEventListener('click', () => this.game.closePhoto());
    this.$('photo-take').addEventListener('click', () => {
      const url = this.capture();
      if (!url) return;
      const img = this.$('photo-img');
      img.src = url;
      const link = this.$('photo-save');
      link.href = url;
      link.download = `nordkamm-foto-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.jpg`;
      this.$('photo-shot').hidden = false;
      this.game.audio.shutter();
    });
    this.$('photo-shot-close').addEventListener('click', () => (this.$('photo-shot').hidden = true));
  }

  #spread() {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }
}
