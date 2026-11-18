// Synthesized WebAudio for Neon Vice: no audio files at all.
// Engine hum follows the driven car's speed, a two-tone siren plays
// while wanted > 0, and gunshots, thuds, blips, clicks and a mission
// jingle are all built from oscillators and filtered noise. A quiet
// bass + arpeggio loop starts after the player presses Start.
// Creating the AudioContext can never throw or block the game: every
// entry point is guarded, and the context is created/resumed on the
// first user gesture (autoplay policies suspend it until then).

function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// 16-step loop at ~100 bpm (eighth notes, 0.30 s per step).
const STEP_DUR = 0.3;
const BASS_LINE = [45, 0, 45, 0, 48, 0, 45, 0, 43, 0, 43, 0, 50, 0, 48, 0];
const ARP_LINE = [69, 0, 0, 72, 0, 0, 76, 0, 0, 72, 0, 0, 79, 0, 76, 0];

export function createAudio(game) {
  const audio = {
    ctx: null,
    master: null,
    musicGain: null,
    engineGain: null,
    engineOsc1: null,
    engineOsc2: null,
    engineFilter: null,
    sirenOsc: null,
    sirenGain: null,
    noiseBuffer: null,
    muted: false,
    musicStarted: false,
    musicTimer: null,
    nextNoteTime: 0,
    step: 0,
    mWasDown: false,

    // Create (or resume) the context. Safe to call any time; returns
    // false when the browser will not give us audio, and the game
    // simply stays silent.
    ensure() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return false;
          this.ctx = new AC();
          this.master = this.ctx.createGain();
          this.master.gain.value = this.muted ? 0 : 0.9;
          this.master.connect(this.ctx.destination);

          this.musicGain = this.ctx.createGain();
          this.musicGain.gain.value = 0.5;
          this.musicGain.connect(this.master);

          // Engine: two detuned saws through a lowpass, gain driven by
          // speed in update().
          this.engineFilter = this.ctx.createBiquadFilter();
          this.engineFilter.type = 'lowpass';
          this.engineFilter.frequency.value = 400;
          this.engineGain = this.ctx.createGain();
          this.engineGain.gain.value = 0;
          this.engineFilter.connect(this.engineGain);
          this.engineGain.connect(this.master);
          this.engineOsc1 = this.ctx.createOscillator();
          this.engineOsc1.type = 'sawtooth';
          this.engineOsc1.frequency.value = 55;
          this.engineOsc2 = this.ctx.createOscillator();
          this.engineOsc2.type = 'square';
          this.engineOsc2.frequency.value = 110;
          this.engineOsc2.detune.value = 8;
          this.engineOsc1.connect(this.engineFilter);
          this.engineOsc2.connect(this.engineFilter);
          this.engineOsc1.start();
          this.engineOsc2.start();

          // Siren: one triangle osc, frequency flipped in update().
          this.sirenOsc = this.ctx.createOscillator();
          this.sirenOsc.type = 'triangle';
          this.sirenOsc.frequency.value = 800;
          this.sirenGain = this.ctx.createGain();
          this.sirenGain.gain.value = 0;
          this.sirenOsc.connect(this.sirenGain);
          this.sirenGain.connect(this.master);
          this.sirenOsc.start();

          // Shared white-noise buffer for the gunshot.
          const len = Math.floor(this.ctx.sampleRate * 0.25);
          this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
          const data = this.noiseBuffer.getChannelData(0);
          for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
        }
        if (this.ctx.state === 'suspended') {
          this.ctx.resume().catch(() => { /* autoplay denied; retry on next gesture */ });
        }
        return true;
      } catch {
        return false;
      }
    },

    setMuted(muted) {
      this.muted = muted;
      try {
        if (this.master && this.ctx) {
          this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.05);
        }
      } catch {
        // Audio unavailable; the flag still sticks.
      }
      if (game.hud) game.hud.setMuteLabel(muted);
    },

    toggleMute() {
      this.setMuted(!this.muted);
      if (game.showToast) game.showToast(this.muted ? 'Sound off.' : 'Sound on.');
    },

    // --- one-shot effects --------------------------------------------------
    blip() {
      if (!this.ensure()) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(1318, t + 0.07);
        g.gain.setValueAtTime(0.16, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc.connect(g);
        g.connect(this.master);
        osc.start(t);
        osc.stop(t + 0.18);
      } catch {
        // Never let a sound effect break the game.
      }
    },

    click() {
      if (!this.ensure()) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = 1400;
        g.gain.setValueAtTime(0.07, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        osc.connect(g);
        g.connect(this.master);
        osc.start(t);
        osc.stop(t + 0.06);
      } catch { /* silent */ }
    },

    thud() {
      if (!this.ensure()) return;
      try {
        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const g = this.ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(110, t);
        osc.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        g.gain.setValueAtTime(0.4, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        osc.connect(g);
        g.connect(this.master);
        osc.start(t);
        osc.stop(t + 0.18);
      } catch { /* silent */ }
    },

    gunshot() {
      if (!this.ensure()) return;
      try {
        const t = this.ctx.currentTime;
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuffer;
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2400, t);
        filter.frequency.exponentialRampToValueAtTime(280, t + 0.14);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.5, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        src.connect(filter);
        filter.connect(g);
        g.connect(this.master);
        src.start(t);
        src.stop(t + 0.18);
      } catch { /* silent */ }
    },

    jingle() {
      if (!this.ensure()) return;
      try {
        const t0 = this.ctx.currentTime;
        [72, 76, 79, 84].forEach((note, i) => {
          this.note(midiToFreq(note), t0 + i * 0.1, 0.22, 'triangle', 0.14, this.master);
        });
      } catch { /* silent */ }
    },

    // --- music ---------------------------------------------------------------
    startMusic() {
      if (this.musicStarted) return;
      if (!this.ensure()) return;
      this.musicStarted = true;
      this.nextNoteTime = this.ctx.currentTime + 0.1;
      this.step = 0;
      this.musicTimer = setInterval(() => this.scheduleMusic(), 120);
    },

    scheduleMusic() {
      try {
        if (!this.ctx || this.ctx.state !== 'running') return;
        while (this.nextNoteTime < this.ctx.currentTime + 0.35) {
          const step = this.step % 16;
          const bass = BASS_LINE[step];
          if (bass) this.note(midiToFreq(bass), this.nextNoteTime, 0.28, 'triangle', 0.11, this.musicGain);
          const arp = ARP_LINE[step];
          if (arp) this.note(midiToFreq(arp), this.nextNoteTime, 0.2, 'sine', 0.05, this.musicGain);
          this.step++;
          this.nextNoteTime += STEP_DUR;
        }
      } catch {
        // Scheduler hiccup: the interval retries on the next tick.
      }
    },

    note(freq, time, dur, type, gain, dest) {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, time);
      g.gain.linearRampToValueAtTime(gain, time + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.connect(g);
      g.connect(dest);
      osc.start(time);
      osc.stop(time + dur + 0.05);
    },

    // --- per-frame: engine + siren -------------------------------------------
    update(dt) {
      // Mute toggle (edge-triggered) works in menu and in game.
      const mDown = game.input.keys.has('KeyM');
      if (mDown && !this.mWasDown) this.toggleMute();
      this.mWasDown = mDown;

      if (!this.ctx || this.ctx.state !== 'running') return;
      try {
        const t = this.ctx.currentTime;
        const car = game.player?.driving;
        const speed = car ? Math.abs(car.speed) : 0;
        if (this.engineOsc1) {
          const freq = 52 + speed * 5.5;
          this.engineOsc1.frequency.setTargetAtTime(freq, t, 0.06);
          this.engineOsc2.frequency.setTargetAtTime(freq * 2, t, 0.06);
          this.engineFilter.frequency.setTargetAtTime(320 + speed * 55, t, 0.08);
          const target = car ? Math.min(0.11, 0.045 + speed * 0.0022) : 0;
          this.engineGain.gain.setTargetAtTime(target, t, 0.09);
        }
        const wanted = game.police?.wanted ?? 0;
        if (this.sirenOsc) {
          if (wanted > 0 && game.state === 'playing') {
            const hi = Math.floor(t * 2.2) % 2 === 0;
            this.sirenOsc.frequency.setTargetAtTime(hi ? 960 : 690, t, 0.05);
            this.sirenGain.gain.setTargetAtTime(0.035, t, 0.1);
          } else {
            this.sirenGain.gain.setTargetAtTime(0, t, 0.1);
          }
        }
      } catch {
        // Audio graph glitch: stay silent this frame.
      }
      void dt;
    },
  };

  // Resume the context on the first user gesture, whenever it happens:
  // autoplay policies suspend it until a click or keypress.
  const gesture = () => audio.ensure();
  window.addEventListener('pointerdown', gesture);
  window.addEventListener('keydown', gesture);

  // Gunshot + fist thud: wrap the combat calls so every shot and punch
  // is heard without touching combat.js.
  if (game.combat) {
    const origFire = game.combat.firePistol.bind(game.combat);
    game.combat.firePistol = (...args) => {
      const before = game.combat.ammo;
      const result = origFire(...args);
      if (game.combat.ammo < before) audio.gunshot();
      return result;
    };
    const origPunch = game.combat.punch.bind(game.combat);
    game.combat.punch = (...args) => {
      const result = origPunch(...args);
      audio.thud();
      return result;
    };
  }

  game.audio = audio;
  return audio;
}
