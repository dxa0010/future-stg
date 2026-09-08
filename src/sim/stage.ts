import type { EnemyKind } from './types';

export type Formation = 'line' | 'arc' | 'sides' | 'stream' | 'single';

export interface SpawnEvent {
  /** ステージ開始からのフレーム。 */
  at: number;
  kind: EnemyKind;
  count: number;
  formation: Formation;
  /** 基準 X（0-1 の画面比率）。 */
  x?: number;
  /** 連続スポーンの間隔フレーム（stream 用）。 */
  gap?: number;
  hpMul?: number;
}

export interface PickupEvent {
  at: number;
  /** 0-1 の画面比率。弾幕の中を狙って置く。 */
  x: number;
}

export interface StageDef {
  id: number;
  name: string;
  /** 背景スクロール速度（px/frame）。 */
  scroll: number;
  events: SpawnEvent[];
  pickups: PickupEvent[];
  /** ボス出現フレーム。 */
  bossAt: number;
  bossKind: 'midboss' | 'boss';
  /** ステージ全体の敵 HP 倍率。 */
  hpMul: number;
}

const s = (sec: number): number => Math.round(sec * 60);

export const STAGES: readonly StageDef[] = [
  {
    id: 1,
    name: 'STAGE 1 — 軌道残骸帯',
    scroll: 1.6,
    hpMul: 1,
    bossAt: s(72),
    bossKind: 'midboss',
    pickups: [{ at: s(38), x: 0.5 }],
    events: [
      { at: s(2), kind: 'grunt', count: 5, formation: 'line', x: 0.5 },
      { at: s(6), kind: 'grunt', count: 4, formation: 'arc', x: 0.28 },
      { at: s(9), kind: 'grunt', count: 4, formation: 'arc', x: 0.72 },
      { at: s(13), kind: 'zigzag', count: 3, formation: 'line', x: 0.5 },
      { at: s(17), kind: 'grunt', count: 6, formation: 'stream', x: 0.2, gap: 12 },
      { at: s(19), kind: 'grunt', count: 6, formation: 'stream', x: 0.8, gap: 12 },
      { at: s(24), kind: 'turret', count: 2, formation: 'sides' },
      { at: s(27), kind: 'zigzag', count: 4, formation: 'arc', x: 0.5 },
      { at: s(32), kind: 'rusher', count: 3, formation: 'line', x: 0.45 },
      { at: s(36), kind: 'shield', count: 3, formation: 'line', x: 0.5 },
      { at: s(40), kind: 'grunt', count: 8, formation: 'stream', x: 0.5, gap: 8 },
      { at: s(44), kind: 'turret', count: 2, formation: 'sides' },
      { at: s(47), kind: 'zigzag', count: 5, formation: 'arc', x: 0.35 },
      { at: s(51), kind: 'rusher', count: 4, formation: 'sides' },
      { at: s(55), kind: 'shield', count: 4, formation: 'arc', x: 0.6 },
      { at: s(59), kind: 'grunt', count: 10, formation: 'stream', x: 0.5, gap: 6 },
      { at: s(63), kind: 'zigzag', count: 4, formation: 'line', x: 0.5 },
      { at: s(66), kind: 'rusher', count: 4, formation: 'line', x: 0.5 },
    ],
  },
  {
    id: 2,
    name: 'STAGE 2 — 拒絶回廊',
    scroll: 2.4,
    hpMul: 1.4,
    bossAt: s(84),
    bossKind: 'boss',
    pickups: [
      { at: s(30), x: 0.18 },
      { at: s(62), x: 0.82 },
    ],
    events: [
      { at: s(2), kind: 'zigzag', count: 4, formation: 'line', x: 0.5 },
      { at: s(5), kind: 'grunt', count: 8, formation: 'stream', x: 0.3, gap: 8 },
      { at: s(8), kind: 'grunt', count: 8, formation: 'stream', x: 0.7, gap: 8 },
      { at: s(12), kind: 'shield', count: 4, formation: 'line', x: 0.5 },
      { at: s(15), kind: 'turret', count: 2, formation: 'sides' },
      { at: s(19), kind: 'rusher', count: 5, formation: 'arc', x: 0.5 },
      { at: s(23), kind: 'zigzag', count: 6, formation: 'arc', x: 0.4 },
      { at: s(27), kind: 'shield', count: 5, formation: 'arc', x: 0.5 },
      { at: s(31), kind: 'turret', count: 2, formation: 'sides' },
      { at: s(33), kind: 'grunt', count: 12, formation: 'stream', x: 0.5, gap: 5 },
      { at: s(38), kind: 'rusher', count: 6, formation: 'sides' },
      { at: s(42), kind: 'zigzag', count: 6, formation: 'line', x: 0.5 },
      { at: s(46), kind: 'shield', count: 4, formation: 'line', x: 0.25 },
      { at: s(48), kind: 'shield', count: 4, formation: 'line', x: 0.75 },
      { at: s(52), kind: 'turret', count: 2, formation: 'sides' },
      { at: s(55), kind: 'rusher', count: 6, formation: 'arc', x: 0.5 },
      { at: s(59), kind: 'zigzag', count: 7, formation: 'arc', x: 0.5 },
      { at: s(64), kind: 'grunt', count: 14, formation: 'stream', x: 0.5, gap: 4 },
      { at: s(69), kind: 'shield', count: 6, formation: 'arc', x: 0.5 },
      { at: s(74), kind: 'rusher', count: 7, formation: 'sides' },
      { at: s(78), kind: 'zigzag', count: 6, formation: 'line', x: 0.5 },
    ],
  },
];
