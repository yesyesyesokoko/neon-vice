// HUD for Neon Vice: every readout and overlay in one place.
// Wanted stars, health bar, cash, speed, mission objective with live
// distance, a live 2D minimap, the toast queue, the mission dialogue
// box, the damage vignette, busted/wasted overlays, the pause menu and
// the start-screen wiring (New Game / Continue). Speed, stars, cash and
// health are refreshed here every frame from game state, so this module
// is the single writer for those elements.

import { clamp, wrapAngle } from './utils.js';

const MAP_SIZE = 168;
const WORLD_HALF = 300;
const MAP_SCALE = MAP_SIZE / (WORLD_HALF * 2);

function el(id) {
  return document.getElementById(id);
}

function makePanelDiv(extraCss) {
  const d = document.createElement('div');
  d.style.cssText = 'position:absolute;background:rgba(8,12,28,.72);border:1px solid rgba(34,230,255,.35);'
    + 'border-radius:10px;backdrop-filter:blur(6px);box-shadow:0 0 18px rgba(34,230,255,.15);'
    + 'color:#e8f6ff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;' + extraCss;
  return d;
}

export function createHud(game) {
  const starsEl = el('stars');
  const healthEl = el('health');
  const cashEl = el('cash');
  const speedEl = el('speed');
  const objectiveTextEl = el('objective-text');
  const minimap = el('minimap');
  const mapCtx = minimap ? minimap.getContext('2d') : null;
  const toastEl = el('toast');
  const app = el('app');
  const startScreen = el('start-screen');
  const pauseScreen = el('pause-screen');
  const startBtn = el('start-btn');

  // --- compass arrow (top centre, points at the current target) ----------
  const compass = document.createElement('div');
  compass.id = 'compass-arrow';
  compass.textContent = '\u25B2';
  compass.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);'
    + 'font-size:26px;color:#22e6ff;text-shadow:0 0 12px #22e6ff;pointer-events:none;z-index:5;display:none;';
  app.appendChild(compass);

  // --- damage vignette ----------------------------------------------------
  const vignette = document.createElement('div');
  vignette.id = 'damage-vignette';
  vignette.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:6;opacity:0;'
    + 'background:radial-gradient(ellipse at center, transparent 52%, rgba(255,0,40,.55) 100%);';
  app.appendChild(vignette);

  // --- dialogue box (mission story) ---------------------------------------
  const dialogue = document.createElement('div');
  dialogue.id = 'dialogue-box';
  dialogue.style.cssText = 'position:absolute;left:50%;bottom:190px;transform:translateX(-50%);'
    + 'width:min(560px,86vw);padding:16px 20px;z-index:12;display:none;pointer-events:auto;'
    + 'background:rgba(8,12,28,.88);border:1px solid rgba(34,230,255,.45);border-radius:12px;'
    + 'box-shadow:0 0 26px rgba(34,230,255,.25);color:#e8f6ff;';
  dialogue.innerHTML = '<div id="dialogue-title" style="font-size:11px;letter-spacing:2px;color:#ff2ea6;margin-bottom:2px;"></div>'
    + '<div id="dialogue-speaker" style="font-size:15px;font-weight:700;color:#22e6ff;margin-bottom:6px;"></div>'
    + '<div id="dialogue-text" style="font-size:15px;line-height:1.55;"></div>'
    + '<div style="margin-top:12px;display:flex;justify-content:space-between;align-items:center;">'
    + '<span style="font-size:12px;color:#8fb4c9;">Press Enter to continue</span>'
    + '<button id="dialogue-continue" type="button" style="cursor:pointer;border:1px solid #22e6ff;background:#22e6ff;color:#04121a;font-weight:700;padding:6px 18px;border-radius:6px;">CONTINUE</button>'
    + '</div>';
  app.appendChild(dialogue);

  // --- mission list (J key) -----------------------------------------------
  const missionList = document.createElement('div');
  missionList.id = 'mission-list';
  missionList.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);'
    + 'width:min(520px,88vw);padding:18px 20px;z-index:12;display:none;pointer-events:auto;'
    + 'background:rgba(8,12,28,.92);border:1px solid rgba(34,230,255,.45);border-radius:12px;'
    + 'box-shadow:0 0 26px rgba(34,230,255,.25);color:#e8f6ff;';
  app.appendChild(missionList);

  // --- busted / wasted overlay ---------------------------------------------
  const endOverlay = document.createElement('div');
  endOverlay.id = 'end-overlay';
  endOverlay.style.cssText = 'position:absolute;inset:0;z-index:14;display:none;flex-direction:column;'
    + 'align-items:center;justify-content:center;gap:16px;text-align:center;'
    + 'background:radial-gradient(ellipse at center, rgba(40,4,12,.6), rgba(3,4,12,.9));color:#e8f6ff;';
  endOverlay.innerHTML = '<div id="end-title" style="font-size:64px;font-weight:900;letter-spacing:8px;color:#ff2ea6;text-shadow:0 0 24px #ff2ea6;"></div>'
    + '<div id="end-fine" style="font-size:18px;color:#9fd8ef;"></div>'
    + '<button id="end-respawn" type="button" style="cursor:pointer;border:1px solid #22e6ff;background:#22e6ff;color:#04121a;font-size:18px;font-weight:700;letter-spacing:2px;padding:12px 34px;border-radius:8px;">RESPAWN</button>'
    + '<div style="font-size:13px;color:#8fb4c9;">Press <b>Enter</b> to respawn</div>';
  app.appendChild(endOverlay);

  // --- mute button ----------------------------------------------------------
  const muteBtn = document.createElement('button');
  muteBtn.id = 'mute-btn';
  muteBtn.type = 'button';
  muteBtn.textContent = '\u266A SOUND: ON';
  muteBtn.style.cssText = 'position:absolute;top:64px;right:16px;z-index:5;pointer-events:auto;cursor:pointer;'
    + 'background:rgba(8,12,28,.72);border:1px solid rgba(34,230,255,.35);border-radius:8px;'
    + 'color:#e8f6ff;font-size:12px;font-weight:700;letter-spacing:1px;padding:6px 10px;';
  muteBtn.addEventListener('click', () => {
    game.audio?.toggleMute();
    game.audio?.click?.();
  });
  app.appendChild(muteBtn);

  // --- pause menu buttons ---------------------------------------------------
  const pauseButtons = [];
  function pauseButton(label, onClick) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = label;
    b.style.cssText = 'font-size:15px;padding:10px 28px;';
    b.addEventListener('click', () => { game.audio?.click?.(); onClick(); });
    pauseScreen.appendChild(b);
    pauseButtons.push(b);
    return b;
  }
  pauseButton('RESTART MISSION', () => {
    if (game.missions?.restartCurrent()) game.setState?.('playing');
    else if (game.showToast) game.showToast('No job is active right now.');
  });
  pauseButton('SAVE GAME', () => {
    game.save?.save();
  });
  pauseButton('QUIT TO MENU', () => {
    game.setState?.('menu');
  });

  // --- Continue button on the start screen ----------------------------------
  const continueBtn = document.createElement('button');
  continueBtn.id = 'continue-btn';
  continueBtn.type = 'button';
  continueBtn.className = 'btn';
  continueBtn.textContent = 'CONTINUE';
  continueBtn.style.display = 'none';
  continueBtn.addEventListener('click', () => game.startGame?.(true));
  startScreen.insertBefore(continueBtn, startBtn);

  const hud = {
    dialogueOpen: false,
    missionListOpen: false,
    endOverlayOpen: false,
    toastQueue: [],
    toastBusy: false,
    prevHealth: 100,
    flash: 0,
    jWasDown: false,
    dialogueClose: null,
    endRespawn: null,

    // --- single-writer readouts -------------------------------------------
    setStars(wanted) {
      if (!starsEl) return;
      let html = '';
      for (let i = 0; i < 5; i++) {
        html += i < wanted ? '\u2605' : '<span class="dim">\u2605</span>';
      }
      starsEl.innerHTML = html;
    },

    setHealth(health, maxHealth) {
      if (healthEl) healthEl.style.width = `${clamp((health / maxHealth) * 100, 0, 100)}%`;
    },

    setCash(amount) {
      if (cashEl) cashEl.textContent = `$ ${amount}`;
    },

    setSpeed(mph) {
      if (speedEl) speedEl.textContent = `${Math.round(mph)} mph`;
    },

    setMuteLabel(muted) {
      muteBtn.textContent = muted ? '\u266A SOUND: OFF' : '\u266A SOUND: ON';
    },

    refreshContinue() {
      const has = game.save?.exists?.() ?? false;
      continueBtn.style.display = has ? '' : 'none';
    },

    // --- toast queue ---------------------------------------------------------
    toast(text, ms = 2600) {
      this.toastQueue.push({ text, ms });
      if (!this.toastBusy) this.nextToast();
    },

    nextToast() {
      const item = this.toastQueue.shift();
      if (!item) {
        this.toastBusy = false;
        return;
      }
      this.toastBusy = true;
      toastEl.textContent = item.text;
      toastEl.classList.add('show');
      setTimeout(() => {
        toastEl.classList.remove('show');
        setTimeout(() => this.nextToast(), 300);
      }, item.ms);
    },

    // --- dialogue --------------------------------------------------------------
    showDialogue({ speaker, title, text, onClose }) {
      el('dialogue-title').textContent = title ? title.toUpperCase() : 'NEON BAY';
      el('dialogue-speaker').textContent = speaker || '';
      el('dialogue-text').textContent = text || '';
      dialogue.style.display = 'block';
      this.dialogueOpen = true;
      this.dialogueClose = onClose || null;
    },

    closeDialogue() {
      if (!this.dialogueOpen) return;
      dialogue.style.display = 'none';
      this.dialogueOpen = false;
      const cb = this.dialogueClose;
      this.dialogueClose = null;
      if (cb) cb();
    },

    // --- mission list -----------------------------------------------------------
    toggleMissionList(force) {
      const open = force !== undefined ? force : !this.missionListOpen;
      this.missionListOpen = open;
      if (!open) {
        missionList.style.display = 'none';
        return;
      }
      const defs = game.missions?.defs || [];
      const status = game.missions?.status || [];
      const rows = defs.map((d, i) => {
        const st = status[i] || 'locked';
        const color = st === 'done' ? '#37ff9e' : st === 'active' ? '#22e6ff'
          : st === 'available' ? '#ffd23a' : '#5a6a80';
        const label = st === 'done' ? 'DONE' : st === 'active' ? 'IN PROGRESS'
          : st === 'available' ? 'AVAILABLE — click to start' : 'LOCKED';
        return `<div data-mission="${i}" style="padding:9px 10px;border:1px solid rgba(34,230,255,.2);border-radius:8px;margin-bottom:8px;cursor:${st === 'available' ? 'pointer' : 'default'};">`
          + `<div style="display:flex;justify-content:space-between;"><b>${i + 1}. ${d.name}</b>`
          + `<span style="color:#7dffb0;">$${d.reward}</span></div>`
          + `<div style="font-size:12px;color:#9fd8ef;margin-top:2px;">${d.objective}</div>`
          + `<div style="font-size:11px;letter-spacing:1px;color:${color};margin-top:3px;">${label}</div></div>`;
      }).join('');
      missionList.innerHTML = '<div style="font-size:13px;letter-spacing:2px;color:#ff2ea6;margin-bottom:10px;">JOBS — PRESS J TO CLOSE</div>' + rows;
      missionList.style.display = 'block';
    },

    // --- busted / wasted ----------------------------------------------------------
    showEndOverlay(label, fine, onRespawn) {
      el('end-title').textContent = label;
      el('end-fine').textContent = fine > 0
        ? `You lost $${fine} in fines. Your ride is parked where you left it.`
        : 'You got off lightly this time.';
      endOverlay.style.display = 'flex';
      this.endOverlayOpen = true;
      this.endRespawn = onRespawn || null;
    },

    closeEndOverlay() {
      if (!this.endOverlayOpen) return;
      endOverlay.style.display = 'none';
      this.endOverlayOpen = false;
      const cb = this.endRespawn;
      this.endRespawn = null;
      if (cb) cb();
    },

    flashDamage() {
      this.flash = 1;
    },

    // --- minimap --------------------------------------------------------------------
    drawMinimap() {
      if (!mapCtx || !game.world) return;
      const ctx = mapCtx;
      const px = (x) => (x + WORLD_HALF) * MAP_SCALE;
      const py = (z) => (z + WORLD_HALF) * MAP_SCALE;
      ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);
      ctx.fillStyle = '#0a1420';
      ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
      // Beach strip along the south edge (z > 240).
      ctx.fillStyle = '#4a4230';
      ctx.fillRect(0, py(240), MAP_SIZE, MAP_SIZE - py(240));
      // Roads as a dark street map.
      ctx.strokeStyle = '#46587a';
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      for (const r of game.world.roads) {
        ctx.beginPath();
        ctx.moveTo(px(r.start.x), py(r.start.z));
        ctx.lineTo(px(r.end.x), py(r.end.z));
        ctx.stroke();
      }
      const dot = (x, z, color, radius) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(px(x), py(z), radius, 0, Math.PI * 2);
        ctx.fill();
      };
      // Traffic dots.
      for (const c of game.vehicles) {
        if (c.kind === 'traffic') dot(c.pos.x, c.pos.z, '#8fa3bd', 1.6);
      }
      // Police dots.
      if (game.police) {
        for (const cop of game.police.cops) dot(cop.pos.x, cop.pos.z, '#ff4444', 2.6);
        for (const off of game.police.officers) dot(off.pos.x, off.pos.z, '#ff8844', 2);
      }
      // Mission marker: pulsing magenta diamond (target) or yellow (start).
      const tp = game.missions?.currentTargetPos?.();
      if (tp) {
        const active = (game.missions?.current ?? -1) >= 0;
        const pulse = 4.5 + Math.sin(game.clock.elapsedTime * 4) * 1.5;
        ctx.fillStyle = active ? '#ff2ea6' : '#ffd23a';
        ctx.beginPath();
        ctx.moveTo(px(tp.x), py(tp.z) - pulse);
        ctx.lineTo(px(tp.x) + pulse, py(tp.z));
        ctx.lineTo(px(tp.x), py(tp.z) + pulse);
        ctx.lineTo(px(tp.x) - pulse, py(tp.z));
        ctx.closePath();
        ctx.fill();
      }
      // Player arrow.
      const p = game.player;
      const pos = p.driving ? p.driving.pos : p.pos;
      const heading = p.driving ? p.driving.heading : p.heading;
      ctx.save();
      ctx.translate(px(pos.x), py(pos.z));
      ctx.rotate(heading);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(4.2, 5);
      ctx.lineTo(-4.2, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    },

    // --- per-frame --------------------------------------------------------------------
    update(dt) {
      // Mission list toggle (J), edge-triggered, works in game and pause.
      const jDown = game.input.keys.has('KeyJ');
      if (jDown && !this.jWasDown) {
        if (game.state === 'playing' || this.missionListOpen) this.toggleMissionList();
      }
      this.jWasDown = jDown;

      if (game.state !== 'playing') return;
      const p = game.player;

      // Readouts, refreshed every frame from game state.
      this.setStars(game.police?.wanted ?? 0);
      this.setHealth(p.health, p.maxHealth);
      this.setCash(game.cash);
      const speed = p.driving ? Math.abs(p.driving.speed) : p.speed;
      this.setSpeed(speed * 2.237);

      // Damage vignette: flash whenever health drops.
      if (p.health < this.prevHealth) this.flash = 1;
      this.prevHealth = p.health;
      if (this.flash > 0) {
        this.flash = Math.max(0, this.flash - dt * 1.8);
        vignette.style.opacity = String(this.flash * 0.9);
      }

      // Objective line with live distance.
      if (objectiveTextEl && game.missions) {
        let text = game.missions.objectiveText();
        const tp = game.missions.currentTargetPos();
        if (tp) {
          const pos = p.driving ? p.driving.pos : p.pos;
          const d = Math.hypot(tp.x - pos.x, tp.z - pos.z);
          text += `  (${Math.round(d)}m)`;
        }
        objectiveTextEl.textContent = text;
      }

      // Compass arrow: rotate toward the target relative to the camera.
      const tp = game.missions?.currentTargetPos?.();
      if (tp && game.player) {
        const pos = p.driving ? p.driving.pos : p.pos;
        const bearing = Math.atan2(tp.x - pos.x, tp.z - pos.z);
        const camYaw = p.cam.yaw;
        // Camera forward is -(sin yaw, cos yaw): its angle is yaw + PI.
        const rel = wrapAngle(bearing - (camYaw + Math.PI));
        compass.style.display = 'block';
        compass.style.transform = `translateX(-50%) rotate(${rel}rad)`;
      } else {
        compass.style.display = 'none';
      }

      this.drawMinimap();
    },
  };

  // Dialogue continue: Enter key or the button.
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (hud.dialogueOpen) {
        game.audio?.click?.();
        hud.closeDialogue();
      } else if (hud.endOverlayOpen) {
        hud.closeEndOverlay();
      }
    }
  });
  el('dialogue-continue').addEventListener('click', () => {
    game.audio?.click?.();
    hud.closeDialogue();
  });
  el('end-respawn').addEventListener('click', () => hud.closeEndOverlay());
  missionList.addEventListener('click', (e) => {
    const row = e.target.closest('[data-mission]');
    if (!row) return;
    const i = Number(row.dataset.mission);
    if (game.missions?.status[i] === 'available') {
      hud.toggleMissionList(false);
      game.audio?.click?.();
      game.missions.requestStart(i);
    }
  });

  // Keep the Continue button honest at boot.
  hud.refreshContinue();
  hud.setStars(0);

  game.hud = hud;
  return hud;
}
