// Pretend devices so the app can be tried without any hardware: add ?demo to the URL.

export class FakeTrainer extends EventTarget {
  constructor() { super(); this.connected = false; this.name = 'Demo trainer'; this.target = { kind: 'power', value: 150 }; }
  async pick() {
    this.dispatchEvent(new CustomEvent('status', { detail: 'connecting' }));
    await new Promise((r) => setTimeout(r, 300));
    this.connected = true;
    this.dispatchEvent(new CustomEvent('status', { detail: 'connected' }));
    let power = 120;
    this.timer = setInterval(() => {
      const cadence = 85 + Math.random() * 6 - 3;
      const want = this.target.kind === 'power' ? this.target.value : 160 + this.target.value * 25;
      power += (want - power) * 0.25 + (Math.random() * 14 - 7);
      const speed = 28 + (power - 150) / 20 - (this.target.kind === 'slope' ? this.target.value * 1.5 : 0);
      this.dispatchEvent(new CustomEvent('data', { detail: { power: Math.round(power), cadence, speed: Math.max(5, speed) } }));
    }, 500);
  }
  disconnect() { clearInterval(this.timer); this.connected = false; this.dispatchEvent(new CustomEvent('status', { detail: 'disconnected' })); }
  setTargetPower(w) { this.target = { kind: 'power', value: w }; }
  setSlope(g) { this.target = { kind: 'slope', value: g }; }
}

let n = 0;
export class FakeClick extends EventTarget {
  constructor() { super(); this.connected = false; this.battery = 80; this.name = `Demo Click ${++n}`; }
  async pick() {
    this.connected = true;
    this.dispatchEvent(new CustomEvent('status', { detail: 'connected' }));
    this.dispatchEvent(new CustomEvent('battery', { detail: this.battery }));
  }
  disconnect() { this.connected = false; }
}
