/**
 * バランス検証：簡易ボットに通しプレイさせて、
 * ステージ所要時間・到達レベル・進化到達可否・被弾数をざっくり測る。
 * 人力プレイの代わりにはならないが、桁が狂っているかどうかは分かる。
 */
import { World } from '../src/sim/world';
import type { InputFrame, WeaponId } from '../src/sim/types';
import { VIEW_W, PLAYER_DRAG_GAIN } from '../src/sim/constants';
import { snap8 } from '../src/input/pointer';

type BotKind = 'safe' | 'aggressive';

/** ボットの移動速度（ワールド座標／フレーム）。人間の指より遅い前提の目安値。 */
const BOT_SPEED = 5.75;

interface Result {
  weapon: WeaponId;
  bot: BotKind;
  seed: number;
  outcome: string;
  frames: number;
  stage: number;
  level: number;
  kills: number;
  deaths: number;
  score: number;
  just: string;
  releases: number;
  maxStage3: number;
  evolutions: string;
  passiveTop: string;
}

function pickChoice(w: World, bot: BotKind): number {
  const wantCat = bot === 'aggressive' ? 'dodge' : 'charge';
  const trigger = w.stats.weapon === 'gatling' ? 'boost_accel' : 'condenser';
  let evo = -1;
  let trig = -1;
  let cat = -1;
  for (let i = 0; i < w.choices.length; i++) {
    const c = w.choices[i];
    if (c.kind === 'evolution') evo = i;
    else if (c.id === trigger) trig = i;
    else if (c.category === wantCat && cat < 0) cat = i;
  }
  // 進化 → 進化のトリガーパッシブ → 系統一致 → 先頭
  return evo >= 0 ? evo : trig >= 0 ? trig : cat >= 0 ? cat : 0;
}

function think(w: World, bot: BotKind, frame: number): InputFrame {
  const inp: InputFrame = { down: true, dx: 0, dy: 0, flick: -1, release: false };

  // 最も近い脅威を探す
  let nx = 0;
  let ny = 0;
  let nd = Infinity;
  let px = 0;
  let py = 0;
  for (const b of w.eBullets) {
    if (!b.alive || b.warn > 0) continue;
    if (b.kind === 'laser') continue;
    const dx = b.x - w.px;
    const dy = b.y - w.py;
    const d = Math.hypot(dx, dy);
    if (d < nd) {
      nd = d;
      nx = dx;
      ny = dy;
    }
    if (d < 150) {
      px -= dx / (d * d + 1);
      py -= dy / (d * d + 1);
    }
  }
  for (const e of w.enemies) {
    if (!e.alive) continue;
    const dx = e.x - w.px;
    const dy = e.y - w.py;
    const d = Math.hypot(dx, dy);
    if (d < nd - 4) {
      nd = d;
      nx = dx;
      ny = dy;
    }
    if (d < 130) {
      px -= dx / (d * d + 1);
      py -= dy / (d * d + 1);
    }
  }

  // 回避：safe は離れる方向、aggressive は脅威に重ねに行く
  const dodgeAt = bot === 'aggressive' ? 34 : 24;
  if (nd < dodgeAt && w.stamina > 0 && !w.flickActive) {
    inp.flick = bot === 'aggressive' ? snap8(nx, ny) : snap8(-nx, -ny);
    return inp;
  }

  // 溜め：脅威が遠いときだけ指を離す
  const calm = nd > 110;
  if (calm && w.chargeStage < 3) {
    inp.down = false;
    return inp;
  }
  // 解放：段階 2 以上で敵が上にいるとき
  if (w.chargeStage >= 2) {
    const target = w.enemies.some((e) => e.alive && e.y < w.py && Math.abs(e.x - w.px) < 70);
    if (target || w.chargeStage === 3) {
      inp.down = false;
      inp.release = true;
      return inp;
    }
  }

  // 移動：脅威から離れつつ、敵の下に潜り込んで撃つ
  let tx = w.px + px * 900;
  let ty = w.py + py * 900;
  let best: { x: number; y: number } | null = null;
  let bd = Infinity;
  for (const e of w.enemies) {
    if (!e.alive || e.y > w.py - 40) continue;
    const d = Math.hypot(e.x - w.px, e.y - w.py);
    if (d < bd) {
      bd = d;
      best = { x: e.x, y: e.y };
    }
  }
  if (best && nd > 70) tx = best.x;
  // ジェム回収のため少しだけ上下に揺れる
  ty += Math.sin(frame * 0.02) * 20;

  tx = Math.max(20, Math.min(VIEW_W - 20, tx));
  ty = Math.max(340, Math.min(600, ty));
  // ボットの速度は「ワールド座標で 1 フレームあたり BOT_SPEED」に固定する。
  // 入力は指の移動量なので、ドラッグ倍率で割ってから渡す
  // （PLAYER_DRAG_GAIN を変えてもボットの実効速度が変わらないようにするため）。
  const mx = Math.max(-BOT_SPEED, Math.min(BOT_SPEED, tx - w.px));
  const my = Math.max(-BOT_SPEED, Math.min(BOT_SPEED, ty - w.py));
  inp.dx = mx / PLAYER_DRAG_GAIN;
  inp.dy = my / PLAYER_DRAG_GAIN;
  return inp;
}

function play(seed: number, weapon: WeaponId, bot: BotKind): Result {
  const w = new World(seed, weapon);
  let deaths = 0;
  let lastLives = w.lives;
  let releases = 0;
  let lastCharge = 0;
  const maxFrames = 60 * 60 * 8;

  for (let f = 0; f < maxFrames; f++) {
    if (w.state === 'levelup') {
      w.choose(pickChoice(w, bot));
      continue;
    }
    if (w.state === 'stageclear') {
      w.nextStage();
      continue;
    }
    if (w.state !== 'playing') break;
    const inp = think(w, bot, f);
    w.update(inp);
    w.drainFx();
    if (w.lives < lastLives) deaths++;
    lastLives = w.lives;
    if (lastCharge > 0 && w.chargeFrames === 0 && w.resonance) releases++;
    lastCharge = w.chargeFrames;
  }

  const lv: string[] = [];
  for (const [k, v] of Object.entries(w.stats.levels)) lv.push(`${k}:${v}`);
  return {
    weapon,
    bot,
    seed,
    outcome: w.state,
    frames: w.frame,
    stage: w.stage.id,
    level: w.level,
    kills: w.kills,
    deaths,
    score: w.score,
    just: `${w.mastery.justSuccess}/${w.mastery.justAttempt}`,
    releases,
    maxStage3: w.mastery.maxStageRelease,
    evolutions: w.stats.evolutions.join('+') || '-',
    passiveTop: lv.join(' '),
  };
}

const rows: Result[] = [];
for (const weapon of ['gatling', 'beam'] as const) {
  for (const bot of ['safe', 'aggressive'] as const) {
    for (const seed of [11, 22, 33]) rows.push(play(seed, weapon, bot));
  }
}

const pad = (s: string | number, n: number): string => String(s).padEnd(n);
console.log(
  pad('weapon', 8) + pad('bot', 11) + pad('seed', 5) + pad('outcome', 11) + pad('time', 8) +
    pad('st', 3) + pad('lv', 4) + pad('kill', 6) + pad('死', 4) + pad('just', 9) + pad('解放', 6) +
    pad('S3', 4) + pad('evo', 12) + 'passives',
);
for (const r of rows) {
  console.log(
    pad(r.weapon, 8) + pad(r.bot, 11) + pad(r.seed, 5) + pad(r.outcome, 11) +
      pad(`${(r.frames / 60).toFixed(0)}s`, 8) + pad(r.stage, 3) + pad(r.level, 4) +
      pad(r.kills, 6) + pad(r.deaths, 4) + pad(r.just, 9) + pad(r.releases, 6) +
      pad(r.maxStage3, 4) + pad(r.evolutions, 12) + r.passiveTop,
  );
}
