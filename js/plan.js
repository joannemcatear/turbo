// 8-week plan, 3 rides a week. Every target is a fraction of FTP, so the
// whole plan rescales automatically when FTP changes (e.g. after a ramp test).
//
// A step is { secs, from, to, label }. from === to is a steady block;
// different values make a smooth ramp (used for warm-ups and cool-downs).

const min = (m) => Math.round(m * 60);
const steady = (m, pct, label) => ({ secs: min(m), from: pct, to: pct, label });
const warmup = (m = 10) => ({ secs: min(m), from: 0.45, to: 0.65, label: 'Warm up' });
const cooldown = (m = 5) => ({ secs: min(m), from: 0.6, to: 0.4, label: 'Cool down' });
const easy = (m) => steady(m, 0.55, 'Easy');

/** n hard efforts with easy spinning between them (no easy block after the last). */
function reps(n, onMin, onPct, offMin, offPct, label) {
  const out = [];
  for (let i = 1; i <= n; i++) {
    out.push(steady(onMin, onPct, `${label} ${i}/${n}`));
    if (i < n) out.push(steady(offMin, offPct, 'Recover'));
  }
  return out;
}

function rampTest() {
  const steps = [{ secs: min(5), from: 0.45, to: 0.55, label: 'Warm up' }];
  // +6% of FTP every minute until you can't turn the pedals any more.
  for (let i = 0; i < 30; i++) {
    const p = Math.round((0.6 + i * 0.06) * 100) / 100;
    steps.push({ secs: 60, from: p, to: p, label: `Ramp step ${i + 1}` });
  }
  return steps;
}

const RAMP_NOTE =
  'Every minute it gets a bit harder. Keep going until you really can\'t, then press "I\'m done". ' +
  'Turbo works out your FTP from your best minute and offers to update the whole plan.';

export const PLAN = [
  {
    week: 1, theme: 'Find your level',
    sessions: [
      { id: 'w1a', name: 'Ramp test', test: true, note: RAMP_NOTE, steps: rampTest() },
      { id: 'w1b', name: 'Endurance 40', note: 'Easy, chatty pace. Smooth pedalling, 85–95 rpm.',
        steps: [warmup(), steady(25, 0.62, 'Endurance'), cooldown()] },
      { id: 'w1c', name: 'Sweet spot 3×6', note: 'Sweet spot: comfortably hard, you could talk in short sentences.',
        steps: [warmup(), ...reps(3, 6, 0.88, 3, 0.55, 'Sweet spot'), cooldown()] },
    ],
  },
  {
    week: 2, theme: 'Build',
    sessions: [
      { id: 'w2a', name: 'Threshold 4×4', note: 'Just below your 1-hour effort. Hard but steady.',
        steps: [warmup(), ...reps(4, 4, 0.95, 3, 0.55, 'Threshold'), cooldown()] },
      { id: 'w2b', name: 'Endurance 45', note: 'Easy, chatty pace.',
        steps: [warmup(), steady(30, 0.65, 'Endurance'), cooldown()] },
      { id: 'w2c', name: 'Sweet spot 3×8', note: 'Settle in and keep cadence steady.',
        steps: [warmup(), ...reps(3, 8, 0.88, 4, 0.55, 'Sweet spot'), cooldown()] },
    ],
  },
  {
    week: 3, theme: 'Build',
    sessions: [
      { id: 'w3a', name: 'Threshold 3×8', note: 'Longer threshold blocks. Stay relaxed in the upper body.',
        steps: [warmup(), ...reps(3, 8, 0.95, 4, 0.55, 'Threshold'), cooldown()] },
      { id: 'w3b', name: 'Endurance + tempo', note: 'Mostly easy with two short tempo blocks.',
        steps: [warmup(), steady(10, 0.65, 'Endurance'), steady(5, 0.8, 'Tempo 1/2'), steady(5, 0.65, 'Endurance'),
          steady(5, 0.8, 'Tempo 2/2'), steady(10, 0.65, 'Endurance'), cooldown()] },
      { id: 'w3c', name: 'Sweet spot 2×12', note: 'Two longer sweet spot blocks.',
        steps: [warmup(), ...reps(2, 12, 0.88, 5, 0.55, 'Sweet spot'), cooldown()] },
    ],
  },
  {
    week: 4, theme: 'Recovery week',
    sessions: [
      { id: 'w4a', name: 'Openers', note: 'Short bursts to keep the legs sharp, otherwise easy.',
        steps: [warmup(), ...reps(4, 1, 1.0, 3, 0.5, 'Burst'), easy(5), cooldown()] },
      { id: 'w4b', name: 'Easy spin 40', note: 'Genuinely easy. Recovery is where you get fitter.',
        steps: [warmup(), steady(25, 0.6, 'Easy endurance'), cooldown()] },
      { id: 'w4c', name: 'Light sweet spot 3×6', note: 'A touch easier than week 1.',
        steps: [warmup(), ...reps(3, 6, 0.85, 3, 0.55, 'Sweet spot'), cooldown()] },
    ],
  },
  {
    week: 5, theme: 'Build 2',
    sessions: [
      { id: 'w5a', name: 'VO2 5×3', note: 'Hard! Breathing heavily by the end of each one. Full recovery between.',
        steps: [warmup(12), ...reps(5, 3, 1.12, 3, 0.5, 'VO2'), cooldown()] },
      { id: 'w5b', name: 'Endurance 55', note: 'Easy, chatty pace.',
        steps: [warmup(), steady(40, 0.65, 'Endurance'), cooldown()] },
      { id: 'w5c', name: 'Sweet spot 2×15', note: 'Long, steady and controlled.',
        steps: [warmup(), ...reps(2, 15, 0.88, 5, 0.55, 'Sweet spot'), cooldown()] },
    ],
  },
  {
    week: 6, theme: 'Build 2',
    sessions: [
      { id: 'w6a', name: 'Threshold 3×10', note: 'Biggest threshold session so far.',
        steps: [warmup(), ...reps(3, 10, 0.95, 5, 0.55, 'Threshold'), cooldown()] },
      { id: 'w6b', name: 'Endurance + tempo 60', note: 'An hour, with three tempo blocks.',
        steps: [warmup(), steady(10, 0.65, 'Endurance'), ...reps(3, 6, 0.8, 4, 0.65, 'Tempo'),
          steady(9, 0.65, 'Endurance'), cooldown()] },
      { id: 'w6c', name: 'VO2 6×3', note: 'One more rep than week 5.',
        steps: [warmup(12), ...reps(6, 3, 1.12, 3, 0.5, 'VO2'), cooldown()] },
    ],
  },
  {
    week: 7, theme: 'Peak',
    sessions: [
      { id: 'w7a', name: 'Threshold 2×15', note: 'The key session of the plan.',
        steps: [warmup(), ...reps(2, 15, 0.95, 6, 0.55, 'Threshold'), cooldown()] },
      { id: 'w7b', name: 'Endurance 60', note: 'Easy, chatty pace for the full hour.',
        steps: [warmup(), steady(45, 0.66, 'Endurance'), cooldown()] },
      { id: 'w7c', name: 'Sweet spot 3×12', note: 'Last big session — then it gets easier.',
        steps: [warmup(), ...reps(3, 12, 0.9, 4, 0.55, 'Sweet spot'), cooldown()] },
    ],
  },
  {
    week: 8, theme: 'Freshen up & re-test',
    sessions: [
      { id: 'w8a', name: 'Short & sharp', note: 'Brief efforts to stay sharp while you freshen up.',
        steps: [warmup(), ...reps(3, 3, 1.05, 3, 0.55, 'Effort'), cooldown()] },
      { id: 'w8b', name: 'Easy 40', note: 'Easy — save your legs for the test.',
        steps: [warmup(), steady(25, 0.6, 'Easy endurance'), cooldown()] },
      { id: 'w8c', name: 'Ramp test', test: true, note: RAMP_NOTE + ' See how far you\'ve come!', steps: rampTest() },
    ],
  },
];

export function totalSecs(session) {
  return session.steps.reduce((a, s) => a + s.secs, 0);
}

/** Which step we're in at `t` seconds, and the target as a fraction of FTP. */
export function at(session, t) {
  let start = 0;
  for (let i = 0; i < session.steps.length; i++) {
    const s = session.steps[i];
    if (t < start + s.secs) {
      const f = (t - start) / s.secs;
      return { index: i, step: s, pct: s.from + (s.to - s.from) * f, left: start + s.secs - t };
    }
    start += s.secs;
  }
  return null; // finished
}

export function findSession(id) {
  for (const w of PLAN) for (const s of w.sessions) if (s.id === id) return { week: w, session: s };
  return null;
}
