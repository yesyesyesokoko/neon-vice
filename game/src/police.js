// Wanted system + police for Neon Vice: 0-5 stars, police cars that spawn
// at the city edge and chase/ram the player, foot officers at 2+ stars,
// BUSTED (caught on foot) and WASTED (health zero) with fines + respawn.
// The HUD stars / cash / health elements are updated directly here.

import * as THREE from 'three';
import { clamp, angleDelta, dist2D, turnToward } from './utils.js';
import { createCar, removeCar, driveCar, damageCar } from './vehicles.js';
import { resolveCircle } from './city.js';
import { buildHumanoid } from './combat.js';

const MAX_COPS = 5;
const DECAY_QUIET_TIME = 25;   // seconds without a crime before stars decay
const DECAY_STEP = 12;         // seconds per star lost while quiet + unseen
const BUST_DIST = 4.5;         // cop must be this close to bust the player
const BUST_TIME = 2.5;         // ...for this long, while the player is on foot
const OFFICER_SPEED = 6.5;

function hudStars(wanted) {
  const el = document.getElementById('stars');
  if (!el) return;
  let html = '';
  for (let i = 0; i < 5; i++) {
    html += i < wanted ? '★' : '<span class="dim">★</span>';
  }
  el.innerHTML = html;
}

function hudCash(amount) {
  const el = document.getElementById('cash');
  if (el) el.textContent = `$ ${amount}`;
}

// --- road-graph routing for police ---------------------------------------
// The road network is a small graph: junctions are road endpoints, edges
// are the roads. Dijkstra over it gives a real route to the player instead
// of the greedy "far end nearest the player" choice, which sent cops down
// the wrong street whenever the player stood just past a junction.

function junctionKey(x, z) {
  return `${Math.round(x)},${Math.round(z)}`;
}

function nearestRoadToPoint(world, x, z) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < world.roads.length; i++) {
    const r = world.roads[i];
    const dx = r.end.x - r.start.x;
    const dz = r.end.z - r.start.z;
    const len2 = dx * dx + dz * dz || 1;
    let t = ((x - r.start.x) * dx + (z - r.start.z) * dz) / len2;
    t = clamp(t, 0, 1);
    const d = Math.hypot(x - (r.start.x + dx * t), z - (r.start.z + dz * t));
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// First edge of the shortest route from the junction at the end of
// `fromRoad` to either end of `targetRoad`. Returns { road, dir } or null.
function routeNextRoad(world, fromRoad, atEnd, targetRoad) {
  const adj = new Map(); // key -> [{ road, toKey, len }]
  const addEdge = (aKey, bKey, road, len) => {
    if (!adj.has(aKey)) adj.set(aKey, []);
    adj.get(aKey).push({ road, toKey: bKey, len });
  };
  const roadLen = (r) => Math.hypot(r.end.x - r.start.x, r.end.z - r.start.z);
  for (let i = 0; i < world.roads.length; i++) {
    const r = world.roads[i];
    const a = junctionKey(r.start.x, r.start.z);
    const b = junctionKey(r.end.x, r.end.z);
    const len = roadLen(r);
    addEdge(a, b, i, len);
    addEdge(b, a, i, len);
  }
  const from = world.roads[fromRoad];
  const startKey = junctionKey(atEnd ? from.end.x : from.start.x, atEnd ? from.end.z : from.start.z);
  const target = world.roads[targetRoad];
  const goalA = junctionKey(target.start.x, target.start.z);
  const goalB = junctionKey(target.end.x, target.end.z);
  // Dijkstra with a linear-scan open set (the graph is tiny).
  const dist = new Map([[startKey, 0]]);
  const prev = new Map(); // key -> { fromKey, road }
  const open = [startKey];
  const closed = new Set();
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (dist.get(open[i]) < dist.get(open[bi])) bi = i;
    const key = open.splice(bi, 1)[0];
    if (closed.has(key)) continue;
    closed.add(key);
    if (key === goalA || key === goalB) {
      // Walk back to the start to find the first edge.
      let cur = key;
      let first = null;
      while (prev.has(cur)) {
        first = prev.get(cur);
        cur = first.fromKey;
        if (cur === startKey) break;
      }
      if (!first) return null; // already at the target junction
      const road = world.roads[first.road];
      const dir = junctionKey(road.start.x, road.start.z) === startKey ? 1 : -1;
      return { road: first.road, dir };
    }
    for (const e of adj.get(key) || []) {
      if (e.road === fromRoad && key === startKey) continue; // don't U-turn at once
      const nd = dist.get(key) + e.len;
      if (nd < (dist.get(e.toKey) ?? Infinity)) {
        dist.set(e.toKey, nd);
        prev.set(e.toKey, { fromKey: key, road: e.road });
        if (!open.includes(e.toKey)) open.push(e.toKey);
      }
    }
  }
  return null;
}

export function createPolice(game) {
  const police = {
    wanted: 0,
    lastCrimeAt: -Infinity,
    decayAt: 0,
    cops: [],
    officers: [],
    bustTimer: 0,
    spawnCooldown: 0,

    addWanted(n, reason) {
      if (n <= 0) return;
      this.wanted = clamp(this.wanted + n, 0, 5);
      this.lastCrimeAt = game.clock.elapsedTime;
      hudStars(this.wanted);
      if (reason && game.showToast) {
        game.showToast(`Wanted level ${this.wanted} — ${reason}`);
      }
    },

    clearWanted() {
      this.wanted = 0;
      this.bustTimer = 0;
      hudStars(0);
    },

    // --- fines / respawn -------------------------------------------------
    // respawnPlayer is the entry point; the actual respawn happens in
    // doRespawn, deferred until the player dismisses the BUSTED/WASTED
    // overlay (HUD) with Enter or the RESPAWN button. Without a HUD the
    // respawn is immediate, as before.
    respawnPending: null,

    respawnPlayer(fine, label) {
      if (this.respawnPending) return; // already waiting on an overlay
      if (game.hud) {
        this.respawnPending = { fine, label };
        game.hud.showEndOverlay(label, fine, () => {
          this.respawnPending = null;
          this.doRespawn(fine, label);
        });
        return;
      }
      this.doRespawn(fine, label);
    },

    doRespawn(fine, label) {
      const player = game.player;
      game.cash = Math.max(0, game.cash - fine);
      hudCash(game.cash);
      if (player.driving) {
        // Leave the car where it is, parked.
        const car = player.driving;
        car.kind = 'parked';
        car.parked = true;
        car.speed = 0;
        car.vel.set(0, 0, 0);
        player.driving = null;
      }
      player.health = player.maxHealth;
      const healthEl = document.getElementById('health');
      if (healthEl) healthEl.style.width = '100%';
      const spawn = game.world.playerSpawn;
      player.pos.set(spawn.x, 0, spawn.z);
      player.vel.set(0, 0, 0);
      player.heading = spawn.heading;
      player.group.visible = true;
      player.group.position.copy(player.pos);
      player.group.rotation.y = player.heading;
      player.snapCamera();
      this.clearWanted();
      this.despawnAll();
      if (game.showToast) game.showToast(`${label} — $${fine} fine.`);
    },

    busted() {
      const fine = Math.min(game.cash, 100 + 100 * this.wanted);
      this.respawnPlayer(fine, 'BUSTED');
    },

    wasted() {
      const fine = Math.min(game.cash, 300 + 100 * this.wanted);
      this.respawnPlayer(fine, 'WASTED');
    },

    damagePlayer(amount) {
      const player = game.player;
      if (player.health <= 0) return;
      player.health = Math.max(0, player.health - amount);
      const healthEl = document.getElementById('health');
      if (healthEl) healthEl.style.width = `${(player.health / player.maxHealth) * 100}%`;
      if (player.health <= 0) this.wasted();
    },

    // --- spawning ----------------------------------------------------------
    edgeSpawnPoint() {
      const p = game.player.driving ? game.player.driving.pos : game.player.pos;
      const b = game.world.bounds;
      // Nearest city edge to the player, with a random offset along it.
      const edges = [
        { x: b.minX, z: clamp(p.z + (Math.random() - 0.5) * 120, b.minZ, b.maxZ) },
        { x: b.maxX, z: clamp(p.z + (Math.random() - 0.5) * 120, b.minZ, b.maxZ) },
        { x: clamp(p.x + (Math.random() - 0.5) * 120, b.minX, b.maxX), z: b.minZ },
        { x: clamp(p.x + (Math.random() - 0.5) * 120, b.minX, b.maxX), z: b.maxZ },
      ];
      let best = edges[0];
      let bestD = Infinity;
      for (const e of edges) {
        const d = dist2D(p, e);
        if (d < bestD) { bestD = d; best = e; }
      }
      // If the nearest edge is too close, use the farthest one instead.
      if (bestD < 55) {
        let far = edges[0];
        let farD = -1;
        for (const e of edges) {
          const d = dist2D(p, e);
          if (d > farD) { farD = d; far = e; }
        }
        best = far;
      }
      return best;
    },

    spawnCop() {
      const at = this.edgeSpawnPoint();
      const playerPos = game.player.driving ? game.player.driving.pos : game.player.pos;
      const heading = Math.atan2(playerPos.x - at.x, playerPos.z - at.z);
      const car = createCar(game, 'police', { kind: 'police', x: at.x, z: at.z, heading });
      car.stuckTimer = 0;
      game.vehicles.push(car);
      this.cops.push(car);
      return car;
    },

    spawnOfficer() {
      const playerPos = game.player.pos;
      const angle = Math.random() * Math.PI * 2;
      const x = clamp(playerPos.x + Math.cos(angle) * 22, -290, 290);
      const z = clamp(playerPos.z + Math.sin(angle) * 22, -290, 290);
      const body = buildHumanoid({
        jacket: 0x1c2f55, pants: 0x14181f, skin: 0xd9a37e, hat: true,
      });
      body.group.position.set(x, 0, z);
      body.group.userData = { hittable: 'officer', ref: null };
      game.scene.add(body.group);
      const officer = {
        body, pos: body.group.position, heading: 0, health: 100,
        punchCooldown: 0, fallTimer: -1, fadeTimer: 0, speed: 0,
      };
      body.group.userData.ref = officer;
      this.officers.push(officer);
      return officer;
    },

    despawnAll() {
      for (const cop of [...this.cops]) removeCar(game, cop);
      this.cops.length = 0;
      for (const off of [...this.officers]) {
        game.scene.remove(off.body.group);
      }
      this.officers.length = 0;
    },

    // Called by vehicles.damageCar when a police car is destroyed.
    onCopDisabled(car) {
      const i = this.cops.indexOf(car);
      if (i >= 0) this.cops.splice(i, 1);
      // The wreck stays as a smoking parked car; traffic ignores it.
      car.kind = 'parked';
      car.parked = true;
      car.speed = 0;
      if (game.showToast) game.showToast('Police car disabled.');
    },

    // Called by the collision resolver when a police car rams the player.
    onRam(copCar) {
      if (game.player.driving) {
        damageCar(game, game.player.driving, 8);
      }
    },

    // --- per-frame ---------------------------------------------------------
    update(dt) {
      // While a BUSTED/WASTED overlay is up, the world waits for the
      // player to respawn; nothing else here may fire meanwhile.
      if (this.respawnPending) return;
      const t = game.clock.elapsedTime;
      const player = game.player;
      const playerPos = player.driving ? player.driving.pos : player.pos;

      // Keep the cop count matched to the wanted level.
      this.spawnCooldown -= dt;
      const wantCops = this.wanted;
      if (this.cops.length < wantCops && this.spawnCooldown <= 0) {
        this.spawnCop();
        this.spawnCooldown = 2.5;
      }
      if (this.wanted === 0 && this.cops.length > 0) {
        // Wanted cleared: the heat is off, cops leave.
        this.despawnAll();
      }

      // Foot officers at 2+ stars, at most two on foot.
      const wantOfficers = this.wanted >= 2 ? Math.min(2, this.wanted - 1) : 0;
      if (this.officers.length < wantOfficers && this.spawnCooldown <= 0) {
        this.spawnOfficer();
        this.spawnCooldown = 3;
      }
      for (const off of [...this.officers]) this.updateOfficer(off, dt);

      // BUSTED check: on foot, a cop parked close to the player.
      if (!player.driving && this.wanted > 0) {
        let close = false;
        for (const cop of this.cops) {
          if (dist2D(cop.pos, playerPos) < BUST_DIST && Math.abs(cop.speed) < 3) {
            close = true;
            break;
          }
        }
        if (close) {
          this.bustTimer += dt;
          if (this.bustTimer >= BUST_TIME) {
            this.bustTimer = 0;
            this.busted();
            return;
          }
        } else {
          this.bustTimer = Math.max(0, this.bustTimer - dt * 2);
        }
      } else {
        this.bustTimer = 0;
      }

      // Wanted decay: quiet for a while and no cop can see the player.
      if (this.wanted > 0 && t - this.lastCrimeAt > DECAY_QUIET_TIME) {
        let seen = false;
        for (const cop of this.cops) {
          if (dist2D(cop.pos, playerPos) < 45) { seen = true; break; }
        }
        if (!seen) {
          if (this.decayAt === 0) this.decayAt = t;
          if (t - this.decayAt > DECAY_STEP) {
            this.wanted--;
            hudStars(this.wanted);
            this.decayAt = t;
            if (this.wanted === 0 && game.showToast) game.showToast('You lost the cops.');
          }
        } else {
          this.decayAt = 0;
        }
      } else {
        this.decayAt = 0;
      }
    },

    // Called from vehicles.update for every police car.
    // Far away the cop follows the road network toward the player (a
    // straight bee-line would wedge it on buildings); inside 20 m it
    // steers straight at the player to ram. A wedged cop reverses out.
    updateCopCar(gameRef, car, dt) {
      const world = gameRef.world;
      const player = gameRef.player;
      const target = player.driving ? player.driving.pos : player.pos;
      const dx = target.x - car.pos.x;
      const dz = target.z - car.pos.z;
      const dist = Math.hypot(dx, dz);

      // Attach the cop to its nearest road the first time it updates.
      // Nearest by perpendicular distance to the segment: the old
      // start+end distance metric attached cops to a crossing road 20 m
      // away and routed them on a long detour.
      if (car.road < 0) {
        const best = nearestRoadToPoint(world, car.pos.x, car.pos.z);
        car.road = best;
        if (best >= 0) {
          const r = world.roads[best];
          const rdx = r.end.x - r.start.x;
          const rdz = r.end.z - r.start.z;
          const len2 = rdx * rdx + rdz * rdz || 1;
          const len = Math.sqrt(len2);
          const proj = clamp(((car.pos.x - r.start.x) * rdx + (car.pos.z - r.start.z) * rdz) / len2, 0, 1) * len;
          car.roadDir = Math.cos(angleDelta(Math.atan2(r.dir.x, r.dir.z), car.heading)) >= 0 ? 1 : -1;
          car.roadS = car.roadDir === 1 ? proj : len - proj;
        }
      }

      let steer;
      let throttle = 1;
      if (dist > 20 && car.road >= 0) {
        // Road-follow toward the player: aim at a point further along the
        // current segment, and at each junction take the first edge of the
        // shortest route to the road the player is on.
        const road = world.roads[car.road];
        const len = Math.hypot(road.end.x - road.start.x, road.end.z - road.start.z);
        // Keep the target road fresh (the player may move to another road).
        car.targetTimer = (car.targetTimer || 0) - dt;
        if (car.targetRoad === undefined || car.targetTimer <= 0) {
          car.targetTimer = 1;
          car.targetRoad = nearestRoadToPoint(world, target.x, target.z);
        }
        // On the player's road, face the player's projection instead of
        // driving to the far end and turning around there.
        if (car.road === car.targetRoad) {
          const proj = clamp((target.x - road.start.x) * road.dir.x
            + (target.z - road.start.z) * road.dir.z, 0, len);
          if (Math.abs(proj - car.roadS) > 5) {
            car.roadDir = proj > car.roadS ? 1 : -1;
          }
        }
        const ahead = clamp(car.roadS + 12, 0, len);
        const along = car.roadDir === 1 ? ahead : len - ahead;
        let tx = road.start.x + road.dir.x * along;
        let tz = road.start.z + road.dir.z * along;
        // Overtake: if a car is close ahead on the same lane, shift the
        // waypoint sideways so the cop swings around it instead of
        // shoving it down the road at walking pace. The offset is sticky
        // for a couple of seconds: without that the cop steers back to
        // the centreline the moment it is half past and never gets by.
        const cfx = Math.sin(car.heading);
        const cfz = Math.cos(car.heading);
        car.overtakeTimer = Math.max(0, (car.overtakeTimer || 0) - dt);
        if (car.overtakeTimer <= 0) {
          for (const other of gameRef.vehicles) {
            if (other === car) continue;
            const odx = other.pos.x - car.pos.x;
            const odz = other.pos.z - car.pos.z;
            const aheadDist = odx * cfx + odz * cfz;
            const sideDist = Math.abs(odx * cfz - odz * cfx);
            if (aheadDist > 0 && aheadDist < 11 && sideDist < 2.6) {
              car.overtakeTimer = 2.5;
              car.overtakeDX = cfz * 3;
              car.overtakeDZ = -cfx * 3;
              break;
            }
          }
        }
        if (car.overtakeTimer > 0) {
          tx += car.overtakeDX;
          tz += car.overtakeDZ;
        }
        const turnErr = angleDelta(car.heading, Math.atan2(tx - car.pos.x, tz - car.pos.z));
        steer = clamp(turnErr * 1.6, -1, 1);
        // Brake for sharp turns: at full speed the turn radius is far too
        // wide for a city junction, so the cop would overshoot into a
        // building. Slow to ~10 m/s before turning.
        if (Math.abs(turnErr) > 0.55 && Math.abs(car.speed) > 12) throttle = -1;
        else if (Math.abs(turnErr) > 0.3) throttle = 0.3;
        // Wedged in road-follow mode: reverse out for a second.
        car.slowTimer = (Math.abs(car.speed) < 1.2)
          ? (car.slowTimer || 0) + dt : 0;
        if ((car.slowTimer || 0) > 1.5) {
          car.reverseTimer = 1.0;
          car.slowTimer = 0;
        }
        if ((car.reverseTimer || 0) > 0) {
          car.reverseTimer -= dt;
          throttle = -1;
        }
        driveCar(gameRef, car, steer, throttle, dt);
        // Advance along the road by projecting the new position onto it.
        const px = car.pos.x - road.start.x;
        const pz = car.pos.z - road.start.z;
        const proj = clamp(px * road.dir.x + pz * road.dir.z, 0, len);
        car.roadS = car.roadDir === 1 ? proj : len - proj;
        if (car.roadS >= len - 1) {
          const atEnd = car.roadDir === 1;
          let bestOpt = null;
          if (car.targetRoad !== undefined && car.targetRoad !== car.road) {
            bestOpt = routeNextRoad(world, car.road, atEnd, car.targetRoad);
          }
          if (!bestOpt) {
            // Already at the target junction (or no route): take the road
            // whose segment passes closest to the player.
            const jx = atEnd ? road.end.x : road.start.x;
            const jz = atEnd ? road.end.z : road.start.z;
            let bestD = Infinity;
            for (let i = 0; i < world.roads.length; i++) {
              if (i === car.road) continue;
              const o = world.roads[i];
              let dir;
              if (Math.hypot(o.start.x - jx, o.start.z - jz) < 1.5) dir = 1;
              else if (Math.hypot(o.end.x - jx, o.end.z - jz) < 1.5) dir = -1;
              else continue;
              const dx = o.end.x - o.start.x;
              const dz = o.end.z - o.start.z;
              const len2 = dx * dx + dz * dz || 1;
              let t = ((target.x - o.start.x) * dx + (target.z - o.start.z) * dz) / len2;
              t = clamp(t, 0, 1);
              const d = Math.hypot(target.x - (o.start.x + dx * t), target.z - (o.start.z + dz * t));
              if (d < bestD) { bestD = d; bestOpt = { road: i, dir }; }
            }
          }
          if (bestOpt) {
            car.road = bestOpt.road;
            car.roadDir = bestOpt.dir;
            const nr = world.roads[bestOpt.road];
            const nlen = Math.hypot(nr.end.x - nr.start.x, nr.end.z - nr.start.z);
            car.roadS = bestOpt.dir === 1 ? 0 : nlen;
          } else {
            car.roadDir *= -1;
            car.roadS = clamp(car.roadS, 1, len - 1);
          }
        }
      } else {
        // Close range: steer straight at the player to ram.
        const wantHeading = Math.atan2(dx, dz);
        steer = clamp(angleDelta(car.heading, wantHeading) * 1.8, -1, 1);
        // Ease off the gas when right on top of an on-foot player so the
        // cop stops next to them (bust) instead of running them over.
        if (!player.driving && dist < 6) throttle = dist > 3.5 ? 0.4 : 0;
        if (player.driving && dist < 5) throttle = 1; // keep ramming
        // Wedged against a wall while chasing: reverse out for a second.
        car.slowTimer = (Math.abs(car.speed) < 1.2 && dist > 8)
          ? (car.slowTimer || 0) + dt : 0;
        if ((car.slowTimer || 0) > 1.5) {
          car.reverseTimer = 1.0;
          car.slowTimer = 0;
        }
        if ((car.reverseTimer || 0) > 0) {
          car.reverseTimer -= dt;
          throttle = -1;
        }
        driveCar(gameRef, car, steer, throttle, dt);
      }

      // Ramming an on-foot player hurts them.
      car.ramCooldown = Math.max(0, (car.ramCooldown || 0) - dt);
      if (!player.driving && dist < 2.4 && car.ramCooldown <= 0) {
        car.ramCooldown = 1.2;
        this.damagePlayer(12);
        // Shove the player away from the car.
        player.pos.x += (dx / (dist || 1)) * -2;
        player.pos.z += (dz / (dist || 1)) * -2;
        resolveCircle(gameRef.world, player.pos, 0.45);
      }

      // Stuck against a building for a while: re-deploy at the city edge.
      if (Math.abs(car.speed) < 0.6 && dist > 12) {
        car.stuckTimer = (car.stuckTimer || 0) + dt;
        if (car.stuckTimer > 5) {
          const at = this.edgeSpawnPoint();
          car.pos.set(at.x, 0, at.z);
          car.heading = Math.atan2(target.x - at.x, target.z - at.z);
          car.speed = 0;
          car.vel.set(0, 0, 0);
          car.stuckTimer = 0;
          car.road = -1; // re-attach to the nearest road on next update
        }
      } else {
        car.stuckTimer = 0;
      }
    },

    updateOfficer(off, dt) {
      const player = game.player;
      if (off.fallTimer >= 0) {
        // Fallen officer: lie flat, fade, then remove.
        off.fallTimer += dt;
        off.body.group.rotation.x = lerp(off.body.group.rotation.x, -Math.PI / 2, 1 - Math.exp(-8 * dt));
        if (off.fallTimer > 1.2) {
          off.fadeTimer += dt;
          const k = 1 - off.fadeTimer / 1.2;
          off.body.group.traverse((o) => {
            if (o.isMesh) {
              o.material.transparent = true;
              o.material.opacity = Math.max(0, k);
            }
          });
          if (off.fadeTimer >= 1.2) {
            game.scene.remove(off.body.group);
            const i = this.officers.indexOf(off);
            if (i >= 0) this.officers.splice(i, 1);
          }
        }
        return;
      }
      const dx = player.pos.x - off.pos.x;
      const dz = player.pos.z - off.pos.z;
      const dist = Math.hypot(dx, dz);
      // Chase the player on foot (even if they are driving, officers run
      // after the car and give up if it gets far away).
      const targetDist = player.driving ? 60 : 1.6;
      if (dist > targetDist) {
        const heading = Math.atan2(dx, dz);
        off.heading = turnToward(off.heading, heading, 8 * dt);
        const speed = player.driving ? OFFICER_SPEED + 1.5 : OFFICER_SPEED;
        off.pos.x += Math.sin(off.heading) * speed * dt;
        off.pos.z += Math.cos(off.heading) * speed * dt;
        resolveCircle(game.world, off.pos, 0.45);
        off.speed = speed;
        // Run animation: reuse the walk swing from the body parts.
        off.body.walkPhase = (off.body.walkPhase || 0) + dt * speed * 2.4;
        const swing = Math.sin(off.body.walkPhase) * 0.7;
        off.body.legL.rotation.x = swing;
        off.body.legR.rotation.x = -swing;
        off.body.armL.rotation.x = -swing * 0.8;
        off.body.armR.rotation.x = swing * 0.8;
      } else {
        off.speed = 0;
        off.body.legL.rotation.x = 0;
        off.body.legR.rotation.x = 0;
        // Punch the player when in reach.
        off.punchCooldown -= dt;
        if (!player.driving && dist < 1.8 && off.punchCooldown <= 0) {
          off.punchCooldown = 1.1;
          this.damagePlayer(6);
          if (game.showToast) game.showToast('An officer is beating you down!');
        }
      }
      off.body.group.position.copy(off.pos);
      off.body.group.rotation.y = off.heading;
    },
  };

  game.police = police;
  hudStars(0);
  return police;
}
