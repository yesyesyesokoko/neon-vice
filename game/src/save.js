// Save / load for Neon Vice: localStorage only, no server.
// Stores cash, completed missions, the current mission, the player
// position + health, and total time played. Autosaves on mission
// completion (called from missions.js) and after a busted/wasted
// respawn; manual save on P, or from the pause menu. The start screen
// offers Continue when a save exists (wired by hud.js).

const SAVE_KEY = 'neon-vice-save-v1';

export function createSave(game) {
  const save = {
    timePlayed: 0,
    pWasDown: false,

    exists() {
      try {
        return localStorage.getItem(SAVE_KEY) !== null;
      } catch {
        return false;
      }
    },

    collect() {
      const p = game.player;
      return {
        version: 1,
        savedAt: Date.now(),
        cash: game.cash,
        completed: game.missions?.completedIndices() || [],
        current: game.missions?.current ?? -1,
        player: {
          x: p.pos.x,
          z: p.pos.z,
          heading: p.heading,
          health: p.health,
        },
        timePlayed: Math.round(this.timePlayed),
      };
    },

    save(silent = false) {
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(this.collect()));
        if (!silent && game.showToast) game.showToast('Game saved.');
        game.hud?.refreshContinue?.();
        return true;
      } catch {
        if (!silent && game.showToast) {
          game.showToast('Save failed — browser storage is unavailable.');
        }
        return false;
      }
    },

    load() {
      try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        return data;
      } catch {
        return null;
      }
    },

    apply(data) {
      if (!data) return false;
      const p = game.player;
      if (typeof data.cash === 'number') game.cash = Math.max(0, Math.round(data.cash));
      if (data.player) {
        p.pos.set(data.player.x ?? 0, 0, data.player.z ?? 0);
        p.vel.set(0, 0, 0);
        p.heading = data.player.heading ?? 0;
        p.health = Math.min(p.maxHealth, Math.max(1, data.player.health ?? p.maxHealth));
        p.group.position.copy(p.pos);
        p.group.rotation.y = p.heading;
        p.snapCamera();
      }
      if (typeof data.timePlayed === 'number') this.timePlayed = data.timePlayed;
      // A mission that was active when the game was saved restarts as
      // available — the player walks back to its yellow marker.
      game.missions?.applySave(data);
      return true;
    },

    clear() {
      try {
        localStorage.removeItem(SAVE_KEY);
      } catch {
        // Storage unavailable: nothing to clear.
      }
      game.hud?.refreshContinue?.();
    },

    update(dt) {
      if (game.state === 'playing') this.timePlayed += dt;
      // Manual save: P key, edge-triggered.
      const pDown = game.input.keys.has('KeyP');
      if (pDown && !this.pWasDown && game.state === 'playing') this.save();
      this.pWasDown = pDown;
    },
  };

  // Autosave after a busted/wasted respawn actually lands (doRespawn is
  // the real respawn step; the overlay in hud.js defers it until the
  // player presses Enter, so wrapping respawnPlayer would save too early).
  if (game.police && typeof game.police.doRespawn === 'function') {
    const orig = game.police.doRespawn.bind(game.police);
    game.police.doRespawn = (fine, label) => {
      orig(fine, label);
      save.save(true);
    };
  }

  game.save = save;
  return save;
}
