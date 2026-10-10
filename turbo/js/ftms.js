// Talks to a smart trainer (e.g. Zwift Hub One) over the standard
// Bluetooth "Fitness Machine Service" (FTMS).
//
//   Indoor Bike Data (notify)   -> live power, cadence, speed
//   Control Point (write+indicate) -> ERG target power / simulated slope

const FTMS_SERVICE = 0x1826;
const INDOOR_BIKE_DATA = 0x2ad2;
const CONTROL_POINT = 0x2ad9;

const OP = {
  REQUEST_CONTROL: 0x00,
  RESET: 0x01,
  SET_TARGET_POWER: 0x05,
  START_RESUME: 0x07,
  SET_SIMULATION: 0x11,
  RESPONSE: 0x80,
};

export class Trainer extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.controlPoint = null;
    this.connected = false;
    this._queue = Promise.resolve();
    this._pending = null; // latest target waiting to be sent (latest wins)
    this._sending = false;
    this._wantDisconnect = false;
  }

  get name() {
    return this.device?.name || 'Trainer';
  }

  async pick() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [FTMS_SERVICE] }, { namePrefix: 'Zwift Hub' }],
      optionalServices: [FTMS_SERVICE],
    });
    this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());
    await this.connect();
  }

  async connect() {
    this._wantDisconnect = false;
    this._status('connecting');
    this._queue = Promise.resolve();
    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(FTMS_SERVICE);

    const data = await service.getCharacteristic(INDOOR_BIKE_DATA);
    data.addEventListener('characteristicvaluechanged', (e) => this._onBikeData(e.target.value));
    await data.startNotifications();

    this.controlPoint = await service.getCharacteristic(CONTROL_POINT);
    this.controlPoint.addEventListener('characteristicvaluechanged', (e) => this._onControlResponse(e.target.value));
    await this.controlPoint.startNotifications(); // indications

    await this._write([OP.REQUEST_CONTROL]);
    await this._write([OP.START_RESUME]);

    this.connected = true;
    this._status('connected');
    // Re-apply whatever target the app last asked for.
    if (this._lastTarget) this._enqueueTarget(this._lastTarget);
  }

  disconnect() {
    this._wantDisconnect = true;
    if (this.device?.gatt.connected) this.device.gatt.disconnect();
  }

  /** ERG mode: hold this many watts whatever the cadence. */
  setTargetPower(watts) {
    const w = Math.round(Math.max(0, Math.min(2000, watts)));
    this._enqueueTarget({ kind: 'power', value: w });
  }

  /** Slope mode: simulate riding up/down a road of this gradient (%). */
  setSlope(gradePercent) {
    const g = Math.max(-10, Math.min(20, gradePercent));
    this._enqueueTarget({ kind: 'slope', value: g });
  }

  // --- internals -------------------------------------------------------

  _enqueueTarget(target) {
    this._lastTarget = target;
    if (!this.connected) return;
    this._pending = target;
    if (!this._sending) this._drain();
  }

  async _drain() {
    this._sending = true;
    try {
      while (this._pending && this.connected) {
        const t = this._pending;
        this._pending = null;
        if (t.kind === 'power') {
          const v = t.value;
          await this._write([OP.SET_TARGET_POWER, v & 0xff, (v >> 8) & 0xff]);
        } else {
          const grade = Math.round(t.value * 100); // 0.01 % units, signed 16-bit
          const g = grade < 0 ? 0x10000 + grade : grade;
          // wind 0 m/s, grade, rolling resistance 0.004, wind resistance 0.51 kg/m
          await this._write([OP.SET_SIMULATION, 0, 0, g & 0xff, (g >> 8) & 0xff, 40, 51]);
        }
        // Don't flood the trainer: one command at most every 250 ms.
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (err) {
      this._log(`Trainer command failed: ${err.message}`);
    } finally {
      this._sending = false;
    }
  }

  _write(bytes) {
    // Bluetooth only allows one operation at a time, so writes go in a line.
    const p = this._queue.then(() => this.controlPoint.writeValueWithResponse(new Uint8Array(bytes)));
    this._queue = p.catch(() => {});
    return p;
  }

  _onControlResponse(view) {
    if (view.getUint8(0) !== OP.RESPONSE) return;
    const op = view.getUint8(1);
    const result = view.getUint8(2);
    if (result !== 0x01) {
      const names = { 2: 'not supported', 3: 'invalid value', 4: 'failed', 5: 'not permitted' };
      this._log(`Trainer rejected command 0x${op.toString(16)}: ${names[result] || result}`);
      if (result === 5) this._write([OP.REQUEST_CONTROL]).catch(() => {});
    }
  }

  _onBikeData(view) {
    const flags = view.getUint16(0, true);
    let i = 2;
    const out = {};
    if (!(flags & 0x0001)) { out.speed = view.getUint16(i, true) / 100; i += 2; } // km/h
    if (flags & 0x0002) i += 2; // average speed
    if (flags & 0x0004) { out.cadence = view.getUint16(i, true) / 2; i += 2; } // rpm
    if (flags & 0x0008) i += 2; // average cadence
    if (flags & 0x0010) i += 3; // total distance
    if (flags & 0x0020) i += 2; // resistance level
    if (flags & 0x0040) { out.power = view.getInt16(i, true); i += 2; } // watts
    if (flags & 0x0080) i += 2; // average power
    if (flags & 0x0100) i += 5; // energy
    if (flags & 0x0200) { out.heartRate = view.getUint8(i); i += 1; }
    if (Object.keys(out).length) this.dispatchEvent(new CustomEvent('data', { detail: out }));
  }

  _onDisconnected() {
    this.connected = false;
    this._status('disconnected');
    if (this._wantDisconnect) return;
    this._log('Trainer dropped out — reconnecting…');
    this._reconnect(1);
  }

  async _reconnect(attempt) {
    if (this._wantDisconnect || attempt > 10) return;
    try {
      await this.connect();
      this._log('Trainer reconnected.');
    } catch {
      setTimeout(() => this._reconnect(attempt + 1), Math.min(10000, 1000 * attempt));
    }
  }

  _status(state) {
    this.dispatchEvent(new CustomEvent('status', { detail: state }));
  }

  _log(msg) {
    this.dispatchEvent(new CustomEvent('log', { detail: msg }));
  }
}
