import type { FxEvent } from '../sim/types';
import type { TextureSet } from './textures';
import { SpritePool } from './pool';

interface Effect {
  kind: 'glow' | 'ring' | 'spark';
  x: number;
  y: number;
  t: number;
  life: number;
  size: number;
  endSize: number;
  tint: number;
  rot: number;
}

/**
 * 演出のみを扱う層。シミュレーションからは切り離されているので、
 * ここが重くなってもロジックのフレームには影響しない。
 */
export class FxLayer {
  readonly pool = new SpritePool();
  private effects: Effect[] = [];
  /** 画面シェイク量。 */
  shake = 0;
  /** 被弾時の赤フラッシュ。 */
  damageFlash = 0;
  /** 臨界共鳴の白フラッシュ。 */
  whiteFlash = 0;

  constructor(private readonly tex: TextureSet) {
    // 加算合成はスプライト単位で指定する。
    // Container 側に blendMode を置くとレンダーグループ扱いになり、
    // 環境によっては背景ごと暗く合成されてしまう。
  }

  push(ev: FxEvent): void {
    switch (ev.type) {
      case 'just':
        this.add('ring', ev.x, ev.y, 10, 78, 0xbff4ff, 22);
        this.add('glow', ev.x, ev.y, 60, 10, 0xffffff, 14);
        this.shake = Math.max(this.shake, 3);
        break;
      case 'explode':
        this.add('glow', ev.x, ev.y, ev.size * 1.6, ev.size * 3.8, 0xffa04d, 24);
        this.add('glow', ev.x, ev.y, ev.size * 0.7, ev.size * 1.5, 0xffffff, 9);
        this.add('ring', ev.x, ev.y, ev.size * 0.6, ev.size * 3.4, 0xfff0c0, 20);
        this.shake = Math.max(this.shake, Math.min(6, ev.size * 0.16));
        break;
      case 'hit':
        this.add('glow', ev.x, ev.y, 16, 4, 0xdff4ff, 8);
        break;
      case 'bossPart':
        this.add('glow', ev.x, ev.y, 40, 110, 0xff8ce0, 30);
        this.add('ring', ev.x, ev.y, 14, 120, 0xffffff, 26);
        this.shake = Math.max(this.shake, 8);
        break;
      case 'resonance':
        this.whiteFlash = 0.55 + ev.stage * 0.12;
        this.shake = Math.max(this.shake, 5 + ev.stage * 2);
        break;
      case 'shock':
        this.add('ring', ev.x, ev.y, 12, ev.r * 2, 0x9ff0ff, 20);
        break;
      case 'damaged':
        this.damageFlash = 1;
        this.shake = Math.max(this.shake, 10);
        this.add('ring', ev.x, ev.y, 8, 130, 0xff5577, 26);
        break;
      default:
        break;
    }
  }

  private add(kind: Effect['kind'], x: number, y: number, size: number, endSize: number, tint: number, life: number): void {
    this.effects.push({ kind, x, y, t: 0, life, size, endSize, tint, rot: 0 });
  }

  /** 描画は可変フレームなので、経過時間（秒）でイージングする。 */
  update(dtScale: number): void {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t += dtScale;
      if (e.t >= e.life) this.effects.splice(i, 1);
    }
    this.shake *= Math.pow(0.82, dtScale);
    if (this.shake < 0.05) this.shake = 0;
    this.damageFlash = Math.max(0, this.damageFlash - 0.055 * dtScale);
    this.whiteFlash = Math.max(0, this.whiteFlash - 0.07 * dtScale);
  }

  draw(): void {
    this.pool.begin();
    for (const e of this.effects) {
      const u = Math.min(1, e.t / e.life);
      const ease = 1 - Math.pow(1 - u, 3);
      const size = e.size + (e.endSize - e.size) * ease;
      const tx = e.kind === 'ring' ? this.tex.ring : this.tex.glow;
      const base = e.kind === 'ring' ? 32 : 64;
      const s = this.pool.add(tx);
      s.x = e.x;
      s.y = e.y;
      s.scale.set(size / base);
      s.tint = e.tint;
      // 加算合成なので、消え際まで芯が残るように立ち上がりを強くする
      s.alpha = Math.pow(1 - u, 1.4) * (e.kind === 'ring' ? 1 : 0.95);
      s.blendMode = 'add';
    }
    this.pool.end();
  }

  clear(): void {
    this.effects.length = 0;
    this.shake = 0;
    this.damageFlash = 0;
    this.whiteFlash = 0;
  }
}
