import type { GameState } from '../sim/types';

/** 画面キーの判定に必要な最小限の情報。 */
export interface ScreenKeySource {
  state: GameState;
  level: number;
  pendingLevels: number;
  stageId: number;
}

/**
 * いま表示すべきオーバーレイのキー。
 *
 * Ui はこのキーが変わったときだけ描き直す。
 * 「画面が開いているかどうか」で判定すると、レベルアップ → ステージクリアのように
 * オーバーレイからオーバーレイへ移るときに描き直しが飛ばされて操作不能になる。
 */
export function screenKey(w: ScreenKeySource): string {
  switch (w.state) {
    // 連続レベルアップでも引き直した 3 択が出るように残数を含める
    case 'levelup':
      return `levelup:${w.level}:${w.pendingLevels}`;
    case 'stageclear':
      return `stageclear:${w.stageId}`;
    case 'gameover':
      return 'gameover';
    case 'gameclear':
      return 'gameclear';
    default:
      return 'none';
  }
}
