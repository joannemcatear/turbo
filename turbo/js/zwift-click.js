// Talks to one puck of a Zwift Click v2 (each puck is its own Bluetooth device).
//
// Protocol notes (from the open-source BikeControl project):
//   - custom service 0xFC82 (older firmware: 00000001-19ca-4651-86e5-fa29dcdd09d1)
//   - write "RideOn" + 0x02 0x03 to the sync-RX characteristic to start
//   - button frames arrive with first byte 0x23, followed by a protobuf
//     message whose field 1 is a bitmap; a bit set to 0 means "pressed"
//   - battery frames arrive with first byte 0x19 (protobuf field 2 = %)

const SERVICE_RIDE = '0000fc82-0000-1000-8000-00805f9b34fb';
const SERVICE_LEGACY = '00000001-19ca-4651-86e5-fa29dcdd09d1';
const CHAR_ASYNC = '00000002-19ca-4651-86e5-fa29dcdd09d1';
const CHAR_SYNC_RX = '00000003-19ca-4651-86e5-fa29dcdd09d1';
const CHAR_SYNC_TX = '00000004-19ca-4651-86e5-fa29dcdd09d1';
const ZWIFT_COMPANY_ID = 0x094a;

const RIDE_ON = [0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e]; // "RideOn"
const START_CLICK_V2 = [0x02, 0x03];

const OPCODE_CONTROLLER = 0x23;
const OPCODE_BATTERY = 0x19;

// Bit -> button name. Names follow what's printed on the Click v2.
export const BUTTON_BITS = {
  left: 0x00001,
  up: 0x00002,
  right: 0x00004,
  down: 0x00008,
  a: 0x00010,
  b: 0x00020,
  y: 0x00040,
  z: 0x00080,
  minus: 0x00100, // the "−" on the left puck
  plus: 0x01000, // the "+" on the right puck
  shiftDownLeft: 0x00200,
  shiftDownRight: 0x02000,
  powerUpLeft: 0x00400,
  powerUpRight: 0x04000,
  onOffLeft: 0x00800,
  onOffRight: 0x08000,
};

export class ZwiftClick extends EventTarget {
  constructor() {
    super();
    this.device = null;
    this.rx = null;
    this.pressed = new Set();
    this.seenReleased = new Set();
    this.battery = null;
    this._wantDisconnect = false;
    this.connected = false;
  }

  get name() {
    return this.device?.name || 'Zwift Click';
  }

  async pick() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Zwift Click' }, { manufacturerData: [{ companyIdentifier: ZWIFT_COMPANY_ID }] }],
      optionalServices: [SERVICE_RIDE, SERVICE_LEGACY, 'battery_service'],
    });
    this.device.addEventListener('gattserverdisconnected', () => this._onDisconnected());
    await this.connect();
  }

  async connect() {
    this._wantDisconnect = false;
    this._status('connecting');
    const server = await this.device.gatt.connect();
    let service;
    try {
      service = await server.getPrimaryService(SERVICE_RIDE);
    } catch {
      try {
        service = await server.getPrimaryService(SERVICE_LEGACY);
      } catch {
        throw new Error(
          'This controller is hiding its button service. Connect it once in the Zwift app, close Zwift, then try again.'
        );
      }
    }

    const asyncChar = await service.getCharacteristic(CHAR_ASYNC);
    const txChar = await service.getCharacteristic(CHAR_SYNC_TX);
    this.rx = await service.getCharacteristic(CHAR_SYNC_RX);

    const onValue = (e) => this._onFrame(new Uint8Array(e.target.value.buffer));
    asyncChar.addEventListener('characteristicvaluechanged', onValue);
    txChar.addEventListener('characteristicvaluechanged', onValue);
    await asyncChar.startNotifications();
    await txChar.startNotifications();

    await this.rx.writeValueWithoutResponse(new Uint8Array([...RIDE_ON, ...START_CLICK_V2]));

    this.connected = true;
    this._status('connected');
  }

  disconnect() {
    this._wantDisconnect = true;
    if (this.device?.gatt.connected) this.device.gatt.disconnect();
  }

  _onFrame(bytes) {
    if (!bytes.length) return;
    if (startsWith(bytes, RIDE_ON)) return; // handshake reply
    const opcode = bytes[0];
    const body = bytes.subarray(1);
    if (opcode === OPCODE_CONTROLLER) {
      const fields = readProtobufVarints(body);
      if (fields[1] === undefined) return;
      this._applyButtonMap(fields[1]);
    } else if (opcode === OPCODE_BATTERY) {
      const fields = readProtobufVarints(body);
      if (fields[2] !== undefined && fields[2] !== this.battery) {
        this.battery = fields[2];
        this.dispatchEvent(new CustomEvent('battery', { detail: this.battery }));
      }
    }
  }

  _applyButtonMap(map) {
    const now = new Set();
    for (const [name, bit] of Object.entries(BUTTON_BITS)) {
      const down = (map & bit) === 0; // 0 = pressed
      // A puck can report buttons it doesn't have as permanently "pressed".
      // Only trust a button once we've seen it released at least once.
      if (!down) this.seenReleased.add(name);
      else if (this.seenReleased.has(name)) now.add(name);
    }
    for (const name of now) {
      if (!this.pressed.has(name)) this.dispatchEvent(new CustomEvent('press', { detail: name }));
    }
    for (const name of this.pressed) {
      if (!now.has(name)) this.dispatchEvent(new CustomEvent('release', { detail: name }));
    }
    this.pressed = now;
  }

  _onDisconnected() {
    this.connected = false;
    for (const name of this.pressed) this.dispatchEvent(new CustomEvent('release', { detail: name }));
    this.pressed = new Set();
    this._status('disconnected');
    if (this._wantDisconnect) return;
    // A Click v2 that hasn't been "unlocked" by Zwift drops off after about a
    // minute. Quietly reconnect so the rider barely notices.
    this._reconnect(1);
  }

  async _reconnect(attempt) {
    if (this._wantDisconnect || attempt > 30) return;
    try {
      await this.connect();
    } catch {
      setTimeout(() => this._reconnect(attempt + 1), Math.min(5000, 500 * attempt));
    }
  }

  _status(state) {
    this.dispatchEvent(new CustomEvent('status', { detail: state }));
  }
}

function startsWith(bytes, prefix) {
  if (bytes.length < prefix.length) return false;
  return prefix.every((b, i) => bytes[i] === b);
}

// Minimal protobuf reader: returns {fieldNumber: value} for varint fields and
// skips everything else. That's all we need from the Click's messages.
export function readProtobufVarints(bytes) {
  const out = {};
  let i = 0;
  const varint = () => {
    let result = 0;
    let shift = 0;
    while (i < bytes.length) {
      const b = bytes[i++];
      result += (b & 0x7f) * 2 ** shift;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    return result;
  };
  while (i < bytes.length) {
    const key = varint();
    const field = Math.floor(key / 8);
    const type = key & 7;
    if (type === 0) out[field] = varint();
    else if (type === 2) i += varint();
    else if (type === 1) i += 8;
    else if (type === 5) i += 4;
    else break;
  }
  return out;
}
