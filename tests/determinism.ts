/**
 * 決定論チェック：同じシードと同じ入力列なら、必ず同じ結果になることを確認する。
 * これが保証されていれば「入力を保存するだけ」でゴーストリプレイが成立する。
 */
import { World } from '../src/sim/world';
import { Rng } from '../src/sim/rng';
import type { InputFrame } from '../src/sim/types';
import type { WeaponId } from '../src/sim/types';

/** 決められた乱数から擬似的なプレイ入力を作る。 */
function makeInputs(seed: number, frames: number): InputFrame[] {
  const rng = new Rng(seed);
  const out: InputFrame[] = [];
  let down = true;
  let hold = 0;
  for (let i = 0; i < frames; i++) {
    if (--hold <= 0) {
      down = rng.bool(0.6);
      hold = rng.int(10, 60);
    }
    out.push({
      down,
      dx: down ? rng.range(-4, 4) : 0,
      dy: down ? rng.range(-4, 4) : 0,
      flick: rng.bool(0.02) ? rng.int(0, 7) : -1,
      release: rng.bool(0.006),
    });
  }
  return out;
}

interface Digest {
  frame: number;
  px: number;
  py: number;
  lives: number;
  score: number;
  kills: number;
  level: number;
  enemies: number;
  eBullets: number;
  pBullets: number;
  gems: number;
  charge: number;
  stamina: number;
  rng: number;
  state: string;
  just: string;
}

function run(seed: number, weapon: WeaponId, inputs: InputFrame[]): Digest {
  const w = new World(seed, weapon);
  for (const inp of inputs) {
    // レベルアップで止まったら決定論的に先頭を選び続ける
    if (w.state === 'levelup') w.choose(0);
    if (w.state === 'stageclear') w.nextStage();
    if (w.state === 'gameover' || w.state === 'gameclear') break;
    w.update(inp);
    w.drainFx();
  }
  return {
    frame: w.frame,
    px: Math.round(w.px * 1000),
    py: Math.round(w.py * 1000),
    lives: w.lives,
    score: w.score,
    kills: w.kills,
    level: w.level,
    enemies: w.enemies.length,
    eBullets: w.eBullets.length,
    pBullets: w.pBullets.length,
    gems: w.gems.length,
    charge: Math.round(w.chargeFrames * 1000),
    stamina: w.stamina,
    rng: w.rng.getState(),
    state: w.state,
    just: `${w.mastery.justSuccess}/${w.mastery.justAttempt}`,
  };
}

let failed = 0;
function check(label: string, ok: boolean, extra = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`);
  if (!ok) failed++;
}

const FRAMES = 60 * 150;

for (const weapon of ['gatling', 'beam'] as const) {
  for (const seed of [1, 12345, 0xdeadbeef]) {
    const inputs = makeInputs(seed ^ 0x9e37, FRAMES);
    const a = run(seed, weapon, inputs);
    const b = run(seed, weapon, inputs);
    check(
      `determinism seed=${seed} weapon=${weapon}`,
      JSON.stringify(a) === JSON.stringify(b),
      `frames=${a.frame} state=${a.state} score=${a.score} kills=${a.kills} lv=${a.level} just=${a.just}`,
    );
  }
}

// 異なるシードでは結果が変わること（＝シードが効いていること）
{
  const inputs = makeInputs(777, FRAMES);
  const a = run(1, 'gatling', inputs);
  const b = run(2, 'gatling', inputs);
  check('different seeds diverge', JSON.stringify(a) !== JSON.stringify(b));
}

// Math.random がシミュレーション内で使われていないこと
{
  const real = Math.random;
  let used = false;
  Math.random = () => {
    used = true;
    return real();
  };
  const inputs = makeInputs(31, 60 * 60);
  run(99, 'beam', inputs);
  Math.random = real;
  check('sim does not use Math.random', !used);
}

// 仕様の主要な数値がフレームに落ちているか
import {
  FLICK_IFRAMES,
  FLICK_DURATION,
  CHARGE_COMMIT,
  CHARGE_STAGES,
  STAMINA_REGEN,
  HITSTOP_JUST,
} from '../src/sim/constants';
check('無敵 0.12s = 7F', FLICK_IFRAMES === 7, `${FLICK_IFRAMES}F`);
check('回避モーション 0.3s = 18F', FLICK_DURATION === 18, `${FLICK_DURATION}F`);
check('誤タッチ閾値 0.15s = 9F', CHARGE_COMMIT === 9, `${CHARGE_COMMIT}F`);
check('溜め段階 1/2/3.5s', CHARGE_STAGES.join(',') === '60,120,210', CHARGE_STAGES.join(','));
check('スタミナ回復 4s = 240F', STAMINA_REGEN === 240, `${STAMINA_REGEN}F`);
check('ヒットストップ 0.05s = 3F', HITSTOP_JUST === 3, `${HITSTOP_JUST}F`);

// 溜めの繰り越し：指を離す→再接地しても溜めは減らない
{
  const w = new World(5, 'beam');
  const up: InputFrame = { down: false, dx: 0, dy: 0, flick: -1, release: false };
  const dn: InputFrame = { down: true, dx: 0, dy: 0, flick: -1, release: false };
  for (let i = 0; i < 40; i++) w.update(up);
  const held = w.chargeFrames;
  for (let i = 0; i < 60; i++) w.update(dn);
  check('溜めは再接地しても保持される', w.chargeFrames === held && held > 0, `${held}F`);
  // 0.15秒未満の誤タッチでは増えない
  const before = w.chargeFrames;
  for (let i = 0; i < 5; i++) w.update(up);
  check('0.15秒未満の指離しでは溜めが増えない', w.chargeFrames === before);
}

// 画面遷移：ボス撃破の「レベルアップ → ステージクリア」でキーが変わること。
// ここが同じキーだと Ui が描き直さず、選択後に操作不能で固まる（実際に出たバグ）。
import { screenKey } from '../src/ui/screenKey';
{
  const levelup = screenKey({ state: 'levelup', level: 5, pendingLevels: 1, stageId: 1 });
  const stageclear = screenKey({ state: 'stageclear', level: 5, pendingLevels: 0, stageId: 1 });
  check('レベルアップ → ステージクリアでキーが変わる', levelup !== stageclear, `${levelup} -> ${stageclear}`);

  const a = screenKey({ state: 'levelup', level: 5, pendingLevels: 2, stageId: 1 });
  const b = screenKey({ state: 'levelup', level: 6, pendingLevels: 1, stageId: 1 });
  check('連続レベルアップでキーが変わる', a !== b, `${a} -> ${b}`);

  const playing = screenKey({ state: 'playing', level: 5, pendingLevels: 0, stageId: 1 });
  check('プレイ中はオーバーレイ無し', playing === 'none');

  const over = screenKey({ state: 'gameover', level: 5, pendingLevels: 0, stageId: 1 });
  check('ゲームオーバーは専用キー', over === 'gameover' && over !== playing);
}

// ボス撃破後、3択を選ぶとステージクリアへ抜けられること（固まらないこと）
{
  const w = new World(4242, 'gatling');
  const idle: InputFrame = { down: true, dx: 0, dy: 0, flick: -1, release: false };
  // 中ボスまで飛ばして即撃破する
  w.stageFrame = w.stage.bossAt - 1;
  w.update(idle);
  const boss = w.enemies.find((e) => e.kind === 'midboss');
  check('中ボスが出現する', !!boss);
  if (boss) {
    boss.parts.forEach((p) => {
      p.destroyed = true;
    });
    boss.coreOpen = true;
    w.damageEnemy(boss, 99999, true, boss.x, boss.y);
  }
  check('撃破でレベルアップ（宝箱）が開く', w.state === 'levelup', w.state);
  w.choose(0);
  check('選択後にステージクリアへ抜ける', w.state === 'stageclear', w.state);
  w.nextStage();
  check('次ステージへ進める', w.state === 'playing' && w.stage.id === 2, `${w.state} stage=${w.stage.id}`);
  const before = w.frame;
  for (let i = 0; i < 30; i++) w.update(idle);
  check('進行が再開する', w.frame > before, `${before} -> ${w.frame}`);
}

// 回避の弾き：無敵区間ではジャストが成立し、経路の弾は弾かれること。
// 無敵中に経路を掃きすぎるとジャスト回避が成立しなくなるので、両立を確認する。
import { DODGE_DEFLECT_R } from '../src/sim/constants';
{
  const hold: InputFrame = { down: true, dx: 0, dy: 0, flick: -1, release: false };
  const dodgeRight: InputFrame = { down: true, dx: 0, dy: 0, flick: 2, release: false };

  /** 自機から (ox, oy) の位置に静止した弾を置く。回避は右方向に 90 進む。 */
  const putBullet = (w: World, ox: number, oy: number) => {
    w.eBullets.push({
      alive: true, kind: 'bullet', x: w.px + ox, y: w.py + oy, vx: 0, vy: 0,
      r: 4, life: 600, len: 0, angle: 0, warn: 0, deflect: 0, style: 1,
    });
    return w.eBullets[w.eBullets.length - 1];
  };

  const runDodge = (w: World) => {
    for (let i = 0; i < FLICK_DURATION + 2; i++) {
      w.update(i === 0 ? dodgeRight : hold);
      w.drainFx();
    }
  };

  // (a) 経路の芯にある弾はジャストの対象。成立して消える
  {
    const w = new World(7, 'gatling');
    w.enemies.length = 0;
    const b = putBullet(w, 20, 0);
    runDodge(w);
    check('経路の芯の弾でジャストが成立する', w.mastery.justSuccess === 1, `just=${w.mastery.justSuccess}`);
    check('ジャストした弾は消える', !b.alive);
  }

  // (b) 無敵が切れた後に通る（＝着地点まわりの）弾は「弾かれる」
  {
    const w = new World(7, 'gatling');
    w.enemies.length = 0;
    const b = putBullet(w, 88, 18);
    runDodge(w);
    check('着地点まわりの弾は弾かれる', b.alive && w.deflects >= 1, `alive=${b.alive} deflects=${w.deflects}`);
    check('弾いた弾は消えていない（消すのはジャストだけ）', b.alive);
    check('弾かれた弾は一時的に無害になる', b.deflect > 0, `${b.deflect}F`);
    check(
      '弾かれた弾は自機から離れる向きに飛ぶ',
      b.vx * (b.x - w.px) + b.vy * (b.y - w.py) > 0,
      `v=(${b.vx.toFixed(1)},${b.vy.toFixed(1)})`,
    );
  }

  // (c) 通路の外は弾かれない（回避が万能にならないこと）
  {
    const w = new World(7, 'gatling');
    w.enemies.length = 0;
    const b = putBullet(w, 88, DODGE_DEFLECT_R + 32);
    runDodge(w);
    check('通路の外の弾は弾かれない', b.deflect === 0 && w.deflects === 0, `deflects=${w.deflects}`);
  }

  // (d) 弾かれた弾は時間が経つと再び危険になる
  {
    const w = new World(7, 'gatling');
    w.enemies.length = 0;
    const b = putBullet(w, 88, 18);
    runDodge(w);
    const start = b.deflect;
    for (let i = 0; i < start + 2; i++) {
      w.update(hold);
      w.drainFx();
    }
    check('弾かれた弾はやがて危険に戻る', start > 0 && b.deflect === 0, `${start}F -> ${b.deflect}F`);
  }
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
if (failed > 0) process.exit(1);
