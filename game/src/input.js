// Keyboard + mouse state for Neon Vice, written onto the shared game object.
//   game.input.keys        — Set of currently pressed codes (e.code)
//   game.input.dragDX/DY   — mouse drag deltas accumulated since last read
//   game.input.wheelDelta  — wheel delta accumulated since last read
//   game.input.pointerLocked — true while pointer lock is held (unused:
//                              drag-orbit is the control scheme, this stays
//                              false unless a later module enables it)
// Callers read deltas with consumeDrag() / consumeWheel(), which reset them.
// Game keys (Space, arrows, WASD, Tab) have their browser defaults suppressed
// so the page never scrolls or loses focus mid-game.

const GAME_KEYS = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Tab',
]);

export function initInput(game, hooks = {}) {
  const input = game.input;
  input.dragDX = 0;
  input.dragDY = 0;
  input.wheelDelta = 0;
  input.pointerLocked = false;

  input.consumeDrag = () => {
    const d = { dx: input.dragDX, dy: input.dragDY };
    input.dragDX = 0;
    input.dragDY = 0;
    return d;
  };
  input.consumeWheel = () => {
    const w = input.wheelDelta;
    input.wheelDelta = 0;
    return w;
  };

  window.addEventListener('keydown', (e) => {
    if (GAME_KEYS.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    input.keys.add(e.code);
    if (e.code === 'Escape') hooks.onEscape?.();
  });
  window.addEventListener('keyup', (e) => input.keys.delete(e.code));

  let lastX = 0;
  let lastY = 0;
  window.addEventListener('mousemove', (e) => {
    input.mouseX = e.clientX;
    input.mouseY = e.clientY;
    if (!input.mouseDown || game.state !== 'playing') {
      lastX = e.clientX;
      lastY = e.clientY;
      return;
    }
    const dx = e.movementX !== undefined ? e.movementX : e.clientX - lastX;
    const dy = e.movementY !== undefined ? e.movementY : e.clientY - lastY;
    input.dragDX += dx;
    input.dragDY += dy;
    lastX = e.clientX;
    lastY = e.clientY;
  });
  window.addEventListener('mousedown', (e) => {
    if (game.state === 'playing' && e.target === game.renderer?.domElement) {
      input.mouseDown = true;
      lastX = e.clientX;
      lastY = e.clientY;
    }
  });
  window.addEventListener('mouseup', () => { input.mouseDown = false; });

  window.addEventListener('wheel', (e) => {
    if (game.state !== 'playing') return;
    e.preventDefault();
    input.wheelDelta += e.deltaY;
  }, { passive: false });

  window.addEventListener('blur', () => {
    input.keys.clear();
    input.mouseDown = false;
    input.dragDX = 0;
    input.dragDY = 0;
  });

  game.renderer?.domElement?.addEventListener('contextmenu', (e) => e.preventDefault());
}
