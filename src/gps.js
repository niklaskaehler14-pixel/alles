// GPS waypoint: route over the road network, a light beacon at the target and the navigation arrow.
import * as THREE from 'three';
import { RoadGraph } from './navigation.js';
import { clamp, wrapAngle } from './util.js';
import * as TX from './textures.js';
import { ICON_COLORS } from './maprender.js';

export class Gps {
  constructor(game) {
    this.game = game;
    this.graph = new RoadGraph(game.data);
    this.target = null; // { x, z, name }
    this.route = null; // { points, length }
    this.refresh = 0;
    this.q = {};
    // Beacon: a tall violet light column at the waypoint.
    const geo = new THREE.CylinderGeometry(2.2, 2.2, 220, 20, 1, true);
    geo.translate(0, 110, 0);
    this.beaconMat = new THREE.MeshBasicMaterial({
      color: ICON_COLORS.waypoint,
      map: TX.beamTexture(),
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    this.beacon = new THREE.Mesh(geo, this.beaconMat);
    this.beacon.visible = false;
    this.beacon.renderOrder = 6;
    game.scene.add(this.beacon);
    this.el = (id) => document.getElementById(id);
  }

  get active() {
    return !!this.target;
  }

  set(x, z, name = 'Wegpunkt') {
    this.target = { x, z, name };
    const q = this.game.data.track.nearest(x, z, -1, this.q);
    this.beacon.position.set(x, this.game.data.groundHeight(x, z, q), z);
    this.beacon.visible = true;
    this.#recompute();
  }

  clear() {
    this.target = null;
    this.route = null;
    this.beacon.visible = false;
    this.el('gps').hidden = true;
  }

  #recompute() {
    const v = this.game.vehicle;
    this.route = this.graph.route(v.x, v.z, this.target.x, this.target.z);
    this.refresh = 1.2;
  }

  // Remaining route from the car: drop the points already passed.
  #trim(v) {
    const pts = this.route.points;
    let best = 0;
    let bd = Infinity;
    const limit = Math.min(pts.length, 60);
    for (let i = 0; i < limit; i++) {
      const d = Math.hypot(pts[i][0] - v.x, pts[i][1] - v.z);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best > 0) pts.splice(0, best);
    return bd;
  }

  update(dt, v, enabled) {
    const box = this.el('gps');
    if (!this.target || !enabled) {
      box.hidden = true;
      this.beacon.visible = false;
      return;
    }
    this.beacon.visible = true;
    const cam = this.game.camera.position;
    const dCam = Math.hypot(this.beacon.position.x - cam.x, this.beacon.position.z - cam.z);
    this.beaconMat.opacity = 0.6 * clamp((dCam - 10) / 50, 0, 1);
    const dist = Math.hypot(this.target.x - v.x, this.target.z - v.z);
    if (dist < 22) {
      this.game.hud.message('Ziel erreicht', 1.4, 'go');
      this.game.audio.chime();
      this.clear();
      return;
    }
    this.refresh -= dt;
    const off = this.route ? this.#trim(v) : Infinity;
    if (!this.route || this.refresh <= 0 || off > 45) this.#recompute();
    // Arrow towards a point about 40 m ahead along the route.
    const pts = this.route.points;
    let aim = pts[pts.length - 1];
    let acc = 0;
    let px = v.x;
    let pz = v.z;
    for (const p of pts) {
      acc += Math.hypot(p[0] - px, p[1] - pz);
      px = p[0];
      pz = p[1];
      if (acc > 40) {
        aim = p;
        break;
      }
    }
    const rel = wrapAngle(Math.atan2(aim[0] - v.x, aim[1] - v.z) - v.yaw);
    box.hidden = false;
    this.el('gps-arrow').style.transform = `rotate(${(-rel * 180) / Math.PI}deg)`;
    let left = 0;
    px = v.x;
    pz = v.z;
    for (const p of pts) {
      left += Math.hypot(p[0] - px, p[1] - pz);
      px = p[0];
      pz = p[1];
    }
    this.el('gps-dist').textContent = left >= 1000 ? `${(left / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(left / 10) * 10} m`;
    this.el('gps-name').textContent = this.target.name;
  }
}
