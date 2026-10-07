// Sky, sun, fog and image-based lighting. Late-afternoon light, fixed for this
// build so composition stays consistent; the sun shadow frustum follows focus.
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

export class Environment {
  constructor(renderer, scene, quality) {
    this.scene = scene;
    // Direction toward the sun: south-west, ~24° above the horizon.
    this.sunDir = new THREE.Vector3(-0.62, 0.43, 0.66).normalize();

    const sky = new Sky();
    sky.scale.setScalar(4500);
    const u = sky.material.uniforms;
    u.turbidity.value = 3.2;
    u.rayleigh.value = 1.35;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    u.cloudCoverage.value = 0.32;
    u.cloudDensity.value = 0.45;
    u.cloudElevation.value = 0.55;
    u.cloudScale.value = 0.00022;
    u.sunPosition.value.copy(this.sunDir).multiplyScalar(4000);
    sky.material.depthWrite = false;
    sky.renderOrder = -10;
    this.sky = sky;
    scene.add(sky);

    // Environment map from the sky only (no clouds animating into it).
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene();
    const envSky = new Sky(); envSky.scale.setScalar(4500);
    for (const k of Object.keys(u)) envSky.material.uniforms[k].value = u[k].value?.clone ? u[k].value.clone() : u[k].value;
    envSky.material.uniforms.showSunDisc.value = 0;
    envScene.add(envSky);
    // A dim green ground plane so the lower hemisphere isn't sky-blue.
    const ground = new THREE.Mesh(new THREE.CircleGeometry(4000, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2c3a1e }));
    ground.position.y = -10; envScene.add(ground);
    this.envMap = pmrem.fromScene(envScene, 0.02).texture;
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.5;
    pmrem.dispose();

    this.fogColor = new THREE.Color(0xa9bcc4);
    scene.fog = new THREE.FogExp2(this.fogColor, 0.0024);

    const sun = new THREE.DirectionalLight(0xffe2bd, 3.1);
    sun.castShadow = true;
    sun.shadow.mapSize.set(quality.shadowSize, quality.shadowSize);
    const sc = sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 220;
    sun.shadow.bias = -0.00025;
    sun.shadow.normalBias = 0.035;
    sun.shadow.radius = 2.5;
    this.sun = sun;
    scene.add(sun, sun.target);

    this.hemi = new THREE.HemisphereLight(0xe6ece8, 0x6e6838, 0.5);
    scene.add(this.hemi);
    this.texel = (sc.right - sc.left) / quality.shadowSize;
  }

  /** Keep the shadow frustum centred on what the camera is looking at. */
  update(dt, focus, time) {
    // Snap to shadow texels to avoid shimmering edges while moving.
    const f = focus.clone();
    const L = this.sun;
    const s = this.texel;
    const dirX = new THREE.Vector3().crossVectors(this.sunDir, new THREE.Vector3(0, 1, 0)).normalize();
    const dirY = new THREE.Vector3().crossVectors(dirX, this.sunDir).normalize();
    const px = Math.round(f.dot(dirX) / s) * s, py = Math.round(f.dot(dirY) / s) * s, pz = f.dot(this.sunDir);
    const snapped = dirX.multiplyScalar(px).add(dirY.multiplyScalar(py)).add(this.sunDir.clone().multiplyScalar(pz));
    L.target.position.copy(snapped);
    L.position.copy(snapped).addScaledVector(this.sunDir, 110);
    L.target.updateMatrixWorld();
    this.sky.material.uniforms.time.value = time;
    this.sky.position.copy(focus).setY(0);
  }
}
