// Sky, sun, haze, shadows and the time of day. The world is drawn in two passes: first the
// far landscape (sky, hills, suburbs) with its own depth range, then the town on top.
import * as THREE from 'three';

// Aerial perspective instead of a hard fog wall: the haze grows with distance but never
// swallows everything, so mountains 8 km away still show as hazy blue silhouettes.
// Fog.near = where the haze starts, Fog.far = its e-folding distance.
THREE.ShaderChunk.fog_fragment = `
#ifdef USE_FOG
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  #else
    float fogFactor = 0.9 * ( 1.0 - exp( - max( vFogDepth - fogNear, 0.0 ) / fogFar ) );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;

export const SKIES = {
  morning: { haze: 1700, sunElev: 13, sunAz: 105, sun: '#ffd7a8', sunI: 2.4, hemiSky: '#bcd4f0', hemiGround: '#5d5a48', hemiI: 0.75, top: '#5f93d1', horizon: '#f6d8b8', fog: '#d9d4cc', exposure: 0.62, night: 0, clouds: 0.35, env: 0.8 },
  day: { haze: 2600, sunElev: 52, sunAz: 195, sun: '#fff4e2', sunI: 2.9, hemiSky: '#c7dcf5', hemiGround: '#55584a', hemiI: 0.85, top: '#3b78c9', horizon: '#c6ddef', fog: '#c9d8e4', exposure: 0.55, night: 0, clouds: 0.45, env: 0.9 },
  evening: { haze: 2100, sunElev: 5, sunAz: 262, sun: '#ffab66', sunI: 2.3, hemiSky: '#f0b894', hemiGround: '#40382f', hemiI: 0.6, top: '#4a5e9a', horizon: '#ffb07a', fog: '#d7a98d', exposure: 0.62, night: 0.35, clouds: 0.5, env: 0.8 },
  night: { haze: 2400, sunElev: 38, sunAz: 150, sun: '#9fb4ff', sunI: 0.32, hemiSky: '#34466b', hemiGround: '#111318', hemiI: 0.6, top: '#050a18', horizon: '#1b2744', fog: '#141b2b', exposure: 0.85, night: 1, clouds: 0.3, env: 0.35 },
};

const SKY_VS = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w * 0.99999; // at the far plane
}`;

const SKY_FS = `
uniform vec3 uSun; uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSunColor;
uniform float uNight; uniform float uTime; uniform float uClouds;
varying vec3 vDir;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a*noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uTop, pow(h, 0.45));
  // Sun (or moon) disc and glow.
  float mu = max(dot(d, normalize(uSun)), 0.0);
  col += uSunColor * (pow(mu, 900.0) * (uNight > 0.5 ? 3.0 : 18.0) + pow(mu, 12.0) * 0.35 * (1.0 - uNight * 0.7));
  // Clouds on a plane high above.
  if (d.y > 0.02) {
    vec2 uv = d.xz / (d.y + 0.08) * 1.4 + vec2(uTime * 0.004, uTime * 0.0015);
    float c = smoothstep(0.55 - uClouds * 0.35, 0.95, fbm(uv));
    vec3 cloudCol = mix(vec3(1.0), uHorizon * 1.05, 0.35) * (1.0 - uNight * 0.82);
    col = mix(col, cloudCol, c * smoothstep(0.02, 0.25, d.y) * 0.85);
  }
  // Stars at night.
  if (uNight > 0.5 && d.y > 0.0) {
    vec2 g = floor(d.xz / (d.y + 0.2) * 220.0);
    float s = hash(g);
    col += vec3(step(0.9975, s)) * (0.6 + 0.4 * sin(uTime * 2.0 + s * 50.0)) * smoothstep(0.05, 0.4, d.y);
  }
  // Below the horizon: fade into the ground haze.
  if (d.y < 0.0) col = mix(uHorizon, uHorizon * 0.6, clamp(-d.y * 4.0, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Environment {
  constructor(renderer, scene, { shadows = 2048 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    // Far pass: sky and landscape, with its own lights and a deep depth range.
    this.back = new THREE.Scene();
    this.backCam = new THREE.PerspectiveCamera(60, 1, 15, 24000);
    this.skyUniforms = {
      uSun: { value: new THREE.Vector3(0, 1, 0) },
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uSunColor: { value: new THREE.Color() },
      uNight: { value: 0 },
      uTime: { value: 0 },
      uClouds: { value: 0.4 },
    };
    const skyMat = new THREE.ShaderMaterial({ uniforms: this.skyUniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), skyMat);
    this.sky.scale.setScalar(4000);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.back.add(this.sky);
    this.backHemi = new THREE.HemisphereLight('#ffffff', '#444444', 0.8);
    this.backSun = new THREE.DirectionalLight('#ffffff', 2.5);
    this.back.add(this.backHemi, this.backSun, this.backSun.target);

    this.hemi = new THREE.HemisphereLight('#ffffff', '#444444', 0.8);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#ffffff', 2.5);
    this.sun.castShadow = shadows > 0;
    if (shadows > 0) {
      this.sun.shadow.mapSize.set(shadows, shadows);
      const cam = this.sun.shadow.camera;
      const ext = 75;
      cam.left = -ext;
      cam.right = ext;
      cam.top = ext;
      cam.bottom = -ext;
      cam.near = 1;
      cam.far = 500;
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
      this.shadowExtent = ext;
    }
    scene.add(this.sun);
    scene.add(this.sun.target);
    scene.fog = new THREE.Fog('#ffffff', 150, 2600);
    this.back.fog = new THREE.Fog('#ffffff', 150, 2600);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sunDir = new THREE.Vector3();
  }

  // Landscape meshes (backdrop.js) go into the far pass.
  addBackdrop(obj) {
    this.back.add(obj);
  }

  set(name) {
    const p = SKIES[name] || SKIES.day;
    this.preset = p;
    this.name = name;
    const el = THREE.MathUtils.degToRad(p.sunElev);
    const az = THREE.MathUtils.degToRad(p.sunAz);
    // Azimuth measured from north (−z) clockwise towards east (+x).
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    const u = this.skyUniforms;
    u.uSun.value.copy(this.sunDir);
    u.uTop.value.set(p.top);
    u.uHorizon.value.set(p.horizon);
    u.uSunColor.value.set(p.sun);
    u.uNight.value = p.night >= 1 ? 1 : 0;
    u.uClouds.value = p.clouds;
    for (const [sun, hemi] of [
      [this.sun, this.hemi],
      [this.backSun, this.backHemi],
    ]) {
      sun.color.set(p.sun);
      sun.intensity = p.sunI;
      hemi.color.set(p.hemiSky);
      hemi.groundColor.set(p.hemiGround);
      hemi.intensity = p.hemiI;
    }
    this.backSun.position.copy(this.sunDir).multiplyScalar(1000);
    this.backSun.target.position.set(0, 0, 0);
    for (const f of [this.scene.fog, this.back.fog]) {
      f.color.set(p.fog);
      f.near = 150;
      f.far = p.haze;
    }
    this.renderer.toneMappingExposure = p.exposure;
    this.night = p.night;
    // Environment map for reflections (bus paint, glass, water).
    const envScene = new THREE.Scene();
    const envSky = this.sky.clone();
    envSky.material = this.sky.material.clone();
    envSky.material.uniforms = THREE.UniformsUtils.clone(this.skyUniforms);
    envSky.scale.setScalar(100);
    envScene.add(envSky);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(100, 16), new THREE.MeshBasicMaterial({ color: p.night >= 1 ? '#0b0c10' : '#525c4c' }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -1;
    envScene.add(ground);
    if (this.envRT) this.envRT.dispose();
    this.envRT = this.pmrem.fromScene(envScene, 0.02, 0.1, 300);
    for (const sc of [this.scene, this.back]) {
      sc.environment = this.envRT.texture;
      sc.environmentIntensity = p.env;
    }
  }

  // Keep the shadow box and the sky around the focus point.
  update(dt, t, focus, camera) {
    this.skyUniforms.uTime.value = t;
    this.sky.position.copy(camera.position);
    const ext = this.shadowExtent || 75;
    // Snap to the shadow texel grid to avoid shimmering.
    const step = (ext * 2) / (this.sun.shadow.mapSize.x || 1024);
    const fx = Math.round(focus.x / step) * step;
    const fz = Math.round(focus.z / step) * step;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 200, this.sunDir.y * 200, fz + this.sunDir.z * 200);
  }

  // Draw the landscape, then the town over it (into `target`, or the screen).
  render(camera, target = null) {
    const r = this.renderer;
    const bc = this.backCam;
    camera.updateMatrixWorld();
    if (bc.fov !== camera.fov || bc.aspect !== camera.aspect) {
      bc.fov = camera.fov;
      bc.aspect = camera.aspect;
      bc.updateProjectionMatrix();
    }
    bc.position.copy(camera.position);
    bc.quaternion.copy(camera.quaternion);
    bc.updateMatrixWorld();
    this.sky.position.copy(camera.position);
    r.setRenderTarget(target);
    r.autoClear = false;
    r.clear(true, true, true);
    r.render(this.back, bc);
    r.clearDepth();
    r.render(this.scene, camera);
  }
}
