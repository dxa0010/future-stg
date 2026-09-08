import type { PlayerStats } from './stats';
import { hasEvolution, upgradeLevel } from './stats';
import type { Rng } from './rng';
import { MASTERY_JUST_MIN, MASTERY_JUST_RATE, MASTERY_MAXCHARGE_MIN } from './constants';

export type UpgradeCategory = 'dodge' | 'charge' | 'collect' | 'general' | 'evolution';

/** 熟練度（内部値）。プレイヤーには見せない。 */
export interface Mastery {
  justSuccess: number;
  justAttempt: number;
  maxStageRelease: number;
}

export interface Upgrade {
  id: string;
  name: string;
  /** 段階ごとの説明。level は取得後のレベル。 */
  desc: (level: number) => string;
  category: UpgradeCategory;
  maxLevel: number;
  apply: (stats: PlayerStats, level: number) => void;
  /** 抽選に出る条件。省略時は常に候補。 */
  available?: (stats: PlayerStats, mastery: Mastery) => boolean;
  /** 抽選の重み。 */
  weight?: number;
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;

export const UPGRADES: readonly Upgrade[] = [
  // ------------------------------------------------------------ 回避系
  {
    id: 'emergency_thrust',
    name: 'エマージェンシースラスト',
    category: 'dodge',
    maxLevel: 3,
    desc: (lv) => `ジャスト判定拡大 / スタミナ上限 +1（Lv${lv}）`,
    apply: (s) => {
      s.justRadius += 3.5;
      s.staminaMax += 1;
    },
  },
  {
    id: 'boost_accel',
    name: 'ブーストアクセル',
    category: 'dodge',
    maxLevel: 3,
    desc: (lv) => `移動速度 +12% / 回避距離 +8% / スタミナ回復加速（Lv${lv}）`,
    apply: (s) => {
      s.moveSpeed *= 1.12;
      s.flickDist *= 1.08;
      s.staminaRegen = Math.max(30, Math.round(s.staminaRegen * 0.85));
    },
  },
  // ------------------------------------------------------------ 溜め系
  {
    id: 'condenser',
    name: 'コンデンサー',
    category: 'charge',
    maxLevel: 3,
    desc: (lv) => `チャージ速度 +22%（Lv${lv}）`,
    apply: (s) => {
      s.chargeRate *= 1.22;
    },
  },
  {
    id: 'aegis_field',
    name: 'イージスフィールド',
    category: 'charge',
    maxLevel: 2,
    desc: (lv) => `溜め成立中の被弾を無効化（ステージ毎 ${lv * 2} 回）`,
    // 仕様：溜め特化の進化以降でのみ入手できる
    available: (s) => hasEvolution(s, 'omega'),
    apply: (s) => {
      s.aegisMax += 2;
      s.aegis += 2;
    },
  },
  // ------------------------------------------------------------ 回収系
  {
    id: 'magnet_conversion',
    name: 'マグネットコンバージョン',
    category: 'collect',
    maxLevel: 2,
    desc: () => '溜め解放時の吸着が全画面化 / 取得経験値 1.5 倍',
    apply: (s) => {
      s.fullMagnet = true;
      s.expMul *= 1.5;
      s.magnetR += 26;
    },
  },
  // ------------------------------------------------------------ シナジー
  {
    id: 'overdrive_syndicate',
    name: 'オーバードライブ・シンジケート',
    category: 'charge',
    maxLevel: 1,
    desc: () => 'ジャスト回避から 3 秒以内に溜め開始でチャージ速度 3 倍',
    available: (_s, m) => m.justSuccess >= 3,
    apply: (s) => {
      s.overdrive = true;
    },
  },
  // ------------------------------------------------------------ 汎用
  {
    id: 'power',
    name: 'パワーセル',
    category: 'general',
    maxLevel: 6,
    weight: 1.4,
    desc: () => `攻撃力 ${pct(0.18)} 上昇`,
    apply: (s) => {
      s.atk *= 1.18;
    },
  },
  {
    id: 'rapid',
    name: 'ラピッドローダー',
    category: 'general',
    maxLevel: 5,
    weight: 1.2,
    desc: () => `連射速度 ${pct(0.15)} 上昇`,
    apply: (s) => {
      s.fireRate *= 1.15;
    },
  },
  {
    id: 'thruster',
    name: 'サブスラスター',
    category: 'general',
    maxLevel: 4,
    desc: () => `移動速度 ${pct(0.1)} 上昇`,
    apply: (s) => {
      s.moveSpeed *= 1.1;
    },
  },
  {
    id: 'coolant',
    name: 'クーラント',
    category: 'general',
    maxLevel: 3,
    desc: () => 'スタミナ回復が 25% 速くなる',
    apply: (s) => {
      s.staminaRegen = Math.max(24, Math.round(s.staminaRegen * 0.75));
    },
  },
  {
    id: 'collector',
    name: 'コレクターアーム',
    category: 'collect',
    maxLevel: 3,
    desc: () => 'ジェム吸着範囲 +40% / 経験値 +10%',
    apply: (s) => {
      s.magnetR *= 1.4;
      s.expMul *= 1.1;
    },
  },
];

/** 進化武器の定義。 */
export interface Evolution {
  id: 'vortex' | 'omega' | 'reflector';
  name: string;
  desc: string;
  /** 出現条件。 */
  ready: (stats: PlayerStats, mastery: Mastery) => boolean;
}

export const EVOLUTIONS: readonly Evolution[] = [
  {
    id: 'vortex',
    name: 'ヴォルテックスストーム',
    desc: 'ガトリング進化：ジャスト成功で 360 度誘導針弾。5 秒間、残像が自動射撃',
    ready: (s) => s.weapon === 'gatling' && upgradeLevel(s, 'boost_accel') >= 3,
  },
  {
    id: 'omega',
    name: '絶対零度・オメガカノン',
    desc: '集束ビーム進化：チャージ速度倍化 / 静止中スローフィールド / 解放が全画面貫通レーザー',
    ready: (s) => s.weapon === 'beam' && upgradeLevel(s, 'condenser') >= 3,
  },
  {
    id: 'reflector',
    name: 'ディメンション・リフレクター',
    desc: '特殊進化：静止中に敵弾を吸収してストック、回避入力で全方向反射レーザーに変換',
    // 「両方を極めた者に」＝回避・溜めの両方が高水準のときだけ
    ready: (_s, m) =>
      m.justSuccess >= MASTERY_JUST_MIN &&
      m.justAttempt > 0 &&
      m.justSuccess / m.justAttempt >= MASTERY_JUST_RATE &&
      m.maxStageRelease >= MASTERY_MAXCHARGE_MIN,
  },
];

export interface Choice {
  kind: 'upgrade' | 'evolution';
  id: string;
  name: string;
  desc: string;
  category: UpgradeCategory;
  /** 取得後のレベル（進化は 0）。 */
  level: number;
  /** 特殊進化の演出フラグ。 */
  special?: boolean;
}

export function findUpgrade(id: string): Upgrade | undefined {
  return UPGRADES.find((u) => u.id === id);
}

/** レベルアップ時の 3 択を決定論的に生成する。 */
export function rollChoices(stats: PlayerStats, mastery: Mastery, rng: Rng, count = 3): Choice[] {
  const out: Choice[] = [];

  // 条件を満たした進化は最優先で 1 枠を占有する
  for (const evo of EVOLUTIONS) {
    if (hasEvolution(stats, evo.id)) continue;
    if (evo.id !== 'reflector' && stats.evolutions.length > 0) continue;
    if (!evo.ready(stats, mastery)) continue;
    out.push({
      kind: 'evolution',
      id: evo.id,
      name: evo.name,
      desc: evo.desc,
      category: 'evolution',
      level: 0,
      special: evo.id === 'reflector',
    });
    break;
  }

  const pool: { up: Upgrade; w: number }[] = [];
  for (const up of UPGRADES) {
    const lv = upgradeLevel(stats, up.id);
    if (lv >= up.maxLevel) continue;
    if (up.available && !up.available(stats, mastery)) continue;
    pool.push({ up, w: up.weight ?? 1 });
  }

  while (out.length < count && pool.length > 0) {
    let total = 0;
    for (const p of pool) total += p.w;
    let r = rng.next() * total;
    let idx = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= pool[i].w;
      if (r <= 0) {
        idx = i;
        break;
      }
    }
    const picked = pool.splice(idx, 1)[0].up;
    const lv = upgradeLevel(stats, picked.id) + 1;
    out.push({
      kind: 'upgrade',
      id: picked.id,
      name: picked.name,
      desc: picked.desc(lv),
      category: picked.category,
      level: lv,
    });
  }

  return out;
}

/** 選択を適用する。 */
export function applyChoice(stats: PlayerStats, choice: Choice): void {
  if (choice.kind === 'evolution') {
    stats.evolutions.push(choice.id as 'vortex' | 'omega' | 'reflector');
    if (choice.id === 'omega') {
      stats.chargeRate *= 2;
    }
    if (choice.id === 'vortex') {
      stats.moveSpeed *= 1.15;
      stats.flickDist *= 1.1;
    }
    return;
  }
  const up = findUpgrade(choice.id);
  if (!up) return;
  const lv = upgradeLevel(stats, choice.id) + 1;
  stats.levels[choice.id] = lv;
  up.apply(stats, lv);
}
