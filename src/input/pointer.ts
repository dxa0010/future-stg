import type { InputFrame } from '../sim/types';
import { FLICK_SWIPE_DIST, STICK_MAX_R, STICK_DEADZONE, STICK_SPEED } from '../sim/constants';

interface Sample {
  x: number;
  y: number;
  t: number;
}

/** 描画に渡すスティックの状態（すべて仮想座標）。 */
export interface StickView {
  active: boolean;
  /** 支点。 */
  ox: number;
  oy: number;
  /** 支点からのつまみのずれ。 */
  kx: number;
  ky: number;
  /** 倒し具合 0-1。 */
  norm: number;
}

/** 操作方式。 */
export type MoveMode = 'stick' | 'drag';

/**
 * ドラッグ／回避／解放を 1 フレーム分の InputFrame に変換する層。
 *
 * 移動の「ダイレクト感」に効くのは主に 3 つ：
 *  - 指の移動量を 1:1 で自機に渡す（PLAYER_DRAG_GAIN = 1.0）
 *  - pointermove の coalesced events を全部拾う（端末のタッチは 120Hz 以上で来る）
 *  - 1 フレームあたりの移動量をむやみに丸めない
 */
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
  private keys = new Set<string>();

  /** 直近の進行方向（8方向）。回避ボタンはこの向きに飛ぶ。 */
  private headingDir = 0;
  /** 進行方向を出すための移動量の指数移動平均。 */
  private hx = 0;
  private hy = 0;

  /** スワイプでも回避を出すか。既定はオフ（誤爆でスタミナを食うため）。 */
  swipeDodge = false;

  /** 1 フレームあたりのドラッグ移動量の上限（暴発時の保険）。 */
  private static readonly MAX_DRAG = 30;
  /** スワイプ判定に使う時間窓（ms）。 */
  private static readonly WINDOW_MS = 110;
  /** 連続スワイプ回避の最小間隔（ms）。 */
  private static readonly FLICK_GAP_MS = 200;
  /** 進行方向とみなす移動量の下限（仮想座標／イベント）。 */
  private static readonly HEADING_MIN = 0.6;
  /** 進行方向の追従の速さ（0-1、大きいほど機敏）。 */
  private static readonly HEADING_SMOOTH = 0.35;

  /** 操作方式。既定は仮想スティック。 */
  mode: MoveMode = 'stick';

  // --- 仮想スティックの状態（仮想座標）
  private stickActive = false;
  private stickOx = 0;
  private stickOy = 0;
  private stickKx = 0;
  private stickKy = 0;

  constructor(
    private readonly getScale: () => number,
    private readonly toVirtual: (clientX: number, clientY: number) => { x: number; y: number },
  ) {}

  /** 描画用のスティック状態。 */
  get stick(): StickView {
    const d = Math.hypot(this.stickKx, this.stickKy);
    return {
      active: this.stickActive && this.mode === 'stick',
      ox: this.stickOx,
      oy: this.stickOy,
      kx: this.stickKx,
      ky: this.stickKy,
      norm: Math.min(1, d / STICK_MAX_R),
    };
  }

  /**
   * スティックの倒し具合を単位ベクトル×強さで返す。倒していなければ null。
   * 遊びの外側から線形に効かせる（素直で読みやすい方が狙って動かせる）。
   */
  private stickVector(): { x: number; y: number } | null {
    if (!this.stickActive) return null;
    const d = Math.hypot(this.stickKx, this.stickKy);
    if (d <= STICK_DEADZONE) return null;
    const strength = Math.min(1, (d - STICK_DEADZONE) / (STICK_MAX_R - STICK_DEADZONE));
    return { x: (this.stickKx / d) * strength, y: (this.stickKy / d) * strength };
  }

  /** スティックのつまみを動かし、倒しきったら支点を引きずる。 */
  private moveStick(clientX: number, clientY: number): void {
    const v = this.toVirtual(clientX, clientY);
    let kx = v.x - this.stickOx;
    let ky = v.y - this.stickOy;
    const d = Math.hypot(kx, ky);
    if (d > STICK_MAX_R) {
      // 支点を指へ寄せる。こうしないと大きく振ったときに反応が頭打ちで固まって感じる
      const over = d - STICK_MAX_R;
      this.stickOx += (kx / d) * over;
      this.stickOy += (ky / d) * over;
      kx = (kx / d) * STICK_MAX_R;
      ky = (ky / d) * STICK_MAX_R;
    }
    this.stickKx = kx;
    this.stickKy = ky;
  }

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
      // 触った場所にスティックが出る（フローティング方式）
      const v = this.toVirtual(e.clientX, e.clientY);
      this.stickActive = true;
      this.stickOx = v.x;
      this.stickOy = v.y;
      this.stickKx = 0;
      this.stickKy = 0;
      e.preventDefault();
    });

    el.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.pointerId || !this.down) return;
      // 端末は rAF より細かくタッチを取っている。まとめて届く分も全部使う。
      const batch = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
      const s = this.getScale();
      for (const p of batch.length > 0 ? batch : [e]) {
        const mx = (p.clientX - this.lastX) / s;
        const my = (p.clientY - this.lastY) / s;
        this.accDx += mx;
        this.accDy += my;
        this.lastX = p.clientX;
        this.lastY = p.clientY;
        this.updateHeading(mx, my);
        this.pushSample(p.clientX, p.clientY, p.timeStamp);
      }
      this.moveStick(e.clientX, e.clientY);
      e.preventDefault();
    });

    const end = (e: PointerEvent): void => {
      if (e.pointerId !== this.pointerId) return;
      this.pointerId = -1;
      this.down = false;
      this.stickActive = false;
      this.stickKx = 0;
      this.stickKy = 0;
      this.samples.length = 0;
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);

    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.key.toLowerCase());
      this.handleKey(e);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.down = false;
      this.pointerId = -1;
      this.stickActive = false;
    });
  }

  private pushSample(x: number, y: number, t: number): void {
    this.samples.push({ x, y, t });
    while (this.samples.length > 1 && t - this.samples[0].t > PointerInput.WINDOW_MS) {
      this.samples.shift();
    }

    const first = this.samples[0];
    const s = this.getScale();
    const dx = (x - first.x) / s;
    const dy = (y - first.y) / s;
    const dist = Math.hypot(dx, dy);

    if (!this.swipeDodge) return;
    if (this.pendingFlick >= 0) return;
    if (t - this.lastFlickAt < PointerInput.FLICK_GAP_MS) return;
    if (dist < FLICK_SWIPE_DIST) return;

    // 通常の移動で暴発しないよう、「速くてまっすぐ」なときだけ回避にする
    let path = 0;
    for (let i = 1; i < this.samples.length; i++) {
      path += Math.hypot(this.samples[i].x - this.samples[i - 1].x, this.samples[i].y - this.samples[i - 1].y) / s;
    }
    if (path > 0 && dist / path < 0.8) return;

    this.pendingFlick = this.headingDir;
    this.lastFlickAt = t;
    this.samples.length = 0;
    this.samples.push({ x, y, t });
    // 回避として消費した移動量はドラッグに二重反映させない
    this.accDx = 0;
    this.accDy = 0;
  }

  /**
   * 進行方向を更新する。
   * 時間窓のサンプルに頼ると pointermove が疎な端末で更新されないので、
   * 移動量そのものの指数移動平均から出す。
   */
  private updateHeading(mx: number, my: number): void {
    const k = PointerInput.HEADING_SMOOTH;
    this.hx = this.hx * (1 - k) + mx * k;
    this.hy = this.hy * (1 - k) + my * k;
    if (Math.hypot(this.hx, this.hy) >= PointerInput.HEADING_MIN) {
      this.headingDir = snap8(this.hx, this.hy);
    }
  }

  private handleKey(e: KeyboardEvent): void {
    const k = e.key.toLowerCase();
    if (k === ' ' || k === 'x') {
      this.pendingRelease = true;
      e.preventDefault();
      return;
    }
    if (k === 'shift' || k === 'z') {
      this.requestDodge();
      e.preventDefault();
    }
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

  /** いま回避ボタンを押したら飛ぶ方向。 */
  get heading(): number {
    return this.headingDir;
  }

  /** 回避ボタン／キーから呼ばれる。進行方向へころりん。 */
  requestDodge(dir?: number): void {
    this.pendingFlick = dir ?? this.headingDir;
    this.lastFlickAt = performance.now();
  }

  /** 解放ボタンから呼ばれる。 */
  requestRelease(): void {
    this.pendingRelease = true;
  }

  reset(): void {
    this.accDx = 0;
    this.accDy = 0;
    this.hx = 0;
    this.hy = 0;
    this.stickActive = false;
    this.stickKx = 0;
    this.stickKy = 0;
    this.pendingFlick = -1;
    this.pendingRelease = false;
    this.samples.length = 0;
  }

  /** 1 ティック分の入力を取り出す（呼ぶたびに累積がリセットされる）。 */
  sample(): InputFrame {
    let dx = 0;
    let dy = 0;

    if (this.mode === 'stick') {
      // スティックは「倒した向きへ一定速度」。指の移動量は使わない
      const v = this.stickVector();
      if (v) {
        dx = v.x * STICK_SPEED;
        dy = v.y * STICK_SPEED;
        this.headingDir = snap8(v.x, v.y);
      }
      this.accDx = 0;
      this.accDy = 0;
    } else {
      dx = this.accDx;
      dy = this.accDy;
      this.accDx = 0;
      this.accDy = 0;
    }

    let down = this.down;
    const kdir = this.keyDir();
    if (kdir >= 0) {
      // キーボード操作時は「移動キーを押している間＝接地」とみなす
      down = true;
      this.headingDir = kdir;
      this.hx = 0;
      this.hy = 0;
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
