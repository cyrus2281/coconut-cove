// Sleeping it off in the hammock. The screen dims to black, the world clock
// runs on to the far side of the day while nothing can be seen (a daytime
// nap wakes you at midnight, a night's sleep at first light), and the island
// fades back in around you. Sky, tide, drying sand and waves all come along
// with it, because they all ride the same clock.

const FADE_OUT = 1.8; // seconds for the screen to go black
const HELD = 0.9;     // ...and to hold there while the clock jumps
const FADE_IN = 2.4;  // ...and to open again on the new hour

export function buildSleep(sky, warpClock) {
  const veil = document.getElementById('fade');
  let busy = false;

  const wait = (s) => new Promise((done) => setTimeout(done, s * 1000));

  // Returns the span that was slept through, or null if a sleep is already
  // running. Resolves once the screen is fully open again.
  async function sleep() {
    if (busy) return null;
    busy = true;
    const span = sky.sleepSpan();
    veil.style.transitionDuration = FADE_OUT + 's';
    veil.classList.add('on');
    await wait(FADE_OUT);
    warpClock(span.seconds); // out cold: the whole jump happens in the dark
    await wait(HELD);
    veil.style.transitionDuration = FADE_IN + 's';
    veil.classList.remove('on');
    await wait(FADE_IN);
    busy = false;
    return span;
  }

  return { sleep, sleeping: () => busy };
}
