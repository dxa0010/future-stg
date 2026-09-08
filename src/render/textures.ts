import { Graphics, Texture, type Renderer } from 'pixi.js';

export interface TextureSet {
  dot: Texture;
  ring: Texture;
  glow: Texture;
  needle: Texture;
  square: Texture;
  player: Texture;
  afterimage: Texture;
  grunt: Texture;
  zigzag: Texture;
  shield: Texture;
  rusher: Texture;
  turret: Texture;
  midboss: Texture;
  boss: Texture;
  part: Texture;
  gem: Texture;
  lifeItem: Texture;
}

function bake(renderer: Renderer, g: Graphics): Texture {
  const tex = renderer.generateTexture({ target: g, resolution: 3, antialias: true });
  g.destroy();
  return tex;
}

/**
 * 半径 r の柔らかい光。同心円を重ねて擬似的なグラデーションにする。
 * 加算合成で使うので、中心は完全に飽和させておく。
 */
function glowGraphic(r: number, steps = 18): Graphics {
  const g = new Graphics();
  for (let i = steps; i >= 1; i--) {
    const t = i / steps;
    g.circle(r, r, r * t).fill({ color: 0xffffff, alpha: 0.14 * (1 - t) * (1 - t) + 0.045 });
  }
  g.circle(r, r, r * 0.3).fill({ color: 0xffffff, alpha: 1 });
  return g;
}

export function buildTextures(renderer: Renderer): TextureSet {
  // --- 基本形
  const dot = bake(renderer, new Graphics().circle(8, 8, 8).fill(0xffffff));
  const ringG = new Graphics();
  ringG.circle(16, 16, 12).stroke({ width: 1.5, color: 0xffffff, alpha: 0.35, alignment: 0.5 });
  ringG.circle(16, 16, 13).stroke({ width: 2.4, color: 0xffffff, alignment: 0.5 });
  const ring = bake(renderer, ringG);
  const glow = bake(renderer, glowGraphic(32));
  const square = bake(renderer, new Graphics().rect(0, 0, 8, 8).fill(0xffffff));
  const needle = bake(
    renderer,
    new Graphics().roundRect(0, 0, 4, 16, 2).fill(0xffffff),
  );

  // --- 自機：前方に尖った三角＋エンジン
  const pg = new Graphics();
  pg.poly([16, 0, 27, 26, 16, 21, 5, 26]).fill(0xf2fbff);
  pg.poly([16, 4, 23, 24, 16, 19, 9, 24]).fill(0x63d9ff);
  pg.rect(13, 22, 6, 7).fill(0xffc75e);
  const player = bake(renderer, pg);

  const ag = new Graphics();
  ag.poly([16, 0, 27, 26, 16, 21, 5, 26]).fill({ color: 0x8ce8ff, alpha: 0.55 });
  const afterimage = bake(renderer, ag);

  // --- 敵
  const gruntG = new Graphics();
  gruntG.poly([14, 28, 0, 10, 14, 0, 28, 10]).fill(0xff6b8a);
  gruntG.poly([14, 22, 6, 11, 14, 6, 22, 11]).fill(0x8a1f38);
  const grunt = bake(renderer, gruntG);

  const zigG = new Graphics();
  zigG.poly([16, 30, 0, 6, 10, 10, 16, 0, 22, 10, 32, 6]).fill(0xffa64d);
  zigG.poly([16, 22, 8, 10, 16, 6, 24, 10]).fill(0x7a3d00);
  const zigzag = bake(renderer, zigG);

  const shieldG = new Graphics();
  shieldG.poly([18, 0, 34, 10, 34, 26, 18, 36, 2, 26, 2, 10]).fill(0x9d7bff);
  shieldG.poly([18, 6, 28, 12, 28, 24, 18, 30, 8, 24, 8, 12]).fill(0x3a2b70);
  const shield = bake(renderer, shieldG);

  const rushG = new Graphics();
  rushG.poly([13, 30, 0, 4, 13, 12, 26, 4]).fill(0xffd166);
  rushG.poly([13, 24, 5, 9, 13, 15, 21, 9]).fill(0x6b4a00);
  const rusher = bake(renderer, rushG);

  const turG = new Graphics();
  turG.circle(16, 16, 15).fill(0x7de3c3);
  turG.circle(16, 16, 9).fill(0x14493c);
  turG.rect(13, 16, 6, 14).fill(0x7de3c3);
  const turret = bake(renderer, turG);

  const mbG = new Graphics();
  mbG.poly([48, 84, 4, 40, 20, 6, 76, 6, 92, 40]).fill(0xff8080);
  mbG.poly([48, 68, 18, 38, 28, 18, 68, 18, 78, 38]).fill(0x5c1b28);
  mbG.circle(48, 40, 12).fill(0xffe66d);
  const midboss = bake(renderer, mbG);

  const bsG = new Graphics();
  bsG.poly([60, 106, 0, 52, 14, 10, 106, 10, 120, 52]).fill(0xc06bff);
  bsG.poly([60, 88, 20, 50, 32, 24, 88, 24, 100, 50]).fill(0x2c1152);
  bsG.circle(60, 52, 15).fill(0xff5ec8);
  const boss = bake(renderer, bsG);

  const partG = new Graphics();
  partG.circle(16, 16, 15).fill(0xffffff);
  partG.circle(16, 16, 9).fill(0x222233);
  const part = bake(renderer, partG);

  // --- ジェム / アイテム
  const gemG = new Graphics();
  gemG.poly([7, 0, 14, 8, 7, 18, 0, 8]).fill(0x7ef7c8);
  const gem = bake(renderer, gemG);

  const lifeG = new Graphics();
  lifeG.circle(14, 14, 13).stroke({ width: 3, color: 0xff86b0 });
  lifeG.poly([14, 4, 22, 14, 14, 24, 6, 14]).fill(0xff86b0);
  const lifeItem = bake(renderer, lifeG);

  return {
    dot,
    ring,
    glow,
    needle,
    square,
    player,
    afterimage,
    grunt,
    zigzag,
    shield,
    rusher,
    turret,
    midboss,
    boss,
    part,
    gem,
    lifeItem,
  };
}
