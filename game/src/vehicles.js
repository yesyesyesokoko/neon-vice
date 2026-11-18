// Vehicles + traffic for Neon Vice: box-built cars with spinning/steering
// wheels, emissive lights, arcade driving, building + car collision,
// enter/exit (E), and a traffic system that follows the road network.
//
// A car is a plain object on the shared game object:
//   { group, pos, heading, speed, steer, style, kind, health, wheels, ... }
// kinds: 'traffic' | 'player' | 'parked' | 'police'
// The player drives at most one car at a time (game.player.driving).

import * as THREE from 'three';
import { clamp, lerp, pick, turnToward, angleDelta, dist2D } from './utils.js';
import { resolveCircle } from './city.js';

const CAR_RADIUS = 2.1;      // circle used for building + car push-out
const ENTER_DIST = 4.2;      // how close the player must be to enter a car
const TRAFFIC_TARGET = 10;   // traffic cars kept alive
const MAX_SPEED = 26;        // m/s, ~58 mph for the fastest style
const ACCEL = 14;
const BRAKE = 26;
const REVERSE_MAX = 9;

const STYLES = {
  sedan:  { color: 0xb03a2e, len: 4.4, wid: 1.9, hgt: 0.62, cabH: 0.55, top: 22, accel: 1.0 },
  taxi:   { color: 0xf2c200, len: 4.4, wid: 1.9, hgt: 0.62, cabH: 0.55, top: 20, accel: 1.0, taxi: true },
  van:    { color: 0x7a8899, len: 5.2, wid: 2.1, hgt: 0.95, cabH: 0.85, top: 18, accel: 0.8 },
  sports: { color: 0x1e6fd9, len: 4.2, wid: 2.0, hgt: 0.5, cabH: 0.42, top: 26, accel: 1.35 },
  police: { color: 0x1a2028, len: 4.5, wid: 1.95, hgt: 0.62, cabH: 0.55, top: 25, accel: 1.25, police: true },
};

const PAINTS = [
  0xb03a2e, 0x2e6db0, 0x3a9e5f, 0xd8d8d8, 0x22242a, 0xc96a1e,
  0x7a4a9e, 0x9e2e4a, 0x4a7a8a, 0xe0b13a, 0x5a6e2e, 0x8a8f96,
];

function box(w, h, d, color, roughness = 0.55, metalness = 0.35) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({ color, roughness, metalness }),
  );
}

// ---------------------------------------------------------------------------
// Car factory
// ---------------------------------------------------------------------------

export function createCar(game, styleName = 'sedan', opts = {}) {
  const style = STYLES[styleName] || STYLES.sedan;
  const paint = opts.color ?? (styleName === 'taxi' || styleName === 'police'
    ? style.color : pick(PAINTS));
  const group = new THREE.Group();
  group.name = `car-${styleName}`;

  const { len, wid, hgt, cabH } = style;

  // Body + cabin. Forward is +z in local space (matches heading math:
  // forward = (sin heading, cos heading)).
  const body = box(wid, hgt, len, paint);
  body.position.y = 0.45 + hgt / 2;
  body.castShadow = true;
  group.add(body);

  const cabin = box(wid * 0.86, cabH, len * 0.5, 0x14181f, 0.25, 0.6);
  cabin.position.set(0, 0.45 + hgt + cabH / 2 - 0.05, -len * 0.06);
  cabin.castShadow = true;
  group.add(cabin);

  // Taxi roof sign / police light bar.
  if (style.taxi) {
    const sign = box(0.7, 0.16, 0.3, 0x111111);
    sign.position.set(0, 0.45 + hgt + cabH + 0.06, -len * 0.06);
    group.add(sign);
    const signGlow = box(0.66, 0.1, 0.26,
      0x000000, 0.4, 0);
    signGlow.material = new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: 0xffd23a, emissiveIntensity: 1.4,
    });
    signGlow.position.copy(sign.position);
    group.add(signGlow);
  }
  let lightBarL = null;
  let lightBarR = null;
  if (style.police) {
    const barMat = (c) => new THREE.MeshStandardMaterial({
      color: 0x111111, emissive: c, emissiveIntensity: 2.2,
    });
    lightBarL = box(0.5, 0.12, 0.3, 0x111111);
    lightBarL.material = barMat(0x2255ff);
    lightBarL.position.set(-0.4, 0.45 + hgt + cabH + 0.05, -len * 0.06);
    lightBarR = box(0.5, 0.12, 0.3, 0x111111);
    lightBarR.material = barMat(0xff2222);
    lightBarR.position.set(0.4, 0.45 + hgt + cabH + 0.05, -len * 0.06);
    group.add(lightBarL, lightBarR);
  }

  // Headlights (front, +z) and taillights (rear, -z), emissive so they glow.
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xfff6cf, emissive: 0xfff2b0, emissiveIntensity: 2.4, roughness: 0.3,
  });
  const tailMat = new THREE.MeshStandardMaterial({
    color: 0x7a0d0d, emissive: 0xff2222, emissiveIntensity: 1.6, roughness: 0.3,
  });
  for (const sx of [-1, 1]) {
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.06), headMat);
    head.position.set(sx * (wid / 2 - 0.32), 0.62, len / 2 + 0.01);
    group.add(head);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.06), tailMat);
    tail.position.set(sx * (wid / 2 - 0.32), 0.66, -len / 2 - 0.01);
    group.add(tail);
  }

  // Wheels: cylinders spun 90 deg so the axle runs across the car.
  // Each wheel lives in a steer pivot (front) so it can turn visibly.
  const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.95 });
  const hubGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.3, 8);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x9aa2ad, roughness: 0.35, metalness: 0.7 });
  const wheels = [];
  const wheelX = wid / 2 - 0.05;
  const wheelZ = len / 2 - 0.85;
  for (const [sx, sz, front] of [[-1, 1, true], [1, 1, true], [-1, -1, false], [1, -1, false]]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * wheelX, 0.36, sz * wheelZ);
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.castShadow = true;
    const hub = new THREE.Mesh(hubGeo, hubMat);
    hub.rotation.z = Math.PI / 2;
    pivot.add(wheel, hub);
    group.add(pivot);
    wheels.push({ pivot, mesh: wheel, front });
  }

  const car = {
    group,
    style: styleName,
    kind: opts.kind || 'traffic',
    pos: new THREE.Vector3(opts.x ?? 0, 0, opts.z ?? 0),
    heading: opts.heading ?? 0,
    speed: 0,
    steer: 0,            // current front-wheel steer angle (radians)
    vel: new THREE.Vector3(), // world velocity (lets hard turns drift)
    health: 100,
    smokeTimer: 0,
    lightBarL,
    lightBarR,
    flashPhase: Math.random() * Math.PI * 2,
    wheels,
    // Traffic state: which road it follows, how far along it, lane side.
    road: -1,
    roadS: 0,
    roadDir: 1,
    cruise: 8 + Math.random() * 5,
    blockedTimer: 0,
    topSpeed: style.top,
    accelMul: style.accel,
    // Police state (used by police.js): current target handled there.
    ramCooldown: 0,
    // Parked cars never move.
    parked: opts.kind === 'parked',
  };
  group.position.copy(car.pos);
  group.rotation.y = car.heading;
  group.userData = { hittable: 'car', ref: car }; // combat raycast target
  game.scene.add(group);
  return car;
}

// Remove a car from the scene and the registry.
export function removeCar(game, car) {
  game.scene.remove(car.group);
  const i = game.vehicles.indexOf(car);
  if (i >= 0) game.vehicles.splice(i, 1);
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

const TRAFFIC_STYLES = ['sedan', 'sedan', 'sedan', 'taxi', 'van', 'sports'];

export function spawnTrafficCar(game) {
  const world = game.world;
  const spawn = pick(world.carSpawns);
  const car = createCar(game, pick(TRAFFIC_STYLES), {
    kind: 'traffic',
    x: spawn.x,
    z: spawn.z,
    heading: spawn.heading,
  });
  // Attach it to the nearest road (by perpendicular distance to the
  // segment) so it can follow the network.
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < world.roads.length; i++) {
    const r = world.roads[i];
    const dx = r.end.x - r.start.x;
    const dz = r.end.z - r.start.z;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((spawn.x - r.start.x) * dx + (spawn.z - r.start.z) * dz) / len2;
    t = clamp(t, 0, 1);
    const d = Math.hypot(spawn.x - (r.start.x + dx * t), spawn.z - (r.start.z + dz * t));
    if (d < bestD) { bestD = d; best = i; }
  }
  car.road = best;
  car.roadDir = 1;
  car.roadS = 0;
  // Seed roadS from the spawn's projection onto the road.
  if (best >= 0) {
    const r = world.roads[best];
    const dx = r.end.x - r.start.x;
    const dz = r.end.z - r.start.z;
    const len2 = dx * dx + dz * dz || 1;
    car.roadS = clamp(((spawn.x - r.start.x) * dx + (spawn.z - r.start.z) * dz) / len2, 0, 1)
      * Math.sqrt(len2);
    car.roadDir = Math.cos(angleDelta(Math.atan2(r.dir.x, r.dir.z), spawn.heading)) >= 0 ? 1 : -1;
  }
  game.vehicles.push(car);
  return car;
}

function roadLength(r) {
  return Math.hypot(r.end.x - r.start.x, r.end.z - r.start.z);
}

// Pick a new road at a junction: any road sharing the junction point.
function pickNextRoad(world, fromRoad, atEnd) {
  const r = world.roads[fromRoad];
  const jx = atEnd ? r.end.x : r.start.x;
  const jz = atEnd ? r.end.z : r.start.z;
  const options = [];
  for (let i = 0; i < world.roads.length; i++) {
    if (i === fromRoad) continue;
    const o = world.roads[i];
    if (Math.hypot(o.start.x - jx, o.start.z - jz) < 1.5) options.push({ road: i, dir: 1 });
    else if (Math.hypot(o.end.x - jx, o.end.z - jz) < 1.5) options.push({ road: i, dir: -1 });
  }
  if (!options.length) return null;
  return pick(options);
}

// ---------------------------------------------------------------------------
// Driving physics (shared by the player's car and police cars)
// ---------------------------------------------------------------------------

// steerInput: -1 (left) .. 1 (right). throttle: 1 = gas, -1 = brake/reverse.
export function driveCar(game, car, steerInput, throttle, dt) {
  const world = game.world;
  const maxSteer = lerp(0.55, 0.2, clamp(Math.abs(car.speed) / MAX_SPEED, 0, 1));
  const targetSteer = steerInput * maxSteer;
  car.steer = lerp(car.steer, targetSteer, 1 - Math.exp(-10 * dt));

  if (throttle > 0) {
    car.speed += ACCEL * car.accelMul * throttle * dt;
  } else if (throttle < 0) {
    if (car.speed > 0.5) car.speed -= BRAKE * dt; // braking
    else car.speed -= ACCEL * 0.6 * dt;          // reversing
  } else {
    // Coast down with drag + rolling resistance.
    car.speed -= car.speed * 0.9 * dt + Math.sign(car.speed) * 1.5 * dt;
    if (Math.abs(car.speed) < 0.15) car.speed = 0;
  }
  car.speed = clamp(car.speed, -REVERSE_MAX, car.topSpeed);

  // Heading follows the front wheels; faster = more yaw per second.
  const grip = car.speed >= 0 ? 1 : -1;
  car.heading += car.steer * clamp(car.speed * 0.16, -3.2, 3.2) * grip * dt;

  // Velocity chases the forward direction; at high steer the grip drops so
  // the car slides sideways a touch (gentle arcade drift).
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  const steerHard = Math.abs(car.steer) / 0.55;
  const gripK = 1 - Math.exp(-(steerHard > 0.7 && Math.abs(car.speed) > 12 ? 2.2 : 8) * dt);
  car.vel.x = lerp(car.vel.x, fx * car.speed, gripK);
  car.vel.z = lerp(car.vel.z, fz * car.speed, gripK);

  car.pos.x += car.vel.x * dt;
  car.pos.z += car.vel.z * dt;

  // Buildings: push out and kill the speed that drove into the wall.
  if (resolveCircle(world, car.pos, CAR_RADIUS)) {
    const into = car.vel.x * fx + car.vel.z * fz;
    if (into > 0) car.speed *= 0.35;
    car.vel.multiplyScalar(0.4);
    const now = game.clock.elapsedTime;
    if (!car._wallHitAt || now - car._wallHitAt > 0.6) {
      car._wallHitAt = now;
      // Only a real impact hurts: resting against a wall while wedged
      // must not grind the car to death.
      if (into > 4) damageCar(game, car, 3);
    }
  }
  car.pos.x = clamp(car.pos.x, world.bounds.minX, world.bounds.maxX);
  car.pos.z = clamp(car.pos.z, world.bounds.minZ, world.bounds.maxZ);

  car.group.position.copy(car.pos);
  // Slight body roll into corners + pitch under accel, purely visual.
  car.group.rotation.y = car.heading;
  car.group.rotation.z = -car.steer * clamp(Math.abs(car.speed) / 14, 0, 1) * 0.5;
  updateWheels(car, dt);
  updateSmoke(game, car, dt);
}

function updateWheels(car, dt) {
  const spin = (car.speed / 0.36) * dt;
  for (const w of car.wheels) {
    w.mesh.rotation.x += spin;
    if (w.front) w.pivot.rotation.y = car.steer * 0.9;
  }
}

// Smoke puffs once a car is badly damaged (health < 40).
function updateSmoke(game, car, dt) {
  if (car.health >= 40 || car.smokeTimer > 0) {
    car.smokeTimer -= dt;
    return;
  }
  car.smokeTimer = 0.28;
  const puff = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 6, 5),
    new THREE.MeshBasicMaterial({ color: 0x555555, transparent: true, opacity: 0.55 }),
  );
  puff.position.set(
    car.pos.x + Math.sin(car.heading) * 1.2,
    1.3,
    car.pos.z + Math.cos(car.heading) * 1.2,
  );
  game.scene.add(puff);
  const born = game.clock.elapsedTime;
  car._smoke = car._smoke || [];
  car._smoke.push({ mesh: puff, born });
  // Age + lift older puffs, drop them after ~1.2 s.
  for (let i = car._smoke.length - 1; i >= 0; i--) {
    const p = car._smoke[i];
    const age = game.clock.elapsedTime - p.born;
    if (age > 1.2) {
      game.scene.remove(p.mesh);
      car._smoke.splice(i, 1);
    } else {
      p.mesh.position.y += dt * 1.6;
      p.mesh.scale.setScalar(1 + age * 1.4);
      p.mesh.material.opacity = 0.55 * (1 - age / 1.2);
    }
  }
}

export function damageCar(game, car, amount) {
  if (!car || car.health <= 0) return;
  car.health = Math.max(0, car.health - amount);
  if (car.health <= 0 && car.kind === 'police' && game.police) {
    game.police.onCopDisabled?.(car);
  }
}

// ---------------------------------------------------------------------------
// Traffic AI
// ---------------------------------------------------------------------------

function updateTrafficCar(game, car, dt) {
  const world = game.world;
  if (car.road < 0) { // no road attached: treat as parked
    car.speed = 0;
    return;
  }
  const road = world.roads[car.road];
  const len = roadLength(road);

  // Waypoint: a point further along the road, offset into the right lane.
  // roadS is distance travelled from the entry end of the segment.
  const ahead = clamp(car.roadS + 16, 0, len);
  const along = car.roadDir === 1 ? ahead : len - ahead;
  const tx = road.start.x + road.dir.x * along;
  const tz = road.start.z + road.dir.z * along;
  // Right-hand lane: offset to the right of the travel direction.
  const dirx = road.dir.x * car.roadDir;
  const dirz = road.dir.z * car.roadDir;
  const laneX = tx + dirz * 2.5;
  const laneZ = tz - dirx * 2.5;

  // Slow down when a car is close ahead (parked cars are ignored here, so
  // traffic does not queue behind an abandoned car).
  let targetSpeed = car.cruise;
  const fx = Math.sin(car.heading);
  const fz = Math.cos(car.heading);
  for (const other of game.vehicles) {
    if (other === car || other.kind === 'parked') continue;
    const dx = other.pos.x - car.pos.x;
    const dz = other.pos.z - car.pos.z;
    const aheadDist = dx * fx + dz * fz;
    const sideDist = Math.abs(dx * fz - dz * fx);
    if (aheadDist > 0 && aheadDist < 11 && sideDist < 2.6) {
      targetSpeed = Math.min(targetSpeed, Math.max(0, other.speed * 0.8));
      break;
    }
  }

  const wantHeading = Math.atan2(laneX - car.pos.x, laneZ - car.pos.z);
  const steer = clamp(angleDelta(car.heading, wantHeading) * 1.6, -1, 1);
  const throttle = car.speed < targetSpeed ? 1 : 0;
  driveCar(game, car, steer, throttle, dt);

  // Advance along the road by projecting the new position onto it.
  const px = car.pos.x - road.start.x;
  const pz = car.pos.z - road.start.z;
  const proj = clamp(px * road.dir.x + pz * road.dir.z, 0, len);
  car.roadS = car.roadDir === 1 ? proj : len - proj;

  // Reached the exit end of the segment: pick a new road at the junction.
  if (car.roadS >= len - 1) {
    const atEnd = car.roadDir === 1; // exit is r.end when driving forward
    const next = pickNextRoad(world, car.road, atEnd);
    if (next) {
      car.road = next.road;
      car.roadDir = next.dir;
      car.roadS = next.dir === 1 ? 0 : roadLength(world.roads[next.road]);
    } else {
      // Dead end (beach edge): turn around on the same road.
      car.roadDir *= -1;
      car.roadS = clamp(car.roadS, 1, len - 1);
    }
  }
}

// ---------------------------------------------------------------------------
// Car-vs-car push-out (all cars; parked cars never move)
// ---------------------------------------------------------------------------

function resolveCarCollisions(game, dt) {
  const cars = game.vehicles;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const d = Math.hypot(dx, dz);
      const min = CAR_RADIUS * 1.9;
      if (d >= min || d < 1e-4) continue;
      const push = (min - d) / 2;
      const nx = dx / d;
      const nz = dz / d;
      // Ram damage when the impact is fast. Police cars are built for
      // ramming, so they take only a quarter of the collision damage.
      const rel = Math.abs((a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz);
      if (rel > 6) {
        damageCar(game, a, rel * (a.kind === 'police' ? 0.15 : 0.6));
        damageCar(game, b, rel * (b.kind === 'police' ? 0.15 : 0.6));
        if (a.kind === 'player' || b.kind === 'player') {
          const other = a.kind === 'player' ? b : a;
          if (other.kind === 'police') game.police?.onRam?.(other);
        }
      }
      if (!a.parked) { a.pos.x -= nx * push; a.pos.z -= nz * push; }
      if (!b.parked) { b.pos.x += nx * push; b.pos.z += nz * push; }
      if (!a.parked) a.vel.multiplyScalar(0.85);
      if (!b.parked) b.vel.multiplyScalar(0.85);
      void dt;
    }
  }
}

// ---------------------------------------------------------------------------
// Enter / exit
// ---------------------------------------------------------------------------

export function nearestCar(game, pos, maxDist = ENTER_DIST) {
  let best = null;
  let bestD = maxDist;
  for (const car of game.vehicles) {
    if (car.kind === 'police' && car.health <= 0) continue;
    const d = dist2D(pos, car.pos);
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

export function enterCar(game, car) {
  const player = game.player;
  const wasTraffic = car.kind === 'traffic';
  car.kind = 'player';
  car.parked = false;
  player.driving = car;
  player.group.visible = false;
  player.vel.set(0, 0, 0);
  // Snap the chase camera behind the car so the view never whips around.
  const cam = player.cam;
  cam.yaw = car.heading + Math.PI;
  cam.pitch = 0.3;
  cam.distance = 10;
  cam.snapped = false;
  if (wasTraffic) {
    game.police?.addWanted(1, 'car theft');
    if (game.showToast) game.showToast('You stole the car — the cops noticed.');
  }
  return car;
}

export function exitCar(game) {
  const player = game.player;
  const car = player.driving;
  if (!car) return;
  car.kind = 'parked';
  car.parked = true;
  car.speed = 0;
  car.vel.set(0, 0, 0);
  // Step out on the driver's side (left of the car's forward axis).
  const sx = -Math.cos(car.heading);
  const sz = Math.sin(car.heading);
  player.pos.set(car.pos.x + sx * 2.4, 0, car.pos.z + sz * 2.4);
  resolveCircle(game.world, player.pos, 0.45);
  player.heading = car.heading;
  player.group.visible = true;
  player.group.position.copy(player.pos);
  player.group.rotation.y = player.heading;
  player.driving = null;
  player.cam.distance = 8;
  player.snapCamera();
}

// ---------------------------------------------------------------------------
// Chase camera while driving
// ---------------------------------------------------------------------------

function updateDriveCamera(game, dt) {
  const player = game.player;
  const car = player.driving;
  if (!car) return;
  const drag = game.input.consumeDrag ? game.input.consumeDrag() : { dx: 0, dy: 0 };
  player.cam.yaw -= drag.dx * 0.004;
  player.cam.pitch = clamp(player.cam.pitch + drag.dy * 0.003, 0.1, 0.9);
  const wheel = game.input.consumeWheel ? game.input.consumeWheel() : 0;
  if (wheel !== 0) {
    player.cam.distance = clamp(player.cam.distance * (1 + wheel * 0.001), 6, 18);
  }
  // Camera yaw eases back behind the car when the player is not dragging.
  if (Math.abs(drag.dx) < 0.5) {
    player.cam.yaw = turnToward(player.cam.yaw, car.heading + Math.PI, 1.4 * dt);
  }
  const cp = Math.cos(player.cam.pitch);
  const sp = Math.sin(player.cam.pitch);
  const d = player.cam.distance;
  const desired = new THREE.Vector3(
    car.pos.x + Math.sin(player.cam.yaw) * cp * d,
    3.2 + sp * d,
    car.pos.z + Math.cos(player.cam.yaw) * cp * d,
  );
  const k = 1 - Math.exp(-7 * dt);
  game.camera.position.lerp(desired, k);
  game.camera.lookAt(
    car.pos.x + Math.sin(car.heading) * 6,
    1.6,
    car.pos.z + Math.cos(car.heading) * 6,
  );
}

// ---------------------------------------------------------------------------
// Per-frame update
// ---------------------------------------------------------------------------

export function createVehicles(game) {
  const vehicles = {
    eWasDown: false,
    update(dt) {
      const keys = game.input.keys;
      // Edge-triggered E: enter / exit.
      const eDown = keys.has('KeyE');
      if (eDown && !vehicles.eWasDown) {
        if (game.player.driving) exitCar(game);
        else {
          const car = nearestCar(game, game.player.pos);
          if (car) enterCar(game, car);
        }
      }
      vehicles.eWasDown = eDown;

      // Player driving input.
      const car = game.player.driving;
      if (car) {
        const steer = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
          - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
        const throttle = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
          - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
        driveCar(game, car, steer, throttle, dt);
        updateDriveCamera(game, dt);
        // Speed readout lives in hud.js now (single writer for the HUD).
      }

      // Traffic: keep the target count alive, spawning away from the player
      // so cars do not pop in on screen.
      let trafficCount = 0;
      for (const c of game.vehicles) if (c.kind === 'traffic') trafficCount++;
      if (trafficCount < TRAFFIC_TARGET) {
        const far = game.vehicles.filter((c) => c.kind === 'traffic'
          && dist2D(c.pos, game.player.pos) > 120);
        if (far.length > 0) {
          // Recycle a far-away car instead of growing the scene forever.
          const old = far[0];
          removeCar(game, old);
        }
        spawnTrafficCar(game);
      }

      // Update every car by kind.
      for (const c of [...game.vehicles]) {
        if (c.kind === 'traffic') updateTrafficCar(game, c, dt);
        else if (c.kind === 'police') game.police?.updateCopCar?.(game, c, dt);
        else if (c.kind === 'parked') {
          // Parked: nothing moves, but wheels/smoke still age out.
          updateSmoke(game, c, dt);
        }
        // Police light-bar strobe.
        if (c.lightBarL && c.lightBarR) {
          c.flashPhase += dt * 10;
          const on = Math.sin(c.flashPhase) > 0;
          c.lightBarL.material.emissiveIntensity = on ? 2.6 : 0.15;
          c.lightBarR.material.emissiveIntensity = on ? 0.15 : 2.6;
        }
      }

      resolveCarCollisions(game, dt);
    },
  };
  // Seed the first traffic at boot so the streets are alive immediately.
  for (let i = 0; i < TRAFFIC_TARGET; i++) spawnTrafficCar(game);
  game.vehicles = game.vehicles; // registry already on the shared object
  return vehicles;
}
