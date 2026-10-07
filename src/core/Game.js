// Owns the renderer, scene and frame loop, and wires the gameplay systems.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { CONFIG, urlParam } from '../data/config.js';
import { Input } from './Input.js';
import { Events } from './Events.js';
import { Assets } from './Assets.js';
import { World } from '../world/World.js';

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, uVignette: { value: 0.32 }, uWarm: { value: 0.035 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uVignette; uniform float uWarm; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      // gentle warm split-tone: lift shadows toward teal, highlights toward amber
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb += vec3(uWarm, uWarm * 0.45, -uWarm) * smoothstep(0.25, 1.2, l);
      c.rgb += vec3(-0.01, 0.004, 0.012) * (1.0 - smoothstep(0.0, 0.35, l));
      vec2 d = vUv - 0.5; d.x *= 1.25;
      c.rgb *= 1.0 - uVignette * smoothstep(0.25, 0.85, length(d));
      // ordered noise dither hides 8-bit banding in the sky gradient
      c.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      gl_FragColor = c;
    }`,
};

export class Game {
  constructor(container) {
    this.container = container;
    const qName = urlParam('q', localStorage.getItem('cr.quality') || 'high');
    this.qualityName = CONFIG.quality[qName] ? qName : 'high';
    this.quality = CONFIG.quality[this.qualityName];

    const renderer = new THREE.WebGLRenderer({ antialias: !this.quality.post, powerPreference: 'high-performance', preserveDrawingBuffer: urlParam('shot') !== null });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatio));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.95;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, container.clientWidth / container.clientHeight, 0.05, 6000);
    this.input = new Input(renderer.domElement);
    this.events = new Events();
    this.assets = new Assets(renderer);
    this.clock = new THREE.Clock();
    this.time = 0;
    this.systems = [];
    this.paused = false;
    this.timeScale = 1;

    if (this.quality.post) this.setupComposer();
    window.addEventListener('resize', () => this.resize());
  }

  setupComposer() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: this.quality.msaa });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new OutputPass());
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.events.emit('resize', { w, h });
  }

  async loadWorld(progress) {
    await this.assets.loadModels(['rock1', 'rock2', 'rock3'], () => {});
    this.world = new World(this);
    await this.world.build(progress);
  }

  add(system) { this.systems.push(system); return system; }

  start() {
    this.clock.start();
    // ?step=1 (headless capture): frames are advanced explicitly via step().
    if (urlParam('step')) { this.manual = true; return; }
    const loop = () => {
      requestAnimationFrame(loop);
      this.frame();
    };
    loop();
  }

  /** Advance n frames of `dt` seconds each (used by automated play tests). */
  step(n = 1, dt = 1 / 30, render = true) {
    this.fixedDt = dt;
    for (let i = 0; i < n; i++) {
      this.skipRender = !render || i < n - 1;
      this.frame();
    }
    this.skipRender = false;
    this.fixedDt = null;
  }

  frame() {
    let dt = Math.min(this.clock.getDelta(), 0.1);
    if (this.fixedDt) dt = this.fixedDt;
    const sdt = this.paused ? 0 : dt * this.timeScale;
    this.time += sdt;
    for (const s of this.systems) s.update?.(sdt, dt);
    const focus = this.focus || new THREE.Vector3();
    this.world.update(sdt, focus, this.time, this.pushers || []);
    for (const s of this.systems) s.lateUpdate?.(sdt, dt);
    if (!this.skipRender) this.render();
    this.input.endFrame();
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }
}
