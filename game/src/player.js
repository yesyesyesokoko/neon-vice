// On-foot player for Neon Vice: a box-built humanoid with a walk swing,
// WASD movement relative to the camera heading, Shift sprint, Space jump
// with gravity, building collision (slides along walls) and city bounds.
// Also owns the third-person follow camera: drag orbits, wheel zooms,
// position smoothed so it never snaps.

import * as THREE from 'three';
import { clamp, lerp, turnToward } from './utils.js';
import { resolveCircle } from './city.js';

const WALK_SPEED = 5;
const SPRINT_SPEED = 9.5;
const ACCEL = 14;          // how fast velocity chases the target (per second)
const JUMP_VELOCITY = 8.5;
const GRAVITY = 24;
const PLAYER_RADIUS = 0.45;
const CAM_MIN_DIST = 4;
const CAM_MAX_DIST = 16;

function box(w, h, d, color, roughness = 0.8) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness }),
  );
}

function buildBody() {
  const group = new THREE.Group();
  const jacket = 0x12939e; // teal jacket
  const pants = 0x23283a;
  const skin = 0xe8b98d;
  const hair = 0x1c1410;

  // Legs pivot at the hip so the swing rotates around the top of the leg.
  const legL = new THREE.Group();
  const legR = new THREE.Group();
  legL.position.set(-0.11, 0.8, 0);
  legR.position.set(0.11, 0.8, 0);
  for (const leg of [legL, legR]) {
    const m = box(0.17, 0.78, 0.2, pants);
    m.position.y = -0.39;
    m.castShadow = true;
    leg.add(m);
  }
  group.add(legL, legR);

  // Torso (jacket) + white shirt strip on the chest.
  const torso = box(0.52, 0.62, 0.3, jacket);
  torso.position.y = 1.12;
  torso.castShadow = true;
  group.add(torso);
  const shirt = box(0.2, 0.5, 0.02, 0xf2f2f2, 0.9);
  shirt.position.set(0, 1.12, 0.16);
  group.add(shirt);

  // Arms pivot at the shoulder; hands are skin-tone boxes at the ends.
  const armL = new THREE.Group();
  const armR = new THREE.Group();
  armL.position.set(-0.33, 1.38, 0);
  armR.position.set(0.33, 1.38, 0);
  for (const arm of [armL, armR]) {
    const m = box(0.14, 0.58, 0.16, jacket);
    m.position.y = -0.27;
    m.castShadow = true;
    arm.add(m);
    const hand = box(0.12, 0.12, 0.13, skin);
    hand.position.y = -0.6;
    hand.castShadow = true;
    arm.add(hand);
  }
  group.add(armL, armR);

  // Head + hair cap.
  const head = box(0.3, 0.32, 0.3, skin);
  head.position.y = 1.62;
  head.castShadow = true;
  group.add(head);
  const hairM = box(0.32, 0.1, 0.32, hair);
  hairM.position.y = 1.8;
  group.add(hairM);

  return { group, legL, legR, armL, armR, torso };
}

export function createPlayer(game) {
  const world = game.world;
  const spawn = world.playerSpawn;
  const body = buildBody();
  game.scene.add(body.group);

  const player = {
    group: body.group,
    pos: new THREE.Vector3(spawn.x, 0, spawn.z), // feet position
    vel: new THREE.Vector3(),
    heading: spawn.heading, // radians; forward = (sin h, cos h) in (x, z)
    vy: 0,
    grounded: true,
    speed: 0,
    health: 100,
    maxHealth: 100,
    driving: null, // the car the player is driving, or null on foot
    walkPhase: 0,
    // Camera rig: yaw 0 puts the camera on +z behind a player facing -z.
    cam: { yaw: 0, pitch: 0.32, distance: 8, snapped: false },
    snapCamera() {
      this.cam.snapped = false;
      this.updateCamera(0, true);
    },
    updateCamera(dt, snap = false) {
      const drag = game.input.consumeDrag ? game.input.consumeDrag() : { dx: 0, dy: 0 };
      this.cam.yaw -= drag.dx * 0.005;
      this.cam.pitch = clamp(this.cam.pitch + drag.dy * 0.004, 0.08, 1.15);
      const wheel = game.input.consumeWheel ? game.input.consumeWheel() : 0;
      if (wheel !== 0) {
        this.cam.distance = clamp(this.cam.distance * (1 + wheel * 0.001), CAM_MIN_DIST, CAM_MAX_DIST);
      }
      const cp = Math.cos(this.cam.pitch);
      const sp = Math.sin(this.cam.pitch);
      const desired = new THREE.Vector3(
        this.pos.x + Math.sin(this.cam.yaw) * cp * this.cam.distance,
        this.pos.y + 1.7 + sp * this.cam.distance,
        this.pos.z + Math.cos(this.cam.yaw) * cp * this.cam.distance,
      );
      if (snap || !this.cam.snapped) {
        game.camera.position.copy(desired);
        this.cam.snapped = true;
      } else {
        const k = 1 - Math.exp(-9 * dt);
        game.camera.position.lerp(desired, k);
      }
      game.camera.lookAt(this.pos.x, this.pos.y + 1.7, this.pos.z);
    },
    update(dt) {
      const keys = game.input.keys;
      // Camera-relative move direction (forward = from camera toward player).
      const fx = -Math.sin(this.cam.yaw);
      const fz = -Math.cos(this.cam.yaw);
      const rx = -fz;
      const rz = fx;
      let mx = 0;
      let mz = 0;
      if (keys.has('KeyW') || keys.has('ArrowUp')) { mx += fx; mz += fz; }
      if (keys.has('KeyS') || keys.has('ArrowDown')) { mx -= fx; mz -= fz; }
      if (keys.has('KeyD') || keys.has('ArrowRight')) { mx += rx; mz += rz; }
      if (keys.has('KeyA') || keys.has('ArrowLeft')) { mx -= rx; mz -= rz; }
      const moving = mx !== 0 || mz !== 0;
      if (moving) {
        const len = Math.hypot(mx, mz);
        mx /= len;
        mz /= len;
      }
      const sprint = keys.has('ShiftLeft') || keys.has('ShiftRight');
      const targetSpeed = moving ? (sprint ? SPRINT_SPEED : WALK_SPEED) : 0;
      const k = 1 - Math.exp(-ACCEL * dt);
      this.vel.x = lerp(this.vel.x, mx * targetSpeed, k);
      this.vel.z = lerp(this.vel.z, mz * targetSpeed, k);
      this.speed = Math.hypot(this.vel.x, this.vel.z);

      this.pos.x += this.vel.x * dt;
      this.pos.z += this.vel.z * dt;
      // Slide along buildings, then stay inside the city.
      resolveCircle(world, this.pos, PLAYER_RADIUS);
      this.pos.x = clamp(this.pos.x, world.bounds.minX, world.bounds.maxX);
      this.pos.z = clamp(this.pos.z, world.bounds.minZ, world.bounds.maxZ);

      // Jump + gravity, landing on ground level (y = 0).
      if (keys.has('Space') && this.grounded) {
        this.vy = JUMP_VELOCITY;
        this.grounded = false;
      }
      if (!this.grounded) {
        this.vy -= GRAVITY * dt;
        this.pos.y += this.vy * dt;
        if (this.pos.y <= 0) {
          this.pos.y = 0;
          this.vy = 0;
          this.grounded = true;
        }
      }

      // Face the movement direction, turning smoothly.
      if (this.speed > 0.5) {
        const targetHeading = Math.atan2(this.vel.x, this.vel.z);
        this.heading = turnToward(this.heading, targetHeading, 10 * dt);
      }
      this.group.position.copy(this.pos);
      this.group.rotation.y = this.heading;

      // Walk animation: legs and arms swing opposite, scaled by speed.
      const moveFactor = clamp(this.speed / WALK_SPEED, 0, 1.6);
      this.walkPhase += dt * this.speed * 2.1;
      const swing = Math.sin(this.walkPhase) * 0.65 * moveFactor;
      body.legL.rotation.x = swing;
      body.legR.rotation.x = -swing;
      body.armL.rotation.x = -swing * 0.8;
      body.armR.rotation.x = swing * 0.8;
      // Idle breathing when standing still.
      if (moveFactor < 0.05) {
        const t = game.clock.elapsedTime;
        body.torso.position.y = 1.12 + Math.sin(t * 2) * 0.008;
        body.legL.rotation.x = 0;
        body.legR.rotation.x = 0;
        body.armL.rotation.x = 0;
        body.armR.rotation.x = 0;
      }

      this.updateCamera(dt);
      // Speed readout lives in hud.js now (single writer for the HUD).
    },
  };

  body.group.position.copy(player.pos);
  body.group.rotation.y = player.heading;
  return player;
}
