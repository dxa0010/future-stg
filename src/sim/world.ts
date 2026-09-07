import { Rng } from './rng';
import {
  VIEW_W,
  VIEW_H,
  PLAYER_RADIUS,
  PLAYER_HIT_RADIUS,
  PLAYER_START_X,
  PLAYER_START_Y,
  PLAYER_DRAG_GAIN,
  PLAYER_HIT_INVULN,
  START_LIVES,
  FLICK_DURATION,
  FLICK_IFRAMES,
  CHARGE_COMMIT,
  CHARGE_STAGES,
  CHARGE_MAX,
  RELEASE_LOCK_AFTER_FLICK,
  RESONANCE_BEAM_FRAMES,
  RESONANCE_BEAM_HALFW,
  RESONANCE_SHOCK_R,
  RESONANCE_BEAM_DPF,
  RESONANCE_CLEARS_BULLETS,
  CHARGE_RATE_CAP,
  RESONANCE_CLEAR_RATIO,
  SHUNEN_DURATION,
  SHUNEN_ATK_MUL,
  SHUNEN_RATE_MUL,
  HITSTOP_JUST,
  HITSTOP_RESONANCE,
  GEM_PICK_R,
  expToNext,
} from './constants';
import { DIR8 } from './types';
import type { InputFrame, PlayerBullet, EnemyBullet, Enemy, Gem, Pickup, FxEvent, GameState } from './types';
import type { PlayerStats } from './stats';
import { createStats, hasEvolution } from './stats';
import type { Choice, Mastery } from './upgrades';
import { rollChoices, applyChoice } from './upgrades';
import { STAGES } from './stage';
import { createEnemy, updateEnemy, isBoss } from './enemies';
import type { WeaponId } from './types';

/** ヴォルテックスストームの残像。 */
interface Afterimage {
  x: number;
  y: number;
  t: number;
  cd: number;
}

/** 臨界共鳴の発動中状態。 */
interface Resonance {
  t: number;
  stage: number;
  halfW: number;
}

function compact<T extends { alive: boolean }>(arr: T[]): void {
  let n = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i].alive) arr[n++] = arr[i];
  }
  arr.length = n;
}

/**
 * ゲームロジック本体。Pixi にも DOM にも依存しない。
 * update(input) を 60Hz で呼ぶだけで進行する決定論的シミュレーション。
 */
export class World {
  readonly rng: Rng;
  readonly seed: number;

  frame = 0;
  state: GameState = 'playing';
  /** ヒットストップ残りフレーム。0 より大きい間はロジックが止まる。 */
  hitstop = 0;

  // --------------------------------------------------------- 自機
  px = PLAYER_START_X;
  py = PLAYER_START_Y;
  lives = START_LIVES;
  invuln = 0;
  stats: PlayerStats;

  // 回避
  stamina: number;
  staminaTimer = 0;
  flickActive = false;
  flickT = 0;
  flickDir = 0;
  flickSx = 0;
  flickSy = 0;
  flickTx = 0;
  flickTy = 0;
  /** このフリックで既にジャストが成立したか。 */
  justDone = false;
  /** ジャスト成功からの経過フレーム（オーバードライブ判定用）。 */
  sinceJust = 9999;
  shunen = 0;

  // 溜め
  chargePending = 0;
  chargeFrames = 0;
  chargeCommitted = false;
  releaseLock = 0;
  resonance: Resonance | null = null;
  /** ディメンション・リフレクターの吸収ストック。 */
  reflectStock = 0;
  /** この溜めでオーバードライブが乗っているか。 */
  overdriveActive = false;

  // 武器
  fireCd = 0;
  /** 集束ビームを撃っているか（描画用）。 */
  beamOn = false;
  /** 発射回数（効果音のトリガー用）。 */
  shots = 0;
  beamHalfW = 0;
  afterimages: Afterimage[] = [];

  // --------------------------------------------------------- エンティティ
  pBullets: PlayerBullet[] = [];
  eBullets: EnemyBullet[] = [];
  enemies: Enemy[] = [];
  gems: Gem[] = [];
  pickups: Pickup[] = [];
  nextEnemyId = 1;

  // --------------------------------------------------------- 進行
  stageIdx = 0;
  stageFrame = 0;
  spawnCursor = 0;
  pickupCursor = 0;
  bossSpawned = false;
  stageCleared = false;
  /** 背景スクロールの累積距離（描画用）。 */
  scrollY = 0;

  level = 1;
  exp = 0;
  expNeed = expToNext(1);
  pendingLevels = 0;
  choices: Choice[] = [];

  score = 0;
  kills = 0;
  /** 熟練度（内部値・非表示）。 */
  mastery: Mastery = { justSuccess: 0, justAttempt: 0, maxStageRelease: 0 };

  /** 描画に渡す演出イベント。毎フレーム drainFx() で吸い出す。 */
  fx: FxEvent[] = [];

  constructor(seed: number, weapon: WeaponId) {
    this.rng = new Rng(seed);
    this.seed = seed;
    this.stats = createStats(weapon);
    this.stamina = this.stats.staminaMax;
  }

  get stage() {
    return STAGES[this.stageIdx];
  }

  /** 現在の溜め段階（0-3）。 */
  get chargeStage(): number {
    let n = 0;
    for (let i = 0; i < CHARGE_STAGES.length; i++) {
      if (this.chargeFrames >= CHARGE_STAGES[i]) n = i + 1;
    }
    return n;
  }

  /** 解放ボタンを表示すべきか。 */
  get showReleaseButton(): boolean {
    return this.chargeFrames > 0 && this.state === 'playing';
  }

  drainFx(): FxEvent[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  // ======================================================================
  // メインループ
  // ======================================================================
  update(input: InputFrame): void {
    if (this.hitstop > 0) {
      this.hitstop--;
      return;
    }
    if (this.state !== 'playing') return;

    this.frame++;
    this.stageFrame++;
    this.scrollY += this.stage.scroll;

    this.updatePlayer(input);
    this.updateWeapons(input);
    this.updateResonance();
    this.updatePlayerBullets();
    this.updateEnemies();
    this.updateEnemyBullets();
    this.collide();
    this.updateGems();
    this.updatePickups();
    this.updateSpawner();

    compact(this.pBullets);
    compact(this.eBullets);
    compact(this.enemies);
    compact(this.gems);
    compact(this.pickups);
  }

  // ======================================================================
  // 自機
  // ======================================================================
  private updatePlayer(input: InputFrame): void {
    if (this.invuln > 0) this.invuln--;
    if (this.shunen > 0) this.shunen--;
    if (this.releaseLock > 0) this.releaseLock--;
    if (this.sinceJust < 9999) this.sinceJust++;

    // --- スタミナ自動回復
    if (this.stamina < this.stats.staminaMax) {
      this.staminaTimer++;
      if (this.staminaTimer >= this.stats.staminaRegen) {
        this.staminaTimer = 0;
        this.stamina++;
      }
    } else {
      this.staminaTimer = 0;
    }

    // --- フリック入力
    if (input.flick >= 0 && !this.flickActive && this.stamina > 0) {
      this.startFlick(input.flick);
    }

    // --- 移動
    if (this.flickActive) {
      this.flickT++;
      const u = Math.min(1, this.flickT / FLICK_DURATION);
      // easeOutCubic：出だしが速く、終わりで止まる
      const e = 1 - Math.pow(1 - u, 3);
      this.px = this.flickSx + (this.flickTx - this.flickSx) * e;
      this.py = this.flickSy + (this.flickTy - this.flickSy) * e;
      if (this.flickT >= FLICK_DURATION) this.flickActive = false;
    } else if (input.down) {
      this.px += input.dx * PLAYER_DRAG_GAIN * this.stats.moveSpeed;
      this.py += input.dy * PLAYER_DRAG_GAIN * this.stats.moveSpeed;
    }
    this.clampPlayer();

    // --- 溜め
    this.updateCharge(input);

    // --- 解放入力
    if (input.release && this.releaseLock === 0 && this.chargeStage >= 1) {
      this.releaseResonance();
    }
  }

  private clampPlayer(): void {
    const m = PLAYER_RADIUS;
    if (this.px < m) this.px = m;
    if (this.px > VIEW_W - m) this.px = VIEW_W - m;
    if (this.py < m + 20) this.py = m + 20;
    if (this.py > VIEW_H - m) this.py = VIEW_H - m;
  }

  private startFlick(dir: number): void {
    this.stamina--;
    this.staminaTimer = 0;
    this.flickActive = true;
    this.flickT = 0;
    this.flickDir = dir;
    this.justDone = false;
    this.releaseLock = RELEASE_LOCK_AFTER_FLICK;
    this.mastery.justAttempt++;

    const [dx, dy] = DIR8[dir];
    const d = this.stats.flickDist;
    this.flickSx = this.px;
    this.flickSy = this.py;
    // 画面端は壁で止まる（距離が縮む）
    this.flickTx = Math.max(PLAYER_RADIUS, Math.min(VIEW_W - PLAYER_RADIUS, this.px + dx * d));
    this.flickTy = Math.max(PLAYER_RADIUS + 20, Math.min(VIEW_H - PLAYER_RADIUS, this.py + dy * d));

    // ディメンション・リフレクター：吸収した弾を全方向レーザーに変換
    if (hasEvolution(this.stats, 'reflector') && this.reflectStock > 0) {
      this.emitReflect();
    }
  }

  /** 回避の無敵中か。 */
  get invincible(): boolean {
    return this.flickActive && this.flickT <= FLICK_IFRAMES;
  }

  private updateCharge(input: InputFrame): void {
    if (input.down) {
      // 再接地。保持している溜めはそのまま残る（繰り越し）。
      this.chargePending = 0;
      this.chargeCommitted = false;
      this.overdriveActive = false;
      return;
    }

    this.chargePending++;
    if (this.chargePending < CHARGE_COMMIT) return;

    if (!this.chargeCommitted) {
      this.chargeCommitted = true;
      // オーバードライブ・シンジケート：ジャスト直後 3 秒以内の溜め開始で 3 倍
      this.overdriveActive = this.stats.overdrive && this.sinceJust <= 180;
      // 「指を離した瞬間から」溜まっている扱いなので閾値分をまとめて加算
      this.addCharge(CHARGE_COMMIT);
      return;
    }
    this.addCharge(1);
  }

  private addCharge(frames: number): void {
    if (this.chargeFrames >= CHARGE_MAX) return;
    const before = this.chargeStage;
    const rate = Math.min(CHARGE_RATE_CAP, this.stats.chargeRate * (this.overdriveActive ? 3 : 1));
    this.chargeFrames = Math.min(CHARGE_MAX, this.chargeFrames + frames * rate);
    const after = this.chargeStage;
    if (after > before) this.fx.push({ type: 'chargeStage', stage: after });
  }

  /** 被弾・解放で溜めを失う。 */
  private clearCharge(): void {
    this.chargeFrames = 0;
    this.chargePending = 0;
    this.chargeCommitted = false;
    this.overdriveActive = false;
    this.reflectStock = 0;
  }

  // ======================================================================
  // 武器
  // ======================================================================
  private get atk(): number {
    return this.stats.atk * (this.shunen > 0 ? SHUNEN_ATK_MUL : 1);
  }

  private updateWeapons(input: InputFrame): void {
    const firing = (input.down || this.flickActive) && this.state === 'playing';
    this.beamOn = false;

    if (firing) {
      if (this.stats.weapon === 'gatling') this.fireGatling();
      else this.fireBeam();
    } else if (this.fireCd > 0) {
      this.fireCd--;
    }

    // 残像（ヴォルテックスストーム）
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      const a = this.afterimages[i];
      a.t--;
      if (a.t <= 0) {
        this.afterimages.splice(i, 1);
        continue;
      }
      if (--a.cd <= 0) {
        a.cd = 9;
        this.spawnPlayerBullet(a.x, a.y, 0, -10, 3, 1.5 * this.stats.atk, 0, 'needle');
      }
    }
  }

  private fireGatling(): void {
    if (--this.fireCd > 0) return;
    const rate = this.stats.fireRate * (this.shunen > 0 ? SHUNEN_RATE_MUL : 1);
    this.fireCd = Math.max(2, Math.round(7 / rate));
    this.shots++;

    const dmg = 1.6 * this.atk;
    const pierce = this.shunen > 0 ? 2 : 0;
    const vortex = hasEvolution(this.stats, 'vortex');
    const offs = vortex ? [-8, 0, 8] : [-5, 5];
    for (const ox of offs) {
      const spread = vortex ? ox * 0.012 : 0;
      this.spawnPlayerBullet(this.px + ox, this.py - 8, spread * 12, -12, 3.2, dmg, pierce, 'gatling');
    }
  }

  private fireBeam(): void {
    // 集束ビームは弾ではなく毎フレームの判定。細いぶん位置取りで当てる武器。
    this.beamOn = true;
    if (this.frame % 8 === 0) this.shots++;
    const omega = hasEvolution(this.stats, 'omega');
    this.beamHalfW = (omega ? 14 : 7) * (this.shunen > 0 ? 1.35 : 1);
    // 細くて射撃を止めやすいぶん、当たっている間の火力はガトリングより高い。
    // 連射強化は「弾を撃つ武器」向けなので、ビームには半分だけ効かせる。
    const dpf = 0.58 * this.atk * (1 + (this.stats.fireRate - 1) * 0.5) * (omega ? 1.25 : 1);
    for (const e of this.enemies) {
      if (!e.alive || e.y > this.py) continue;
      if (Math.abs(e.x - this.px) > this.beamHalfW + e.r) continue;
      this.damageEnemy(e, dpf, this.shunen > 0, e.x, e.y);
    }
    if (this.frame % 6 === 0) this.fx.push({ type: 'hit', x: this.px, y: this.py - 40 });
  }

  private emitReflect(): void {
    const n = Math.min(24, this.reflectStock);
    const dmg = 2.6 * this.atk;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.frame * 0.01;
      this.spawnPlayerBullet(this.px, this.py, Math.cos(a) * 9, Math.sin(a) * 9, 4, dmg, 3, 'reflect');
    }
    this.reflectStock = 0;
  }

  private spawnPlayerBullet(
    x: number,
    y: number,
    vx: number,
    vy: number,
    r: number,
    damage: number,
    pierce: number,
    style: PlayerBullet['style'],
    homing = 0,
  ): void {
    this.pBullets.push({ alive: true, x, y, vx, vy, r, damage, pierce, life: 180, homing, style, hits: [] });
  }

  // ======================================================================
  // 臨界共鳴
  // ======================================================================
  private releaseResonance(): void {
    const stage = this.chargeStage;
    const omega = hasEvolution(this.stats, 'omega');
    const halfW = RESONANCE_BEAM_HALFW[stage - 1] * (omega ? 1.5 : 1);
    this.resonance = { t: RESONANCE_BEAM_FRAMES, stage, halfW };

    // 衝撃波：範囲内の敵にダメージ、段階 2 以上で敵弾を消す
    const r = RESONANCE_SHOCK_R[stage - 1] * (omega ? 1.15 : 1);
    this.fx.push({ type: 'resonance', x: this.px, y: this.py, stage });
    this.fx.push({ type: 'shock', x: this.px, y: this.py, r });
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const dx = e.x - this.px;
      const dy = e.y - this.py;
      if (dx * dx + dy * dy <= (r + e.r) * (r + e.r)) {
        this.damageEnemy(e, 14 * stage * this.atk, true, e.x, e.y);
      }
    }
    if (RESONANCE_CLEARS_BULLETS[stage - 1] || omega) {
      this.clearBullets(this.px, this.py, r * RESONANCE_CLEAR_RATIO);
    }

    // ジェム吸着（マグネットコンバージョンで全画面化）
    const pullR = this.stats.fullMagnet ? 9999 : 220;
    for (const g of this.gems) {
      if (!g.alive) continue;
      const dx = g.x - this.px;
      const dy = g.y - this.py;
      if (dx * dx + dy * dy <= pullR * pullR) g.pulled = true;
    }

    if (stage >= 3) this.mastery.maxStageRelease++;
    this.hitstop = HITSTOP_RESONANCE;
    this.clearCharge();
  }

  private updateResonance(): void {
    const res = this.resonance;
    if (!res) return;
    res.t--;
    if (res.t <= 0) {
      this.resonance = null;
      return;
    }
    const dpf = RESONANCE_BEAM_DPF[res.stage - 1] * this.atk;
    for (const e of this.enemies) {
      if (!e.alive || e.y > this.py) continue;
      if (Math.abs(e.x - this.px) > res.halfW + e.r) continue;
      this.damageEnemy(e, dpf, true, e.x, e.y);
    }
    // 極太ビームは触れた敵弾も焼き払う
    for (const b of this.eBullets) {
      if (!b.alive || b.kind !== 'bullet') continue;
      if (b.y > this.py) continue;
      if (Math.abs(b.x - this.px) <= res.halfW + b.r) b.alive = false;
    }
  }

  /** 指定範囲の敵弾を消す。 */
  clearBullets(x: number, y: number, r: number): void {
    const rr = r * r;
    for (const b of this.eBullets) {
      if (!b.alive) continue;
      if (b.kind === 'laser') continue;
      const dx = b.x - x;
      const dy = b.y - y;
      if (dx * dx + dy * dy <= rr) b.alive = false;
    }
  }

  // ======================================================================
  // 弾
  // ======================================================================
  private updatePlayerBullets(): void {
    for (const b of this.pBullets) {
      if (!b.alive) continue;
      if (b.homing > 0) {
        const t = this.nearestEnemy(b.x, b.y);
        if (t) {
          const a = Math.atan2(t.y - b.y, t.x - b.x);
          const sp = Math.hypot(b.vx, b.vy);
          const ca = Math.atan2(b.vy, b.vx);
          let d = a - ca;
          while (d > Math.PI) d -= Math.PI * 2;
          while (d < -Math.PI) d += Math.PI * 2;
          const na = ca + Math.max(-b.homing, Math.min(b.homing, d));
          b.vx = Math.cos(na) * sp;
          b.vy = Math.sin(na) * sp;
        }
      }
      b.x += b.vx;
      b.y += b.vy;
      if (--b.life <= 0) b.alive = false;
      if (b.x < -20 || b.x > VIEW_W + 20 || b.y < -30 || b.y > VIEW_H + 30) b.alive = false;
    }
  }

  private updateEnemyBullets(): void {
    const omegaSlow = hasEvolution(this.stats, 'omega') && this.chargeCommitted;
    for (const b of this.eBullets) {
      if (!b.alive) continue;
      if (b.warn > 0) {
        b.warn--;
        continue;
      }
      if (b.kind === 'laser') {
        if (--b.life <= 0) b.alive = false;
        continue;
      }
      let mul = 1;
      if (omegaSlow) {
        const dx = b.x - this.px;
        const dy = b.y - this.py;
        if (dx * dx + dy * dy < 130 * 130) mul = 0.35;
      }
      b.x += b.vx * mul;
      b.y += b.vy * mul;
      if (--b.life <= 0) b.alive = false;
      if (b.x < -30 || b.x > VIEW_W + 30 || b.y < -40 || b.y > VIEW_H + 40) b.alive = false;
    }
  }

  // --------------------------------------------------------- 敵の射撃 API
  fireAimed(x: number, y: number, speed: number, style: number): void {
    const a = Math.atan2(this.py - y, this.px - x);
    this.pushEnemyBullet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, 4.2, style);
  }

  fireSpread(x: number, y: number, speed: number, count: number, step: number): void {
    const base = Math.atan2(this.py - y, this.px - x);
    const start = base - ((count - 1) / 2) * step;
    for (let i = 0; i < count; i++) {
      const a = start + i * step;
      this.pushEnemyBullet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, 4.2, 1);
    }
  }

  fireRing(x: number, y: number, speed: number, count: number, offset: number): void {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + offset;
      this.pushEnemyBullet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, 4.6, 2);
    }
  }

  fireLaser(x: number, y: number, angle: number, warn: number, active: number): void {
    this.eBullets.push({
      alive: true,
      kind: 'laser',
      x,
      y,
      vx: 0,
      vy: 0,
      r: 13,
      life: active,
      len: 900,
      angle,
      warn,
      style: 0,
    });
  }

  private pushEnemyBullet(x: number, y: number, vx: number, vy: number, r: number, style: number): void {
    this.eBullets.push({ alive: true, kind: 'bullet', x, y, vx, vy, r, life: 480, len: 0, angle: 0, warn: 0, style });
  }

  // ======================================================================
  // 敵
  // ======================================================================
  private updateEnemies(): void {
    for (const e of this.enemies) {
      if (!e.alive) continue;
      updateEnemy(this, e);
    }
  }

  private nearestEnemy(x: number, y: number): Enemy | null {
    let best: Enemy | null = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (!e.alive) continue;
      const d = (e.x - x) ** 2 + (e.y - y) ** 2;
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** 敵にダメージ。ignoreShield は貫通弾・臨界共鳴など。 */
  damageEnemy(e: Enemy, dmg: number, ignoreShield: boolean, hx: number, hy: number): void {
    if (!e.alive) return;

    // ボスの部位破壊：部位が残っている間は本体へのダメージが通りにくい
    if (isBoss(e)) {
      const part = this.hitPart(e, hx, hy);
      if (part) {
        part.hp -= dmg;
        if (part.hp <= 0) {
          part.destroyed = true;
          this.fx.push({ type: 'bossPart', x: e.x + part.ox, y: e.y + part.oy });
          this.score += 500;
        }
        e.flash = 3;
        return;
      }
      if (!e.coreOpen) dmg *= 0.25;
    }

    if (!ignoreShield && e.shieldHp > 0) {
      e.shieldHp -= dmg;
      dmg *= 0.2;
      if (e.shieldHp <= 0) {
        e.shieldHp = 0;
        this.fx.push({ type: 'hit', x: e.x, y: e.y });
      }
    }

    e.hp -= dmg;
    e.flash = 3;
    if (e.hp <= 0) this.killEnemy(e);
  }

  private hitPart(e: Enemy, hx: number, hy: number) {
    for (const p of e.parts) {
      if (p.destroyed) continue;
      const dx = hx - (e.x + p.ox);
      const dy = hy - (e.y + p.oy);
      if (dx * dx + dy * dy <= (p.r + 6) * (p.r + 6)) return p;
    }
    return null;
  }

  private killEnemy(e: Enemy): void {
    e.alive = false;
    this.kills++;
    this.score += isBoss(e) ? 8000 : Math.round(e.maxHp * 12);
    this.fx.push({ type: 'explode', x: e.x, y: e.y, size: e.r });
    for (let i = 0; i < e.gems; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const sp = this.rng.range(0.6, 2.2);
      this.gems.push({
        alive: true,
        x: e.x,
        y: e.y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 0.5,
        value: 1,
        pulled: false,
        life: 900,
      });
    }
    if (isBoss(e)) this.onBossDefeated();
  }

  // ======================================================================
  // 当たり判定
  // ======================================================================
  private collide(): void {
    // --- 自弾 → 敵
    for (const b of this.pBullets) {
      if (!b.alive) continue;
      for (const e of this.enemies) {
        if (!e.alive) continue;
        const dx = e.x - b.x;
        const dy = e.y - b.y;
        const rr = e.r + b.r;
        if (dx * dx + dy * dy > rr * rr) continue;
        if (b.hits.indexOf(e.id) >= 0) continue;
        b.hits.push(e.id);
        this.damageEnemy(e, b.damage, b.pierce > 0 || b.style === 'reflect', b.x, b.y);
        this.fx.push({ type: 'hit', x: b.x, y: b.y });
        if (b.pierce > 0) b.pierce--;
        else {
          b.alive = false;
          break;
        }
      }
    }

    // --- 敵弾・接触 → 自機（無敵中はジャスト回避の判定に化ける）
    const justR = this.stats.justRadius;
    const reflector = hasEvolution(this.stats, 'reflector');

    for (const b of this.eBullets) {
      if (!b.alive || b.warn > 0) continue;

      if (b.kind === 'laser') {
        const d = distToSegment(this.px, this.py, b.x, b.y, b.angle, b.len);
        if (this.invincible && !this.justDone && d <= b.r + justR) {
          this.onJust();
        } else if (d <= b.r + PLAYER_HIT_RADIUS) {
          this.onPlayerHit();
        }
        continue;
      }

      const dx = b.x - this.px;
      const dy = b.y - this.py;
      const d2 = dx * dx + dy * dy;

      // ディメンション・リフレクター：静止（溜め）中は敵弾を吸収してストック
      if (reflector && this.chargeCommitted && d2 <= 46 * 46) {
        b.alive = false;
        this.reflectStock = Math.min(40, this.reflectStock + 1);
        continue;
      }

      if (this.invincible && !this.justDone) {
        const jr = b.r + justR;
        if (d2 <= jr * jr) {
          this.onJust();
          continue;
        }
      }
      const hr = b.r + PLAYER_HIT_RADIUS;
      if (d2 <= hr * hr) {
        b.alive = false;
        this.onPlayerHit();
      }
    }

    for (const e of this.enemies) {
      if (!e.alive || !e.contact) continue;
      const dx = e.x - this.px;
      const dy = e.y - this.py;
      const d2 = dx * dx + dy * dy;
      if (this.invincible && !this.justDone) {
        const jr = e.r + justR;
        if (d2 <= jr * jr) {
          this.onJust();
          continue;
        }
      }
      const hr = e.r + PLAYER_HIT_RADIUS;
      if (d2 <= hr * hr) this.onPlayerHit();
    }
  }

  /** ジャスト回避成立。 */
  private onJust(): void {
    this.justDone = true;
    this.mastery.justSuccess++;
    this.sinceJust = 0;
    this.hitstop = HITSTOP_JUST;
    this.shunen = SHUNEN_DURATION;
    this.stamina = Math.min(this.stats.staminaMax, this.stamina + 1);
    this.staminaTimer = 0;
    this.score += 300;
    this.fx.push({ type: 'just', x: this.px, y: this.py });

    // 通過軌跡上の弾を消す
    const steps = 6;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      this.clearBullets(this.flickSx + (this.px - this.flickSx) * t, this.flickSy + (this.py - this.flickSy) * t, 26);
    }

    // ヴォルテックスストーム：360 度誘導針弾 + 残像
    if (hasEvolution(this.stats, 'vortex')) {
      const n = 16;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        this.spawnPlayerBullet(
          this.px,
          this.py,
          Math.cos(a) * 6,
          Math.sin(a) * 6,
          3,
          2.2 * this.atk,
          1,
          'needle',
          0.09,
        );
      }
      this.afterimages.push({ x: this.px, y: this.py, t: 300, cd: 9 });
      if (this.afterimages.length > 3) this.afterimages.shift();
    }
  }

  /** 被弾。 */
  private onPlayerHit(): void {
    if (this.invuln > 0 || this.invincible) return;

    // イージスフィールド：溜め成立中の被弾のみ無効化（溜めも残る）
    if (this.chargeCommitted && this.stats.aegis > 0) {
      this.stats.aegis--;
      this.invuln = 24;
      this.fx.push({ type: 'shock', x: this.px, y: this.py, r: 60 });
      this.clearBullets(this.px, this.py, 60);
      return;
    }

    this.lives--;
    this.invuln = PLAYER_HIT_INVULN;
    this.shunen = 0;
    // 保持中の溜めも含めて全消滅：これがこの仕様のリスクの本体
    this.clearCharge();
    this.fx.push({ type: 'damaged', x: this.px, y: this.py });
    this.clearBullets(this.px, this.py, 76);

    if (this.lives < 0) {
      this.lives = 0;
      this.state = 'gameover';
    }
  }

  // ======================================================================
  // ジェム・アイテム
  // ======================================================================
  private updateGems(): void {
    const mr = this.stats.magnetR;
    for (const g of this.gems) {
      if (!g.alive) continue;
      const dx = this.px - g.x;
      const dy = this.py - g.y;
      const d2 = dx * dx + dy * dy;
      if (!g.pulled && d2 <= mr * mr) g.pulled = true;

      if (g.pulled) {
        const d = Math.max(1, Math.sqrt(d2));
        const sp = 3 + Math.min(9, 400 / d);
        g.vx = (dx / d) * sp;
        g.vy = (dy / d) * sp;
      } else {
        g.vx *= 0.94;
        g.vy = g.vy * 0.94 + 0.06;
      }
      g.x += g.vx;
      g.y += g.vy + this.stage.scroll * 0.25;

      if (d2 <= GEM_PICK_R * GEM_PICK_R) {
        g.alive = false;
        this.gainExp(g.value);
      }
      if (--g.life <= 0 || g.y > VIEW_H + 30) g.alive = false;
    }
  }

  private updatePickups(): void {
    for (const p of this.pickups) {
      if (!p.alive) continue;
      p.y += p.vy + this.stage.scroll * 0.4;
      const dx = p.x - this.px;
      const dy = p.y - this.py;
      if (dx * dx + dy * dy <= 16 * 16) {
        p.alive = false;
        this.lives++;
        this.score += 1000;
        this.fx.push({ type: 'pickupLife' });
      }
      if (--p.life <= 0 || p.y > VIEW_H + 30) p.alive = false;
    }
  }

  private gainExp(v: number): void {
    this.exp += v * this.stats.expMul;
    this.score += 10;
    while (this.exp >= this.expNeed) {
      this.exp -= this.expNeed;
      this.level++;
      this.expNeed = expToNext(this.level);
      this.pendingLevels++;
      this.fx.push({ type: 'levelup' });
    }
    if (this.pendingLevels > 0 && this.state === 'playing') this.openLevelUp();
  }

  // ======================================================================
  // 進行
  // ======================================================================
  private updateSpawner(): void {
    const st = this.stage;
    if (!this.bossSpawned) {
      while (this.spawnCursor < st.events.length && st.events[this.spawnCursor].at <= this.stageFrame) {
        this.runSpawnEvent(this.spawnCursor++);
      }
      while (this.pickupCursor < st.pickups.length && st.pickups[this.pickupCursor].at <= this.stageFrame) {
        const p = st.pickups[this.pickupCursor++];
        this.pickups.push({ alive: true, x: p.x * VIEW_W, y: -20, vy: 0.7, kind: 'life', life: 1800 });
      }
      if (this.stageFrame >= st.bossAt) {
        this.bossSpawned = true;
        const boss = createEnemy(this, st.bossKind, VIEW_W / 2, -60, st.hpMul);
        this.enemies.push(boss);
      }
    }
    // 予約スポーン（stream 用）
    for (let i = this.queued.length - 1; i >= 0; i--) {
      const q = this.queued[i];
      if (--q.delay > 0) continue;
      this.enemies.push(createEnemy(this, q.kind, q.x, q.y, q.hpMul));
      this.queued.splice(i, 1);
    }
  }

  private queued: { delay: number; kind: Enemy['kind']; x: number; y: number; hpMul: number }[] = [];

  private runSpawnEvent(idx: number): void {
    const ev = this.stage.events[idx];
    const hpMul = this.stage.hpMul * (ev.hpMul ?? 1);
    const cx = (ev.x ?? 0.5) * VIEW_W;

    switch (ev.formation) {
      case 'single':
        this.enemies.push(createEnemy(this, ev.kind, cx, -30, hpMul));
        break;
      case 'line': {
        const w = Math.min(VIEW_W - 60, ev.count * 40);
        for (let i = 0; i < ev.count; i++) {
          const t = ev.count === 1 ? 0.5 : i / (ev.count - 1);
          const x = clampX(cx - w / 2 + t * w);
          this.enemies.push(createEnemy(this, ev.kind, x, -30 - i * 4, hpMul));
        }
        break;
      }
      case 'arc': {
        for (let i = 0; i < ev.count; i++) {
          const t = ev.count === 1 ? 0.5 : i / (ev.count - 1);
          const x = clampX(cx + (t - 0.5) * 190);
          const y = -30 - Math.sin(t * Math.PI) * 60;
          this.enemies.push(createEnemy(this, ev.kind, x, y, hpMul));
        }
        break;
      }
      case 'sides': {
        for (let i = 0; i < ev.count; i++) {
          const left = i % 2 === 0;
          const x = left ? 40 + (i >> 1) * 26 : VIEW_W - 40 - (i >> 1) * 26;
          this.enemies.push(createEnemy(this, ev.kind, clampX(x), -30 - i * 18, hpMul));
        }
        break;
      }
      case 'stream': {
        const gap = ev.gap ?? 10;
        for (let i = 0; i < ev.count; i++) {
          const x = clampX(cx + Math.sin(i * 0.9) * 70);
          this.queued.push({ delay: 1 + i * gap, kind: ev.kind, x, y: -30, hpMul });
        }
        break;
      }
    }
  }

  private onBossDefeated(): void {
    this.stageCleared = true;
    // 中ボス撃破 → 宝箱 → 進化ルーレット（プロトタイプでは 3 択を 1 回追加）
    this.pendingLevels++;
    this.score += 5000;
    this.openLevelUp();
  }

  // --------------------------------------------------------- レベルアップ
  private openLevelUp(): void {
    if (this.pendingLevels <= 0) return;
    this.choices = rollChoices(this.stats, this.mastery, this.rng);
    if (this.choices.length === 0) {
      this.pendingLevels = 0;
      this.finishLevelUp();
      return;
    }
    this.state = 'levelup';
  }

  /** UI から呼ぶ：3 択の決定。 */
  choose(index: number): void {
    if (this.state !== 'levelup') return;
    const c = this.choices[index];
    if (c) applyChoice(this.stats, c);
    this.stamina = Math.min(this.stamina, this.stats.staminaMax);
    this.pendingLevels--;
    this.choices = [];
    if (this.pendingLevels > 0) this.openLevelUp();
    else this.finishLevelUp();
  }

  private finishLevelUp(): void {
    if (this.stageCleared) {
      this.state = this.stageIdx >= STAGES.length - 1 ? 'gameclear' : 'stageclear';
    } else {
      this.state = 'playing';
    }
  }

  /** UI から呼ぶ：次ステージへ。 */
  nextStage(): void {
    if (this.state !== 'stageclear') return;
    this.stageIdx++;
    this.stageFrame = 0;
    this.spawnCursor = 0;
    this.pickupCursor = 0;
    this.bossSpawned = false;
    this.stageCleared = false;
    this.queued.length = 0;
    this.eBullets.length = 0;
    this.pBullets.length = 0;
    this.enemies.length = 0;
    this.gems.length = 0;
    this.pickups.length = 0;
    this.resonance = null;
    this.invuln = 90;
    // イージスは次ステージ開始で回復する
    this.stats.aegis = this.stats.aegisMax;
    this.stamina = this.stats.staminaMax;
    this.state = 'playing';
  }
}

function clampX(x: number): number {
  return Math.max(18, Math.min(VIEW_W - 18, x));
}

/** 点と半直線レーザーの距離。 */
function distToSegment(px: number, py: number, sx: number, sy: number, angle: number, len: number): number {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let t = (px - sx) * dx + (py - sy) * dy;
  if (t < 0) t = 0;
  if (t > len) t = len;
  const cx = sx + dx * t;
  const cy = sy + dy * t;
  return Math.hypot(px - cx, py - cy);
}
