// On-screen touch controls: a virtual joystick (move) and a jump button.
// The joystick writes into player.touchMove (x = strafe, y = back/forward),
// the jump button holds player.touchJump. Mouse fallbacks are wired so the
// controls are testable on desktop too.

export function buildTouchUI(player) {
  const root = document.getElementById('touchui');
  const joy = document.getElementById('joy');
  const knob = document.getElementById('knob');
  const jump = document.getElementById('jumpBtn');
  const TRAVEL = 46; // knob travel radius in px

  function setKnob(dx, dy) {
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  function steer(clientX, clientY) {
    const rect = joy.getBoundingClientRect();
    let dx = clientX - (rect.left + rect.width / 2);
    let dy = clientY - (rect.top + rect.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > TRAVEL) { dx = (dx / len) * TRAVEL; dy = (dy / len) * TRAVEL; }
    setKnob(dx, dy);
    player.touchMove.set(dx / TRAVEL, dy / TRAVEL);
  }

  function release() {
    player.touchMove.set(0, 0);
    setKnob(0, 0);
  }

  // --- joystick: touch ---
  let joyTouch = null;
  joy.addEventListener('touchstart', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (joyTouch === null) {
      const t = e.changedTouches[0];
      joyTouch = t.identifier;
      steer(t.clientX, t.clientY);
    }
  }, { passive: false });
  joy.addEventListener('touchmove', (e) => {
    e.preventDefault(); e.stopPropagation();
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouch) steer(t.clientX, t.clientY);
    }
  }, { passive: false });
  const joyEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === joyTouch) { joyTouch = null; release(); }
    }
  };
  joy.addEventListener('touchend', joyEnd);
  joy.addEventListener('touchcancel', joyEnd);

  // --- joystick: mouse fallback ---
  let mouseDrag = false;
  joy.addEventListener('mousedown', (e) => {
    e.preventDefault(); e.stopPropagation();
    mouseDrag = true;
    steer(e.clientX, e.clientY);
  });
  window.addEventListener('mousemove', (e) => {
    if (mouseDrag) steer(e.clientX, e.clientY);
  });
  window.addEventListener('mouseup', () => {
    if (mouseDrag) { mouseDrag = false; release(); }
  });

  // --- jump button ---
  const press = (e) => {
    e.preventDefault(); e.stopPropagation();
    player.touchJump = true;
    jump.classList.add('pressed');
  };
  const unpress = () => {
    player.touchJump = false;
    jump.classList.remove('pressed');
  };
  jump.addEventListener('touchstart', press, { passive: false });
  jump.addEventListener('touchend', unpress);
  jump.addEventListener('touchcancel', unpress);
  jump.addEventListener('mousedown', press);
  window.addEventListener('mouseup', unpress);

  return {
    show() {
      root.classList.remove('hidden');
      document.body.classList.add('touch-ui'); // CSS trims keycap hints
    },
    hide() {
      root.classList.add('hidden');
      document.body.classList.remove('touch-ui');
      release();
    },
    get active() { return !root.classList.contains('hidden'); },
  };
}
