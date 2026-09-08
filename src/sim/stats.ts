import { STAMINA_MAX, STAMINA_REGEN, JUST_RADIUS_BASE, FLICK_DISTANCE, GEM_MAGNET_R } from './constants';
import type { EvolutionId, WeaponId } from './types';

/** ビルドによって変化する自機の性能。すべてここに集約する。 */
export interface PlayerStats {
  weapon: WeaponId;
  /** 攻撃力倍率。 */
  atk: number;
  /** 連射速度倍率（大きいほど速い）。 */
  fireRate: number;
  /** ドラッグ追従倍率。 */
  moveSpeed: number;
  /** スタミナ上限。 */
  staminaMax: number;
  /** スタミナ 1 個の自動回復に必要なフレーム。 */
  staminaRegen: number;
  /** ジャスト成立判定の半径。 */
  justRadius: number;
  /** フリックの固定距離。 */
  flickDist: number;
  /** チャージ速度倍率。 */
  chargeRate: number;
  /** ジェム吸着半径。 */
  magnetR: number;
  /** 取得経験値倍率。 */
  expMul: number;
  /** 溜め解放時にジェムを全画面吸着するか。 */
  fullMagnet: boolean;
  /** イージスフィールド：溜め成立中の被弾を無効化できる残り回数。 */
  aegis: number;
  /** ステージ開始時に戻るイージスの回数。 */
  aegisMax: number;
  /** オーバードライブ・シンジケート所持。 */
  overdrive: boolean;
  /** 取得済みの進化武器。 */
  evolutions: EvolutionId[];
  /** 取得済みアップグレードのレベル。 */
  levels: Record<string, number>;
}

export function createStats(weapon: WeaponId): PlayerStats {
  return {
    weapon,
    atk: 1,
    fireRate: 1,
    moveSpeed: 1,
    staminaMax: STAMINA_MAX,
    staminaRegen: STAMINA_REGEN,
    justRadius: JUST_RADIUS_BASE,
    flickDist: FLICK_DISTANCE,
    chargeRate: 1,
    magnetR: GEM_MAGNET_R,
    expMul: 1,
    fullMagnet: false,
    aegis: 0,
    aegisMax: 0,
    overdrive: false,
    evolutions: [],
    levels: {},
  };
}

export function hasEvolution(stats: PlayerStats, id: EvolutionId): boolean {
  return stats.evolutions.indexOf(id) >= 0;
}

export function upgradeLevel(stats: PlayerStats, id: string): number {
  return stats.levels[id] ?? 0;
}
