// The species art library. Every bony fish in the cove — reef schools, the
// bait ball, the clownfish — is assembled here from the fishcraft parts: a
// parametric body, a painted mirrored skin with a matching bump map, and the
// instanced swim material. sealife.js gives them brains; the /components
// viewer shows them one at a time. (The blacktip shark is not one of these:
// it has its own CPU-flexed rig in shark.js.)

import { mulberry32 } from '../core/rng.js';
import { fishGeometry, fishTexture, tintFinStrip, fishMaterial } from './fishcraft.js';

export function speciesLibrary() {
  const mk = (name, geoOpts, painter, texOpts = {}, matOpts = {}) => {
    const geo = fishGeometry(geoOpts);
    const { map, bump } = fishTexture(painter, texOpts);
    if (texOpts.finTint) tintFinStrip(map, texOpts.finTint);
    const mat = fishMaterial({ map, bump, name, len: geoOpts.len, ...matOpts });
    return { geo, mat, len: geoOpts.len };
  };

  return {
    // Abudefduf: silver-green with five soot bars and a yellow saddle wash
    sergeant: mk('sergeant',
      {
        len: 0.17, height: 0.095, width: 0.03, blunt: 0.78,
        caudal: { type: 'fork', l: 0.3, h: 0.55 },
        pelvic: { l: 0.1, h: 0.42, u: 0.4 },
      },
      (h) => {
        h.base([[0, '#eef2ec'], [0.42, '#d8e0d0'], [0.75, '#cdd8c4'], [1, '#b8c8ae']]);
        // yellow wash riding the back, strongest over the shoulder
        const g = h.ctx.createLinearGradient(0, h.H * 0.55, 0, h.H);
        g.addColorStop(0, 'rgba(240,210,60,0)');
        g.addColorStop(1, 'rgba(238,200,44,0.85)');
        h.ctx.fillStyle = g;
        h.ctx.fillRect(0, h.H * 0.55, h.W, h.H * 0.45);
        h.scales({ rows: 10, light: 0.12, dark: 0.1, from: 0.12 });
        for (let i = 0; i < 5; i++) h.bar(0.2 + i * 0.145, 0.055, 'rgba(16,20,24,0.88)', 0.12);
        h.shade(0.9);
        h.lateral(0.66);
        h.gill(0.17);
        h.mouth(0.05, 0.3);
        h.eye(0.08, 0.62, 0.09, '#cfc08a');
      },
      { finColor: '#dfe4cf', rayColor: 'rgba(60,70,60,0.35)' },
      { rough: 0.42, clearcoat: 0.55, irid: 0.15 }),

    // the bait-ball schooler: chromed blue-silver with a gold seam
    fusilier: mk('fusilier',
      {
        len: 0.1, height: 0.024, width: 0.015, peak: 0.45, blunt: 0.85,
        slices: 12, ring: 8, snoutDroop: 0.2,
        eyeBulge: { u: 0.09, v: 0.6, k: 0.22 },
        caudal: { type: 'fork', l: 0.3, h: 1.4 }, dorsal: null, anal: null, pect: null,
      },
      (h) => {
        h.base([[0, '#f2f6f6'], [0.4, '#cfdce4'], [0.68, '#8fb0c4'], [1, '#48708f']]);
        h.scales({ rows: 6, light: 0.1, dark: 0.06, from: 0.1 });
        h.stripe(0.66, 0.14, 'rgba(244,214,80,0.9)');
        h.stripe(0.58, 0.03, 'rgba(120,140,150,0.4)');
        h.shade(0.6);
        h.mouth(0.04, 0.34);
        h.eye(0.085, 0.58, 0.15, '#d8dce0');
      },
      { W: 256, H: 128, finColor: '#f0dc8c', rayColor: 'rgba(120,100,30,0.4)' },
      { metal: 0.5, rough: 0.28, freq: 9, clearcoat: 0.7, irid: 0.85 }),

    // Paracanthurus: royal blue, the black painter's-palette sweep, yellow tail
    blueTang: mk('blueTang',
      {
        len: 0.26, height: 0.145, width: 0.035, peak: 0.45, blunt: 0.85,
        eyeBulge: { u: 0.09, v: 0.66, k: 0.25 },
        caudal: { type: 'truncate', l: 0.22, h: 0.5 },
        dorsal: { h: 0.34, u0: 0.18, u1: 0.8 }, anal: { h: 0.34, u0: 0.3, u1: 0.8 },
        pelvic: { l: 0.09, h: 0.35, u: 0.42 },
      },
      (h) => {
        h.base([[0, '#356fe2'], [0.6, '#1b4cc4'], [1, '#0e2f96']]);
        // the palette: a bold sweep from the eye to the peduncle, with the
        // blue teardrop window inside it
        const c = h.ctx;
        c.fillStyle = 'rgba(6,10,32,0.95)';
        c.beginPath();
        c.moveTo(h.W * 0.1, h.H * 0.86);
        c.bezierCurveTo(h.W * 0.34, h.H * 1.02, h.W * 0.72, h.H * 0.98, h.W * 0.95, h.H * 0.72);
        c.bezierCurveTo(h.W * 0.86, h.H * 0.62, h.W * 0.72, h.H * 0.6, h.W * 0.58, h.H * 0.64);
        c.bezierCurveTo(h.W * 0.42, h.H * 0.68, h.W * 0.24, h.H * 0.7, h.W * 0.1, h.H * 0.86);
        c.closePath();
        c.fill();
        c.fillStyle = '#2456d8';
        c.beginPath();
        c.moveTo(h.W * 0.2, h.H * 0.84);
        c.bezierCurveTo(h.W * 0.4, h.H * 0.94, h.W * 0.6, h.H * 0.9, h.W * 0.72, h.H * 0.76);
        c.bezierCurveTo(h.W * 0.56, h.H * 0.72, h.W * 0.34, h.H * 0.74, h.W * 0.2, h.H * 0.84);
        c.closePath();
        c.fill();
        h.bar(0.915, 0.17, 'rgba(246,214,20,0.95)', 0, 0.35); // yellow caudal wedge
        h.speckle({ n: 90, col: 'rgba(255,255,255,0.05)', seedFn: mulberry32(90) });
        h.shade(0.85);
        h.gill(0.16, 0.7);
        h.mouth(0.045, 0.32);
        h.eye(0.075, 0.68, 0.085, '#e8c860');
      },
      { finColor: '#10245e', rayColor: 'rgba(4,10,30,0.5)' },
      { rough: 0.4, clearcoat: 0.6 }),

    // Zebrasoma: a lemon wedge with a white tail-spur
    yellowTang: mk('yellowTang',
      {
        len: 0.19, height: 0.13, width: 0.028, peak: 0.42, blunt: 0.9,
        snoutDroop: 0.55, eyeBulge: { u: 0.1, v: 0.68, k: 0.25 },
        caudal: { type: 'truncate', l: 0.2, h: 0.42 },
        dorsal: { h: 0.52, u0: 0.2, u1: 0.78 }, anal: { h: 0.44, u0: 0.34, u1: 0.78 },
        pelvic: { l: 0.11, h: 0.4, u: 0.4 },
      },
      (h) => {
        h.base([[0, '#f8de24'], [0.55, '#f4d312'], [0.85, '#eec60e'], [1, '#e0b30c']]);
        h.scales({ rows: 12, light: 0.07, dark: 0.05, lightCol: '255,250,200', darkCol: '160,120,10' });
        h.stripe(0.56, 0.045, 'rgba(255,248,214,0.55)'); // pale lateral streak
        h.ctx.fillStyle = 'rgba(200,150,16,0.4)';
        h.ctx.fillRect(0, 0, h.W * 0.14, h.H); // warm head shading
        h.spot(0.9, 0.42, 0.05, 'rgba(252,250,240,0.95)'); // the white scalpel
        h.shade(0.75);
        h.gill(0.17, 0.55);
        h.mouth(0.04, 0.3, 0.04);
        h.eye(0.085, 0.66, 0.08, '#5a4a20');
      },
      { finColor: '#f6d90e', rayColor: 'rgba(150,110,10,0.45)' },
      { rough: 0.45, clearcoat: 0.5 }),

    // Chaetodon: porcelain white, soot eye-band, chevron pinstripes, eyespot
    butterfly: mk('butterfly',
      {
        len: 0.15, height: 0.092, width: 0.024, blunt: 0.8,
        snoutDroop: 0.6, eyeBulge: { u: 0.1, v: 0.64, k: 0.22 },
        caudal: { type: 'truncate', l: 0.22, h: 0.42 },
        dorsal: { h: 0.42, u0: 0.24, u1: 0.78 }, anal: { h: 0.36, u0: 0.4, u1: 0.78 },
        pelvic: { l: 0.1, h: 0.42, u: 0.42 },
      },
      (h) => {
        h.base([[0, '#f8f6ec'], [0.6, '#f4eeda'], [1, '#f0e2b0']]);
        // chevron pinstripes: two diagonal fans meeting mid-flank
        const c = h.ctx;
        c.strokeStyle = 'rgba(110,100,64,0.4)';
        c.lineWidth = Math.max(h.H * 0.012, 1);
        for (let i = 0; i < 9; i++) {
          const x = h.W * (0.2 + i * 0.075);
          c.beginPath();
          c.moveTo(x, h.H * 0.1);
          c.lineTo(x + h.W * 0.1, h.H * 0.52);
          c.lineTo(x, h.H * 0.94);
          c.stroke();
        }
        // dark trim along the dorsal margin and an amber rear band
        c.fillStyle = 'rgba(40,34,20,0.5)';
        c.fillRect(0, h.H * 0.94, h.W, h.H * 0.06);
        const g = c.createLinearGradient(h.W * 0.72, 0, h.W * 0.9, 0);
        g.addColorStop(0, 'rgba(238,150,32,0)');
        g.addColorStop(1, 'rgba(238,150,32,0.75)');
        c.fillStyle = g;
        c.fillRect(h.W * 0.72, h.H * 0.3, h.W * 0.18, h.H * 0.7);
        // soot band through the eye, nape to throat
        c.save();
        c.translate(h.W * 0.085, h.H * 0.62);
        c.rotate(-0.12);
        c.fillStyle = 'rgba(16,16,18,0.92)';
        c.fillRect(-h.W * 0.032, -h.H * 0.62, h.W * 0.062, h.H * 1.3);
        c.restore();
        h.spot(0.76, 0.84, 0.15, 'rgba(250,248,240,0.95)'); // ocellus ring
        h.spot(0.76, 0.84, 0.1, '#14161a');                 // false eye
        h.shade(0.7);
        h.mouth(0.035, 0.3, 0.035);
        h.eye(0.08, 0.64, 0.07, '#3a3018');
      },
      { finColor: '#f2d258', rayColor: 'rgba(60,50,10,0.4)' },
      { rough: 0.42, clearcoat: 0.5 }),

    // Pomacanthus imperator: navy field, electric-yellow arcs, masked eye
    angelfish: mk('angelfish',
      {
        len: 0.3, height: 0.165, width: 0.045, peak: 0.44, blunt: 0.8,
        eyeBulge: { u: 0.09, v: 0.62, k: 0.22 },
        caudal: { type: 'truncate', l: 0.2, h: 0.44 },
        dorsal: { h: 0.34, u0: 0.2, u1: 0.82 }, anal: { h: 0.34, u0: 0.34, u1: 0.82 },
        pelvic: { l: 0.12, h: 0.45, u: 0.4 },
      },
      (h) => {
        h.base([[0, '#16307a'], [0.5, '#122868'], [1, '#0c1c50']]);
        const c = h.ctx;
        // the emperor's stripes sweep up toward the tail in long arcs
        c.strokeStyle = 'rgba(244,206,44,0.95)';
        c.lineWidth = Math.max(h.H * 0.035, 2);
        c.lineCap = 'round';
        for (let i = 0; i < 10; i++) {
          const y0 = h.H * (0.06 + i * 0.1);
          c.beginPath();
          c.moveTo(h.W * 0.16, y0);
          c.quadraticCurveTo(h.W * 0.6, y0 + h.H * 0.1, h.W * 0.94, y0 + h.H * 0.16);
          c.stroke();
        }
        c.lineCap = 'butt';
        h.bar(0.945, 0.12, 'rgba(246,210,36,0.95)', 0, 0.3); // yellow tail root
        // the mask: black saddle over the eye with pale blue piping
        c.save();
        c.translate(h.W * 0.1, h.H * 0.6);
        c.rotate(-0.06);
        c.fillStyle = 'rgba(8,12,26,0.96)';
        c.fillRect(-h.W * 0.045, -h.H * 0.34, h.W * 0.1, h.H * 0.74);
        c.strokeStyle = 'rgba(150,210,240,0.85)';
        c.lineWidth = Math.max(h.H * 0.016, 1.2);
        c.strokeRect(-h.W * 0.045, -h.H * 0.34, h.W * 0.1, h.H * 0.74);
        c.restore();
        // white throat blaze
        c.fillStyle = 'rgba(226,234,238,0.85)';
        c.fillRect(0, 0, h.W * 0.05, h.H * 0.5);
        h.scales({ rows: 12, light: 0.06, dark: 0.08 });
        h.shade(0.85);
        h.gill(0.17, 0.6);
        h.mouth(0.04, 0.34, 0.04);
        h.eye(0.08, 0.62, 0.08, '#e0b840');
      },
      { finColor: '#f0c828', rayColor: 'rgba(90,60,0,0.4)' },
      { rough: 0.38, clearcoat: 0.65 }),

    // Scarus: sea-green armor with rose-edged scales and the parrot beak
    parrotfish: mk('parrotfish',
      {
        len: 0.44, height: 0.155, width: 0.07, peak: 0.4, blunt: 0.62,
        snoutDroop: 0.45, eyeBulge: { u: 0.08, v: 0.66, k: 0.2 },
        gillFlare: { u: 0.2, k: 0.1 },
        caudal: { type: 'truncate', l: 0.2, h: 0.5 },
        dorsal: { h: 0.24, u0: 0.18, u1: 0.8 }, anal: { h: 0.22, u0: 0.36, u1: 0.8 },
        pelvic: { l: 0.11, h: 0.4, u: 0.36 },
      },
      (h) => {
        h.base([[0, '#6cd0b2'], [0.45, '#36a890'], [0.8, '#1f8a8c'], [1, '#187478']]);
        // big armor scales with rose edging, the parrotfish signature
        h.scales({
          rows: 8, size: 1.15, light: 0.55, dark: 0.34,
          lightCol: '248,172,192', darkCol: '10,84,96',
        });
        // pink cheek wash + banded chin
        const c = h.ctx;
        const g = c.createRadialGradient(h.W * 0.1, h.H * 0.4, 0, h.W * 0.1, h.H * 0.4, h.W * 0.2);
        g.addColorStop(0, 'rgba(240,170,190,0.55)');
        g.addColorStop(1, 'rgba(240,170,190,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, h.W * 0.3, h.H);
        c.strokeStyle = 'rgba(240,170,190,0.5)';
        c.lineWidth = Math.max(h.H * 0.02, 1.5);
        for (let i = 0; i < 3; i++) {
          c.beginPath();
          c.moveTo(0, h.H * (0.16 + i * 0.1));
          c.quadraticCurveTo(h.W * 0.08, h.H * (0.2 + i * 0.1), h.W * 0.14, h.H * (0.16 + i * 0.1));
          c.stroke();
        }
        // the beak: a mint bone plate over the jaw
        c.fillStyle = '#e4f0e6';
        c.beginPath();
        c.moveTo(0, h.H * 0.2);
        c.quadraticCurveTo(h.W * 0.045, h.H * 0.3, h.W * 0.035, h.H * 0.46);
        c.lineTo(0, h.H * 0.5);
        c.closePath();
        c.fill();
        c.strokeStyle = 'rgba(60,110,90,0.6)';
        c.lineWidth = 1.5;
        c.stroke();
        h.shade(0.85);
        h.gill(0.19, 0.8);
        h.eye(0.075, 0.66, 0.062, '#e8a050');
      },
      { finColor: '#2fa892', rayColor: 'rgba(240,150,170,0.55)' },
      { rough: 0.4, clearcoat: 0.55, irid: 0.2, bumpScale: 1.3 }),

    // Amphiprion: satsuma orange, three porcelain bars in soot piping
    clownfish: mk('clownfish',
      {
        len: 0.105, height: 0.058, width: 0.024, blunt: 0.8,
        snoutDroop: 0.4, eyeBulge: { u: 0.1, v: 0.6, k: 0.25 },
        caudal: { type: 'round', l: 0.26, h: 0.55 },
        dorsal: { h: 0.42, u0: 0.26, u1: 0.72 }, anal: { h: 0.32, u0: 0.45, u1: 0.72 },
        pelvic: { l: 0.13, h: 0.5, u: 0.38 },
      },
      (h) => {
        h.base([[0, '#ffa64e'], [0.55, '#fb8832'], [0.85, '#f07424'], [1, '#e0641a']]);
        h.scales({ rows: 7, light: 0.08, dark: 0.06, darkCol: '120,50,10' });
        for (const [u, w] of [[0.17, 0.09], [0.5, 0.11], [0.82, 0.075]]) {
          h.bar(u, w + 0.035, 'rgba(20,16,12,0.9)', 0, 0.15);
          h.bar(u, w, '#f6f4ee', 0, 0.2);
        }
        h.shade(0.4);
        h.mouth(0.04, 0.32, 0.035);
        h.eye(0.08, 0.6, 0.1, '#c87830');
      },
      { W: 256, H: 128, finColor: '#f07822', rayColor: 'rgba(30,15,5,0.5)',
        finTint: (ctx, x, y, w, hh) => {
          // soot piping along the fin margins
          const g = ctx.createLinearGradient(x, 0, x + w, 0);
          g.addColorStop(0, 'rgba(20,14,8,0)');
          g.addColorStop(0.85, 'rgba(20,14,8,0)');
          g.addColorStop(1, 'rgba(20,14,8,0.75)');
          ctx.fillStyle = g;
          ctx.fillRect(x, y, w, hh);
        } },
      { freq: 10, rough: 0.42, clearcoat: 0.55 }),
  };
}
