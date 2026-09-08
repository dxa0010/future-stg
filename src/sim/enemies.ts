import type { Enemy, EnemyKind, EnemyPart } from './types';
import { VIEW_W, VIEW_H } from './constants';
import type { World } from './world';

interface EnemyTemplate {
  hp: number;
  r: number;
  gems: number;
  contact: boolean;
  shield: number;
}

const TEMPLATES: Record<EnemyKind, EnemyTemplate> = {
  grunt: { hp: 4, r: 9, gems: 1, contact: true, shield: 0 },
  zigzag: { hp: 7, r: 10, gems: 2, contact: true, shield: 0 },
  shield: { hp: 10, r: 12, gems: 3, contact: true, shield: 26 },
  rusher: { hp: 6, r: 10, gems: 2, contact: true, shield: 0 },
  turret: { hp: 22, r: 13, gems: 4, contact: true, shield: 0 },
  midboss: { hp: 330, r: 34, gems: 30, contact: true, shield: 0 },
  boss: { hp: 760, r: 42, gems: 60, contact: true, shield: 0 },
};

export function createEnemy(w: World, kind: EnemyKind, x: number, y: number, hpMul: number): Enemy {
  const t = TEMPLATES[kind];
  const e: Enemy = {
    id: w.nextEnemyId++,
    alive: true,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    r: t.r,
    hp: t.hp * hpMul,
    maxHp: t.hp * hpMul,
    gems: t.gems,
    contact: t.contact,
    t: 0,
    fireCd: 0,
    phase: w.rng.next() * Math.PI * 2,
    shieldHp: t.shield * hpMul,
    shieldMax: t.shield * hpMul,
    flash: 0,
    parts: [],
    coreOpen: false,
    phaseIdx: 0,
    baseX: x,
  };

  switch (kind) {
    case 'grunt':
      e.vy = w.rng.range(1.5, 2.1);
      e.fireCd = w.rng.int(40, 110);
      break;
    case 'zigzag':
      e.vy = 1.15;
      e.fireCd = w.rng.int(50, 90);
      break;
    case 'shield':
      e.vy = 0.85;
      e.fireCd = w.rng.int(70, 130);
      break;
    case 'rusher':
      e.vy = 0.5;
      break;
    case 'turret':
      e.vy = 1.6;
      e.fireCd = 70;
      break;
    case 'midboss':
      e.vy = 1.0;
      e.fireCd = 120;
      e.parts = [
        makePart('左砲塔', -30, 6, 13, 80 * hpMul),
        makePart('右砲塔', 30, 6, 13, 80 * hpMul),
      ];
      break;
    case 'boss':
      e.vy = 0.8;
      e.fireCd = 150;
      e.parts = [
        makePart('左ウイング', -44, 4, 15, 150 * hpMul),
        makePart('右ウイング', 44, 4, 15, 150 * hpMul),
        makePart('上部装甲', 0, -26, 14, 190 * hpMul),
      ];
      break;
  }
  return e;
}

function makePart(name: string, ox: number, oy: number, r: number, hp: number): EnemyPart {
  return { name, hp, maxHp: hp, ox, oy, r, destroyed: false };
}

/** ボスかどうか。 */
export function isBoss(e: Enemy): boolean {
  return e.kind === 'midboss' || e.kind === 'boss';
}

export function updateEnemy(w: World, e: Enemy): void {
  e.t++;
  if (e.flash > 0) e.flash--;

  switch (e.kind) {
    case 'grunt':
      e.y += e.vy;
      if (--e.fireCd <= 0) {
        e.fireCd = w.rng.int(90, 170);
        if (e.y > 0 && e.y < VIEW_H * 0.75) w.fireAimed(e.x, e.y, 2.3, 1);
      }
      break;

    case 'zigzag': {
      e.y += e.vy;
      e.x = e.baseX + Math.sin(e.t * 0.035 + e.phase) * 62;
      if (--e.fireCd <= 0) {
        e.fireCd = w.rng.int(80, 130);
        if (e.y > 0 && e.y < VIEW_H * 0.7) w.fireSpread(e.x, e.y, 2.1, 3, 0.32);
      }
      break;
    }

    case 'shield': {
      e.y += e.vy;
      e.x = e.baseX + Math.sin(e.t * 0.018 + e.phase) * 26;
      if (--e.fireCd <= 0) {
        e.fireCd = w.rng.int(100, 150);
        if (e.y > 0 && e.y < VIEW_H * 0.7) w.fireAimed(e.x, e.y, 2.6, 2);
      }
      break;
    }

    case 'rusher': {
      // 上部で溜めてから一気に突っ込む。接触が主なダメージ源。
      if (e.t < 44) {
        e.y += e.vy;
      } else {
        e.vy = Math.min(e.vy + 0.32, 8.2);
        e.y += e.vy;
      }
      break;
    }

    case 'turret': {
      // 一定位置で止まり、撃ち続ける固定砲台。
      const stopY = 96 + (e.phase % 1) * 40;
      if (e.y < stopY) e.y += e.vy;
      else if (--e.fireCd <= 0) {
        e.fireCd = 78;
        w.fireSpread(e.x, e.y, 2.4, 5, 0.26);
      }
      break;
    }

    case 'midboss':
      updateMidboss(w, e);
      break;

    case 'boss':
      updateBoss(w, e);
      break;
  }

  if (e.kind !== 'turret' && e.y > VIEW_H + 40) e.alive = false;
  if (e.kind === 'turret' && e.y > VIEW_H + 40) e.alive = false;
}

function bossEntry(e: Enemy, targetY: number): boolean {
  if (e.y < targetY) {
    e.y += e.vy;
    return true;
  }
  return false;
}

function updateMidboss(w: World, e: Enemy): void {
  if (bossEntry(e, 120)) return;

  e.x = VIEW_W / 2 + Math.sin(e.t * 0.014) * 92;
  const alivePart = e.parts.some((p) => !p.destroyed);
  e.coreOpen = !alivePart;

  if (--e.fireCd > 0) return;

  if (alivePart) {
    // 砲塔が生きている間：左右から交互に扇状の弾。
    const idx = e.phaseIdx % 2;
    const p = e.parts[idx];
    e.phaseIdx++;
    if (!p.destroyed) {
      w.fireSpread(e.x + p.ox, e.y + p.oy, 2.5, 5, 0.22);
      e.fireCd = 46;
    } else {
      e.fireCd = 8;
    }
  } else {
    // コア露出後：ばら撒き＋薙ぎ払いレーザー
    e.phaseIdx++;
    if (e.phaseIdx % 4 === 0) {
      w.fireLaser(e.x, e.y + 16, Math.PI / 2 + Math.sin(e.t * 0.01) * 0.5, 40, 26);
      e.fireCd = 96;
    } else {
      w.fireRing(e.x, e.y, 2.2, 14, e.t * 0.11);
      e.fireCd = 54;
    }
  }
}

function updateBoss(w: World, e: Enemy): void {
  if (bossEntry(e, 132)) return;

  const destroyed = e.parts.filter((p) => p.destroyed).length;
  e.coreOpen = destroyed >= 2;
  const phase = destroyed >= 3 ? 2 : destroyed >= 1 ? 1 : 0;

  const sway = phase === 2 ? 110 : phase === 1 ? 92 : 70;
  const speed = phase === 2 ? 0.024 : phase === 1 ? 0.018 : 0.012;
  e.x = VIEW_W / 2 + Math.sin(e.t * speed) * sway;

  if (--e.fireCd > 0) return;
  e.phaseIdx++;

  if (phase === 0) {
    // 第 1 形態：自機狙いの扇 + 左右ウイングからの直線弾
    if (e.phaseIdx % 3 === 0) {
      w.fireSpread(e.x, e.y + 18, 2.6, 7, 0.2);
      e.fireCd = 62;
    } else {
      for (const p of e.parts) {
        if (p.destroyed) continue;
        w.fireAimed(e.x + p.ox, e.y + p.oy, 3.0, 1);
      }
      e.fireCd = 34;
    }
  } else if (phase === 1) {
    // 第 2 形態：リング弾 + 予告レーザー
    if (e.phaseIdx % 5 === 0) {
      const a = Math.atan2(w.py - e.y, w.px - e.x);
      w.fireLaser(e.x, e.y + 18, a, 44, 30);
      e.fireCd = 92;
    } else if (e.phaseIdx % 2 === 0) {
      w.fireRing(e.x, e.y, 2.4, 18, e.t * 0.07);
      e.fireCd = 52;
    } else {
      w.fireSpread(e.x, e.y + 18, 2.8, 9, 0.17);
      e.fireCd = 46;
    }
  } else {
    // 最終形態：三連レーザー + 高密度弾幕
    if (e.phaseIdx % 4 === 0) {
      const a = Math.atan2(w.py - e.y, w.px - e.x);
      w.fireLaser(e.x, e.y + 18, a - 0.45, 40, 22);
      w.fireLaser(e.x, e.y + 18, a, 40, 22);
      w.fireLaser(e.x, e.y + 18, a + 0.45, 40, 22);
      e.fireCd = 104;
    } else if (e.phaseIdx % 2 === 0) {
      w.fireRing(e.x, e.y, 2.6, 22, e.t * 0.05);
      e.fireCd = 40;
    } else {
      w.fireSpread(e.x, e.y + 18, 3.0, 11, 0.15);
      e.fireCd = 38;
    }
  }
}
