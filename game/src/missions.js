// Story + mission system for Neon Vice: seven jobs that unlock in order,
// told through a dialogue box, with a 3D beacon, minimap blip, live
// objective line, compass arrow, cash rewards, and fail/retry handling.
// The player is a driver fresh back in Neon Bay who owes money to Rosa
// Vale, a fixer who runs a cafe on the boulevard. All names, story and
// dialogue are original to this game.

import * as THREE from 'three';
import { clamp, dist2D } from './utils.js';
import { createCar, removeCar } from './vehicles.js';
import { buildHumanoid } from './combat.js';
import { resolveCircle } from './city.js';

const START_RADIUS = 7;   // walk/drive into the start marker to begin a job
const TARGET_RADIUS = 6;  // reach radius for delivery targets
const CHECKPOINT_RADIUS = 8;

const DEFS = [
  {
    id: 'm1',
    name: 'Back in Neon Bay',
    type: 'reach',
    reward: 300,
    timeLimit: 0,
    start: { x: 0, z: -12 },
    startLabel: 'Rosa\u2019s corner',
    target: { x: 60, z: -60, label: 'Cafe Lumen' },
    objective: 'Drive to Cafe Lumen and see Rosa Vale.',
    intro: {
      speaker: 'Rosa Vale',
      text: 'Well, well. The driver who vanished for two years walks back into my city like he owns the place. You still owe me, kid — but I like you, so let\u2019s start small. Come to my cafe. First coffee\u2019s on me. The debt is not.',
    },
    doneText: 'Rosa slides a coffee across the counter. \u201cSee? Easy money. Don\u2019t get used to it.\u201d',
    failText: 'Rosa taps her watch. \u201cThe cafe didn\u2019t move, kid. Come back when you can find it.\u201d',
  },
  {
    id: 'm2',
    name: 'The Midnight Parcel',
    type: 'timed',
    reward: 500,
    timeLimit: 150,
    start: { x: 60, z: -60 },
    startLabel: 'Cafe Lumen',
    target: { x: -180, z: 120, label: 'Pier 9 warehouse' },
    objective: 'Deliver the parcel to the Pier 9 warehouse before the timer runs out.',
    intro: {
      speaker: 'Rosa Vale',
      text: 'A friend of mine left a parcel at the cafe and it needs to be across town, fast. What\u2019s inside? Don\u2019t ask. What happens if you\u2019re late? Also don\u2019t ask. The clock is already running, sweetheart.',
    },
    doneText: 'The warehouse clerk signs without looking up. \u201cOn time. Rosa\u2019s people usually are.\u201d',
    failText: 'Rosa sighs into the phone. \u201cLate is late, kid. The parcel went back in the fridge. We\u2019ll try again tomorrow — you will, anyway.\u201d',
  },
  {
    id: 'm3',
    name: 'Borrowed Beauty',
    type: 'steal',
    reward: 800,
    timeLimit: 0,
    start: { x: -180, z: 120 },
    startLabel: 'Pier 9 warehouse',
    target: { x: -120, z: -180, label: 'the magenta Comet GT' },
    garage: { x: 180, z: 60, label: 'Vic\u2019s garage' },
    objective: 'Take the magenta Comet GT and bring it to Vic\u2019s garage.',
    intro: {
      speaker: 'Rosa Vale',
      text: 'There\u2019s a magenta Comet GT parked up north, and its owner owes me more than you do. Bring it to Vic\u2019s garage and we\u2019ll call it even-ish. Try not to scratch it. Try not to get caught, either — that part matters more.',
    },
    doneText: 'Vic whistles as the Comet rolls in. \u201cNot a scratch. Rosa owes you a favour now. Don\u2019t spend it all at once.\u201d',
    failText: 'Rosa shakes her head. \u201cThat car was worth more than your whole wardrobe, kid. It\u2019s scrap now. Vic will find another one. You will pay for it.\u201d',
  },
  {
    id: 'm4',
    name: 'Heat Wave',
    type: 'loseHeat',
    reward: 600,
    timeLimit: 240,
    start: { x: 180, z: 60 },
    startLabel: 'Vic\u2019s garage',
    target: null,
    objective: 'Lose the cops — get your wanted level back to zero.',
    intro: {
      speaker: 'Rosa Vale',
      text: 'Bad news: somebody filmed the Comet job. Good news: they filmed it badly. The whole precinct is looking for you now, so go be invisible for a while. Duck down side streets, keep moving, and whatever you do, don\u2019t stop to admire the sirens.',
    },
    doneText: 'The radio goes quiet. Somewhere behind you, a siren gives up and turns for home.',
    failText: 'Rosa laughs when you call. \u201cFour minutes of heat and you\u2019re still glowing? Kid, you hide like a lighthouse.\u201d',
  },
  {
    id: 'm5',
    name: 'Dockside Static',
    type: 'shootout',
    reward: 1200,
    timeLimit: 0,
    start: { x: 60, z: 240 },
    startLabel: 'the docks road',
    target: { x: 60, z: 270, label: 'the docks' },
    objective: 'Deal with the Coral Kings crew at the docks — fists or pistol, your call.',
    intro: {
      speaker: 'Rosa Vale',
      text: 'The Coral Kings have been leaning on my dock deliveries, and I am fresh out of patience. Go down to the docks and have a firm word with them. A loud word. Bring the pistol if the talking doesn\u2019t work — it usually doesn\u2019t.',
    },
    doneText: 'The last King sits down hard on a crate. \u201cTell Rosa the docks are hers,\u201d he wheezes. \u201cTell her yourself,\u201d you say, and walk away.',
    failText: 'Rosa patches you up with a first-aid kit and a lecture. \u201cThe Kings are still standing, kid. So are you, barely. Go back when you\u2019re ready.\u201d',
  },
  {
    id: 'm6',
    name: 'Boulevard Blitz',
    type: 'race',
    reward: 900,
    timeLimit: 150,
    start: { x: -240, z: -240 },
    startLabel: 'north-west corner',
    checkpoints: [
      { x: -240, z: 0, label: 'Checkpoint 1' },
      { x: 240, z: 0, label: 'Checkpoint 2' },
      { x: 240, z: -240, label: 'Checkpoint 3' },
      { x: -240, z: -240, label: 'Checkpoint 4' },
    ],
    objective: 'Race through all four checkpoints around the boulevard before time runs out.',
    intro: {
      speaker: 'Rosa Vale',
      text: 'A rich kid with a fast car says nobody in Neon Bay can beat him around the boulevard. I put money on you, which means you cannot lose, because I hate losing money more than I like you. Four checkpoints. Don\u2019t be polite about it.',
    },
    doneText: 'The rich kid stares at the timer, then at you. \u201cRematch?\u201d he says. Rosa is already counting the winnings.',
    failText: 'Rosa pockets the betting slip with a sigh. \u201cThe kid\u2019s still bragging. Go practise your corners, then we take our money back.\u201d',
  },
  {
    id: 'm7',
    name: 'Marina Lights',
    type: 'reach',
    reward: 2500,
    timeLimit: 0,
    start: { x: -240, z: -240 },
    startLabel: 'north-west corner',
    target: { x: 240, z: 270, label: 'the marina boat' },
    objective: 'Deliver Rosa\u2019s case to the boat waiting at the marina.',
    intro: {
      speaker: 'Rosa Vale',
      text: 'Last job, kid, and then your debt is done. A little case, a boat at the marina, no questions. You\u2019ve driven this city like you were born in it. After tonight, you owe nobody anything — and that, in Neon Bay, is the rarest thing of all.',
    },
    doneText: 'The boat pulls away into the dark, its lights shrinking to stars. Your phone buzzes: one message from Rosa. \u201cDebt paid. Coffee\u2019s still on me. — R\u201d Neon Bay is yours now.',
    failText: 'Rosa doesn\u2019t even sound angry, which is worse. \u201cThe boat waited, kid. It won\u2019t wait twice. Come back when you\u2019re ready to finish this.\u201d',
  },
];

const RIVAL_COUNT = 5;
const RIVAL_SPEED = 5.5;
const RIVAL_DAMAGE = 5;

function makeBeacon(color) {
  const group = new THREE.Group();
  const cyl = new THREE.Mesh(
    new THREE.CylinderGeometry(3, 3, 26, 24, 1, true),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  cyl.position.y = 13;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(2.2, 3, 32),
    new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.15;
  const gem = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.9),
    new THREE.MeshBasicMaterial({ color }),
  );
  gem.position.y = 6;
  group.add(cyl, ring, gem);
  group.userData = { cyl, ring, gem, phase: Math.random() * 6 };
  group.visible = false;
  return group;
}

export function createMissions(game) {
  const startBeacon = makeBeacon(0xffd23a); // yellow: where a job begins
  const targetBeacon = makeBeacon(0xff2ea6); // magenta: where the job goes
  game.scene.add(startBeacon, targetBeacon);

  const missions = {
    defs: DEFS,
    status: DEFS.map((_, i) => (i === 0 ? 'available' : 'locked')),
    current: -1,
    timer: 0,
    checkpointIdx: 0,
    phase: 1,
    rivals: [],
    targetCar: null,
    stolen: false,
    pendingStart: -1,

    completedIndices() {
      const out = [];
      this.status.forEach((s, i) => { if (s === 'done') out.push(i); });
      return out;
    },

    nextAvailable() {
      for (let i = 0; i < this.status.length; i++) {
        if (this.status[i] === 'available') return i;
      }
      return -1;
    },

    allDone() {
      return this.status.every((s) => s === 'done');
    },

    playerPos() {
      const p = game.player;
      return p.driving ? p.driving.pos : p.pos;
    },

    // The point the HUD, minimap and compass should point at right now:
    // the active target, or the start marker of the next available job.
    currentTargetPos() {
      if (this.current >= 0) {
        const def = DEFS[this.current];
        if (def.type === 'steal' && this.phase === 1 && this.targetCar) {
          return { x: this.targetCar.pos.x, z: this.targetCar.pos.z };
        }
        if (def.type === 'steal' && this.phase === 2) return def.garage;
        if (def.type === 'race') return def.checkpoints[this.checkpointIdx] || null;
        if (def.type === 'loseHeat') return null;
        return def.target || null;
      }
      const next = this.nextAvailable();
      if (next >= 0) return DEFS[next].start;
      return null;
    },

    objectiveText() {
      if (this.current >= 0) {
        const def = DEFS[this.current];
        let text = def.objective;
        if (def.type === 'steal' && this.phase === 2) {
          text = `Bring the Comet GT to ${def.garage.label}.`;
        }
        if (def.type === 'race') {
          text = `Checkpoint ${this.checkpointIdx + 1} of ${def.checkpoints.length} — ${def.checkpoints[this.checkpointIdx]?.label || ''}.`;
        }
        if (def.type === 'loseHeat') {
          text = `Lose the cops — wanted level ${game.police?.wanted ?? 0} / 0 stars.`;
        }
        if (def.timeLimit > 0) text += `  [${Math.max(0, Math.ceil(this.timer))}s]`;
        return text;
      }
      if (this.allDone()) return 'Every job done — Neon Bay is yours. Rosa owes YOU a coffee now.';
      const next = this.nextAvailable();
      if (next >= 0) {
        return `Next job: ${DEFS[next].name} — go to the yellow marker to start.`;
      }
      return 'Welcome to Neon Vice. Find your ride and make the city yours.';
    },

    // --- starting ---------------------------------------------------------
    requestStart(i) {
      if (this.status[i] !== 'available') return false;
      if (game.hud?.dialogueOpen) return false;
      this.pendingStart = i;
      const def = DEFS[i];
      if (game.hud) {
        game.hud.showDialogue({
          speaker: def.intro.speaker,
          title: def.name,
          text: def.intro.text,
          onClose: () => { this.pendingStart = -1; this.activate(i); },
        });
      } else {
        this.pendingStart = -1;
        this.activate(i);
      }
      return true;
    },

    activate(i) {
      const def = DEFS[i];
      this.current = i;
      this.status[i] = 'active';
      this.timer = def.timeLimit || 0;
      this.checkpointIdx = 0;
      this.phase = 1;
      this.stolen = false;
      this.rivals = [];
      this.targetCar = null;
      if (def.type === 'steal') this.spawnTargetCar(def);
      if (def.type === 'shootout') this.spawnRivals(def);
      if (def.type === 'loseHeat') game.police?.addWanted(3, 'The heat is on');
      game.audio?.blip?.();
      if (game.showToast) game.showToast(`${def.name} — ${def.objective}`);
      this.placeBeacons();
    },

    spawnTargetCar(def) {
      const car = createCar(game, 'sports', {
        kind: 'parked', x: def.target.x, z: def.target.z,
        heading: Math.PI / 2, color: 0xff2ea6,
      });
      car.missionCar = true;
      game.vehicles.push(car);
      this.targetCar = car;
    },

    spawnRivals(def) {
      for (let n = 0; n < RIVAL_COUNT; n++) {
        const angle = (n / RIVAL_COUNT) * Math.PI * 2;
        const x = clamp(def.target.x + Math.cos(angle) * 9, -290, 290);
        const z = clamp(def.target.z + Math.sin(angle) * 9, -290, 290);
        const body = buildHumanoid({
          jacket: 0x8a1f2e, pants: 0x1a1a1a, skin: 0xd9a37e,
        });
        body.group.position.set(x, 0, z);
        game.scene.add(body.group);
        const rival = {
          body,
          pos: body.group.position,
          heading: Math.random() * Math.PI * 2,
          health: 100,
          state: 'stroll',
          target: { x: def.target.x, z: def.target.z },
          fleeTimer: 0,
          fleeFrom: null,
          fallTimer: -1,
          fadeTimer: 0,
          knock: new THREE.Vector3(),
          walkPhase: Math.random() * 6,
          speed: 0,
          punchCooldown: 0,
          isRival: true,
        };
        body.group.userData = { hittable: 'ped', ref: rival };
        game.combat?.peds.push(rival);
        this.rivals.push(rival);
      }
    },

    // --- finishing ---------------------------------------------------------
    completeCurrent() {
      const i = this.current;
      if (i < 0) return;
      const def = DEFS[i];
      // Mark done BEFORE cleanup: cleanup keeps the delivered car only
      // when the job actually succeeded.
      this.status[i] = 'done';
      this.cleanupMission();
      this.current = -1;
      game.cash += def.reward;
      game.audio?.jingle?.();
      if (game.showToast) {
        game.showToast(`${def.name} complete — +$${def.reward}.`);
      }
      if (i + 1 < DEFS.length && this.status[i + 1] === 'locked') {
        this.status[i + 1] = 'available';
        if (game.showToast) {
          game.showToast(`New job unlocked: ${DEFS[i + 1].name}.`);
        }
      }
      if (i === DEFS.length - 1) {
        // Finale: let Rosa have the last word.
        if (game.hud) {
          game.hud.showDialogue({
            speaker: 'Rosa Vale', title: 'Marina Lights',
            text: def.doneText, onClose: null,
          });
        }
      } else if (game.hud) {
        game.hud.showDialogue({
          speaker: 'Rosa Vale', title: `${def.name} — done`,
          text: def.doneText, onClose: null,
        });
      }
      game.save?.save(true); // autosave on mission completion
      this.placeBeacons();
    },

    failCurrent(reason, silent = false) {
      const i = this.current;
      if (i < 0) return;
      const def = DEFS[i];
      this.cleanupMission();
      this.status[i] = 'available';
      this.current = -1;
      if (!silent) {
        if (game.showToast) game.showToast(`${def.name} failed — try again at the yellow marker.`);
        // No dialogue when the failure is busted/wasted: the BUSTED /
        // WASTED overlay is already on screen above the dialogue box,
        // and a stacked dialogue would swallow the first Enter that is
        // meant to respawn the player.
        if (reason !== 'busted' && reason !== 'wasted' && game.hud) {
          game.hud.showDialogue({
            speaker: 'Rosa Vale', title: `${def.name} — not this time`,
            text: def.failText, onClose: null,
          });
        }
      }
      this.placeBeacons();
    },

    // Restart the active job from the pause menu: back to its start marker.
    restartCurrent() {
      if (this.current < 0) return false;
      this.failCurrent('restart', true);
      if (game.showToast) game.showToast('Job restarted — head to the yellow marker.');
      return true;
    },

    cleanupMission() {
      for (const r of this.rivals) {
        const pi = game.combat?.peds.indexOf(r);
        if (pi >= 0) game.combat.peds.splice(pi, 1);
        game.scene.remove(r.body.group);
      }
      this.rivals = [];
      if (this.targetCar) {
        // On failure the car is scrapped; on success it stays parked where
        // it was delivered. Only remove it when the job failed.
        if (this.status[this.current] !== 'done') removeCar(game, this.targetCar);
        else this.targetCar.missionCar = false;
        this.targetCar = null;
      }
    },

    // --- save / load -------------------------------------------------------
    applySave(data) {
      this.cleanupMission();
      this.current = -1;
      this.status = DEFS.map((_, i) => {
        if (data?.completed?.includes(i)) return 'done';
        return 'locked';
      });
      const next = this.status.findIndex((s) => s !== 'done');
      if (next >= 0) this.status[next] = 'available';
      this.placeBeacons();
    },

    // --- beacons -----------------------------------------------------------
    placeBeacons() {
      const next = this.nextAvailable();
      if (this.current < 0 && next >= 0) {
        startBeacon.position.set(DEFS[next].start.x, 0, DEFS[next].start.z);
        startBeacon.visible = true;
      } else {
        startBeacon.visible = false;
      }
      const tp = this.currentTargetPos();
      if (this.current >= 0 && tp) {
        targetBeacon.position.set(tp.x, 0, tp.z);
        targetBeacon.visible = true;
      } else {
        targetBeacon.visible = false;
      }
    },

    pulseBeacon(beacon, dt, t) {
      const u = beacon.userData;
      u.phase += dt;
      const s = 1 + Math.sin(u.phase * 3) * 0.12;
      u.ring.scale.set(s, s, 1);
      u.cyl.material.opacity = 0.16 + 0.08 * Math.sin(u.phase * 3);
      u.gem.rotation.y += dt * 1.5;
      u.gem.position.y = 6 + Math.sin(u.phase * 2) * 0.7;
      void t;
    },

    // --- per-frame -----------------------------------------------------------
    update(dt) {
      const pp = this.playerPos();

      // No active job: walking into the next job's start marker opens it.
      if (this.current < 0) {
        const next = this.nextAvailable();
        if (next >= 0 && !game.hud?.dialogueOpen) {
          const s = DEFS[next].start;
          if (dist2D(pp, s) < START_RADIUS) this.requestStart(next);
        }
        this.pulseBeacon(startBeacon, dt);
        targetBeacon.visible = false;
        return;
      }

      const def = DEFS[this.current];

      // Death fails the job (the busted/wasted wrappers also call this;
      // the guard in failCurrent makes a double call harmless).
      if (game.player.health <= 0) {
        this.failCurrent('wasted');
        return;
      }

      // Timer.
      if (def.timeLimit > 0) {
        this.timer -= dt;
        if (this.timer <= 0) {
          this.failCurrent('timeout');
          return;
        }
      }

      // Per-type completion.
      if (def.type === 'reach' || def.type === 'timed') {
        if (dist2D(pp, def.target) < TARGET_RADIUS) {
          this.completeCurrent();
          return;
        }
      } else if (def.type === 'steal') {
        if (this.targetCar) {
          if (this.targetCar.health <= 0) {
            this.failCurrent('target destroyed');
            return;
          }
          if (this.phase === 1 && game.player.driving === this.targetCar) {
            this.phase = 2;
            this.stolen = true;
            game.police?.addWanted(1, 'grand theft auto');
            if (game.showToast) {
              game.showToast(`Got the Comet GT — now get it to ${def.garage.label}.`);
            }
          } else if (this.phase === 2 && game.player.driving === this.targetCar
            && dist2D(pp, def.garage) < TARGET_RADIUS) {
            this.completeCurrent();
            return;
          }
        }
      } else if (def.type === 'loseHeat') {
        if ((game.police?.wanted ?? 0) === 0) {
          this.completeCurrent();
          return;
        }
      } else if (def.type === 'shootout') {
        this.updateRivals(dt, pp);
        if (this.rivals.length > 0 && this.rivals.every((r) => r.state === 'fallen')) {
          this.completeCurrent();
          return;
        }
      } else if (def.type === 'race') {
        const cp = def.checkpoints[this.checkpointIdx];
        if (cp && dist2D(pp, cp) < CHECKPOINT_RADIUS) {
          this.checkpointIdx++;
          game.audio?.blip?.();
          if (this.checkpointIdx >= def.checkpoints.length) {
            this.completeCurrent();
            return;
          }
          if (game.showToast) {
            game.showToast(`Checkpoint ${this.checkpointIdx} of ${def.checkpoints.length}.`);
          }
        }
      }

      // Beacons follow the live target (the stolen car moves; race
      // checkpoints advance).
      this.placeBeacons();
      this.pulseBeacon(targetBeacon, dt);
      this.pulseBeacon(startBeacon, dt);
    },

    updateRivals(dt, pp) {
      const player = game.player;
      for (const r of this.rivals) {
        if (r.state === 'fallen') continue;
        const dx = pp.x - r.pos.x;
        const dz = pp.z - r.pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 70) {
          // Chase the player and swing when close.
          const heading = Math.atan2(dx, dz);
          r.heading = heading;
          r.pos.x += Math.sin(heading) * RIVAL_SPEED * dt;
          r.pos.z += Math.cos(heading) * RIVAL_SPEED * dt;
          resolveCircle(game.world, r.pos, 0.45);
          r.walkPhase += dt * RIVAL_SPEED * 2.4;
          const swing = Math.sin(r.walkPhase) * 0.7;
          r.body.legL.rotation.x = swing;
          r.body.legR.rotation.x = -swing;
          r.body.armL.rotation.x = -swing * 0.8;
          r.body.armR.rotation.x = swing * 0.8;
          r.punchCooldown -= dt;
          if (dist < 1.9 && r.punchCooldown <= 0) {
            r.punchCooldown = 1.2;
            game.police?.damagePlayer(RIVAL_DAMAGE);
            game.audio?.thud?.();
            if (game.showToast) game.showToast('A Coral King is beating you down!');
          }
        } else {
          r.body.legL.rotation.x = 0;
          r.body.legR.rotation.x = 0;
        }
        r.body.group.position.copy(r.pos);
        r.body.group.rotation.y = r.heading;
        void player;
      }
    },
  };

  // Busted / wasted fails the active job before the respawn happens.
  if (game.police) {
    const origBusted = game.police.busted.bind(game.police);
    const origWasted = game.police.wasted.bind(game.police);
    game.police.busted = () => { missions.failCurrent('busted'); origBusted(); };
    game.police.wasted = () => { missions.failCurrent('wasted'); origWasted(); };
  }

  game.missions = missions;
  missions.placeBeacons();
  return missions;
}
