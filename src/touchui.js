// On-screen touch controls: a virtual joystick (move), a jump button, and a
// dive button that surfaces while swimming (when jump doubles as float).
// The joystick writes into player.touchMove (x = strafe, y = back/forward),
// the buttons hold player.touchJump / player.touchDive. Mouse fallbacks are
// wired so the controls are testable on desktop too.

export function buildTouchUI(player) {
  const root = document.getElementById('touchui');
  const joy = document.getElementById('joy');
  const knob = document.getElementById('knob');
  const jump = document.getElementById('jumpBtn');
  const dive = document.getElementById('diveBtn');
  const run = document.getElementById('runBtn');
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

  // --- dive button (only shown while swimming) ---
  const divePress = (e) => {
    e.preventDefault(); e.stopPropagation();
    player.touchDive = true;
    dive.classList.add('pressed');
  };
  const diveUnpress = () => {
    player.touchDive = false;
    dive.classList.remove('pressed');
  };
  dive.addEventListener('touchstart', divePress, { passive: false });
  dive.addEventListener('touchend', diveUnpress);
  dive.addEventListener('touchcancel', diveUnpress);
  dive.addEventListener('mousedown', divePress);
  window.addEventListener('mouseup', diveUnpress);

  // --- run toggle (holding a third control while thumb-looking is a
  // finger too many, so a tap latches the sprint on or off) ---
  const setRun = (on) => {
    player.touchRun = on;
    run.classList.toggle('latched', on);
  };
  const runTap = (e) => {
    e.preventDefault(); e.stopPropagation();
    setRun(!player.touchRun);
  };
  run.addEventListener('touchstart', runTap, { passive: false });
  run.addEventListener('mousedown', runTap);

  // in the water the jump thumb becomes the float thumb (and the sprint
  // latch resets — swim pace is its own decision)
  let wasSwimming = false;
  function setSwimming(s) {
    if (s === wasSwimming) return;
    wasSwimming = s;
    root.classList.toggle('swimming', s);
    jump.textContent = s ? 'FLOAT' : 'JUMP';
    if (!s) diveUnpress();
    setRun(false);
  }

  return {
    setSwimming,
    show() {
      root.classList.remove('hidden');
      document.body.classList.add('touch-ui'); // CSS trims keycap hints
    },
    hide() {
      root.classList.add('hidden');
      document.body.classList.remove('touch-ui');
      release();
      setRun(false);
    },
    get active() { return !root.classList.contains('hidden'); },
  };
}
