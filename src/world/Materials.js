// Shared PBR materials for structures and props.
import * as THREE from 'three';

export function createMaterials(assets) {
  const T = (n, srgb = true) => assets.texture(`assets/textures/${n}.jpg`, { srgb });
  const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  const planks = std({ map: T('planks_color'), normalMap: T('planks_normal', false), roughnessMap: T('planks_rough', false), roughness: 1 });
  const fence = std({ map: T('fence_color'), normalMap: T('fence_normal', false), roughnessMap: T('fence_rough', false), roughness: 1 });
  const m = {
    planks,
    planksDark: (() => { const p = planks.clone(); p.color = new THREE.Color(0x8a7a68); return p; })(),
    fence,
    fenceNew: (() => { const p = fence.clone(); p.color = new THREE.Color(0xf0dcc0); return p; })(),
    slate: std({ map: T('slate_color'), normalMap: T('slate_normal', false), roughness: 0.62 }),
    stone: std({ map: T('stone_color'), normalMap: T('stone_normal', false), roughness: 0.92 }),
    straw: std({ map: T('straw_color'), normalMap: T('straw_normal', false), roughness: 0.95 }),
    galv: std({ map: T('galv_color'), roughnessMap: T('galv_rough', false), metalness: 0.85, roughness: 1 }),
    soil: std({ map: T('soil_color'), normalMap: T('soil_normal', false), roughness: 1 }),
    paintGreen: std({ color: 0x33473a, roughness: 0.55 }),
    paintCream: std({ color: 0xd9d0b8, roughness: 0.6 }),
    iron: std({ color: 0x24282a, roughness: 0.55, metalness: 0.7 }),
    rope: std({ color: 0xb59a6a, roughness: 0.95 }),
    rubberRed: std({ color: 0xa8321e, roughness: 0.45 }),
    tyre: std({ color: 0x1b1b1b, roughness: 0.8 }),
    brass: std({ color: 0xb08d4a, roughness: 0.35, metalness: 0.9 }),
    canvas: std({ color: 0x8f8a6c, roughness: 0.95 }),
    kibble: std({ color: 0x7a4a24, roughness: 0.7 }),
    paper: std({ color: 0xeee6d2, roughness: 0.9 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x2b3236, roughness: 0.08, metalness: 0, emissive: 0xffb466, emissiveIntensity: 0.07, envMapIntensity: 1.4, clearcoat: 1 }),
    water: new THREE.MeshStandardMaterial({ color: 0x2c4044, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.85 }),
    lampGlow: new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffc070, emissiveIntensity: 2.2 }),
    ghostOk: new THREE.MeshStandardMaterial({ color: 0x9fe0a0, emissive: 0x2f6d33, emissiveIntensity: 0.6, transparent: true, opacity: 0.55, depthWrite: false }),
    ghostBad: new THREE.MeshStandardMaterial({ color: 0xe08f80, emissive: 0x7a2618, emissiveIntensity: 0.7, transparent: true, opacity: 0.55, depthWrite: false }),
  };
  return m;
}
