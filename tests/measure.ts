/** 究極進化（ディメンション・リフレクター）の実効値を測る一時スクリプト。 */
import { World } from '../src/sim/world';
import type { InputFrame, Enemy } from '../src/sim/types';
import { applyChoice } from '../src/sim/upgrades';
import { CHARGE_STAGES, RESONANCE_BEAM_DPF, RESONANCE_BEAM_FRAMES, RESONANCE_SHOCK_R } from '../src/sim/constants';

const up: InputFrame = { down: false, dx: 0, dy: 0, flick: -1, release: false };
const hold: InputFrame = { down: true, dx: 0, dy: 0, flick: -1, release: false };
const dodge: InputFrame = { down: true, dx: 0, dy: 0, flick: 0, release: false };

/** 自機の周りに濃い弾幕を張る。 */
function curtain(w: World, n: number, r: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.4 + (i % 5) / 5);
    w.eBullets.push({
      alive: true, kind: 'bullet', x: w.px + Math.cos(a) * rr, y: w.py + Math.sin(a) * rr,
      vx: -Math.cos(a) * 0.6, vy: -Math.sin(a) * 0.6,
      r: 4.2, life: 900, len: 0, angle: 0, warn: 0, deflect: 0, style: 1,
    });
  }
}

function dummy(w: World, x: number, y: number, hp: number): Enemy {
  const e = w.enemies[0];
  void e;
  w.enemies.push({
    id: w.nextEnemyId++, alive: true, kind: 'grunt', x, y, vx: 0, vy: 0, r: 12,
    hp, maxHp: hp, gems: 0, contact: false, t: 0, fireCd: 99999, phase: 0,
    shieldHp: 0, shieldMax: 0, flash: 0, parts: [], coreOpen: false, phaseIdx: 0, baseX: x,
  });
  return w.enemies[w.enemies.length - 1];
}

// --- 1. 吸収できる量
{
  const w = new World(1, 'beam');
  applyChoice(w.stats, { kind: 'evolution', id: 'omega', name: '', desc: '', category: 'evolution', level: 0 });
  applyChoice(w.stats, { kind: 'evolution', id: 'reflector', name: '', desc: '', category: 'evolution', level: 0 });
  w.enemies.length = 0;
  // 濃い弾幕の中で 2 秒静止する
  for (let f = 0; f < 120; f++) {
    if (f % 20 === 0) curtain(w, 14, 70);
    w.update(up);
    w.drainFx();
  }
  console.log(`吸収: 2秒静止で ${w.reflectStock} 発`);

  // --- 2. 解放レーザーのダメージ（真上の敵）
  const target = dummy(w, w.px, w.py - 150, 99999);
  const before = target.hp;
  const stock = w.reflectStock;
  w.update(dodge);
  for (let f = 0; f < 90; f++) {
    w.update(hold);
    w.drainFx();
  }
  console.log(`解放レーザー: ストック ${stock} 発 → 真上の敵に ${(before - target.hp).toFixed(0)} ダメージ`);
}

// --- 2b. 回避中の弾きがホーミングに変わるか
{
  const w = new World(2, 'beam');
  applyChoice(w.stats, { kind: 'evolution', id: 'omega', name: '', desc: '', category: 'evolution', level: 0 });
  applyChoice(w.stats, { kind: 'evolution', id: 'reflector', name: '', desc: '', category: 'evolution', level: 0 });
  w.enemies.length = 0;
  const target = dummy(w, w.px + 40, w.py - 200, 99999);
  const before = target.hp;
  // 回避の経路上に弾を並べる
  for (let i = 0; i < 8; i++) {
    w.eBullets.push({
      alive: true, kind: 'bullet', x: w.px + 60 + i * 5, y: w.py + (i % 3) * 7 - 7, vx: 0, vy: 0,
      r: 4.2, life: 900, len: 0, angle: 0, warn: 0, deflect: 0, style: 1,
    });
  }
  const n0 = w.eBullets.length;
  for (let f = 0; f < 120; f++) {
    w.update(f === 0 ? { down: true, dx: 0, dy: 0, flick: 2, release: false } : hold);
    w.drainFx();
  }
  console.log(`\n回避の弾き: 経路の ${n0} 発 → 反転して敵に ${(before - target.hp).toFixed(0)} ダメージ（弾き ${w.deflects} 発）`);
}

// --- 2c. ジャスト＋αの反射窓
{
  const w = new World(3, 'beam');
  applyChoice(w.stats, { kind: 'evolution', id: 'omega', name: '', desc: '', category: 'evolution', level: 0 });
  applyChoice(w.stats, { kind: 'evolution', id: 'reflector', name: '', desc: '', category: 'evolution', level: 0 });
  w.enemies.length = 0;
  w.eBullets.push({
    alive: true, kind: 'bullet', x: w.px + 20, y: w.py, vx: 0, vy: 0,
    r: 4.2, life: 900, len: 0, angle: 0, warn: 0, deflect: 0, style: 1,
  });
  w.update({ down: true, dx: 0, dy: 0, flick: 2, release: false });
  const livesBefore = w.lives;
  console.log(`反射窓: ジャストで ${w.reflectWindow}F 開く`);
  // 窓の間に弾をぶつける
  let reflected = 0;
  for (let f = 0; f < 20; f++) {
    w.eBullets.push({
      alive: true, kind: 'bullet', x: w.px, y: w.py, vx: 0, vy: 0,
      r: 4.2, life: 900, len: 0, angle: 0, warn: 0, deflect: 0, style: 1,
    });
    const pb = w.pBullets.length;
    w.update(hold);
    w.drainFx();
    if (w.pBullets.length > pb) reflected++;
  }
  console.log(`  窓の中で自機に当てた弾: ${reflected} 発を撃ち返し、残機は ${livesBefore} → ${w.lives}`);
}

// --- 3. 比較：臨界共鳴（段階3）の理論値
{
  const beamDmg = RESONANCE_BEAM_DPF[2] * RESONANCE_BEAM_FRAMES;
  const shock = 14 * 3;
  console.log(`\n参考：臨界共鳴 段階3 = ビーム ${beamDmg.toFixed(0)} + 衝撃波 ${shock} = ${(beamDmg + shock).toFixed(0)} ダメージ`);
  console.log(`      衝撃波の範囲 ${RESONANCE_SHOCK_R[2]}、溜め ${CHARGE_STAGES[2]}F`);
}

// --- 4. 敵の HP 感
console.log(`\n参考：雑魚 HP 4、シールド敵 10（+シールド26）、砲台 22、中ボス 330、ボス 760`);
