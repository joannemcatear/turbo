import { Trainer } from './ftms.js';
import { ZwiftClick } from './zwift-click.js';
import { PLAN, totalSecs, at, findSession } from './plan.js';

const demo = new URLSearchParams(location.search).has('demo');
const { FakeTrainer, FakeClick } = demo ? await import('./demo.js') : {};

// ---------------------------------------------------------------------------
// Settings (remembered in this browser)

const ACTIONS = {
  up: 'Increase',
  down: 'Decrease',
  bigUp: 'Big increase',
  bigDown: 'Big decrease',
  toggleMode: 'Switch ERG / Slope',
  none: 'Nothing',
};

// Click v2 layout — left puck: up/left/right/down + "−"; right puck: Y/Z/A/B + "+"
const BUTTONS = [
  ['plus', '+', 'right'],
  ['b', 'B', 'right'],
  ['y', 'Y', 'right'],
  ['a', 'A', 'right'],
  ['z', 'Z', 'right'],
  ['minus', '−', 'left'],
  ['up', '▲', 'left'],
  ['down', '▼', 'left'],
  ['left', '◀', 'left'],
  ['right', '▶', 'left'],
];

const DEFAULTS = {
  mode: 'erg',
  power: 100,
  ftp: 100,
  done: {}, // session id -> date completed
  ftpHistory: [],
  slope: 0,
  stepErg: 10,
  stepErgBig: 25,
  stepSlope: 0.5,
  stepSlopeBig: 2,
  mapping: {
    plus: 'up', b: 'down', y: 'bigUp', a: 'bigDown', z: 'toggleMode',
    minus: 'down', up: 'bigUp', down: 'bigDown', left: 'down', right: 'up',
  },
};

const settings = load();
function load() {
  try {
    const saved = JSON.parse(localStorage.getItem('turbo-settings') || '{}');
    return { ...DEFAULTS, ...saved, mapping: { ...DEFAULTS.mapping, ...(saved.mapping || {}) } };
  } catch {
    return structuredClone(DEFAULTS);
  }
}
function save() {
  try { localStorage.setItem('turbo-settings', JSON.stringify(settings)); } catch {}
}

// ---------------------------------------------------------------------------
// Elements

const $ = (s) => document.querySelector(s);
const el = {
  trainerBtn: $('#btn-trainer'),
  clickBtn: $('#btn-click'),
  targetNum: $('#target-num'),
  targetUnit: $('#target-unit'),
  targetCaption: $('#target-caption'),
  flash: $('#press-flash'),
  power: $('#m-power'),
  cadence: $('#m-cadence'),
  speed: $('#m-speed'),
  time: $('#m-time'),
  avg: $('#m-avg'),
  hr: $('#m-hr'),
  hrBox: $('#hr-box'),
  chart: $('#chart'),
  log: $('#log'),
  mapping: $('#mapping'),
};

if (!demo && !navigator.bluetooth) $('#unsupported').hidden = false;

function log(msg) {
  const t = new Date().toLocaleTimeString();
  el.log.textContent = `${t}  ${msg}\n` + el.log.textContent;
}

// ---------------------------------------------------------------------------
// Trainer

const trainer = demo ? new FakeTrainer() : new Trainer();
trainer.addEventListener('log', (e) => log(e.detail));
trainer.addEventListener('status', (e) => {
  const s = e.detail;
  setChip(el.trainerBtn, s === 'connected' ? 'on' : s === 'connecting' ? 'connecting' : 'off',
    s === 'connected' ? trainer.name : s === 'connecting' ? 'Connecting…' : 'Connect trainer');
  if (s === 'connected') { log(`Trainer connected: ${trainer.name}`); keepAwake(); lastSent = null; sendTarget(); }
});
trainer.addEventListener('data', (e) => onBikeData(e.detail));

el.trainerBtn.addEventListener('click', async () => {
  if (trainer.connected) {
    if (confirm(`Disconnect ${trainer.name}?`)) trainer.disconnect();
    return;
  }
  try {
    await trainer.pick();
  } catch (err) {
    if (err.name !== 'NotFoundError') log(`Couldn't connect trainer: ${err.message}`);
    setChip(el.trainerBtn, 'off', 'Connect trainer');
  }
});

// ---------------------------------------------------------------------------
// Clicker pucks

const pucks = [];
function updateClickChip() {
  const live = pucks.filter((p) => p.connected);
  if (!pucks.length) return setChip(el.clickBtn, 'off', 'Add clicker');
  const batt = live.map((p) => p.battery).filter((b) => b != null);
  const battText = batt.length ? ` · ${Math.min(...batt)}%` : '';
  const state = live.length === pucks.length ? 'on' : live.length ? 'partial' : 'connecting';
  setChip(el.clickBtn, state, `Clicker ${live.length}/${pucks.length}${battText} · add`);
}

el.clickBtn.addEventListener('click', async () => {
  const puck = demo ? new FakeClick() : new ZwiftClick();
  puck.addEventListener('status', (e) => {
    if (e.detail === 'connected') log(`Clicker connected: ${puck.name}`);
    if (e.detail === 'disconnected') log(`Clicker dropped: ${puck.name} (reconnecting)`);
    updateClickChip();
  });
  puck.addEventListener('battery', updateClickChip);
  puck.addEventListener('press', (e) => buttonDown(e.detail));
  puck.addEventListener('release', (e) => buttonUp(e.detail));
  try {
    setChip(el.clickBtn, 'connecting', 'Pick a clicker…');
    await puck.pick();
    if (!pucks.includes(puck)) pucks.push(puck);
  } catch (err) {
    if (err.name !== 'NotFoundError') log(`Couldn't connect clicker: ${err.message}`);
  }
  updateClickChip();
});
window.__turbo = { buttonDown: (b) => buttonDown(b), buttonUp: (b) => buttonUp(b), trainer, pucks, settings };

// ---------------------------------------------------------------------------
// Target (what we ask the trainer for)

function setMode(mode) {
  if (workout && mode !== 'erg') return; // workouts always run in ERG
  settings.mode = mode;
  save();
  for (const b of document.querySelectorAll('.mode button')) {
    b.setAttribute('aria-selected', b.dataset.mode === mode);
    b.disabled = !!workout && b.dataset.mode !== 'erg';
  }
  render();
  sendTarget();
}

function adjust(action) {
  const erg = settings.mode === 'erg';
  if (action === 'none') return;
  const sign = action === 'up' || action === 'bigUp' ? 1 : -1;
  const big = action === 'bigUp' || action === 'bigDown';
  if (workout) {
    // During a workout the buttons make the whole session easier/harder.
    if (action === 'toggleMode') return;
    setIntensity(workout.intensity + sign * (big ? 0.1 : 0.05));
    return;
  }
  if (action === 'toggleMode') return setMode(erg ? 'slope' : 'erg');
  if (erg) {
    const step = big ? settings.stepErgBig : settings.stepErg;
    settings.power = clamp(settings.power + sign * step, 0, 1000);
  } else {
    const step = big ? settings.stepSlopeBig : settings.stepSlope;
    settings.slope = clamp(round1(settings.slope + sign * step), -10, 20);
  }
  save();
  render();
  sendTarget();
}

let lastSent = null;
function sendTarget() {
  if (!trainer.connected) return;
  if (workout) {
    const w = workoutTarget();
    if (w != null && w !== lastSent) { trainer.setTargetPower(w); lastSent = w; }
    return;
  }
  lastSent = null;
  if (settings.mode === 'erg') trainer.setTargetPower(settings.power);
  else trainer.setSlope(settings.slope);
}

function render() {
  if (workout) {
    const w = workoutTarget();
    const now = at(workout.session, workout.t);
    el.targetNum.textContent = w ?? '–';
    el.targetUnit.textContent = 'W';
    el.targetCaption.textContent = now
      ? `${now.step.label} · ${Math.round(now.pct * 100)}% FTP${workout.intensity !== 1 ? ` × ${Math.round(workout.intensity * 100)}%` : ''}`
      : 'workout finished';
    return;
  }
  if (settings.mode === 'erg') {
    el.targetNum.textContent = settings.power;
    el.targetUnit.textContent = 'W';
    el.targetCaption.textContent = 'target power';
  } else {
    el.targetNum.textContent = (settings.slope > 0 ? '+' : '') + settings.slope.toFixed(1);
    el.targetUnit.textContent = '%';
    el.targetCaption.textContent = 'simulated gradient';
  }
}

for (const b of document.querySelectorAll('.mode button')) b.addEventListener('click', () => setMode(b.dataset.mode));

// On-screen − / + (with hold-to-repeat)
for (const b of document.querySelectorAll('.adj')) {
  const action = b.dataset.action;
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); startRepeat(`screen-${action}`, action); });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => stopRepeat(`screen-${action}`));
}

// Keyboard
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select')) return;
  if (e.key === 'ArrowUp') adjust(e.shiftKey ? 'bigUp' : 'up');
  else if (e.key === 'ArrowDown') adjust(e.shiftKey ? 'bigDown' : 'down');
  else if (e.key.toLowerCase() === 'm') adjust('toggleMode');
  else return;
  e.preventDefault();
});

// ---------------------------------------------------------------------------
// Button presses, with hold-to-repeat for up/down actions

const repeats = new Map();
function startRepeat(key, action) {
  stopRepeat(key);
  adjust(action);
  if (action === 'toggleMode' || action === 'none') return;
  const timer = setTimeout(function tick() {
    adjust(action);
    repeats.set(key, setTimeout(tick, 220));
  }, 500);
  repeats.set(key, timer);
}
function stopRepeat(key) {
  clearTimeout(repeats.get(key));
  repeats.delete(key);
}

function buttonDown(name) {
  const action = settings.mapping[name] || 'none';
  const label = BUTTONS.find((b) => b[0] === name)?.[1] || name;
  el.flash.textContent = `Clicker ${label} → ${ACTIONS[action]}`;
  el.flash.classList.add('hit');
  setTimeout(() => el.flash.classList.remove('hit'), 300);
  document.querySelector(`.key[data-btn="${name}"]`)?.classList.add('lit');
  startRepeat(`click-${name}`, action);
}
function buttonUp(name) {
  document.querySelector(`.key[data-btn="${name}"]`)?.classList.remove('lit');
  stopRepeat(`click-${name}`);
}

// ---------------------------------------------------------------------------
// Live data, ride timer, chart

const samples = []; // { t, power }
const history = []; // one point per second: { power, target }
let rideSeconds = 0;
let powerSum = 0;
let powerCount = 0;
let latest = {};

function onBikeData(d) {
  latest = { ...latest, ...d, at: Date.now() };
  if (d.power != null) samples.push({ t: Date.now(), power: d.power });
  if (d.cadence != null) el.cadence.textContent = Math.round(d.cadence);
  if (d.speed != null) el.speed.textContent = d.speed.toFixed(1);
  if (d.heartRate) { el.hrBox.hidden = false; el.hr.textContent = d.heartRate; }
}

setInterval(() => {
  const now = Date.now();
  while (samples.length && now - samples[0].t > 3000) samples.shift();
  const fresh = latest.at && now - latest.at < 4000;
  const p3 = samples.length ? Math.round(samples.reduce((a, s) => a + s.power, 0) / samples.length) : null;
  el.power.textContent = fresh && p3 != null ? p3 : '–';
  if (!fresh) { el.cadence.textContent = '–'; el.speed.textContent = '–'; }

  // The clock only runs while you're pedalling.
  const pedalling = fresh && (latest.cadence > 0 || latest.power > 0);
  if (pedalling) {
    rideSeconds++;
    powerSum += latest.power || 0;
    powerCount++;
    el.time.textContent = fmtTime(rideSeconds);
    el.avg.textContent = Math.round(powerSum / powerCount);
  }
  if (workout) workoutTick(pedalling);
  const target = workout ? workoutTarget() : settings.mode === 'erg' ? settings.power : null;
  history.push({ power: fresh ? p3 : null, target });
  if (history.length > 300) history.shift();
  drawChart();
}, 1000);

function drawChart() {
  const c = el.chart;
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth;
  const h = c.clientHeight;
  if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);

  const css = getComputedStyle(document.documentElement);
  const max = Math.max(200, ...history.map((p) => Math.max(p.power || 0, p.target || 0))) * 1.1;
  const x = (i) => (i / 299) * w;
  const y = (v) => h - (v / max) * h;

  g.strokeStyle = css.getPropertyValue('--line');
  g.fillStyle = css.getPropertyValue('--muted');
  g.font = '11px system-ui';
  g.lineWidth = 1;
  for (let v = 100; v < max; v += 100) {
    g.beginPath(); g.moveTo(0, y(v)); g.lineTo(w, y(v)); g.stroke();
    if (y(v) > 14) g.fillText(v, 2, y(v) - 3);
  }
  const offset = 300 - history.length;
  const line = (key, color, width) => {
    g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round';
    g.beginPath();
    let pen = false;
    history.forEach((p, i) => {
      if (p[key] == null) { pen = false; return; }
      const X = x(i + offset), Y = y(p[key]);
      pen ? g.lineTo(X, Y) : g.moveTo(X, Y);
      pen = true;
    });
    g.stroke();
  };
  line('target', css.getPropertyValue('--accent'), 2);
  line('power', css.getPropertyValue('--power'), 2.5);
}

// ---------------------------------------------------------------------------
// Training plan & workout player

let workout = null; // { session, week, t, intensity, paused, log: [watts per second] }
let viewWeek = null;

const wo = {
  card: $('#workout'),
  week: $('#wo-week'),
  name: $('#wo-name'),
  int: $('#wo-int'),
  step: $('#wo-step'),
  next: $('#wo-next'),
  left: $('#wo-left'),
  profile: $('#wo-profile'),
  elapsed: $('#wo-elapsed'),
  total: $('#wo-total'),
  hint: $('#wo-hint'),
  done: $('#wo-done'),
  pause: $('#wo-pause'),
  skip: $('#wo-skip'),
  end: $('#wo-end'),
};
const planEl = {
  card: $('#plan'),
  ftp: $('#ftp'),
  progress: $('#plan-progress'),
  weeks: $('#weeks'),
  sessions: $('#sessions'),
  resume: $('#resume'),
  result: $('#result'),
};

function workoutTarget() {
  if (!workout) return null;
  const now = at(workout.session, workout.t);
  if (!now) return null;
  return Math.max(0, Math.round(settings.ftp * now.pct * workout.intensity));
}

function nextSessionId() {
  for (const w of PLAN) for (const s of w.sessions) if (!settings.done[s.id]) return s.id;
  return null;
}

function startWorkout(id, t = 0, intensity = 1) {
  const found = findSession(id);
  if (!found) return;
  if (workout && !confirm(`Stop ${workout.session.name} and start ${found.session.name}?`)) return;
  workout = { session: found.session, week: found.week, t, intensity, paused: false, log: [] };
  planEl.resume.hidden = true;
  planEl.result.hidden = true;
  wo.card.hidden = false;
  planEl.card.hidden = true;
  wo.week.textContent = `Week ${found.week.week} · ${found.week.theme}`;
  wo.name.textContent = found.session.name;
  wo.done.hidden = !found.session.test;
  wo.skip.hidden = !!found.session.test;
  wo.pause.textContent = 'Pause';
  wo.total.textContent = fmtTime(totalSecs(found.session));
  setMode('erg');
  lastSent = null;
  updateWorkoutUI(false);
  sendTarget();
  log(`Started workout: week ${found.week.week}, ${found.session.name}`);
  wo.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setIntensity(v) {
  if (!workout) return;
  workout.intensity = clamp(Math.round(v * 100) / 100, 0.5, 1.5);
  updateWorkoutUI(true);
  sendTarget();
}

function workoutTick(pedalling) {
  if (!workout.paused && pedalling) {
    workout.log.push(latest.power || 0);
    workout.t++;
    if (!at(workout.session, workout.t)) return finishWorkout(true);
    saveActive();
  }
  updateWorkoutUI(pedalling);
  sendTarget();
}

function updateWorkoutUI(pedalling) {
  if (!workout) return;
  const s = workout.session;
  const now = at(s, workout.t);
  if (!now) return;
  wo.int.textContent = `${Math.round(workout.intensity * 100)}%`;
  wo.step.textContent = `${now.step.label} · ${workoutTarget()} W`;
  const nxt = s.steps[now.index + 1];
  wo.next.textContent = s.test
    ? 'Keep going as long as you can'
    : nxt
      ? `Next: ${nxt.label} · ${fmtTime(nxt.secs)} at ${Math.round(settings.ftp * nxt.from * workout.intensity)} W`
      : 'Last one!';
  wo.left.textContent = fmtTime(Math.ceil(now.left));
  wo.elapsed.textContent = fmtTime(workout.t);
  wo.hint.textContent = workout.paused
    ? 'Paused'
    : !trainer.connected
      ? 'Connect your trainer'
      : pedalling ? '' : 'Start pedalling to continue';
  wo.profile.innerHTML = profileSvg(s, workout.t);
  render();
}

function saveActive() {
  if (workout.t % 5) return;
  try {
    localStorage.setItem('turbo-active', JSON.stringify({
      id: workout.session.id, t: workout.t, intensity: workout.intensity, savedAt: Date.now(),
    }));
  } catch {}
}
function clearActive() {
  try { localStorage.removeItem('turbo-active'); } catch {}
}

function finishWorkout(completed) {
  const w = workout;
  if (!w) return;
  workout = null;
  clearActive();
  wo.card.hidden = true;
  planEl.card.hidden = false;
  setMode('erg');

  const mins = Math.round(w.t / 60);
  const avg = w.log.length ? Math.round(w.log.reduce((a, b) => a + b, 0) / w.log.length) : 0;

  if (w.session.test) {
    settings.done[w.session.id] = today();
    const best = bestMinute(w.log);
    const est = Math.round(best * 0.75);
    planEl.result.hidden = false;
    planEl.result.innerHTML = best
      ? `<div>Ramp test done! Best minute <b>${best} W</b> → estimated FTP<br><b class="big">${est} W</b>
           <span class="muted">(currently ${settings.ftp} W)</span></div>
         <div><button class="primary" data-ftp="${est}">Use ${est} W</button> <button data-ftp="">Keep ${settings.ftp} W</button></div>`
      : `<div>Not enough power data to estimate FTP — was the trainer connected?</div><div><button data-ftp="">OK</button></div>`;
    log(`Ramp test: best minute ${best} W, estimated FTP ${est} W`);
  } else {
    if (completed || w.t >= totalSecs(w.session) * 0.8) settings.done[w.session.id] = today();
    planEl.result.hidden = false;
    planEl.result.innerHTML = `<div><b>${completed ? 'Workout complete! 🎉' : 'Workout ended.'}</b>
      ${w.session.name}: ${mins} min${avg ? `, average ${avg} W` : ''}.</div><div><button data-ftp="">OK</button></div>`;
  }
  save();
  // Gentle spin afterwards so the trainer doesn't stay at a hard target.
  settings.power = Math.round(settings.ftp * 0.45);
  save();
  render();
  lastSent = null;
  sendTarget();
  el.flash.textContent = `Free ride at ${settings.power} W — spin easy to cool down.`;
  renderPlan();
  planEl.card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/** Highest average power over any 60 consecutive seconds. */
function bestMinute(watts) {
  if (watts.length < 60) return 0;
  let sum = 0;
  let best = 0;
  for (let i = 0; i < watts.length; i++) {
    sum += watts[i];
    if (i >= 60) sum -= watts[i - 60];
    if (i >= 59) best = Math.max(best, sum / 60);
  }
  return Math.round(best);
}

planEl.result.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.ftp) {
    settings.ftpHistory.push({ date: today(), from: settings.ftp, to: +b.dataset.ftp });
    settings.ftp = +b.dataset.ftp;
    planEl.ftp.value = settings.ftp;
    save();
  }
  planEl.result.hidden = true;
  renderPlan();
});

wo.pause.addEventListener('click', () => {
  if (!workout) return;
  workout.paused = !workout.paused;
  wo.pause.textContent = workout.paused ? 'Resume' : 'Pause';
  updateWorkoutUI(true);
});
wo.skip.addEventListener('click', () => {
  if (!workout) return;
  const now = at(workout.session, workout.t);
  if (now) workout.t += Math.ceil(now.left);
  if (!at(workout.session, workout.t)) finishWorkout(true);
  else { updateWorkoutUI(true); sendTarget(); }
});
wo.end.addEventListener('click', () => {
  if (workout && confirm('End this workout now?')) finishWorkout(false);
});
wo.done.addEventListener('click', () => finishWorkout(true));
for (const b of document.querySelectorAll('[data-int]')) {
  b.addEventListener('click', () => workout && setIntensity(workout.intensity + Number(b.dataset.int) / 100));
}

// --- plan list ---

function renderPlan() {
  const next = nextSessionId();
  const doneCount = Object.keys(settings.done).filter((id) => findSession(id)).length;
  planEl.progress.textContent = next
    ? `${doneCount} of 24 rides done · next up: week ${findSession(next).week.week}, ${findSession(next).session.name}`
    : 'All 24 rides done — brilliant! Start again with your new FTP?';
  if (viewWeek == null) viewWeek = next ? findSession(next).week.week : 8;

  planEl.weeks.innerHTML = '';
  for (const w of PLAN) {
    const b = document.createElement('button');
    b.setAttribute('role', 'tab');
    b.textContent = `W${w.week}`;
    b.title = `Week ${w.week}: ${w.theme}`;
    b.setAttribute('aria-selected', w.week === viewWeek);
    if (w.sessions.every((s) => settings.done[s.id])) b.classList.add('done');
    b.addEventListener('click', () => { viewWeek = w.week; renderPlan(); });
    planEl.weeks.append(b);
  }

  const week = PLAN[viewWeek - 1];
  planEl.sessions.innerHTML = `<p class="week-theme">Week ${week.week} · ${week.theme}</p>`;
  week.sessions.forEach((s, i) => {
    const row = document.createElement('div');
    const done = settings.done[s.id];
    row.className = `session${done ? ' done' : ''}${s.id === next ? ' next' : ''}`;
    const mins = Math.round(totalSecs(s) / 60);
    row.innerHTML = `
      <span class="tick">${done ? '✓' : i + 1}</span>
      <div><div class="title">${s.name}</div>
        <div class="meta">${s.test ? 'up to ' : ''}${mins} min${done ? ` · done ${fmtDate(done)}` : ''}</div></div>
      <button>${done ? 'Ride again' : 'Start'}</button>
      ${profileSvg(s)}
      <div class="note">${s.note}</div>`;
    row.querySelector('button').addEventListener('click', () => startWorkout(s.id));
    planEl.sessions.append(row);
  });
}

planEl.ftp.value = settings.ftp;
planEl.ftp.addEventListener('change', () => {
  const v = Math.round(parseFloat(planEl.ftp.value));
  if (v >= 40 && v <= 500) {
    settings.ftp = v;
    save();
    if (workout) { updateWorkoutUI(true); sendTarget(); }
  } else planEl.ftp.value = settings.ftp;
});

/** Bar chart of a session, coloured by training zone; `t` draws progress. */
function profileSvg(session, t) {
  const total = totalSecs(session);
  const H = 100;
  const y = (pct) => H - Math.min(H, (pct / 1.6) * H);
  let x = 0;
  let shapes = '';
  for (const s of session.steps) {
    const z = zone((s.from + s.to) / 2);
    shapes += `<polygon points="${x},${H} ${x},${y(s.from)} ${x + s.secs},${y(s.to)} ${x + s.secs},${H}" fill="var(--z${z})"/>`;
    x += s.secs;
  }
  let overlay = '';
  if (t != null) {
    overlay = `<rect x="0" y="0" width="${t}" height="${H}" fill="var(--bg)" opacity="0.55"/>
      <rect x="${t}" y="0" width="${total / 300}" height="${H}" fill="var(--text)"/>`;
  }
  return `<svg viewBox="0 0 ${total} ${H}" preserveAspectRatio="none" role="img" aria-label="${session.name} profile">${shapes}${overlay}</svg>`;
}
function zone(p) {
  return p < 0.56 ? 1 : p < 0.76 ? 2 : p < 0.91 ? 3 : p < 1.06 ? 4 : p < 1.21 ? 5 : 6;
}

function offerResume() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem('turbo-active') || 'null'); } catch {}
  if (!saved || Date.now() - saved.savedAt > 6 * 3600 * 1000) return clearActive();
  const found = findSession(saved.id);
  if (!found) return clearActive();
  planEl.resume.hidden = false;
  planEl.resume.innerHTML = `<div>Carry on with <b>${found.session.name}</b> from ${fmtTime(saved.t)}?</div>
    <div><button class="primary" data-go>Resume</button> <button data-no>Discard</button></div>`;
  planEl.resume.querySelector('[data-go]').onclick = () => startWorkout(saved.id, saved.t, saved.intensity);
  planEl.resume.querySelector('[data-no]').onclick = () => { clearActive(); planEl.resume.hidden = true; };
}

const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

// ---------------------------------------------------------------------------
// Settings panel

function buildMapping() {
  el.mapping.innerHTML = '';
  for (const [name, label, side] of BUTTONS) {
    const row = document.createElement('label');
    const key = document.createElement('span');
    key.className = 'key';
    key.dataset.btn = name;
    key.textContent = label;
    key.title = `${side} puck`;
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', `Clicker ${label} button (${side} puck)`);
    for (const [value, text] of Object.entries(ACTIONS)) sel.add(new Option(text, value));
    sel.value = settings.mapping[name] || 'none';
    sel.addEventListener('change', () => { settings.mapping[name] = sel.value; save(); });
    const left = document.createElement('span');
    left.append(key, ` ${side}`);
    left.className = 'muted';
    row.append(left, sel);
    el.mapping.append(row);
  }
}

function bindNumber(id, key) {
  const input = document.getElementById(id);
  input.value = settings[key];
  input.addEventListener('change', () => {
    const v = parseFloat(input.value);
    if (v > 0) { settings[key] = v; save(); } else input.value = settings[key];
  });
}
bindNumber('step-erg', 'stepErg');
bindNumber('step-erg-big', 'stepErgBig');
bindNumber('step-slope', 'stepSlope');
bindNumber('step-slope-big', 'stepSlopeBig');

// ---------------------------------------------------------------------------
// Helpers

let wakeLock = null;
async function keepAwake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && trainer.connected) keepAwake();
});

function setChip(btn, state, text) {
  btn.dataset.state = state;
  btn.querySelector('.label').textContent = text;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round1 = (v) => Math.round(v * 10) / 10;
function fmtTime(s) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

buildMapping();
setMode(settings.mode);
renderPlan();
offerResume();
window.__turbo.startWorkout = startWorkout;
window.__turbo.state = () => ({ workout, settings });
if (demo) log('Demo mode: fake trainer and clicker, no Bluetooth needed.');
