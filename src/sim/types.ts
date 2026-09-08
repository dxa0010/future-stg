/**
 * シミュレーション層で使う型。Pixi には一切依存しない。
 */

/** 1 フレーム分の入力。これを並べたものがリプレイになる。 */
export interface InputFrame {
  /** 画面に触れているか。false の間だけ溜めが進む。 */
  down: boolean;
  /** 前フレームからの指の移動量（仮想座標）。 */
  dx: number;
  dy: number;
  /** フリック方向 0-7（上を 0 として時計回り）。-1 はフリックなし。 */
  flick: number;
  /** 解放ボタンをタップしたフレームか。 */
  release: boolean;
}

export const EMPTY_INPUT: InputFrame = { down: false, dx: 0, dy: 0, flick: -1, release: false };

/** 8 方向スナップの方向ベクトル（上=0、時計回り）。 */
const R = Math.SQRT1_2;
export const DIR8: readonly (readonly [number, number])[] = [
  [0, -1],
  [R, -R],
  [1, 0],
  [R, R],
  [0, 1],
  [-R, R],
  [-1, 0],
  [-R, -R],
];

export type WeaponId = 'gatling' | 'beam';

export type EvolutionId = 'vortex' | 'omega' | 'reflector';

/** 敵弾の形状。円は通常弾、レーザーは太い線分判定。 */
export type HazardKind = 'bullet' | 'laser';

export interface PlayerBullet {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  /** 貫通残数。0 で消える。 */
  pierce: number;
  life: number;
  /** 誘導強度（0 で直進）。 */
  homing: number;
  /** 見た目の種別。 */
  style: 'gatling' | 'beam' | 'needle' | 'reflect';
  /** 既にヒットした敵 ID（貫通弾の多重ヒット防止）。 */
  hits: number[];
}

export interface EnemyBullet {
  alive: boolean;
  kind: HazardKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  /** レーザー用：長さと角度。 */
  len: number;
  angle: number;
  /** 出現直後の予告時間（この間は当たらない）。 */
  warn: number;
  /** 回避に弾かれてから無害でいる残りフレーム。 */
  deflect: number;
  style: number;
}

export type EnemyKind =
  | 'grunt'
  | 'zigzag'
  | 'shield'
  | 'rusher'
  | 'turret'
  | 'midboss'
  | 'boss';

export interface EnemyPart {
  /** 部位名（HUD 表示用）。 */
  name: string;
  hp: number;
  maxHp: number;
  /** 本体中心からのオフセット。 */
  ox: number;
  oy: number;
  r: number;
  destroyed: boolean;
}

export interface Enemy {
  id: number;
  alive: boolean;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  maxHp: number;
  /** 撃破時のジェム数。 */
  gems: number;
  /** 接触ダメージを持つか。 */
  contact: boolean;
  /** 内部タイマー（AI 用）。 */
  t: number;
  /** 次の射撃までのフレーム。 */
  fireCd: number;
  /** 個体ごとの位相（決定論的に生成時に決める）。 */
  phase: number;
  /** シールド敵：正面シールドの残量（0 で破壊）。 */
  shieldHp: number;
  shieldMax: number;
  /** 被弾フラッシュ。 */
  flash: number;
  /** ボス用の部位。 */
  parts: EnemyPart[];
  /** ボス用：コア露出中か。 */
  coreOpen: boolean;
  /** ボス用フェーズ番号。 */
  phaseIdx: number;
  /** スポーン時の基準 X（蛇行の中心）。 */
  baseX: number;
}

export interface Gem {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  /** 吸着中か。 */
  pulled: boolean;
  life: number;
}

export interface Pickup {
  alive: boolean;
  x: number;
  y: number;
  vy: number;
  kind: 'life';
  life: number;
}

/** 描画側に渡す一時的な演出イベント（シミュは状態を持たない）。 */
export type FxEvent =
  | { type: 'just'; x: number; y: number }
  | { type: 'deflect'; x: number; y: number }
  | { type: 'dash'; x1: number; y1: number; x2: number; y2: number; dir: number }
  | { type: 'explode'; x: number; y: number; size: number }
  | { type: 'hit'; x: number; y: number }
  | { type: 'resonance'; x: number; y: number; stage: number }
  | { type: 'shock'; x: number; y: number; r: number }
  | { type: 'damaged'; x: number; y: number }
  | { type: 'levelup' }
  | { type: 'chargeStage'; stage: number }
  | { type: 'pickupLife' }
  | { type: 'bossPart'; x: number; y: number };

/** ゲーム全体の進行状態。 */
export type GameState =
  | 'title'
  | 'playing'
  | 'levelup'
  | 'stageclear'
  | 'gameover'
  | 'gameclear';
