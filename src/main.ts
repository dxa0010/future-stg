import './style.css';
import { Application } from 'pixi.js';
import { World } from './sim/world';
import { hashSeed } from './sim/rng';
import { EMPTY_INPUT, type InputFrame, type WeaponId } from './sim/types';
import { VIEW_W, VIEW_H, TICK_RATE, CHARGE_MAX } from './sim/constants';
import { GameRenderer } from './render/renderer';
import { PointerInput } from './input/pointer';
import { Sfx } from './audio/sfx';
import { Ui, randomSeedText } from './ui/ui';

const STEP_MS = 1000 / TICK_RATE;
/** 1 フレームで進めるロジックの最大ステップ数（重い端末での暴走を防ぐ）。 */
const MAX_STEPS = 5;

async function boot(): Promise<void> {
  const app = new Application();
  await app.init({
    width: VIEW_W,
    height: VIEW_H,
    background: 0x05070f,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(2, window.devicePixelRatio || 1),
    powerPreference: 'high-performance',
  });
  const mount = document.getElementById('canvas-mount');
  mount?.appendChild(app.canvas as HTMLCanvasElement);

  const renderer = new GameRenderer(app);
  renderer.resize();
  window.addEventListener('resize', () => renderer.resize());
  window.addEventListener('orientationchange', () => window.setTimeout(() => renderer.resize(), 120));

  const sfx = new Sfx();
  const input = new PointerInput(() => renderer.viewScale);
  input.attach(app.canvas as HTMLCanvasElement);

  let world: World | null = null;
  let paused = false;
  let acc = 0;
  let crtOn = false;
  /** 入力列の記録。仕様書のゴーストリプレイはこれを保存するだけで済む。 */
  let replay: InputFrame[] = [];
  let lastShots = 0;
  let lastShotSoundAt = 0;

  const ui = new Ui({
    onStart: (weapon, seedText) => startRun(weapon, seedText),
    onChoice: (i) => {
      const w = world;
      if (!w) return;
      w.choose(i);
      sfx.levelup();
      syncScreen();
    },
    onRelease: () => {
      sfx.unlock();
      input.requestRelease();
    },
    onNext: () => {
      const w = world;
      if (!w) return;
      w.nextStage();
      input.reset();
      renderer.clearFx();
      ui.hide();
      ui.toast(w.stage.name, 1400);
    },
    onRetry: () => {
      world = null;
      paused = false;
      sfx.setCharge(false, 0);
      renderer.clearFx();
      ui.hideRelease();
      ui.showTitle(randomSeedText());
    },
    onResume: () => {
      paused = false;
      input.reset();
      ui.hide();
    },
    onToggleSound: () => {
      sfx.unlock();
      sfx.setMuted(!sfx.isMuted);
      return sfx.isMuted;
    },
    onToggleCrt: () => {
      crtOn = !crtOn;
      ui.setCrt(crtOn);
      return crtOn;
    },
  });

  function startRun(weapon: WeaponId, seedText: string): void {
    sfx.unlock();
    const seed = /^\d+$/.test(seedText.trim()) ? Number(seedText.trim()) >>> 0 : hashSeed(seedText.trim() || 'seed');
    world = new World(seed, weapon);
    replay = [];
    acc = 0;
    paused = false;
    lastShots = 0;
    input.reset();
    renderer.clearFx();
    ui.hide();
    ui.toast(world.stage.name, 1400);
  }

  /** ワールドの状態に合わせて画面を出し入れする。 */
  function syncScreen(): void {
    const w = world;
    if (!w) return;
    switch (w.state) {
      case 'levelup':
        if (!ui.isOpen) ui.showLevelUp(w.choices, w.level);
        break;
      case 'stageclear':
        if (!ui.isOpen) ui.showStageClear(w);
        break;
      case 'gameover':
        if (!ui.isOpen) {
          sfx.setCharge(false, 0);
          ui.showGameOver(w);
        }
        break;
      case 'gameclear':
        if (!ui.isOpen) {
          sfx.setCharge(false, 0);
          ui.showGameClear(w);
        }
        break;
      case 'playing':
        if (ui.isOpen && !paused) ui.hide();
        break;
      default:
        break;
    }
  }

  /** シミュレーションの演出イベントを描画と音に配る。 */
  function dispatchFx(w: World): void {
    const events = w.drainFx();
    renderer.pushFx(events);
    for (const ev of events) {
      switch (ev.type) {
        case 'just':
          sfx.just();
          ui.toast('JUST', 480);
          break;
        case 'explode':
          if (ev.size > 20) sfx.explode(ev.size);
          else if (ev.size > 11) sfx.explode(ev.size * 0.5);
          break;
        case 'damaged':
          sfx.damage();
          break;
        case 'resonance':
          sfx.resonance(ev.stage);
          ui.toast('臨界共鳴', 700);
          break;
        case 'chargeStage':
          sfx.chargeStage(ev.stage);
          break;
        case 'levelup':
          sfx.levelup();
          break;
        case 'pickupLife':
          sfx.pickup();
          ui.toast('残機 +1', 800);
          break;
        case 'bossPart':
          sfx.explode(30);
          break;
        default:
          break;
      }
    }
  }

  app.ticker.add((ticker) => {
    const w = world;
    const dtMs = Math.min(100, ticker.deltaMS);

    if (w && !paused && !ui.isOpen) {
      acc += dtMs;
      let steps = 0;
      while (acc >= STEP_MS && steps < MAX_STEPS) {
        const frame = w.state === 'playing' ? input.sample() : EMPTY_INPUT;
        if (w.state === 'playing') replay.push(frame);
        w.update(frame);
        acc -= STEP_MS;
        steps++;
        if (w.state !== 'playing') break;
      }
      if (steps >= MAX_STEPS) acc = 0;
    } else {
      acc = 0;
      // 画面が開いている間は入力を捨てる（裏で自機が動かないように）
      input.sample();
    }

    if (w) {
      dispatchFx(w);
      syncScreen();

      // 射撃音（間引き）
      if (w.shots !== lastShots) {
        const now = performance.now();
        if (now - lastShotSoundAt > 55) {
          sfx.shot();
          lastShotSoundAt = now;
        }
        lastShots = w.shots;
      }

      // 充填音のクレッシェンド
      const charging = w.state === 'playing' && w.chargeCommitted && !paused;
      sfx.setCharge(charging, Math.min(1, w.chargeFrames / CHARGE_MAX));

      ui.updateRelease(w);
      renderer.draw(w, dtMs / STEP_MS);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && world && world.state === 'playing') {
      paused = true;
      sfx.setCharge(false, 0);
      ui.showPause();
    }
  });

  ui.setCrt(crtOn);
  ui.showTitle(randomSeedText());

  // デバッグ・調整用。コンソールから中身を覗けるようにしておく。
  Object.defineProperty(window, 'game', {
    get: () => ({
      get world() {
        return world;
      },
      get replay() {
        return replay;
      },
      get paused() {
        return paused;
      },
    }),
  });
}

void boot();
