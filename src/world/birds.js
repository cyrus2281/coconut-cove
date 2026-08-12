// A few gulls riding thermals over the bay — flap bursts and long glides.

import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

export function buildBirds(scene) {
  const rand = mulberry32(808);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xf4f4f2, roughness: 0.8 });
  const wingMat = new THREE.MeshStandardMaterial({
    color: 0xd8dadc, roughness: 0.8, side: THREE.DoubleSide,
  });
  const beakMat = new THREE.MeshStandardMaterial({ color: 0xd98a2b, roughness: 0.7 });

  const gulls = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();

    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), bodyMat);
    body.scale.set(0.9, 0.75, 2.2);
    g.add(body);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), bodyMat);
    head.position.set(0, 0.06, 0.22);
    g.add(head);

    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.07, 6), beakMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.05, 0.3);
    g.add(beak);

    const wingGeo = new THREE.PlaneGeometry(0.52, 0.16, 3, 1);
    wingGeo.translate(0.26, 0, 0);
    // taper the wing tip backwards
    const wp = wingGeo.attributes.position;
    for (let vi = 0; vi < wp.count; vi++) {
      const x = wp.getX(vi);
      wp.setY(vi, wp.getY(vi) * (1 - x * 0.9));
      wp.setZ(vi, -x * 0.22);
    }
    wingGeo.rotateX(-Math.PI / 2);

    const wingL = new THREE.Mesh(wingGeo, wingMat);
    wingL.position.set(0.05, 0.02, 0);
    g.add(wingL);
    const wingR = new THREE.Mesh(wingGeo, wingMat);
    wingR.scale.x = -1;
    wingR.position.set(-0.05, 0.02, 0);
    g.add(wingR);

    scene.add(g);
    gulls.push({
      group: g, wingL, wingR,
      r: 34 + rand() * 55,
      h: 22 + rand() * 22,
      speed: (0.05 + rand() * 0.035) * (rand() < 0.5 ? 1 : -1),
      a: rand() * Math.PI * 2,
      flapPhase: rand() * 10,
      glideSeed: rand() * 100,
    });
  }

  function update(t, dt) {
    for (const b of gulls) {
      b.a += b.speed * dt;
      const x = Math.cos(b.a) * b.r;
      const z = Math.sin(b.a) * b.r;
      const y = b.h + Math.sin(t * 0.3 + b.glideSeed) * 3;
      b.group.position.set(x, y, z);
      // face along the direction of travel
      b.group.rotation.y = -b.a - (b.speed > 0 ? 0 : Math.PI);
      b.group.rotation.z = 0.22 * Math.sign(b.speed);

      // alternate flapping bursts and glides
      const gate = THREE.MathUtils.smoothstep(Math.sin(t * 0.43 + b.glideSeed), -0.2, 0.35);
      const flap = Math.sin(t * 9 + b.flapPhase) * 0.85 * gate - 0.12;
      b.wingL.rotation.z = flap;
      b.wingR.rotation.z = -flap;
    }
  }

  return { update };
}
