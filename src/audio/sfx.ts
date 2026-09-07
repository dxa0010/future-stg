/**
 * WebAudio による最小の効果音。アセットは持たず、その場で合成する。
 * 仕様書で「音」が体験の一部になっている箇所（ジャストの金属音、
 * 溜めの充填音クレッシェンド、段階到達音）を優先して実装している。
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private chargeOsc: OscillatorNode | null = null;
  private chargeOsc2: OscillatorNode | null = null;
  private chargeGain: GainNode | null = null;
  private muted = false;

  /** ユーザー操作をきっかけに初期化する（モバイルの制約）。 */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.32;
    this.master.connect(this.ctx.destination);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.32;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  private get t(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private tone(
    type: OscillatorType,
    freq: number,
    dur: number,
    gain: number,
    sweepTo?: number,
    delay = 0,
  ): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t0 = this.t + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (sweepTo !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, filterHz: number, delay = 0): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t0 = this.t + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let seed = 12345;
    for (let i = 0; i < len; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(filterHz, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(120, filterHz * 0.25), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(master);
    src.start(t0);
  }

  shot(): void {
    this.tone('square', 760, 0.045, 0.045, 420);
  }

  /** ジャスト回避：鋭い金属音。 */
  just(): void {
    this.tone('triangle', 2400, 0.09, 0.3, 1500);
    this.tone('square', 3600, 0.05, 0.12, 2600, 0.005);
    this.noise(0.12, 0.18, 6000);
  }

  explode(size: number): void {
    this.noise(0.18 + size * 0.004, 0.28, 1800);
    this.tone('sine', 160, 0.25, 0.16, 50);
  }

  damage(): void {
    this.tone('sawtooth', 320, 0.4, 0.28, 60);
    this.noise(0.35, 0.24, 900);
  }

  levelup(): void {
    this.tone('triangle', 660, 0.09, 0.16);
    this.tone('triangle', 880, 0.09, 0.16, undefined, 0.08);
    this.tone('triangle', 1320, 0.16, 0.18, undefined, 0.16);
  }

  pickup(): void {
    this.tone('triangle', 900, 0.07, 0.14, 1400);
    this.tone('triangle', 1400, 0.1, 0.12, undefined, 0.06);
  }

  /** 溜め段階の到達音。 */
  chargeStage(stage: number): void {
    const base = [520, 780, 1180][Math.max(0, Math.min(2, stage - 1))];
    this.tone('square', base, 0.1, 0.16, base * 1.5);
    this.tone('sine', base * 2, 0.12, 0.1, undefined, 0.02);
  }

  /** 臨界共鳴。 */
  resonance(stage: number): void {
    this.tone('sawtooth', 90, 0.55, 0.3, 40);
    this.tone('square', 220 * stage, 0.35, 0.18, 80);
    this.noise(0.5, 0.3, 5200);
  }

  /**
   * 充填音。溜め量 t（0-1）に合わせて音程と音量をクレッシェンドさせる。
   * on=false で停止。
   */
  setCharge(on: boolean, t: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    if (on && !this.chargeOsc) {
      const g = ctx.createGain();
      g.gain.value = 0.0001;
      g.connect(master);
      const o1 = ctx.createOscillator();
      o1.type = 'sawtooth';
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o1.connect(g);
      o2.connect(g);
      o1.start();
      o2.start();
      this.chargeOsc = o1;
      this.chargeOsc2 = o2;
      this.chargeGain = g;
    }

    if (!on) {
      if (this.chargeOsc) {
        const now = this.t;
        this.chargeGain?.gain.cancelScheduledValues(now);
        this.chargeGain?.gain.setTargetAtTime(0.0001, now, 0.02);
        this.chargeOsc.stop(now + 0.12);
        this.chargeOsc2?.stop(now + 0.12);
        this.chargeOsc = null;
        this.chargeOsc2 = null;
        this.chargeGain = null;
      }
      return;
    }

    const now = this.t;
    const f = 110 + t * t * 520;
    this.chargeOsc?.frequency.setTargetAtTime(f, now, 0.05);
    this.chargeOsc2?.frequency.setTargetAtTime(f * 2.01, now, 0.05);
    this.chargeGain?.gain.setTargetAtTime(0.02 + t * 0.11, now, 0.06);
  }
}
