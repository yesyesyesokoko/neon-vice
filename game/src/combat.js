// Pedestrians + combat for Neon Vice: box humanoids strolling the
// sidewalks who flee gunfire and oncoming cars, a fist attack, and a
// pistol with raycast hits, tracer, muzzle flash, and a reload cycle.
// Hitting a pedestrian raises the wanted level (via game.police).

import * as THREE from 'three';
import { clamp, lerp, pick, turnToward, dist2D } from './utils.js';
import { resolveCircle } from './city.js';
import { damageCar } from './vehicles.js';

const PED_COUNT = 12;
const STROLL_SPEED = 1.6;
const FLEE_SPEED = 4.6;
const FLEE_RADIUS = 25;   // gunshots within this range scare pedestrians
const CAR_SCARE_DIST = 7; // a fast car this close makes peds run
const PISTOL_MAG = 12;
const PISTOL_RESERVE_START = 48;
const PISTOL_RANGE = 70;
const PUNCH_RANGE = 2.3;
const PUNCH_DAMAGE = 25;
const BULLET_DAMAGE_PED = 100;
const BULLET_DAMAGE_OFFICER = 34;
const BULLET_DAMAGE_CAR = 25;

const SHIRTS = [0xc96a4a, 0x4a7a9e, 0x7a9e4a, 0xd8c25a, 0x9e4a7a, 0x5a5a6e, 0xe8e8e8, 0x3a9e8a];
const PANTS = [0x23283a, 0x3a3a3a, 0x4a3a2a, 0x2a3a4a];
const SKINS = [0xe8b98d, 0xd9a37e, 0xa8764a, 0xf0c8a0];

// ---------------------------------------------------------------------------
// Box humanoid builder (also used by police.js for foot officers)
// ---------------------------------------------------------------------------

export function buildHumanoid(opts = {}) {
  const jacket = opts.jacket ?? pick(SHIRTS);
  const pants = opts.pants ?? pick(PANTS);
  const skin = opts.skin ?? pick(SKINS);
  const group = new THREE.Group();
  const box = (w, h, d, color, roughness = 0.85) => new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness }),
  );

  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.11, 0.78, 0);
  legR.position.set(0.11, 0.78, 0);
  for (const leg of [legL, legR]) {
    const m = box(0.16, 0.76, 0.19, pants);
    m.position.y = -0.38;
    m.castShadow = true;
    leg.add(m);
  }
  group.add(legL, legR);

  const torso = box(0.5, 0.6, 0.28, jacket);
  torso.position.y = 1.1;
  torso.castShadow = true;
  group.add(torso);

  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.31, 1.36, 0);
  armR.position.set(0.31, 1.36, 0);
  for (const arm of [armL, armR]) {
    const m = box(0.13, 0.56, 0.15, jacket);
    m.position.y = -0.26;
    m.castShadow = true;
    arm.add(m);
    const hand = box(0.11, 0.11, 0.12, skin);
    hand.position.y = -0.58;
    arm.add(hand);
  }
  group.add(armL, armR);

  const head = box(0.29, 0.3, 0.29, skin);
  head.position.y = 1.58;
  head.castShadow = true;
  group.add(head);
  if (opts.hat) {
    const cap = box(0.32, 0.09, 0.32, 0x101418);
    cap.position.y = 1.76;
    group.add(cap);
    const brim = box(0.34, 0.04, 0.14, 0x101418);
    brim.position.set(0, 1.72, 0.2);
    group.add(brim);
  } else {
    const hair = box(0.31, 0.09, 0.31, 0x1c1410);
    hair.position.y = 1.75;
    group.add(hair);
  }

  return { group, legL, legR, armL, armR, torso, walkPhase: Math.random() * 6 };
}

// ---------------------------------------------------------------------------
// Pedestrians
// ---------------------------------------------------------------------------

function spawnPed(game, at) {
  const world = game.world;
  const spawn = at || pick(world.pedSpawns);
  const body = buildHumanoid();
  body.group.position.set(spawn.x, 0, spawn.z);
  game.scene.add(body.group);
  const ped = {
    body,
    pos: body.group.position,
    heading: Math.random() * Math.PI * 2,
    health: 100,
    state: 'stroll', // 'stroll' | 'flee' | 'fallen'
    target: pick(world.pedSpawns),
    fleeTimer: 0,
    fleeFrom: null,
    fallTimer: -1,
    fadeTimer: 0,
    knock: new THREE.Vector3(),
    walkPhase: Math.random() * 6,
    speed: 0,
  };
  body.group.userData = { hittable: 'ped', ref: ped };
  return ped;
}

function knockDown(game, ped) {
  if (ped.state === 'fallen') return;
  ped.state = 'fallen';
  ped.fallTimer = 0;
  ped.fadeTimer = 0;
  ped.speed = 0;
}

function updatePed(game, ped, dt) {
  const world = game.world;
  if (ped.state === 'fallen') {
    ped.fallTimer += dt;
    ped.body.group.rotation.x = lerp(ped.body.group.rotation.x, -Math.PI / 2, 1 - Math.exp(-8 * dt));
    if (ped.fallTimer > 1.4) {
      ped.fadeTimer += dt;
      const k = 1 - ped.fadeTimer / 1.2;
      ped.body.group.traverse((o) => {
        if (o.isMesh) {
          o.material.transparent = true;
          o.material.opacity = Math.max(0, k);
        }
      });
      if (ped.fadeTimer >= 1.2) {
        game.scene.remove(ped.body.group);
        const i = game.combat.peds.indexOf(ped);
        if (i >= 0) game.combat.peds.splice(i, 1);
        game.combat.respawnTimer = 2;
      }
    }
    return;
  }

  // Knockback slides the ped and decays.
  if (ped.knock.lengthSq() > 0.01) {
    ped.pos.x += ped.knock.x * dt;
    ped.pos.z += ped.knock.z * dt;
    ped.knock.multiplyScalar(Math.max(0, 1 - 6 * dt));
    resolveCircle(world, ped.pos, 0.45);
  }

  // --- threat scan: gunfire nearby, or a fast car bearing down ---------
  let threat = null;
  const combat = game.combat;
  if (combat.lastShotAt > 0
    && game.clock.elapsedTime - combat.lastShotAt < 1.5
    && dist2D(ped.pos, combat.lastShotPos) < FLEE_RADIUS) {
    threat = combat.lastShotPos;
  }
  if (!threat) {
    for (const car of game.vehicles) {
      if (Math.abs(car.speed) < 4) continue;
      const dx = ped.pos.x - car.pos.x;
      const dz = ped.pos.z - car.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < CAR_SCARE_DIST) {
        // Only flee if the car is heading roughly toward the ped.
        const fx = Math.sin(car.heading);
        const fz = Math.cos(car.heading);
        if ((dx * fx + dz * fz) / d > 0.1) { threat = car.pos; break; }
      }
    }
  }
  if (threat) {
    ped.state = 'flee';
    ped.fleeTimer = 3;
    ped.fleeFrom = { x: threat.x, z: threat.z };
  }

  // --- movement ----------------------------------------------------------
  if (ped.state === 'flee') {
    ped.fleeTimer -= dt;
    const away = Math.atan2(ped.pos.x - ped.fleeFrom.x, ped.pos.z - ped.fleeFrom.z);
    ped.heading = turnToward(ped.heading, away, 10 * dt);
    ped.speed = FLEE_SPEED;
    if (ped.fleeTimer <= 0) ped.state = 'stroll';
  } else {
    const dx = ped.target.x - ped.pos.x;
    const dz = ped.target.z - ped.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 1.5) {
      ped.target = pick(world.pedSpawns);
    } else {
      ped.heading = turnToward(ped.heading, Math.atan2(dx, dz), 6 * dt);
      ped.speed = STROLL_SPEED * (0.8 + 0.4 * Math.sin(ped.walkPhase * 0.3));
    }
  }
  ped.pos.x += Math.sin(ped.heading) * ped.speed * dt;
  ped.pos.z += Math.cos(ped.heading) * ped.speed * dt;
  resolveCircle(world, ped.pos, 0.45);
  ped.pos.x = clamp(ped.pos.x, world.bounds.minX, world.bounds.maxX);
  ped.pos.z = clamp(ped.pos.z, world.bounds.minZ, world.bounds.maxZ);
  ped.body.group.position.copy(ped.pos);
  ped.body.group.rotation.y = ped.heading;

  // Walk swing.
  ped.walkPhase += dt * ped.speed * 2.2;
  const swing = Math.sin(ped.walkPhase) * 0.55 * clamp(ped.speed / STROLL_SPEED, 0, 1.8);
  ped.body.legL.rotation.x = swing;
  ped.body.legR.rotation.x = -swing;
  ped.body.armL.rotation.x = -swing * 0.8;
  ped.body.armR.rotation.x = swing * 0.8;

  // --- hit by a car -------------------------------------------------------
  for (const car of game.vehicles) {
    if (Math.abs(car.speed) < 3) continue;
    if (dist2D(ped.pos, car.pos) < 2.1) {
      // Fling the ped in the car's direction of travel.
      ped.knock.set(Math.sin(car.heading) * 7, 0, Math.cos(car.heading) * 7);
      knockDown(game, ped);
      if (car.kind === 'player') {
        game.police?.addWanted(1, 'hit a pedestrian');
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Combat
// ---------------------------------------------------------------------------

export function createCombat(game) {
  const scene = game.scene;

  // Tracer: one reusable line, faded out after each shot.
  const tracerGeo = new THREE.BufferGeometry();
  tracerGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3));
  const tracerMat = new THREE.LineBasicMaterial({
    color: 0xffe9a0, transparent: true, opacity: 0,
  });
  const tracer = new THREE.Line(tracerGeo, tracerMat);
  tracer.frustumCulled = false;
  scene.add(tracer);

  // Muzzle flash: a point light that flares for a few frames per shot.
  const muzzle = new THREE.PointLight(0xffc36b, 0, 14, 1.6);
  scene.add(muzzle);

  const raycaster = new THREE.Raycaster();
  const screenCenter = new THREE.Vector2(0, 0);

  const combat = {
    peds: [],
    respawnTimer: 0,
    weapon: 'fist', // 'fist' | 'pistol'
    ammo: PISTOL_MAG,
    reserve: PISTOL_RESERVE_START,
    reloadTimer: 0,
    reloadTotal: 1.1,
    lastShotAt: -10,
    lastShotPos: new THREE.Vector3(),
    shotWantedAt: -10,
    tracer,
    muzzle,
    fWasDown: false,
    rWasDown: false,
    gWasDown: false,
    key1WasDown: false,
    key2WasDown: false,

    // --- helpers -----------------------------------------------------------
    muzzlePos(out) {
      const player = game.player;
      const src = player.driving ? player.driving.pos : player.pos;
      const heading = player.driving ? player.driving.heading : player.heading;
      out.set(
        src.x + Math.sin(heading) * 0.7,
        1.45,
        src.z + Math.cos(heading) * 0.7,
      );
      return out;
    },

    nearestTarget(maxDist) {
      const player = game.player;
      const src = player.driving ? player.driving.pos : player.pos;
      const heading = player.driving ? player.driving.heading : player.heading;
      const fx = Math.sin(heading);
      const fz = Math.cos(heading);
      let best = null;
      let bestD = maxDist;
      const consider = (pos, ref) => {
        const dx = pos.x - src.x;
        const dz = pos.z - src.z;
        const d = Math.hypot(dx, dz);
        if (d >= bestD) return;
        // Must be roughly in front of the player.
        if (d > 0.5 && (dx * fx + dz * fz) / d < 0.35) return;
        bestD = d;
        best = ref;
      };
      for (const ped of this.peds) if (ped.state !== 'fallen') consider(ped.pos, ped);
      for (const off of game.police?.officers || []) {
        if (off.fallTimer < 0) consider(off.pos, off);
      }
      return best;
    },

    damageTarget(target, amount, knockDir) {
      if (!target) return;
      target.health -= amount;
      if (target.knock) {
        target.knock.x += knockDir.x * 6;
        target.knock.z += knockDir.z * 6;
      } else if (target.body) {
        // Officers have no knock vector; shove their position directly.
        target.pos.x += knockDir.x * 1.2;
        target.pos.z += knockDir.z * 1.2;
      }
      if (target.health <= 0) {
        if (target.body && target.body.group.userData.hittable === 'ped') {
          knockDown(game, target);
        } else {
          // Officer goes down like a ped.
          target.fallTimer = 0;
          target.fadeTimer = 0;
        }
      }
    },

    punch() {
      const player = game.player;
      const heading = player.driving ? player.driving.heading : player.heading;
      const target = this.nearestTarget(PUNCH_RANGE);
      if (!target) return;
      const dir = { x: Math.sin(heading), z: Math.cos(heading) };
      this.damageTarget(target, PUNCH_DAMAGE, dir);
      if (target.body?.group?.userData?.hittable === 'ped') {
        game.police?.addWanted(1, 'assault');
      } else {
        game.police?.addWanted(1, 'assaulting an officer');
      }
    },

    firePistol() {
      if (this.reloadTimer > 0) return;
      if (this.ammo <= 0) {
        if (game.showToast) game.showToast('Click — empty. Press R to reload.');
        return;
      }
      this.ammo--;
      const now = game.clock.elapsedTime;
      this.lastShotAt = now;
      this.lastShotPos.copy(this.muzzlePos(new THREE.Vector3()));

      // Raycast from the camera through the screen centre. The player's own
      // body and driven car are skipped (the camera sits right behind them).
      raycaster.setFromCamera(screenCenter, game.camera);
      raycaster.far = PISTOL_RANGE;
      const hits = raycaster.intersectObjects(scene.children, true);
      const ownGroups = [game.player.group];
      if (game.player.driving) ownGroups.push(game.player.driving.group);
      let end = null;
      let hitTarget = null;
      let hitCar = null;
      for (const hit of hits) {
        let o = hit.object;
        let own = false;
        let found = null;
        while (o) {
          if (ownGroups.includes(o)) { own = true; break; }
          if (o.userData && o.userData.hittable) { found = o.userData; break; }
          o = o.parent;
        }
        if (own) continue; // bullet passes the player's own body/car
        end = hit.point.clone();
        if (found) {
          if (found.hittable === 'car') hitCar = found.ref;
          else hitTarget = found.ref;
        }
        break; // first solid hit along the ray stops the bullet
      }
      if (!end) {
        end = raycaster.ray.at(PISTOL_RANGE, new THREE.Vector3());
      }

      // Tracer + muzzle flash.
      const start = this.muzzlePos(new THREE.Vector3());
      const pos = tracer.geometry.attributes.position;
      pos.setXYZ(0, start.x, start.y, start.z);
      pos.setXYZ(1, end.x, end.y, end.z);
      pos.needsUpdate = true;
      tracer.material.opacity = 0.95;
      tracer.userData.born = now;
      muzzle.position.copy(start);
      muzzle.intensity = 26;

      // Firing a weapon is a crime, but one shot should not stack stars.
      if (now - this.shotWantedAt > 8) {
        this.shotWantedAt = now;
        game.police?.addWanted(1, 'firing a weapon');
      }

      if (hitTarget) {
        const isPed = hitTarget.body?.group?.userData?.hittable === 'ped';
        const dir = end.clone().sub(start).setY(0).normalize();
        this.damageTarget(hitTarget, isPed ? BULLET_DAMAGE_PED : BULLET_DAMAGE_OFFICER, dir);
        if (isPed) game.police?.addWanted(1, 'shot a pedestrian');
      } else if (hitCar) {
        damageCar(game, hitCar, BULLET_DAMAGE_CAR);
        if (hitCar.kind === 'police') game.police?.addWanted(1, 'shot a police car');
      }
    },

    startReload() {
      if (this.reloadTimer > 0 || this.ammo >= PISTOL_MAG || this.reserve <= 0) return;
      this.reloadTimer = this.reloadTotal;
      if (game.showToast) game.showToast('Reloading…');
    },

    finishReload() {
      const need = PISTOL_MAG - this.ammo;
      const take = Math.min(need, this.reserve);
      this.ammo += take;
      this.reserve -= take;
    },

    // --- per-frame ---------------------------------------------------------
    update(dt) {
      const keys = game.input.keys;
      const now = game.clock.elapsedTime;

      // Weapon switching (edge-triggered).
      const k1 = keys.has('Digit1');
      if (k1 && !this.key1WasDown) {
        this.weapon = 'fist';
        if (game.showToast) game.showToast('Fists');
      }
      this.key1WasDown = k1;
      const k2 = keys.has('Digit2');
      if (k2 && !this.key2WasDown) {
        this.weapon = 'pistol';
        if (game.showToast) game.showToast(`Pistol — ${this.ammo}/${this.reserve} rounds`);
      }
      this.key2WasDown = k2;

      // Fist: F key. Pistol: G key (click also fires; see the listeners below).
      const fDown = keys.has('KeyF');
      if (fDown && !this.fWasDown && this.weapon === 'fist') this.punch();
      this.fWasDown = fDown;
      const gDown = keys.has('KeyG');
      if (gDown && !this.gWasDown && this.weapon === 'pistol') this.firePistol();
      this.gWasDown = gDown;

      // Reload: R key.
      const rDown = keys.has('KeyR');
      if (rDown && !this.rWasDown) this.startReload();
      this.rWasDown = rDown;
      if (this.reloadTimer > 0) {
        this.reloadTimer -= dt;
        if (this.reloadTimer <= 0) {
          this.finishReload();
          if (game.showToast) game.showToast(`Reloaded — ${this.ammo}/${this.reserve} rounds`);
        }
      }

      // Tracer fade + muzzle flash decay.
      if (tracer.material.opacity > 0) {
        tracer.material.opacity = Math.max(0, 0.95 - (now - tracer.userData.born) / 0.14);
      }
      if (muzzle.intensity > 0) muzzle.intensity = Math.max(0, muzzle.intensity - dt * 220);

      // Pedestrian upkeep: respawn to keep the streets populated.
      if (this.peds.length < PED_COUNT) {
        this.respawnTimer -= dt;
        if (this.respawnTimer <= 0) {
          this.peds.push(spawnPed(game));
          this.respawnTimer = 1;
        }
      }
      for (const ped of [...this.peds]) updatePed(game, ped, dt);
    },
  };

  // Click = fire the equipped weapon (a real click, not a camera drag).
  let downAt = 0;
  let downX = 0;
  let downY = 0;
  const canvas = game.renderer.domElement;
  canvas.addEventListener('mousedown', (e) => {
    downAt = performance.now();
    downX = e.clientX;
    downY = e.clientY;
  });
  canvas.addEventListener('mouseup', (e) => {
    if (game.state !== 'playing') return;
    const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
    if (performance.now() - downAt < 350 && moved < 6) {
      if (combat.weapon === 'pistol') combat.firePistol();
      else combat.punch();
    }
  });

  // Seed the first pedestrian group at boot.
  for (let i = 0; i < PED_COUNT; i++) combat.peds.push(spawnPed(game));
  game.combat = combat;
  return combat;
}
