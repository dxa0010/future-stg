import type { InputFrame } from '../sim/types';
import { FLICK_SWIPE_DIST } from '../sim/constants';

interface Sample {
  x: number;
  y: number;
  t: number;
}

/** ドラッグ／フリック／解放タップを 1 フレーム分の InputFrame に変換する層。 */
export class PointerInput {
  private down = false;
  private accDx = 0;
  private accDy = 0;
  private lastX = 0;
  private lastY = 0;
  private samples: Sample[] = [];
  private pendingFlick = -1;
  private pendingRelease = false;
  private lastFlickAt = -1e9;
  private pointerId = -1;

  /** キーボード操作（PC 検証用）。 */
  private keys = new Set<string>();

  /** 1 フレームあたりのドラッグ移動量の上限（速いスワイプで自機がワープしないように）。 */
  private static readonly MAX_DRAG = 20;
  /** スワイプ判定に使う時間窓（ms）。 */
  private static readonly WINDOW_MS = 130;
  /** 連続フリックの最小間隔（ms）。 */
  private static readonly FLICK_GAP_MS = 130;

  constructor(private readonly getScale: () => number) {}

  attach(el: HTMLElement): void {
    el.style.touchAction = 'none';

    el.addEventListener('pointerdown', (e) => {
      if (this.pointerId !== -1) return;
      this.pointerId = e.pointerId;
      el.setPointerCapture(e.pointerId);
      this.down = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.samples.length = 0;
      this.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
      e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId || !this.down) return;
      const s = this.getScale();
      this.accDx += (e.clientX - this.lastX) / s;
      this.accDy += (e.clientY - this.lastY) / s;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.pushSample(e.clientX, e.clientY, e.timeStamp);
      e.preventDefault();
    });

    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = -1;
      this.down = false;
      this.samples.length = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.key.toLowerCase());
      this.handleKeyFlick(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.down = false;
      this.pointerId = -1;
    });
  }

  private pushSample(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t });
    while (this.samples.length > 1 && t - this.samples[0].t > PointerInput.WINDOW_MS) {
      this.samples.shift();
    }
    if (this.pendingFlick >= 0) return;
    if (t - this.lastFlickAt < PointerInput.FLICK_GAP_MS) return;

    const first = this.samples[0];
    const s = this.getScale();
    const dx = (x - first.x) / s;
    const dy = (y - first.y) / s;
    if (Math.hypot(dx, dy) < FLICK_SWIPE_DIST) return;

    this.pendingFlick = snap8(dx, dy);
    this.lastFlickAt = t;
    this.samples.length = 0;
    this.samples.push({ x, y, t });
    // フリックとして消費した移動量はドラッグに二重反映させない
    this.accDx = 0;
    this.accDy = 0;
  }

  private handleKeyFlick(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'x') {
      this.pendingRelease = true;
      e.preventDefault();
      return;
    }
    if (k !== 'shift' && k !== 'z') return;
    const dir = this.keyDir();
    if (dir >= 0) this.pendingFlick = dir;
  }

  /** キーボードの方向入力（-1 で入力なし）。 */
  private keyDir(): number {
    let dx = 0;
    let dy = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dx -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) dx += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) dy -= 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) dy += 1;
    if (dx === 0 && dy === 0) return -1;
    return snap8(dx, dy);
  }

  /** 解放ボタンから呼ばれる。 */
  requestRelease(): void {
    this.pendingRelease = true;
  }

  /** 状態をリセット（ステージ切り替えなど）。 */
  reset(): void {
    this.accDx = 0;
    this.accDy = 0;
    this.pendingFlick = -1;
    this.pendingRelease = false;
    this.samples.length = 0;
  }

  /** 1 ティック分の入力を取り出す（呼ぶたびに累積がリセットされる）。 */
  sample(): InputFrame {
    let dx = this.accDx;
    let dy = this.accDy;
    this.accDx = 0;
    this.accDy = 0;

    let down = this.down;
    const kdir = this.keyDir();
    if (kdir >= 0) {
      // キーボード操作時は「移動キーを押している間＝接地」とみなす
      down = true;
      const sp = 4.6;
      const [kx, ky] = DIRV[kdir];
      dx += kx * sp;
      dy += ky * sp;
    }

    const m = Math.hypot(dx, dy);
    if (m > PointerInput.MAX_DRAG) {
      dx = (dx / m) * PointerInput.MAX_DRAG;
      dy = (dy / m) * PointerInput.MAX_DRAG;
    }

    const frame: InputFrame = {
      down,
      dx,
      dy,
      flick: this.pendingFlick,
      release: this.pendingRelease,
    };
    this.pendingFlick = -1;
    this.pendingRelease = false;
    return frame;
  }
}

const R = Math.SQRT1_2;
const DIRV: readonly (readonly [number, number])[] = [
  [0, -1],
  [R, -R],
  [1, 0],
  [R, R],
  [0, 1],
  [-R, R],
  [-1, 0],
  [-R, -R],
];

/** ベクトルを 8 方向インデックス（上=0、時計回り）にスナップする。 */
export function snap8(dx: number, dy: number): number {
  const a = Math.atan2(dx, -dy);
  let i = Math.round(a / (Math.PI / 4)) % 8;
  if (i < 0) i += 8;
  return i;
}
