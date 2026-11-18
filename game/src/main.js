// Neon Vice boot module: renderer, scene, lights, state machine,
// and the shared `game` object later modules register into.

import * as THREE from 'three';
import { clamp } from './utils.js';
import { buildCity } from './city.js';
import { initInput } from './input.js';
import { createPlayer } from './player.js';
import { createVehicles } from './vehicles.js';
import { createPolice } from './police.js';
import { createCombat } from './combat.js';
import { createMissions } from './missions.js';
import { createSave } from './save.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';
import { initShots } from './shots.js';

// Shared game object: every subsystem reads/writes through this one place.
export const game = {
  renderer: null,
  scene: null,
  camera: null,
  clock: null,
  state: 'menu', // 'menu' | 'playing' | 'paused'
  input: {
    keys: new Set(),
    mouseX: 0,
    mouseY: 0,
    mouseDown: false,
  },
  // Registries filled in by later modules (world, player, vehicles, ...).
  world: null,
  player: null,
  vehicles: [],
  vehicleSys: null,
  police: null,
  combat: null,
  missions: null,
  save: null,
  hud: null,
  audio: null,
  cash: 500,
};

const app = document.getElementById('app');
const startScreen = document.getElementById('start-screen');
const pauseScreen = document.getElementById('pause-screen');
const startBtn = document.getElementById('start-btn');
const resumeBtn = document.getElementById('resume-btn');
const toastEl = document.getElementById('toast');

let toastTimer = 0;

export function showToast(text, ms = 2600) {
  toastEl.textContent = text;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
}

function buildRenderer() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.classList.add('webgl');
  app.prepend(renderer.domElement);
  return renderer;
}

function buildLights(scene) {
  const sky = new THREE.HemisphereLight(0x8fd8ff, 0x8a7a5a, 1.15);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(0xffb36b, 2.0);
  sun.position.set(60, 90, -40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -90;
  sun.shadow.camera.right = 90;
  sun.shadow.camera.top = 90;
  sun.shadow.camera.bottom = -90;
  sun.shadow.camera.far = 260;
  scene.add(sun);
  return { sky, sun };
}

function setState(next) {
  game.state = next;
  startScreen.classList.toggle('hidden', next !== 'menu');
  pauseScreen.classList.toggle('hidden', next !== 'paused');
  if (next === 'playing' && game.player) game.player.snapCamera();
}

// Start (or continue) a run: load the save when continuing, wake audio
// and start the music bed on this user gesture, then play.
function startGame(continueSave) {
  if (continueSave) {
    const data = game.save?.load();
    if (data) game.save.apply(data);
  }
  game.audio?.ensure();
  game.audio?.startMusic();
  setState('playing');
  showToast(continueSave
    ? 'Welcome back to Neon Bay.'
    : 'Welcome to Neon Vice — find your ride.');
}

function bindButtons() {
  startBtn.addEventListener('click', () => startGame(false));
  resumeBtn.addEventListener('click', () => setState('playing'));
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  game.camera.aspect = w / h;
  game.camera.updateProjectionMatrix();
  game.renderer.setSize(w, h);
}

function init() {
  game.renderer = buildRenderer();
  game.scene = new THREE.Scene();
  game.scene.background = new THREE.Color(0x05060f);
  game.scene.fog = new THREE.Fog(0x0a0d24, 60, 320);
  game.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 1500);
  game.camera.position.set(0, 14, 42);
  game.camera.lookAt(0, 4, -20);
  game.clock = new THREE.Clock();
  buildLights(game.scene);
  game.world = buildCity(game.scene);
  game.player = createPlayer(game);
  game.showToast = showToast;
  game.vehicleSys = createVehicles(game);
  game.combat = createCombat(game);
  game.police = createPolice(game);
  game.missions = createMissions(game);
  game.save = createSave(game);
  game.audio = createAudio(game);
  game.hud = createHud(game);
  // From here on the HUD owns the toast queue.
  game.showToast = (text, ms) => game.hud.toast(text, ms);
  game.setState = setState;
  game.startGame = startGame;
  const cashEl = document.getElementById('cash');
  if (cashEl) cashEl.textContent = `$ ${game.cash}`;
  initInput(game, {
    onEscape: () => {
      // Escape closes the mission list first, never pauses over an
      // end overlay (the player must respawn with Enter instead).
      if (game.hud?.missionListOpen) { game.hud.toggleMissionList(false); return; }
      if (game.hud?.endOverlayOpen) return;
      if (game.state === 'playing') setState('paused');
      else if (game.state === 'paused') setState('playing');
    },
  });
  bindButtons();
  window.addEventListener('resize', onResize);
  game.renderer.setAnimationLoop(tick);
  // ?shot=<scene> boots straight into a staged screenshot scene; without
  // it the game starts normally on the menu.
  initShots(game);
}

// Debug/verification handle: other builders and the CDP checks read the
// shared game object through window.__nvGame (never written to by the page).
window.__nvGame = game;

function tick() {
  const dt = Math.min(game.clock.getDelta(), 0.05);
  const t = game.clock.elapsedTime;
  // A staged screenshot scene freezes the sim on its frame: render only.
  if (game.freezeSim) {
    game.renderer.render(game.scene, game.camera);
    return;
  }
  if (game.world?.update) game.world.update(dt, t);
  if (game.state === 'playing') {
    // On-foot movement pauses while the player is driving; the vehicle
    // system owns the camera and the speed readout then.
    if (!game.player.driving) game.player.update(dt);
    game.vehicleSys?.update(dt);
    game.police?.update(dt);
    game.combat?.update(dt);
    game.missions?.update(dt);
    game.save?.update(dt);
  } else if (game.state === 'menu') {
    // Slow establishing orbit over Neon Bay behind the title screen.
    const a = t * 0.045;
    game.camera.position.set(Math.sin(a) * 150, 55, Math.cos(a) * 150);
    game.camera.lookAt(0, 12, 0);
    void clamp(dt, 0, 1);
  }
  // Audio (engine/siren/mute) and HUD run in every state; their updates
  // internally gate the parts that only apply while playing.
  game.audio?.update(dt);
  game.hud?.update(dt);
  game.renderer.render(game.scene, game.camera);
}

init();
