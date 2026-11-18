// Neon Bay — procedural sun-soaked modern coastal city for Neon Vice.
// Boxes + canvas-generated textures only, no external assets.
// Registers the world on the shared `game` object: colliders, roads,
// spawn points, bounds, and the two helpers other modules need:
//   resolveCircle(pos, radius) — push a ground circle out of buildings
//   isOnRoad(x, z)             — true when a ground point is on asphalt

import * as THREE from 'three';
import { makeRng, clamp, pick } from './utils.js';

const HALF = 300;            // city is 600 x 600 m, centred on the origin
const GRID = 60;             // road grid spacing
const ROAD_W = 10;           // asphalt width
const WALK_W = 3;            // sidewalk width each side of a road
const BEACH_Z = 240;         // sand starts here; ocean beyond z = 300
const BLOCK = GRID - ROAD_W - WALK_W * 2; // 44 m of buildable block

// ---------------------------------------------------------------------------
// Canvas textures
// ---------------------------------------------------------------------------

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// One facade tile: a diffuse map (walls + windows) and a matching emissive
// map that is black except for the randomly lit windows, so towers glow
// warmly without the whole wall lighting up.
function makeFacadePair(rng, base) {
  const cols = 6;
  const rows = 12;
  const lit = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) lit.push(rng() < 0.38);
  }
  const map = canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, w, h);
    // faint vertical grime / panel shading so big walls are not flat
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let c = 0; c < cols; c++) ctx.fillRect(c * (w / cols), 0, 1, h);
    const ww = 12;
    const wh = 12;
    const gx = (w - cols * ww) / (cols + 1);
    const gy = (h - rows * wh) / (rows + 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = gx + c * (ww + gx);
        const y = gy + r * (wh + gy);
        ctx.fillStyle = lit[r * cols + c] ? '#ffd27a' : '#202c40';
        ctx.fillRect(x, y, ww, wh);
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.fillRect(x, y, ww, 2);
      }
    }
  });
  const emissive = canvasTexture(128, 256, (ctx, w, h) => {
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, w, h);
    const ww = 12;
    const wh = 12;
    const gx = (w - cols * ww) / (cols + 1);
    const gy = (h - rows * wh) / (rows + 1);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (!lit[r * cols + c]) continue;
        ctx.fillStyle = '#ffc25e';
        ctx.fillRect(gx + c * (ww + gx), gy + r * (wh + gy), ww, wh);
      }
    }
  });
  return { map, emissive };
}

function makeRoadTexture() {
  const tex = canvasTexture(256, 64, (ctx, w, h) => {
    ctx.fillStyle = '#2e3138';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 0; i < 300; i++) ctx.fillRect(Math.random() * w, Math.random() * h, 2, 1);
    // dashed centre line
    ctx.fillStyle = '#e8d44d';
    for (let x = 0; x < w; x += 64) ctx.fillRect(x, h / 2 - 2, 32, 4);
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeOceanTexture() {
  const tex = canvasTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#2fa8d8');
    g.addColorStop(0.5, '#1e7fb8');
    g.addColorStop(1, '#1668a0');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      const y = (i / 10) * h + 8;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.09 + i) * 4);
      ctx.stroke();
    }
  });
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(10, 5);
  return tex;
}

function makeSkyTexture() {
  const tex = canvasTexture(16, 512, (ctx, w, h) => {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0.0, '#2f6fb4'); // zenith
    g.addColorStop(0.45, '#7ec3ee');
    g.addColorStop(0.68, '#ffd9a3');
    g.addColorStop(0.85, '#ffb36b');
    g.addColorStop(1.0, '#f78d4e'); // horizon haze
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
  return tex;
}

// ---------------------------------------------------------------------------
// Small builders
// ---------------------------------------------------------------------------

function makePalm(rng) {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.95 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f8f4e, roughness: 0.85 });
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.22, 4.6, 6), trunkMat);
  trunk.position.y = 2.3;
  trunk.rotation.z = (rng() - 0.5) * 0.12;
  trunk.castShadow = true;
  group.add(trunk);
  const crown = new THREE.Mesh(new THREE.SphereGeometry(1.9, 7, 5), leafMat);
  crown.scale.set(1, 0.42, 1);
  crown.position.y = 4.9;
  crown.castShadow = true;
  group.add(crown);
  const top = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.6, 6), leafMat);
  top.position.y = 5.4;
  group.add(top);
  return group;
}

function makeLamp() {
  const group = new THREE.Group();
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, roughness: 0.6, metalness: 0.6 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 5.2, 6), poleMat);
  pole.position.y = 2.6;
  pole.castShadow = true;
  group.add(pole);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.08, 0.08), poleMat);
  arm.position.set(0.5, 5.1, 0);
  group.add(arm);
  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.12, 0.24),
    new THREE.MeshStandardMaterial({
      color: 0x333333, emissive: 0xffd9a0, emissiveIntensity: 1.6, roughness: 0.4,
    }),
  );
  head.position.set(1.0, 5.05, 0);
  group.add(head);
  return group;
}

// ---------------------------------------------------------------------------
// Collision / road helpers (exported for player, vehicles, pedestrians)
// ---------------------------------------------------------------------------

// Push a ground circle {x, z} out of every building box it overlaps.
// Mutates `pos` in place; returns true if any push happened.
export function resolveCircle(world, pos, radius) {
  let hit = false;
  for (const b of world.colliders) {
    const cx = clamp(pos.x, b.minX, b.maxX);
    const cz = clamp(pos.z, b.minZ, b.maxZ);
    let dx = pos.x - cx;
    let dz = pos.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    hit = true;
    if (d2 > 1e-8) {
      const d = Math.sqrt(d2);
      const push = (radius - d) / d;
      pos.x += dx * push;
      pos.z += dz * push;
    } else {
      // Centre is inside the box: push out along the smallest penetration.
      const px = Math.min(pos.x - b.minX, b.maxX - pos.x);
      const pz = Math.min(pos.z - b.minZ, b.maxZ - pos.z);
      if (px < pz) pos.x += (pos.x - b.minX < b.maxX - pos.x ? -px : px) + radius;
      else pos.z += (pos.z - b.minZ < b.maxZ - pos.z ? -pz : pz) + radius;
    }
  }
  return hit;
}

// True when a ground point lies on asphalt (within half a road width of a
// road segment, with a small margin so wheels read as on-road).
export function isOnRoad(world, x, z) {
  const m = ROAD_W / 2 + 0.6;
  for (const r of world.roads) {
    const dx = r.end.x - r.start.x;
    const dz = r.end.z - r.start.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((x - r.start.x) * dx + (z - r.start.z) * dz) / len2;
    t = clamp(t, 0, 1);
    const px = r.start.x + dx * t;
    const pz = r.start.z + dz * t;
    if (Math.hypot(x - px, z - pz) <= m) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// City builder
// ---------------------------------------------------------------------------

export function buildCity(scene) {
  const rng = makeRng(20261118);
  const group = new THREE.Group();
  group.name = 'NeonBay';
  scene.add(group);

  const world = {
    group,
    bounds: { minX: -HALF + 4, maxX: HALF - 4, minZ: -HALF + 4, maxZ: HALF - 4 },
    colliders: [],
    roads: [],
    carSpawns: [],
    pedSpawns: [],
    playerSpawn: { x: 6, z: 8.5, heading: Math.PI },
    buildingCount: 0,
    meshCount: 0,
    update: null,
  };
  const add = (mesh) => { group.add(mesh); world.meshCount++; return mesh; };

  // Warm hazy sky + fog to match the sun-soaked look (boot fog was night).
  scene.fog = new THREE.Fog(0xf2c184, 120, 620);
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(700, 24, 16),
    new THREE.MeshBasicMaterial({ map: makeSkyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -1;
  add(sky);
  // Widen the boot sun's shadow frustum so it covers the whole city.
  scene.traverse((o) => {
    if (o.isDirectionalLight && o.castShadow) {
      o.shadow.camera.left = -320;
      o.shadow.camera.right = 320;
      o.shadow.camera.top = 320;
      o.shadow.camera.bottom = -320;
      o.shadow.camera.updateProjectionMatrix();
    }
  });

  // --- ground, beach, ocean ---------------------------------------------
  const ground = add(new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2, HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0xa8a58e, roughness: 1 }),
  ));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;

  const sand = add(new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2, HALF - BEACH_Z),
    new THREE.MeshStandardMaterial({ color: 0xe8d29a, roughness: 1 }),
  ));
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(0, 0.02, BEACH_Z + (HALF - BEACH_Z) / 2);
  sand.receiveShadow = true;

  const oceanTex = makeOceanTexture();
  const ocean = add(new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 700),
    new THREE.MeshStandardMaterial({ map: oceanTex, roughness: 0.35, metalness: 0.1 }),
  ));
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.set(0, 0.05, HALF + 350);

  const foams = [];
  for (let i = 0; i < 3; i++) {
    const foam = add(new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2, 1.4),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 }),
    ));
    foam.rotation.x = -Math.PI / 2;
    foam.position.set(0, 0.09, HALF - 3 + i * 2.4);
    foams.push(foam);
  }

  // --- roads + sidewalks --------------------------------------------------
  const roadTex = makeRoadTexture();
  const asphaltMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9 });
  const walkMat = new THREE.MeshStandardMaterial({ color: 0xc9c4b8, roughness: 1 });
  const blockMat = new THREE.MeshStandardMaterial({ color: 0xbdb8a8, roughness: 1 });

  const xLines = [];
  for (let c = -HALF; c <= HALF; c += GRID) xLines.push(c);
  const zLines = [];
  for (let c = -HALF; c <= BEACH_Z; c += GRID) zLines.push(c);

  // East-west roads (constant z), full width of the city.
  for (const z of zLines) {
    const tex = roadTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(HALF * 2 / 24, 1);
    const road = add(new THREE.Mesh(
      new THREE.PlaneGeometry(HALF * 2, ROAD_W),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
    ));
    road.rotation.x = -Math.PI / 2;
    road.position.set(0, 0.03, z);
    road.receiveShadow = true;
    const walk = add(new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, ROAD_W + WALK_W * 2), walkMat));
    walk.rotation.x = -Math.PI / 2;
    walk.position.set(0, 0.015, z);
    walk.receiveShadow = true;
    world.roads.push({ start: { x: -HALF, z }, end: { x: HALF, z }, dir: { x: 1, z: 0 } });
  }
  // North-south roads (constant x), stopping at the beach.
  for (const x of xLines) {
    const len = BEACH_Z + HALF; // -300 .. 240
    const tex = roadTex.clone();
    tex.needsUpdate = true;
    tex.repeat.set(len / 24, 1);
    const road = add(new THREE.Mesh(
      new THREE.PlaneGeometry(ROAD_W, len),
      new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }),
    ));
    road.rotation.x = -Math.PI / 2;
    road.rotation.z = Math.PI / 2;
    road.position.set(x, 0.03, (BEACH_Z - HALF) / 2);
    road.receiveShadow = true;
    const walk = add(new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W + WALK_W * 2, len), walkMat));
    walk.rotation.x = -Math.PI / 2;
    walk.rotation.z = Math.PI / 2;
    walk.position.set(x, 0.015, (BEACH_Z - HALF) / 2);
    walk.receiveShadow = true;
    world.roads.push({ start: { x, z: -HALF }, end: { x, z: BEACH_Z }, dir: { x: 0, z: 1 } });
  }
  void asphaltMat;

  // --- buildings ----------------------------------------------------------
  const facades = [
    '#e8d8c8', '#d9c2a3', '#c9d6dd', '#e6b8a2',
    '#b8c9d9', '#d9a679', '#a8b8c8', '#e0cfa8',
  ].map((c) => makeFacadePair(rng, c));
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 1 });

  function placeBuilding(cx, cz, w, d) {
    const distC = Math.hypot(cx, cz);
    let h = 8 + rng() * 22;
    if (distC < 150) h = h * 1.6 + rng() * 30;
    if (distC < 80 && rng() < 0.35) h = 55 + rng() * 40;
    h = clamp(h, 7, 95);
    const pair = pick(facades, rng);
    const map = pair.map.clone();
    map.needsUpdate = true;
    map.repeat.set(Math.max(1, Math.round(w / 7)), Math.max(1, Math.round(h / 7)));
    const em = pair.emissive.clone();
    em.needsUpdate = true;
    em.repeat.copy(map.repeat);
    const mat = new THREE.MeshStandardMaterial({
      map, emissiveMap: em, emissive: 0xffc27a, emissiveIntensity: 0.55, roughness: 0.85,
    });
    const mesh = add(new THREE.Mesh(unitBox, mat));
    mesh.scale.set(w, h, d);
    mesh.position.set(cx, h / 2, cz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world.colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 });
    world.buildingCount++;
    if (rng() < 0.3) {
      const cap = add(new THREE.Mesh(unitBox, roofMat));
      cap.scale.set(w * 0.3, 1.6, d * 0.3);
      cap.position.set(cx + (rng() - 0.5) * w * 0.3, h + 0.8, cz + (rng() - 0.5) * d * 0.3);
      cap.castShadow = true;
    }
  }

  for (let gx = 0; gx < 10; gx++) {
    for (let gz = 0; gz < 9; gz++) {
      const bx = -HALF + GRID / 2 + gx * GRID;
      const bz = -HALF + GRID / 2 + gz * GRID;
      // block slab under the buildings
      const slab = add(new THREE.Mesh(new THREE.PlaneGeometry(BLOCK + 2, BLOCK + 2), blockMat));
      slab.rotation.x = -Math.PI / 2;
      slab.position.set(bx, 0.012, bz);
      slab.receiveShadow = true;
      const roll = rng();
      const count = roll < 0.25 ? 1 : roll < 0.55 ? 2 : roll < 0.85 ? 3 : 4;
      const o = BLOCK / 4; // 11 m slot offset
      if (count === 1) {
        placeBuilding(bx, bz, 34, 34);
      } else if (count === 2) {
        if (rng() < 0.5) {
          placeBuilding(bx - o, bz, 16, 34);
          placeBuilding(bx + o, bz, 16, 34);
        } else {
          placeBuilding(bx, bz - o, 34, 16);
          placeBuilding(bx, bz + o, 34, 16);
        }
      } else {
        const slots = [[-o, -o], [o, -o], [-o, o], [o, o]];
        // shuffle slots, take `count` of them
        for (let i = slots.length - 1; i > 0; i--) {
          const j = Math.floor(rng() * (i + 1));
          [slots[i], slots[j]] = [slots[j], slots[i]];
        }
        for (let i = 0; i < count; i++) {
          placeBuilding(bx + slots[i][0], bz + slots[i][1], 16, 16);
        }
      }
    }
  }

  // --- palm-lined boulevard (the z = 0 east-west road) --------------------
  for (let x = -270; x <= 270; x += 45) {
    for (const z of [-8.5, 8.5]) {
      const palm = makePalm(rng);
      palm.position.set(x + (rng() - 0.5) * 4, 0, z);
      palm.rotation.y = rng() * Math.PI * 2;
      group.add(palm);
      world.meshCount += 3;
    }
  }

  // --- street lamps along the boulevard and the central north-south road --
  for (let x = -270; x <= 270; x += 60) {
    for (const z of [-6.5, 6.5]) {
      const lamp = makeLamp();
      lamp.position.set(x, 0, z);
      lamp.rotation.y = z < 0 ? 0 : Math.PI;
      group.add(lamp);
      world.meshCount += 3;
    }
  }
  for (let z = -270; z <= 210; z += 60) {
    const lamp = makeLamp();
    lamp.position.set(6.5, 0, z);
    lamp.rotation.y = -Math.PI / 2;
    group.add(lamp);
    world.meshCount += 3;
  }

  // --- spawn points --------------------------------------------------------
  for (const r of world.roads) {
    const len = Math.hypot(r.end.x - r.start.x, r.end.z - r.start.z);
    const steps = Math.floor(len / 80);
    for (let i = 1; i <= steps; i++) {
      const t = i / (steps + 1);
      const x = r.start.x + (r.end.x - r.start.x) * t;
      const z = r.start.z + (r.end.z - r.start.z) * t;
      const lane = 2.5;
      const heading = Math.atan2(r.dir.x, r.dir.z);
      world.carSpawns.push({ x: x - r.dir.z * lane, z: z + r.dir.x * lane, heading });
      world.carSpawns.push({ x: x + r.dir.z * lane, z: z - r.dir.x * lane, heading: heading + Math.PI });
    }
  }
  for (let i = 0; i < 48; i++) {
    const gx = Math.floor(rng() * 10);
    const gz = Math.floor(rng() * 9);
    const bx = -HALF + GRID / 2 + gx * GRID;
    const bz = -HALF + GRID / 2 + gz * GRID;
    world.pedSpawns.push({
      x: bx + (rng() - 0.5) * (BLOCK + 6),
      z: bz + (rng() - 0.5) * (BLOCK + 6),
    });
  }

  // --- per-frame animation: ocean drift + shoreline foam -------------------
  world.update = (dt, t) => {
    oceanTex.offset.y += dt * 0.02;
    oceanTex.offset.x += dt * 0.004;
    for (let i = 0; i < foams.length; i++) {
      foams[i].position.x = Math.sin(t * 0.4 + i * 1.7) * 6;
      foams[i].material.opacity = 0.35 + 0.2 * Math.sin(t * 0.7 + i * 2.1);
    }
  };

  return world;
}
