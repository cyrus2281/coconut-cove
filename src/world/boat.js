// A small sloop forever rounding the island, hull-down near the horizon.
// Pure set dressing: ~300 triangles, one lap every ~7 minutes, gentle bob
// and heel, and a warm masthead light once the stars come out.

import * as THREE from 'three';
import { uniforms } from '../core/env.js';

const LAP_RADIUS = 780; // clear of the biggest island's shore + swim limit
const LAP_SECONDS = 420;

function sailGeometry(pts) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3));
  geo.computeVertexNormals();
  return geo;
}

function lightTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,240,205,1)');
  g.addColorStop(0.18, 'rgba(255,225,170,0.85)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildBoat() {
  const g = new THREE.Group();
  g.name = 'sailboat';

  // hull: bottom half of a stretched ellipsoid, capped by a pale deck
  const hull = new THREE.Mesh(
    new THREE.SphereGeometry(1, 18, 9, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x24384f, roughness: 0.6 })
  );
  hull.scale.set(5.8, 2.1, 1.5);
  g.add(hull);

  const deck = new THREE.Mesh(
    new THREE.CircleGeometry(1, 18),
    new THREE.MeshStandardMaterial({ color: 0xd9cfb6, roughness: 0.9 })
  );
  deck.rotation.x = -Math.PI / 2;
  deck.scale.set(5.8, 1.5, 1);
  deck.position.y = 0.02;
  g.add(deck);

  const mast = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.1, 12.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x8a7a5f, roughness: 0.8 })
  );
  mast.position.set(0.5, 6.3, 0);
  g.add(mast);

  const sailMat = new THREE.MeshStandardMaterial({
    color: 0xf3eedd,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  // main sail aft of the mast, jib forward to the bow
  g.add(new THREE.Mesh(sailGeometry([
    [0.42, 12.2, 0], [0.42, 1.9, 0], [-4.9, 1.9, 0.35],
  ]), sailMat));
  g.add(new THREE.Mesh(sailGeometry([
    [0.62, 10.6, 0], [5.5, 1.7, -0.28], [0.62, 1.7, 0],
  ]), sailMat));

  const light = new THREE.Sprite(new THREE.SpriteMaterial({
    map: lightTexture(),
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  light.scale.setScalar(5.5);
  light.position.set(0.5, 12.9, 0);
  g.add(light);

  function update(t) {
    const az = t * ((Math.PI * 2) / LAP_SECONDS) + 0.8;
    g.position.set(
      Math.cos(az) * LAP_RADIUS,
      Math.sin(t * 0.47) * 0.3 + 0.5 + uniforms.uTide.value,
      Math.sin(az) * LAP_RADIUS
    );
    g.rotation.y = -az - Math.PI / 2; // bow along the (counter-clockwise) lap
    g.rotation.z = 0.06 + Math.sin(t * 0.31) * 0.035; // heel
    g.rotation.x = Math.sin(t * 0.53) * 0.02;         // pitch
    light.material.opacity = uniforms.uNightF.value * 0.95;
  }

  return { group: g, update };
}
