import { Trainer } from './ftms.js';
import { ZwiftClick } from './zwift-click.js';

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
  power: 150,
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
  if (s === 'connected') { log(`Trainer connected: ${trainer.name}`); keepAwake(); sendTarget(); }
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
  settings.mode = mode;
  save();
  for (const b of document.querySelectorAll('.mode button')) b.setAttribute('aria-selected', b.dataset.mode === mode);
  render();
  sendTarget();
}

function adjust(action) {
  const erg = settings.mode === 'erg';
  if (action === 'toggleMode') return setMode(erg ? 'slope' : 'erg');
  if (action === 'none') return;
  const sign = action === 'up' || action === 'bigUp' ? 1 : -1;
  const big = action === 'bigUp' || action === 'bigDown';
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

function sendTarget() {
  if (!trainer.connected) return;
  if (settings.mode === 'erg') trainer.setTargetPower(settings.power);
  else trainer.setSlope(settings.slope);
}

function render() {
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
  history.push({ power: fresh ? p3 : null, target: settings.mode === 'erg' ? settings.power : null });
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
if (demo) log('Demo mode: fake trainer and clicker, no Bluetooth needed.');
