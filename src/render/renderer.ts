import { Application, Container, Graphics, Text, type Texture } from 'pixi.js';
import type { World } from '../sim/world';
import type { Enemy, FxEvent } from '../sim/types';
import {
  VIEW_W,
  VIEW_H,
  CHARGE_STAGES,
  CHARGE_MAX,
  FLICK_IFRAMES,
  DODGE_DEFLECT_R,
  STICK_MAX_R,
  STICK_DEADZONE,
  SHUNEN_DURATION,
  REFLECT_ABSORB_R,
  REFLECT_WINDOW,
  REFLECT_STOCK_MAX,
} from '../sim/constants';
import type { StickView } from '../input/pointer';
import { buildTextures, type TextureSet } from './textures';
import { ParticlePool, SpritePool } from './pool';
import { FxLayer } from './fx';
import { Rng } from '../sim/rng';

const STAGE_COLORS = [0x63d9ff, 0xffd166, 0xff6bd6];

interface Star {
  x: number;
  y: number;
  z: number;
  s: number;
}

export class GameRenderer {
  readonly root = new Container();
  private readonly tex: TextureSet;

  private readonly bg = new Graphics();
  private readonly stars: Star[] = [];
  private readonly starPool: ParticlePool;
  private readonly gemPool: ParticlePool;
  private readonly pBulletPool: ParticlePool;
  private readonly pGlowPool: ParticlePool;
  private readonly eBulletPool: ParticlePool;
  private readonly eGlowPool: ParticlePool;
  private readonly enemyPool = new SpritePool();
  private readonly partPool = new SpritePool();
  private readonly miscPool = new SpritePool();
  private readonly beamGfx = new Graphics();
  private readonly laserGfx = new Graphics();
  private readonly pLaserGfx = new Graphics();
  private readonly playerGfx = new Graphics();
  private readonly overlayGfx = new Graphics();
  private readonly fx: FxLayer;
  private readonly hud = new Container();
  private readonly hudGfx = new Graphics();
  private readonly stickGfx = new Graphics();
  private readonly txtScore: Text;
  private readonly txtStage: Text;
  private readonly txtLives: Text;
  private readonly txtBuff: Text;
  private readonly shipPool = new SpritePool();

  private scale = 1;
  /** キャンバスの表示位置。クライアント座標 → 仮想座標の変換に使う。 */
  private originX = 0;
  private originY = 0;

  constructor(private readonly app: Application) {
    this.tex = buildTextures(app.renderer);
    this.fx = new FxLayer(this.tex);

    this.starPool = new ParticlePool(this.tex.dot);
    this.gemPool = new ParticlePool(this.tex.gem);
    this.pBulletPool = new ParticlePool(this.tex.dot);
    this.pGlowPool = new ParticlePool(this.tex.glow);
    this.eBulletPool = new ParticlePool(this.tex.dot);
    this.eGlowPool = new ParticlePool(this.tex.glow);
    this.pGlowPool.container.blendMode = 'add';
    this.eGlowPool.container.blendMode = 'add';

    const rng = new Rng(0x5eed1234);
    for (let i = 0; i < 150; i++) {
      this.stars.push({
        x: rng.range(0, VIEW_W),
        y: rng.range(0, VIEW_H),
        z: rng.range(0.25, 1.6),
        s: rng.range(0.6, 2.1),
      });
    }

    this.root.addChild(
      this.bg,
      this.starPool.container,
      this.gemPool.container,
      this.miscPool.container,
      this.enemyPool.container,
      this.partPool.container,
      this.beamGfx,
      this.pLaserGfx,
      this.pGlowPool.container,
      this.pBulletPool.container,
      this.laserGfx,
      this.eGlowPool.container,
      this.eBulletPool.container,
      this.shipPool.container,
      this.playerGfx,
      this.fx.pool.container,
      this.stickGfx,
      this.overlayGfx,
      this.hud,
    );

    this.beamGfx.blendMode = 'add';
    this.pLaserGfx.blendMode = 'add';

    this.txtScore = mkText(13, 0xffffff, 'right');
    this.txtStage = mkText(11, 0x9fb6c8, 'center');
    this.txtLives = mkText(13, 0xff86b0, 'left');
    this.txtBuff = mkText(12, 0xffd166, 'center');
    this.hud.addChild(this.hudGfx, this.txtScore, this.txtStage, this.txtLives, this.txtBuff);

    app.stage.addChild(this.root);
    this.drawBackground();
  }

  private drawBackground(): void {
    this.bg.clear();
    this.bg.rect(0, 0, VIEW_W, VIEW_H).fill(0x05070f);
    for (let i = 0; i < 12; i++) {
      const t = i / 12;
      this.bg
        .rect(0, VIEW_H * t, VIEW_W, VIEW_H / 12)
        .fill({ color: 0x0d1830, alpha: 0.14 + t * 0.16 });
    }
  }

  /** 画面サイズに合わせてキャンバスと拡大率を更新する。 */
  resize(): void {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const s = Math.min(vw / VIEW_W, vh / VIEW_H);
    this.scale = s;
    const w = Math.round(VIEW_W * s);
    const h = Math.round(VIEW_H * s);
    this.app.renderer.resize(w, h);
    this.root.scale.set(s);
    const canvas = this.app.canvas as HTMLCanvasElement;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    this.updateOrigin();
  }

  /** キャンバスの画面上の位置を取り直す（レイアウト確定後に呼ぶ）。 */
  updateOrigin(): void {
    const rect = (this.app.canvas as HTMLCanvasElement).getBoundingClientRect();
    this.originX = rect.left;
    this.originY = rect.top;
  }

  /** クライアント座標 → 仮想座標。 */
  toVirtual(clientX: number, clientY: number): { x: number; y: number } {
    return { x: (clientX - this.originX) / this.scale, y: (clientY - this.originY) / this.scale };
  }

  /** 仮想スティックを描く。 */
  drawStick(stick: StickView): void {
    const g = this.stickGfx;
    g.clear();
    if (!stick.active) return;

    const { ox, oy, kx, ky } = stick;
    // 台座
    g.circle(ox, oy, STICK_MAX_R).fill({ color: 0x0a1524, alpha: 0.3 });
    g.circle(ox, oy, STICK_MAX_R).stroke({ width: 1.5, color: 0x8ce4ff, alpha: 0.35 });
    g.circle(ox, oy, STICK_DEADZONE).stroke({ width: 1, color: 0x8ce4ff, alpha: 0.25 });
    // 倒している向きの線
    if (stick.norm > 0) {
      g.moveTo(ox, oy)
        .lineTo(ox + kx, oy + ky)
        .stroke({ width: 2, color: 0x8ce4ff, alpha: 0.45 });
    }
    // つまみ
    g.circle(ox + kx, oy + ky, 16).fill({ color: 0x63d9ff, alpha: 0.28 });
    g.circle(ox + kx, oy + ky, 16).stroke({ width: 2, color: 0xbff4ff, alpha: 0.85 });
    g.circle(ox + kx, oy + ky, 4).fill({ color: 0xffffff, alpha: 0.9 });
  }

  /** 画面座標 → 仮想座標の変換に使う倍率。 */
  get viewScale(): number {
    return this.scale;
  }

  clearFx(): void {
    this.fx.clear();
  }

  /** シミュレーションから取り出した演出イベントを流し込む。 */
  pushFx(events: readonly FxEvent[]): void {
    for (const ev of events) this.fx.push(ev);
  }

  draw(w: World, dtScale: number): void {
    this.fx.update(dtScale);

    // 画面シェイク
    const sh = this.fx.shake;
    const ox = sh > 0 ? (Math.random() * 2 - 1) * sh : 0;
    const oy = sh > 0 ? (Math.random() * 2 - 1) * sh : 0;
    this.root.position.set(ox * this.scale, oy * this.scale);

    this.drawStars(w);
    this.drawGems(w);
    this.drawMisc(w);
    this.drawEnemies(w);
    this.drawBeams(w);
    this.drawPlayerLasers(w);
    this.drawPlayerBullets(w);
    this.drawLasers(w);
    this.drawEnemyBullets(w);
    this.drawPlayer(w);
    this.fx.draw();
    this.drawOverlay(w);
    this.drawHud(w);
  }

  // ------------------------------------------------------------------ 背景
  private drawStars(w: World): void {
    this.starPool.begin();
    for (const st of this.stars) {
      const y = (st.y + w.scrollY * st.z) % VIEW_H;
      this.starPool.add(st.x, y < 0 ? y + VIEW_H : y, st.s / 8, st.s / 8, 0, 0x9fd8ff, 0.18 + st.z * 0.35);
    }
    this.starPool.end();
  }

  // ------------------------------------------------------------------ ジェム
  private drawGems(w: World): void {
    this.gemPool.begin();
    for (const g of w.gems) {
      if (!g.alive) continue;
      const pulse = g.pulled ? 1.25 : 1;
      this.gemPool.add(g.x, g.y, pulse, pulse, w.frame * 0.08, 0xffffff, 1);
    }
    this.gemPool.end();
  }

  private drawMisc(w: World): void {
    this.miscPool.begin();
    for (const p of w.pickups) {
      if (!p.alive) continue;
      const s = this.miscPool.add(this.tex.lifeItem);
      s.x = p.x;
      s.y = p.y;
      const k = 1 + Math.sin(w.frame * 0.12) * 0.12;
      s.scale.set(k);
    }
    // 回避中の残像。通った道が見えると「切り開いた」感じが出る
    if (w.flickActive) {
      for (let i = 1; i <= 3; i++) {
        const t = i / 4;
        const g = this.miscPool.add(this.tex.afterimage);
        g.x = w.px + (w.flickSx - w.px) * t;
        g.y = w.py + (w.flickSy - w.py) * t;
        g.scale.set(0.85 - t * 0.15);
        g.alpha = (1 - t) * 0.55;
        g.tint = 0x9fe8ff;
        g.blendMode = 'add';
      }
    }

    // ヴォルテックスストームの残像
    for (const a of w.afterimages) {
      const s = this.miscPool.add(this.tex.afterimage);
      s.x = a.x;
      s.y = a.y;
      s.alpha = Math.min(1, a.t / 60) * 0.7;
      s.blendMode = 'add';
    }
    this.miscPool.end();
  }

  // ------------------------------------------------------------------ 敵
  private enemyTexture(e: Enemy): Texture {
    switch (e.kind) {
      case 'grunt':
        return this.tex.grunt;
      case 'zigzag':
        return this.tex.zigzag;
      case 'shield':
        return this.tex.shield;
      case 'rusher':
        return this.tex.rusher;
      case 'turret':
        return this.tex.turret;
      case 'midboss':
        return this.tex.midboss;
      case 'boss':
        return this.tex.boss;
    }
  }

  private drawEnemies(w: World): void {
    this.enemyPool.begin();
    this.partPool.begin();
    for (const e of w.enemies) {
      if (!e.alive) continue;
      const tx = this.enemyTexture(e);
      const s = this.enemyPool.add(tx);
      s.x = e.x;
      s.y = e.y;
      // 見た目が当たり判定と大きくズレないようにスプライト側を合わせる
      s.scale.set((e.r * 2.6) / tx.width);
      if (e.flash > 0) s.tint = 0xffffff;
      // シールドが残っている敵は青白く硬そうに見せる
      if (e.shieldHp > 0) s.tint = 0xbfd8ff;
      if (e.kind === 'rusher' && e.t > 44) s.tint = 0xffe9a8;

      for (const p of e.parts) {
        if (p.destroyed) continue;
        const ps = this.partPool.add(this.tex.part);
        ps.x = e.x + p.ox;
        ps.y = e.y + p.oy;
        ps.scale.set((p.r * 2) / 32);
        const hpT = p.hp / p.maxHp;
        ps.tint = hpT > 0.5 ? 0x8ce8ff : hpT > 0.2 ? 0xffd166 : 0xff6b8a;
      }
    }
    this.enemyPool.end();
    this.partPool.end();
  }

  // ------------------------------------------------------------------ ビーム
  private drawBeams(w: World): void {
    const g = this.beamGfx;
    g.clear();

    if (w.beamOn) {
      const hw = w.beamHalfW;
      g.rect(w.px - hw, 0, hw * 2, w.py - 6).fill({ color: 0x63d9ff, alpha: 0.28 });
      g.rect(w.px - hw * 0.4, 0, hw * 0.8, w.py - 6).fill({ color: 0xffffff, alpha: 0.7 });
    }

    const res = w.resonance;
    if (res) {
      const hw = res.halfW * (0.7 + 0.3 * Math.sin(w.frame * 0.6));
      const c = STAGE_COLORS[res.stage - 1] ?? 0xffffff;
      g.rect(w.px - hw, 0, hw * 2, w.py).fill({ color: c, alpha: 0.4 });
      g.rect(w.px - hw * 0.5, 0, hw, w.py).fill({ color: 0xffffff, alpha: 0.85 });
    }
  }

  // ------------------------------------------------------------------ 弾
  private drawPlayerBullets(w: World): void {
    this.pBulletPool.begin();
    this.pGlowPool.begin();
    for (const b of w.pBullets) {
      if (!b.alive) continue;
      const rot = Math.atan2(b.vy, b.vx) + Math.PI / 2;
      const long = b.style === 'needle' || b.style === 'reflect' ? 2.8 : 1.9;
      // 瞬炎中は弾そのものを熱い色にする。強化されたことが弾を見れば分かる
      const hot = w.shunen > 0 && b.style === 'gatling';
      const tint = hot
        ? 0xffb347
        : b.style === 'reflect'
          ? 0xff9ef0
          : b.style === 'needle'
            ? 0x9fffdd
            : 0x8ce4ff;
      const k = (b.r / 8) * (hot ? 1.25 : 1);
      this.pGlowPool.add(b.x, b.y, (b.r * 2.6) / 64, (b.r * 2.6) / 64, 0, tint, 0.5);
      this.pBulletPool.add(b.x, b.y, k * 0.9, k * long, rot, tint, 0.95);
      this.pBulletPool.add(b.x, b.y, k * 0.45, k * (long * 0.7), rot, 0xffffff, 1);
    }
    this.pBulletPool.end();
    this.pGlowPool.end();
  }

  /** 究極進化の解放レーザー。 */
  private drawPlayerLasers(w: World): void {
    const g = this.pLaserGfx;
    g.clear();
    for (const l of w.pLasers) {
      if (!l.alive) continue;
      // 出だしが太く、消え際に細くなる
      const u = l.t / l.maxT;
      const hw = l.halfW * (0.35 + u * 0.65);
      const ex = l.x + Math.cos(l.angle) * l.len;
      const ey = l.y + Math.sin(l.angle) * l.len;
      g.moveTo(l.x, l.y).lineTo(ex, ey).stroke({ width: hw * 2.6, color: 0xff5ec8, alpha: 0.3 * u });
      g.moveTo(l.x, l.y).lineTo(ex, ey).stroke({ width: hw * 1.3, color: 0xff9ef0, alpha: 0.6 * u });
      g.moveTo(l.x, l.y).lineTo(ex, ey).stroke({ width: hw * 0.5, color: 0xffffff, alpha: 0.95 * u });
    }
  }

  private drawEnemyBullets(w: World): void {
    this.eBulletPool.begin();
    this.eGlowPool.begin();
    for (const b of w.eBullets) {
      if (!b.alive || b.kind !== 'bullet') continue;
      // 弾かれている間は無害なので、色を抜いて「今は危なくない」と分かるようにする
      const knocked = b.deflect > 0;
      const tint = knocked ? 0x9fd8ff : b.style === 2 ? 0xff5ec8 : b.style === 1 ? 0xff5a5a : 0xffa83d;
      const k = (b.r / 8) * (knocked ? 0.8 : 1);
      // 外側に加算のグロー、内側は不透明なコア。暗い背景でも弾道が読める。
      this.eGlowPool.add(b.x, b.y, (b.r * 3.4) / 64, (b.r * 3.4) / 64, 0, tint, knocked ? 0.22 : 0.42);
      this.eBulletPool.add(b.x, b.y, k * 1.05, k * 1.05, 0, tint, knocked ? 0.5 : 1);
      this.eBulletPool.add(b.x, b.y, k * 0.5, k * 0.5, 0, 0xffffff, knocked ? 0.7 : 1);
    }
    this.eBulletPool.end();
    this.eGlowPool.end();
  }

  private drawLasers(w: World): void {
    const g = this.laserGfx;
    g.clear();
    for (const b of w.eBullets) {
      if (!b.alive || b.kind !== 'laser') continue;
      const ex = b.x + Math.cos(b.angle) * b.len;
      const ey = b.y + Math.sin(b.angle) * b.len;
      if (b.warn > 0) {
        // 予告：細い線が点滅する
        const a = 0.25 + 0.35 * Math.abs(Math.sin(b.warn * 0.35));
        g.moveTo(b.x, b.y).lineTo(ex, ey).stroke({ width: 2, color: 0xff5577, alpha: a });
      } else {
        g.moveTo(b.x, b.y).lineTo(ex, ey).stroke({ width: b.r * 2, color: 0xff3366, alpha: 0.45 });
        g.moveTo(b.x, b.y).lineTo(ex, ey).stroke({ width: b.r * 0.8, color: 0xffffff, alpha: 0.95 });
      }
    }
  }

  // ------------------------------------------------------------------ 自機
  private drawPlayer(w: World): void {
    this.shipPool.begin();
    const g = this.playerGfx;
    g.clear();
    if (w.state === 'gameover') {
      this.shipPool.end();
      return;
    }

    // 保持中の溜めを常時可視化（被弾で失うものを見せる）
    if (w.chargeFrames > 0) {
      const stage = w.chargeStage;
      const t = w.chargeFrames / CHARGE_MAX;
      const c = STAGE_COLORS[Math.max(0, stage - 1)];
      const r = 16 + t * 22;
      g.circle(w.px, w.py, r).stroke({ width: 2, color: c, alpha: 0.55 + 0.25 * Math.sin(w.frame * 0.25) });
      g.circle(w.px, w.py, r * 0.62).fill({ color: c, alpha: 0.1 });
      // 段階の目盛り
      for (let i = 0; i < CHARGE_STAGES.length; i++) {
        const on = w.chargeFrames >= CHARGE_STAGES[i];
        const a = -Math.PI / 2 + ((i + 1) / (CHARGE_STAGES.length + 1)) * Math.PI * 2;
        g.circle(w.px + Math.cos(a) * (r + 6), w.py + Math.sin(a) * (r + 6), 2.2).fill({
          color: on ? c : 0x445566,
          alpha: on ? 1 : 0.6,
        });
      }
    }

    // 回避の可視化。無敵中は太い光、無敵が切れた後は「弾き飛ばす通路」を見せる
    if (w.flickActive) {
      const inv = w.flickT <= FLICK_IFRAMES;
      g.moveTo(w.flickSx, w.flickSy)
        .lineTo(w.px, w.py)
        .stroke({ width: inv ? 12 : DODGE_DEFLECT_R * 2, color: inv ? 0xbff4ff : 0x63d9ff, alpha: inv ? 0.5 : 0.14 });
      g.moveTo(w.flickSx, w.flickSy)
        .lineTo(w.px, w.py)
        .stroke({ width: inv ? 4 : 3, color: 0xffffff, alpha: inv ? 0.85 : 0.4 });
      if (inv) {
        g.circle(w.px, w.py, w.stats.justRadius).stroke({ width: 1.5, color: 0xbff4ff, alpha: 0.75 });
      } else {
        g.circle(w.px, w.py, DODGE_DEFLECT_R).stroke({ width: 1.5, color: 0x63d9ff, alpha: 0.5 });
      }
    }

    // 瞬炎。残り時間がリングの長さで分かるようにして「今は強い」を見せる
    if (w.shunen > 0) {
      const t = w.shunen / SHUNEN_DURATION;
      const r = 17 + Math.sin(w.frame * 0.35) * 2;
      g.circle(w.px, w.py, r).stroke({ width: 2, color: 0xffb347, alpha: 0.35 });
      const seg = 26;
      for (let i = 0; i < seg; i++) {
        if (i / seg > t) break;
        const a0 = -Math.PI / 2 + (i / seg) * Math.PI * 2;
        const a1 = -Math.PI / 2 + ((i + 0.7) / seg) * Math.PI * 2;
        g.moveTo(w.px + Math.cos(a0) * r, w.py + Math.sin(a0) * r)
          .lineTo(w.px + Math.cos(a1) * r, w.py + Math.sin(a1) * r)
          .stroke({ width: 3, color: 0xffd166, alpha: 0.95 });
      }
      // 揺らめく炎
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + w.frame * 0.09;
        const rr = r + 4 + Math.sin(w.frame * 0.3 + i) * 3;
        g.circle(w.px + Math.cos(a) * rr, w.py + Math.sin(a) * rr, 2.4).fill({
          color: 0xffb347,
          alpha: 0.85,
        });
      }
    }

    // ディメンション・リフレクター
    if (w.stats.evolutions.indexOf('reflector') >= 0) {
      // 吸収フィールド：溜め中だけ張られる
      if (w.chargeCommitted) {
        g.circle(w.px, w.py, REFLECT_ABSORB_R).stroke({
          width: 1.5,
          color: 0xff9ef0,
          alpha: 0.35 + 0.2 * Math.sin(w.frame * 0.18),
        });
        g.circle(w.px, w.py, REFLECT_ABSORB_R).fill({ color: 0xff5ec8, alpha: 0.05 });
      }
      // 反射窓：この間は当たった弾を撃ち返す
      if (w.reflectWindow > 0) {
        const t = w.reflectWindow / REFLECT_WINDOW;
        g.circle(w.px, w.py, 24 + (1 - t) * 8).stroke({ width: 3, color: 0xff9ef0, alpha: 0.35 + t * 0.55 });
        g.circle(w.px, w.py, 24 + (1 - t) * 8).fill({ color: 0xff5ec8, alpha: 0.08 * t });
      }
      // ストックは自機の周りを回る弾で見せる
      const shown = Math.min(REFLECT_STOCK_MAX, w.reflectStock);
      for (let i = 0; i < shown; i++) {
        const a = (i / Math.max(8, shown)) * Math.PI * 2 + w.frame * 0.045;
        const rr = 27 + (i % 3) * 4;
        g.circle(w.px + Math.cos(a) * rr, w.py + Math.sin(a) * rr, 2.4).fill({
          color: 0xff9ef0,
          alpha: 0.95,
        });
      }
    }

    const s = this.shipPool.add(this.tex.player);
    s.x = w.px;
    s.y = w.py;
    s.scale.set(0.85);
    if (w.invuln > 0) s.alpha = w.frame % 6 < 3 ? 0.35 : 0.85;
    if (w.shunen > 0) s.tint = 0xffd9a0;
    if (w.invincible) s.tint = 0xbff4ff;
    this.shipPool.end();

    // 被弾判定の芯（STG の作法として明示する）
    g.circle(w.px, w.py, 2.6).fill({ color: 0xffffff, alpha: 0.95 });
  }

  // ------------------------------------------------------------------ 全画面演出
  private drawOverlay(w: World): void {
    const g = this.overlayGfx;
    g.clear();
    if (this.fx.damageFlash > 0) {
      g.rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0xff2244, alpha: this.fx.damageFlash * 0.32 });
    }
    if (this.fx.whiteFlash > 0) {
      g.rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0xffffff, alpha: this.fx.whiteFlash * 0.5 });
    }
    if (w.state === 'levelup' || w.state === 'stageclear' || w.state === 'gameover' || w.state === 'gameclear') {
      g.rect(0, 0, VIEW_W, VIEW_H).fill({ color: 0x02040a, alpha: 0.55 });
    }
  }

  // ------------------------------------------------------------------ HUD
  private drawHud(w: World): void {
    const g = this.hudGfx;
    g.clear();

    // 経験値バー
    const expT = Math.max(0, Math.min(1, w.exp / w.expNeed));
    g.rect(0, 0, VIEW_W, 4).fill({ color: 0x16233d, alpha: 0.95 });
    g.rect(0, 0, VIEW_W * expT, 4).fill(0x7ef7c8);

    // 残機は小さな自機アイコンで示す（絵文字は環境差が大きいので使わない）
    const shown = Math.min(8, w.lives);
    for (let i = 0; i < shown; i++) {
      const x = 11 + i * 11;
      const y = 14;
      g.poly([x, y - 5, x + 4.5, y + 5, x, y + 2.5, x - 4.5, y + 5]).fill({ color: 0xff86b0, alpha: 0.95 });
    }
    if (w.lives > 8) {
      g.rect(11 + 8 * 11, 12, 3, 3).fill(0xff86b0);
    }
    this.txtLives.text = `Lv.${w.level}`;
    this.txtLives.position.set(11 + shown * 11 + 6, 8);

    this.txtScore.text = `${w.score}`;
    this.txtScore.position.set(VIEW_W - 34 - this.txtScore.width, 8);

    // ステージ名はしばらく出してから消す（常時出すと画面が汚れる）
    const sf = w.stageFrame;
    this.txtStage.alpha = sf < 180 ? 1 : Math.max(0, 1 - (sf - 180) / 60);
    this.txtStage.text = w.stage.name;
    this.txtStage.position.set((VIEW_W - this.txtStage.width) / 2, 26);

    // スタミナ（回避ストック）は回避ボタン側に出すので HUD には描かない

    // バフ表示
    const buffs: string[] = [];
    if (w.shunen > 0) {
      buffs.push(w.justCombo > 1 ? `瞬炎 ×${w.justCombo}連` : '瞬炎');
    }
    if (w.overdriveActive) buffs.push('OVERDRIVE ×3');
    if (w.stats.aegis > 0) buffs.push(`イージス ${w.stats.aegis}`);
    if (w.reflectStock > 0) buffs.push(`反射 ${w.reflectStock}`);
    this.txtBuff.text = buffs.join('　');
    // 自機の定位置（画面下寄り）や操作ボタンと重ならないよう上に置く
    this.txtBuff.position.set((VIEW_W - this.txtBuff.width) / 2, 62);

    // ボス HP
    const boss = w.enemies.find((e) => e.alive && (e.kind === 'boss' || e.kind === 'midboss'));
    if (boss) {
      const t = Math.max(0, boss.hp / boss.maxHp);
      g.rect(24, 44, VIEW_W - 48, 7).fill({ color: 0x2a0f1c, alpha: 0.9 });
      g.rect(24, 44, (VIEW_W - 48) * t, 7).fill(boss.coreOpen ? 0xff5ec8 : 0xff6b6b);
      g.rect(24, 44, VIEW_W - 48, 7).stroke({ width: 1, color: 0x88203f, alpha: 0.9 });
      // 部位ゲージ
      const n = boss.parts.length;
      for (let i = 0; i < n; i++) {
        const p = boss.parts[i];
        const bw = (VIEW_W - 48) / n - 4;
        const x = 24 + i * ((VIEW_W - 48) / n);
        const pt = p.destroyed ? 0 : Math.max(0, p.hp / p.maxHp);
        g.rect(x, 54, bw, 3).fill({ color: 0x1a2436, alpha: 0.9 });
        g.rect(x, 54, bw * pt, 3).fill(p.destroyed ? 0x445566 : 0x8ce8ff);
      }
      if (boss.coreOpen) {
        g.circle(boss.x, boss.y, 18 + Math.sin(w.frame * 0.3) * 3).stroke({
          width: 2,
          color: 0xff5ec8,
          alpha: 0.9,
        });
      }
    }
  }
}

function mkText(size: number, color: number, _align: 'left' | 'right' | 'center'): Text {
  return new Text({
    text: '',
    style: {
      fontFamily: 'system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif',
      fontSize: size,
      fontWeight: '700',
      fill: color,
    },
  });
}
