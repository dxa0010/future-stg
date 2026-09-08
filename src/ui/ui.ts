import type { World } from '../sim/world';
import type { Choice } from '../sim/upgrades';
import type { WeaponId } from '../sim/types';
import { CHARGE_MAX } from '../sim/constants';

const STAGE_CSS = ['#63d9ff', '#ffd166', '#ff5ec8'];

export interface UiCallbacks {
  onStart: (weapon: WeaponId, seedText: string) => void;
  onChoice: (index: number) => void;
  onNext: () => void;
  onRetry: () => void;
  onRelease: () => void;
  onDodge: () => void;
  onPause: () => void;
  onResume: () => void;
  onToggleSound: () => boolean;
  onToggleCrt: () => boolean;
  onToggleSwipe: () => boolean;
}

const CAT_LABEL: Record<string, string> = {
  dodge: '回避',
  charge: '溜め',
  collect: '回収',
  general: '汎用',
  evolution: '進化',
};

/**
 * DOM 側の画面まわり。Pixi のキャンバスに重ねて表示する。
 *
 * 表示中の画面は currentKey で管理する。
 * 「今出すべき画面のキー」と違うときだけ描き直すので、
 * レベルアップ → ステージクリアのように画面から画面へ直接遷移できる。
 */
export class Ui {
  private readonly screen = document.getElementById('screen') as HTMLDivElement;
  private readonly releaseBtn = document.getElementById('release-btn') as HTMLButtonElement;
  private readonly dodgeBtn = document.getElementById('dodge-btn') as HTMLButtonElement;
  private readonly dodgeArrow = this.dodgeBtn.querySelector('.arrow') as HTMLElement;
  private readonly dodgeStock = this.dodgeBtn.querySelector('.stock') as HTMLElement;
  private readonly pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  private readonly crt = document.getElementById('crt') as HTMLDivElement;
  private readonly toastEl = document.getElementById('toast') as HTMLDivElement;
  private toastTimer = 0;
  private stockCount = -1;

  /** いま表示している画面のキー。'none' は非表示。 */
  private currentKey = 'none';

  constructor(private readonly cb: UiCallbacks) {
    // 解放・回避はタップの瞬間に効かせる。ドラッグ扱いにならないよう伝播を止める。
    this.releaseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cb.onRelease();
    });
    this.dodgeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cb.onDodge();
    });
    this.pauseBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.cb.onPause();
    });
  }

  // ------------------------------------------------------------- 共通
  get key(): string {
    return this.currentKey;
  }

  get isOpen(): boolean {
    return this.currentKey !== 'none';
  }

  private open(key: string, html: string, bottom = false): void {
    this.currentKey = key;
    this.screen.innerHTML = html;
    this.screen.classList.toggle('bottom', bottom);
    this.screen.classList.remove('hidden');
    this.pauseBtn.classList.add('hidden');
    this.releaseBtn.classList.add('hidden');
    this.dodgeBtn.classList.add('hidden');
  }

  hide(): void {
    this.currentKey = 'none';
    this.screen.classList.add('hidden');
    this.screen.innerHTML = '';
    this.pauseBtn.classList.remove('hidden');
  }

  private on(id: string, fn: () => void): void {
    this.screen.querySelector<HTMLElement>(`#${id}`)?.addEventListener('click', fn);
  }

  toast(text: string, ms = 1100): void {
    this.toastEl.innerHTML = text;
    this.toastEl.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('show'), ms);
  }

  // ------------------------------------------------------------- タイトル
  showTitle(defaultSeed: string, swipeDodge: boolean): void {
    this.open(
      'title',
      `
      <h1>RESONANCE FLICK</h1>
      <p class="sub">縦スクロール・ローグライトSTG／プロトタイプ v1</p>

      <div class="help">
        <b>ドラッグ</b>：移動＋自動射撃<br />
        <b>回避ボタン（左下）</b>：進んでいる向きにころりん。無敵中に敵弾と重なると<b>ジャスト</b>成立 → 瞬炎<br />
        <b>指を離す</b>：完全静止して溜め。<b>溜めは繰り越せる</b>が、被弾すると全消滅<br />
        <b>解放ボタン（右下）</b>：臨界共鳴（極太ビーム＋弾消し衝撃波＋ジェム吸着）<br />
        <span class="sub">PC：WASD/矢印で移動、Shift で回避、Space で解放</span>
      </div>

      <p>初期武器を選ぶ</p>
      <div class="cards">
        <button class="card" id="w-gatling" data-cat="dodge">
          <div class="name"><span class="badge">回避</span>ガトリング</div>
          <div class="desc">やや広めの連射。ジャスト回避で瞬炎を回し続ける「速度」のビルド。進化：ヴォルテックスストーム</div>
        </button>
        <button class="card" id="w-beam" data-cat="charge">
          <div class="name"><span class="badge">溜め</span>集束ビーム</div>
          <div class="desc">細い常時ビーム。位置取りで当てて、溜めを分割払いする「防御と火力」のビルド。進化：絶対零度・オメガカノン</div>
        </button>
      </div>

      <div class="row seedrow">
        <input id="seed" value="${escapeHtml(defaultSeed)}" aria-label="シード" />
        <button class="btn" id="reroll">🎲</button>
      </div>
      <div class="row">
        <button class="btn" id="snd">音 ON</button>
        <button class="btn" id="crtbtn">CRT OFF</button>
        <button class="btn" id="swipebtn">スワイプ回避 ${swipeDodge ? 'ON' : 'OFF'}</button>
      </div>
      <p class="sub">同じシード＋同じ入力なら必ず同じ展開になる決定論シミュレーション。</p>
    `,
    );

    const seedInput = this.screen.querySelector<HTMLInputElement>('#seed');
    const start = (w: WeaponId): void => this.cb.onStart(w, seedInput?.value ?? defaultSeed);
    this.on('w-gatling', () => start('gatling'));
    this.on('w-beam', () => start('beam'));
    this.on('reroll', () => {
      if (seedInput) seedInput.value = randomSeedText();
    });
    this.bindToggle('snd', () => (this.cb.onToggleSound() ? '音 OFF' : '音 ON'));
    this.bindToggle('crtbtn', () => (this.cb.onToggleCrt() ? 'CRT ON' : 'CRT OFF'));
    this.bindToggle('swipebtn', () => `スワイプ回避 ${this.cb.onToggleSwipe() ? 'ON' : 'OFF'}`);
  }

  private bindToggle(id: string, fn: () => string): void {
    this.on(id, () => {
      const label = fn();
      const el = this.screen.querySelector(`#${id}`);
      if (el) el.textContent = label;
    });
  }

  // ------------------------------------------------------------- レベルアップ
  showLevelUp(key: string, choices: Choice[], level: number): void {
    const cards = choices
      .map(
        (c, i) => `
      <button class="card ${c.special ? 'special' : ''}" data-cat="${c.category}" data-i="${i}">
        <div class="name"><span class="badge">${CAT_LABEL[c.category] ?? ''}</span>${escapeHtml(c.name)}</div>
        <div class="desc">${escapeHtml(c.desc)}</div>
      </button>`,
      )
      .join('');
    this.open(
      key,
      `
      <h2>LEVEL UP　<span class="sub">Lv.${level}</span></h2>
      <div class="cards">${cards}</div>
    `,
      true,
    );
    this.screen.querySelectorAll<HTMLElement>('.card').forEach((el) => {
      el.addEventListener('click', () => this.cb.onChoice(Number(el.dataset.i ?? '0')));
    });
  }

  // ------------------------------------------------------------- ステージ
  showStageClear(key: string, w: World): void {
    this.open(
      key,
      `
      <h2>STAGE ${w.stage.id} CLEAR</h2>
      <p class="sub">ボスを撃破した。次のステージへ。</p>
      ${this.statsHtml(w)}
      <button class="btn primary" id="next">次のステージへ</button>
    `,
      true,
    );
    this.on('next', () => this.cb.onNext());
  }

  showGameOver(w: World): void {
    this.open(
      'gameover',
      `
      <h2 style="color:#ff6b8a">GAME OVER</h2>
      ${this.statsHtml(w)}
      ${this.verifyHtml(w)}
      <button class="btn primary" id="retry">もう一度</button>
    `,
    );
    this.on('retry', () => this.cb.onRetry());
  }

  showGameClear(w: World): void {
    this.open(
      'gameclear',
      `
      <h1>ALL CLEAR</h1>
      <p class="sub">プロトタイプ範囲（ステージ 1〜2）を踏破した。</p>
      ${this.statsHtml(w)}
      ${this.verifyHtml(w)}
      <button class="btn primary" id="retry">もう一度</button>
    `,
    );
    this.on('retry', () => this.cb.onRetry());
  }

  showPause(swipeDodge: boolean): void {
    this.open(
      'pause',
      `
      <h2>PAUSE</h2>
      <div class="row">
        <button class="btn" id="snd">音</button>
        <button class="btn" id="crtbtn">CRT</button>
      </div>
      <button class="btn" id="swipebtn">スワイプ回避 ${swipeDodge ? 'ON' : 'OFF'}</button>
      <button class="btn primary" id="resume">再開</button>
      <button class="btn" id="quit">タイトルへ</button>
    `,
    );
    this.on('resume', () => this.cb.onResume());
    this.on('quit', () => this.cb.onRetry());
    this.bindToggle('snd', () => (this.cb.onToggleSound() ? '音 OFF' : '音 ON'));
    this.bindToggle('crtbtn', () => (this.cb.onToggleCrt() ? 'CRT ON' : 'CRT OFF'));
    this.bindToggle('swipebtn', () => `スワイプ回避 ${this.cb.onToggleSwipe() ? 'ON' : 'OFF'}`);
  }

  private statsHtml(w: World): string {
    return `
      <dl class="stats">
        <dt>SCORE</dt><dd>${w.score}</dd>
        <dt>撃破</dt><dd>${w.kills}</dd>
        <dt>レベル</dt><dd>${w.level}</dd>
        <dt>残機</dt><dd>${w.lives}</dd>
        <dt>ビルド</dt><dd>${escapeHtml(buildSummary(w))}</dd>
      </dl>`;
  }

  /** プロトタイプの仮説検証用。熟練度そのものではなく素の記録を出す。 */
  private verifyHtml(w: World): string {
    const m = w.mastery;
    const rate = m.justAttempt > 0 ? Math.round((m.justSuccess / m.justAttempt) * 100) : 0;
    return `
      <div class="help">
        <b>検証データ</b><br />
        ジャスト回避：${m.justSuccess} / ${m.justAttempt}（成功率 ${rate}%）<br />
        段階3 解放：${m.maxStageRelease} 回<br />
        シード：${w.seed}
      </div>`;
  }

  // ------------------------------------------------------------- 操作ボタン
  updateRelease(w: World): void {
    const show = w.showReleaseButton && !this.isOpen;
    this.releaseBtn.classList.toggle('hidden', !show);
    if (!show) return;
    const stage = w.chargeStage;
    const t = Math.min(1, w.chargeFrames / CHARGE_MAX);
    this.releaseBtn.style.setProperty('--t', t.toFixed(3));
    this.releaseBtn.style.setProperty('--stage-color', STAGE_CSS[Math.max(0, stage - 1)]);
    // 段階に応じて大きさも変える（何を失うのかを見せる）
    this.releaseBtn.style.transform = `scale(${(1 + stage * 0.06).toFixed(3)})`;
    this.releaseBtn.dataset.armed = stage >= 1 ? '1' : '0';
    const label = this.releaseBtn.querySelector('.label');
    if (label) label.textContent = stage >= 1 ? `解放 ${stage}` : '溜め中';
  }

  /** 回避ボタン。矢印が「いま押したらどっちへ飛ぶか」を示す。 */
  updateDodge(w: World, heading: number): void {
    const show = w.state === 'playing' && !this.isOpen;
    this.dodgeBtn.classList.toggle('hidden', !show);
    if (!show) return;

    this.dodgeArrow.style.transform = `rotate(${heading * 45}deg)`;
    this.dodgeBtn.dataset.ready = w.stamina > 0 ? '1' : '0';

    // スタミナのストックを点で、次の 1 個の回復をリングで見せる
    const max = w.stats.staminaMax;
    if (this.stockCount !== max) {
      this.stockCount = max;
      this.dodgeStock.innerHTML = new Array(max).fill('<i></i>').join('');
    }
    const dots = this.dodgeStock.children;
    for (let i = 0; i < dots.length; i++) {
      (dots[i] as HTMLElement).classList.toggle('on', i < w.stamina);
    }
    const t = w.stamina >= max ? 0 : w.staminaTimer / w.stats.staminaRegen;
    this.dodgeBtn.style.setProperty('--t', t.toFixed(3));
  }

  hideButtons(): void {
    this.releaseBtn.classList.add('hidden');
    this.dodgeBtn.classList.add('hidden');
  }

  setCrt(on: boolean): void {
    this.crt.classList.toggle('hidden', !on);
  }
}

function buildSummary(w: World): string {
  const parts: string[] = [w.stats.weapon === 'gatling' ? 'ガトリング' : '集束ビーム'];
  for (const e of w.stats.evolutions) {
    parts.push(e === 'vortex' ? 'ヴォルテックス' : e === 'omega' ? 'オメガカノン' : 'リフレクター');
  }
  return parts.join(' + ');
}

export function randomSeedText(): string {
  return Math.floor(Math.random() * 1e9)
    .toString(36)
    .toUpperCase();
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
