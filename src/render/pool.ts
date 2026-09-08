import { Container, ParticleContainer, Particle, Sprite, type Texture } from 'pixi.js';

/**
 * ParticleContainer の中身を毎フレーム作り直すためのプール。
 * 弾のように出入りの激しいものはこれで回す（GC を起こさない）。
 */
export class ParticlePool {
  readonly container: ParticleContainer;
  private readonly texture: Texture;
  private n = 0;

  constructor(texture: Texture) {
    this.texture = texture;
    this.container = new ParticleContainer({
      dynamicProperties: { position: true, rotation: true, color: true, vertex: true, uvs: false },
    });
  }

  begin(): void {
    this.n = 0;
  }

  add(x: number, y: number, scaleX: number, scaleY: number, rotation: number, tint: number, alpha: number): void {
    const list = this.container.particleChildren;
    let p = list[this.n] as Particle | undefined;
    if (!p) {
      p = new Particle({ texture: this.texture, anchorX: 0.5, anchorY: 0.5 });
      list.push(p);
    }
    p.x = x;
    p.y = y;
    p.scaleX = scaleX;
    p.scaleY = scaleY;
    p.rotation = rotation;
    p.tint = tint;
    p.alpha = alpha;
    this.n++;
  }

  end(): void {
    this.container.particleChildren.length = this.n;
    this.container.update();
  }
}

/** Sprite を使い回すプール（テクスチャが混ざるもの用）。 */
export class SpritePool {
  readonly container = new Container();
  private n = 0;

  begin(): void {
    this.n = 0;
  }

  add(texture: Texture): Sprite {
    let s = this.container.children[this.n] as Sprite | undefined;
    if (!s) {
      s = new Sprite();
      s.anchor.set(0.5);
      this.container.addChild(s);
    }
    s.texture = texture;
    s.visible = true;
    s.alpha = 1;
    s.rotation = 0;
    s.tint = 0xffffff;
    s.blendMode = 'normal';
    this.n++;
    return s;
  }

  end(): void {
    const kids = this.container.children;
    for (let i = this.n; i < kids.length; i++) kids[i].visible = false;
  }
}
