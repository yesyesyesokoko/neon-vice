// Screenshot staging for Neon Vice: one named scene per `?shot=` value in
// the page URL. Every scene is built only with the real game systems — the
// player, vehicles, traffic, police, missions and HUD are set up through
// their own modules, then the simulation is advanced a fixed number of
// 1/60 s steps so the frame is the same every time it is staged. After
// staging the simulation freezes (game.freezeSim, honoured by the tick in
// main.js) so the captured frame is exactly the staged one.
//   ?shot=cover  — driving down the palm boulevard, traffic, 1 wanted star
//   ?shot=beacon — on foot by the pulsing mission beacon, objective visible
//   ?shot=chase  — 3 wanted stars, two police cars closing in behind
//   ?shot=docks  — the Dockside Static job: rivals at the docks, dialogue up
// Without the parameter the game starts normally on the menu.

import * as THREE from 'three';
import { createCar, enterCar } from './vehicles.js';

const STEP = 1 / 60; // fixed step, so staging is deterministic
const BOULEVARD_Z = 0; // the palm-lined east-west road through Neon Bay

// Run the same per-frame updates the main tick runs while playing, but with
// a fixed step and a fixed count. `keys` are held down for the whole run
// (KeyW to drive, for example) and released afterwards.
function fixedStep(game, count, keys = []) {
  for (const k of keys) game.input.keys.add(k);
  for (let i = 0; i < count; i++) {
    if (game.world?.update) game.world.update(STEP, game.clock.elapsedTime);
    if (!game.player.driving) game.player.update(STEP);
    game.vehicleSys?.update(STEP);
    game.police?.update(STEP);
    game.combat?.update(STEP);
    game.missions?.update(STEP);
    game.save?.update(STEP);
    game.audio?.update(STEP);
    game.hud?.update(STEP);
    game.renderer.render(game.scene, game.camera);
  }
  for (const k of keys) game.input.keys.delete(k);
}

// Put the player on foot at a spot, facing a heading, with the follow
// camera placed behind them and snapped into place at once.
function placeOnFoot(game, x, z, heading, camYaw, camPitch = 0.34, camDist = 9) {
  const p = game.player;
  p.pos.set(x, 0, z);
  p.vel.set(0, 0, 0);
  p.heading = heading;
  p.group.visible = true;
  p.group.position.copy(p.pos);
  p.group.rotation.y = heading;
  p.cam.yaw = camYaw;
  p.cam.pitch = camPitch;
  p.cam.distance = camDist;
  p.snapCamera();
}

// Put the player behind the wheel of a fresh car at a spot and heading.
function placeDriving(game, x, z, heading, style, color, camDist = 10) {
  const car = createCar(game, style, { kind: 'parked', x, z, heading, color });
  game.vehicles.push(car);
  enterCar(game, car);
  game.player.cam.distance = camDist;
  return car;
}

// A traffic car on the boulevard, attached to the boulevard's road so the
// traffic AI drives it instead of leaving it parked. Eastbound cars run in
// the z = -2.5 lane, westbound in z = +2.5, matching the traffic spawner.
function placeTraffic(game, x, z, heading, style) {
  const car = createCar(game, style, { kind: 'traffic', x, z, heading });
  const roads = game.world.roads;
  let boulevard = -1;
  for (let i = 0; i < roads.length; i++) {
    if (roads[i].start.z === BOULEVARD_Z && roads[i].end.z === BOULEVARD_Z) {
      boulevard = i;
      break;
    }
  }
  if (boulevard >= 0) {
    const len = Math.hypot(
      roads[boulevard].end.x - roads[boulevard].start.x,
      roads[boulevard].end.z - roads[boulevard].start.z,
    );
    const proj = x - roads[boulevard].start.x; // distance along from the west end
    car.road = boulevard;
    car.roadDir = heading === Math.PI / 2 ? 1 : -1;
    car.roadS = car.roadDir === 1 ? proj : len - proj;
  }
  game.vehicles.push(car);
  return car;
}

// A police car already on the hunt: registered with the police system so
// its chase AI runs, instead of a car that merely sits there.
function placeCop(game, x, z, heading) {
  const cop = createCar(game, 'police', { kind: 'police', x, z, heading });
  game.vehicles.push(cop);
  game.police.cops.push(cop);
  return cop;
}

// --- scenes ---------------------------------------------------------------

// Cover: the player driving east down the palm boulevard in a blue sports
// car, traffic in both lanes, one wanted star on the HUD.
function stageCover(game) {
  placeDriving(game, -140, -2.5, Math.PI / 2, 'sports', 0x1e6fd9, 8.5);
  placeTraffic(game, -60, -2.5, Math.PI / 2, 'taxi');
  placeTraffic(game, -20, -2.5, Math.PI / 2, 'sedan');
  placeTraffic(game, 40, 2.5, -Math.PI / 2, 'van');
  placeTraffic(game, 90, 2.5, -Math.PI / 2, 'sedan');
  placeTraffic(game, -100, 2.5, -Math.PI / 2, 'sports');
  game.police.addWanted(1, 'speeding down the boulevard');
  fixedStep(game, 150, ['KeyW']);
}

// Beacon: on foot on the north-south road by Rosa's corner, the yellow
// start beacon pulsing ahead and the first job's objective on the HUD.
function stageBeacon(game) {
  // Player at (0, -2), beacon at (0, -12): 10 m away, outside the 7 m
  // start radius, so the job does not trigger — the beacon just pulses.
  // (0, 6) would put a boulevard palm between the camera and the beacon.
  placeOnFoot(game, 0, -2, Math.PI, 0, 0.34, 9);
  fixedStep(game, 120);
}

// Chase: the player fleeing west down the boulevard at 3 wanted stars,
// two police cars closing in behind. The chase camera looks forward by
// default, so after the sim runs the camera is reframed to look back
// down the road: the player's car in front, the cops behind it.
function stageChase(game) {
  placeDriving(game, 140, 2.5, -Math.PI / 2, 'sports', 0xb03a2e);
  // 16 m and 28 m back: close enough to read as a chase, far enough
  // that neither cop rams the player to death inside the staged steps.
  placeCop(game, 156, 2.5, -Math.PI / 2);
  placeCop(game, 168, -2.5, -Math.PI / 2);
  game.police.addWanted(3, 'the whole precinct is on you');
  fixedStep(game, 150, ['KeyW']);

  const car = game.player.driving;
  if (car) {
    const fx = Math.sin(car.heading);
    const fz = Math.cos(car.heading);
    // Camera ahead of the car, off to one side, looking back at it and
    // at the road behind it where the cops are.
    game.camera.position.set(
      car.pos.x + fx * 14 + fz * 5,
      5.5,
      car.pos.z + fz * 14 - fx * 5,
    );
    game.camera.lookAt(car.pos.x - fx * 12, 1.5, car.pos.z - fz * 12);
    game.renderer.render(game.scene, game.camera);
  }
}

// Docks: the Dockside Static job (mission 5) active at the docks, the
// Coral Kings rivals closing in on foot, Rosa's briefing dialogue open
// over the objective line.
function stageDocks(game) {
  const missions = game.missions;
  missions.status = ['done', 'done', 'done', 'done', 'available', 'locked', 'locked'];
  missions.activate(4); // spawns the five rivals around the docks
  // The mission stays on screen through the objective line ("Deal with
  // the Coral Kings crew..."). The briefing dialogue is left closed: open,
  // its box covers the middle of the frame and hides the crew.
  // Player on the dock road just north of the crew, facing the docks.
  // 220 steps lets the nearest rivals close to ~10 m — near enough to
  // read, still out of punching range.
  placeOnFoot(game, 60, 232, 0, Math.PI, 0.42, 11);
  fixedStep(game, 220);
}

const SCENES = {
  cover: stageCover,
  beacon: stageBeacon,
  chase: stageChase,
  docks: stageDocks,
};

// Read ?shot= from the URL; when it names a scene, start the game straight
// into it and freeze the sim on the staged frame. Returns the scene name,
// or null when the game should boot normally onto the menu.
export function initShots(game) {
  const name = new URLSearchParams(window.location.search).get('shot');
  if (!name || !SCENES[name]) return null;
  game.setState('playing');
  // Toasts would sit over the staged frame (their timers run on wall
  // time while the page is still loading), so staging runs silent.
  const realToast = game.showToast;
  game.showToast = () => {};
  SCENES[name](game);
  game.showToast = realToast;
  game.freezeSim = true;
  window.__nvShot = name;
  return name;
}
