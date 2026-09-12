/**
 * YouTube Playables SDK の薄いラッパー。
 *
 * Playables の外（GitHub Pages やローカル）でも同じコードが動くように、
 * SDK が無ければすべて安全な no-op になる。保存だけは localStorage に落ちる。
 *
 * SDK は index.html でページ最初のスクリプトとして読み込む：
 *   <script src="https://www.youtube.com/game_api/v1"></script>
 */

/** SDK が生やすグローバル。使う分だけ型を付ける。 */
interface YtGame {
  SDK_VERSION?: string;
  IN_PLAYABLES_ENV?: boolean;
  game: {
    firstFrameReady: () => void;
    gameReady: () => void;
    loadData: () => Promise<string>;
    saveData: (data: string) => Promise<void>;
  };
  system: {
    onPause: (cb: () => void) => void;
    onResume: (cb: () => void) => void;
    getLanguage: () => Promise<string>;
    isAudioEnabled: () => boolean;
    onAudioEnabledChange: (cb: (enabled: boolean) => void) => void;
  };
  engagement: {
    sendScore: (arg: { value: number }) => Promise<void>;
  };
}

declare global {
  interface Window {
    ytgame?: YtGame;
  }
}

/** localStorage のキー（Playables の外で使うフォールバック）。 */
const LOCAL_KEY = 'resonance-flick/save';

/** 保存するデータ。浅いオブジェクトにしておく（SDK の制約）。 */
export interface SaveData {
  /** 最高スコア。 */
  best: number;
  /** 到達した最大ステージ。 */
  bestStage: number;
  /** 設定。 */
  muted: boolean;
  crt: boolean;
  stickMode: boolean;
  swipeDodge: boolean;
}

export const DEFAULT_SAVE: SaveData = {
  best: 0,
  bestStage: 0,
  muted: false,
  crt: false,
  stickMode: true,
  swipeDodge: false,
};

/** 呼び出しがぶら下がったままにならないように時間で打ち切る。 */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error('playables: timeout')), ms);
    p.then(
      (v) => {
        window.clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        window.clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * saveData に渡せる文字列か検証する。
 * SDK は「lone surrogate を含まない正しい UTF-16」を要求するので、
 * 壊れたサロゲートペアが混ざっていたら保存しない。
 */
function isWellFormedUtf16(s: string): boolean {
  // 環境にあれば標準の判定を使う
  const anyStr = s as unknown as { isWellFormed?: () => boolean };
  if (typeof anyStr.isWellFormed === 'function') return anyStr.isWellFormed();
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = s.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

class PlayablesBridge {
  private sdk: YtGame | null = null;
  /** Playables の中で動いているか。 */
  inEnv = false;
  version = 'unloaded';
  private firstFrameSent = false;
  private gameReadySent = false;

  /** ドキュメントと SDK の準備が済むまで待つ。 */
  boot(): Promise<void> {
    return new Promise((resolve) => {
      const done = (): void => {
        const g = window.ytgame;
        if (g) {
          this.sdk = g;
          this.version = g.SDK_VERSION ?? 'unknown';
          this.inEnv = g.IN_PLAYABLES_ENV === true;
        }
        resolve();
      };
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        done();
        return;
      }
      const check = (): void => {
        document.removeEventListener('DOMContentLoaded', check, true);
        window.removeEventListener('load', check, true);
        done();
      };
      document.addEventListener('DOMContentLoaded', check, true);
      window.addEventListener('load', check, true);
    });
  }

  /** ローダー相当の最初の 1 フレームを描いた直後に 1 度だけ。 */
  firstFrameReady(): void {
    if (this.firstFrameSent) return;
    this.firstFrameSent = true;
    try {
      this.sdk?.game.firstFrameReady();
    } catch {
      /* Playables の外では何もしない */
    }
  }

  /** 操作を受け付けられる状態になったら 1 度だけ。 */
  gameReady(): void {
    if (this.gameReadySent) return;
    this.gameReadySent = true;
    try {
      this.sdk?.game.gameReady();
    } catch {
      /* 同上 */
    }
  }

  onPause(cb: () => void): void {
    try {
      this.sdk?.system.onPause(cb);
    } catch {
      /* 同上 */
    }
  }

  onResume(cb: () => void): void {
    try {
      this.sdk?.system.onResume(cb);
    } catch {
      /* 同上 */
    }
  }

  /**
   * YouTube プレーヤー側で音が有効か。
   * SDK が無い環境では「有効」として扱い、ゲーム内の設定に任せる。
   */
  isAudioEnabled(): boolean {
    try {
      return this.sdk ? this.sdk.system.isAudioEnabled() : true;
    } catch {
      return true;
    }
  }

  onAudioEnabledChange(cb: (enabled: boolean) => void): void {
    try {
      this.sdk?.system.onAudioEnabledChange(cb);
    } catch {
      /* 同上 */
    }
  }

  /** スコアを YouTube に送る。 */
  sendScore(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    try {
      void this.sdk?.engagement.sendScore({ value: Math.round(value) })?.catch(() => undefined);
    } catch {
      /* 同上 */
    }
  }

  /** セーブ。Playables があればクラウド、無ければ localStorage。 */
  async save(data: SaveData): Promise<void> {
    const json = JSON.stringify(data);
    if (!isWellFormedUtf16(json)) return;
    if (this.sdk) {
      try {
        await withTimeout(this.sdk.game.saveData(json), 2000);
        return;
      } catch {
        /* クラウドに書けなければローカルへ落とす */
      }
    }
    try {
      window.localStorage.setItem(LOCAL_KEY, json);
    } catch {
      /* プライベートモードなどでは保存しない */
    }
  }

  /** ロード。壊れていたら既定値を返す。 */
  async load(): Promise<SaveData> {
    let json: string | null = null;
    if (this.sdk) {
      try {
        json = await withTimeout(this.sdk.game.loadData(), 1500);
      } catch {
        json = null;
      }
    }
    if (!json) {
      try {
        json = window.localStorage.getItem(LOCAL_KEY);
      } catch {
        json = null;
      }
    }
    if (!json) return { ...DEFAULT_SAVE };
    try {
      const parsed = JSON.parse(json) as Partial<SaveData>;
      return {
        best: typeof parsed.best === 'number' ? parsed.best : DEFAULT_SAVE.best,
        bestStage: typeof parsed.bestStage === 'number' ? parsed.bestStage : DEFAULT_SAVE.bestStage,
        muted: typeof parsed.muted === 'boolean' ? parsed.muted : DEFAULT_SAVE.muted,
        crt: typeof parsed.crt === 'boolean' ? parsed.crt : DEFAULT_SAVE.crt,
        stickMode: typeof parsed.stickMode === 'boolean' ? parsed.stickMode : DEFAULT_SAVE.stickMode,
        swipeDodge:
          typeof parsed.swipeDodge === 'boolean' ? parsed.swipeDodge : DEFAULT_SAVE.swipeDodge,
      };
    } catch {
      return { ...DEFAULT_SAVE };
    }
  }
}

export const playables = new PlayablesBridge();
