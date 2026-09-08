/**
 * 仕様書の数値をすべて「フレーム」で確定させる定数群。
 * ロジックは 60Hz 固定ステップなので、0.12 秒 = 7F、0.15 秒 = 9F のように
 * 実数を持ち込まずに判定できる。【仮】値は PROTO_ で始まるコメントを付けている。
 */

/** ロジック更新レート（Hz）。描画は可変。 */
export const TICK_RATE = 60;
/** 1 フレームの秒数。演出の時間換算にのみ使う。 */
export const DT = 1 / TICK_RATE;

/** 秒をフレームに変換（定義用のヘルパー。実行時計算には使わない）。 */
const f = (sec: number): number => Math.round(sec * TICK_RATE);

// ---------------------------------------------------------------- 画面
/** 仮想解像度・横。実画面はこれをスケールして表示する。 */
export const VIEW_W = 360;
/** 仮想解像度・縦。 */
export const VIEW_H = 640;

// ---------------------------------------------------------------- 自機
export const PLAYER_RADIUS = 5;
/** 見た目の当たり判定より小さい「被弾判定」。STG の作法。 */
export const PLAYER_HIT_RADIUS = 3.2;
export const PLAYER_START_X = VIEW_W / 2;
export const PLAYER_START_Y = VIEW_H * 0.78;
/**
 * ドラッグ追従の倍率（指の移動量に対する自機の移動量）。
 * 1.0 = 指の動きと自機の動きが 1:1。ここを上げるほど「滑る」感触になるので、
 * ダイレクト感を優先して等倍にしている。移動速度の強化は stats.moveSpeed 側で乗る。
 */
export const PLAYER_DRAG_GAIN = 1.0;
/** 被弾後の無敵。 */
export const PLAYER_HIT_INVULN = f(1.2);
/** 初期残機。プロトタイプは「触って評価できる」ことを優先して多めにしている。 */
export const START_LIVES = 4;

// ---------------------------------------------------------------- 回避（フリック）
/** 回避モーション全体：0.3 秒 = 18F【仮】 */
export const FLICK_DURATION = f(0.3);
/** 開始直後の無敵：0.12 秒 = 7F【仮】 */
export const FLICK_IFRAMES = f(0.12);
/** 固定距離：画面幅の 25%【仮】 */
export const FLICK_DISTANCE = VIEW_W * 0.25;
/** スタミナ上限【仮】 */
export const STAMINA_MAX = 3;
/** スタミナ 1 個あたりの自動回復：4 秒【仮】 */
export const STAMINA_REGEN = f(4);
/** ジャスト成立判定に使う自機の当たり半径（弾との重なり判定）。 */
export const JUST_RADIUS_BASE = 11;
// ---------------------------------------------------------------- 仮想スティック
/** スティックを倒しきる距離（仮想座標）。 */
export const STICK_MAX_R = 44;
/** 反応しない中心の遊び（仮想座標）。 */
export const STICK_DEADZONE = 5;
/** 倒しきったときの移動速度（仮想座標／フレーム）。stats.moveSpeed が乗る。 */
export const STICK_SPEED = 5.4;

/** スワイプを回避入力とみなす最小距離（仮想座標）。通常移動での暴発を避けて広めに取る。 */
export const FLICK_SWIPE_DIST = 34;

/**
 * 回避中に敵弾を弾き飛ばす通路の半径。
 * ここを広げるほど「回避＝安全地帯」に寄って、飛び込むリスクが薄くなる。
 */
export const DODGE_DEFLECT_R = 18;
/** 弾かれた弾が無害でいるフレーム数（この間に自機から離れる）。 */
export const DODGE_DEFLECT_FRAMES = f(0.4);
/** 弾かれた弾の最低速度。 */
export const DODGE_DEFLECT_SPEED = 3.6;
/** スワイプ判定に使う入力履歴の長さ（フレーム）。 */
export const FLICK_SWIPE_WINDOW = f(0.12);

// ---------------------------------------------------------------- バフ「瞬炎」
/** 持続 3 秒。連続成功で延長のみ（重ねがけなし）【仮】 */
export const SHUNEN_DURATION = f(3);
export const SHUNEN_ATK_MUL = 1.6;
export const SHUNEN_RATE_MUL = 1.7;

// ---------------------------------------------------------------- 溜め（指離し）
/** 誤タッチ閾値：0.15 秒 = 9F【仮】 */
export const CHARGE_COMMIT = f(0.15);
/** 段階しきい値：1 秒 / 2 秒 / 3.5 秒【仮】 */
export const CHARGE_STAGES: readonly number[] = [f(1), f(2), f(3.5)];
export const CHARGE_MAX = CHARGE_STAGES[CHARGE_STAGES.length - 1];
/** フリック直後は解放ボタンを無効化：0.1 秒【仮】 */
export const RELEASE_LOCK_AFTER_FLICK = f(0.1);
/** 臨界共鳴：ビーム持続。 */
export const RESONANCE_BEAM_FRAMES = f(0.45);
/** 段階別のビーム半幅。 */
export const RESONANCE_BEAM_HALFW: readonly number[] = [14, 26, 44];
/** 段階別の衝撃波半径（敵へのダメージ範囲）。 */
export const RESONANCE_SHOCK_R: readonly number[] = [66, 108, 170];
/**
 * 弾消しはダメージ範囲より狭くする。
 * 解放のたびに全画面の弾が消えると「静止のリスク」が丸ごと無くなるため。
 */
export const RESONANCE_CLEAR_RATIO = 0.55;
/** 段階別のビーム毎フレームダメージ。 */
export const RESONANCE_BEAM_DPF: readonly number[] = [2.2, 4.0, 7.5];
/** 段階 1 では弾消しなし、2 以降で衝撃波が敵弾を消す。 */
export const RESONANCE_CLEARS_BULLETS: readonly boolean[] = [false, true, true];

// ---------------------------------------------------------------- 演出
/** ジャスト回避のヒットストップ：0.05 秒 = 3F */
export const HITSTOP_JUST = f(0.05);
/**
 * ジャスト成立後のスローモーション。
 * ヒットストップだけだと「止まって終わり」なので、直後に一拍スローを入れて
 * 「切り抜けた」を見せる。ロジックのフレーム数で数えるので決定論は保たれる。
 */
export const JUST_SLOWMO = f(0.22);
/** スロー中の時間の進み方。 */
export const JUST_SLOWMO_SCALE = 0.38;
/** 瞬炎が切れるとジャストの連続数はリセットされる。 */
export const JUST_COMBO_MAX = 9;
export const HITSTOP_RESONANCE = f(0.08);

// ---------------------------------------------------------------- ジェム / レベル
export const GEM_MAGNET_R = 52;
export const GEM_PICK_R = 12;
/**
 * レベル N → N+1 に必要な経験値。
 * ローグライトとして「1 プレイで 15〜20 回は 3 択を引く」density を狙っている。
 * ボット検証（tests/balance.ts）でステージ 2 終了時に Lv17 前後になる曲線。
 */
export const expToNext = (level: number): number => Math.round(6 + level * 1.2);

// ---------------------------------------------------------------- 熟練度【仮】
/** 特殊進化の出現条件：ジャスト成功回数。 */
export const MASTERY_JUST_MIN = 10;
/** 特殊進化の出現条件：ジャスト成功率。 */
export const MASTERY_JUST_RATE = 0.5;
/** 特殊進化の出現条件：段階 3 での解放回数。 */
export const MASTERY_MAXCHARGE_MIN = 4;

/**
 * チャージ速度倍率の上限。
 * コンデンサー・オメガカノン・オーバードライブが素直に乗算すると 10 倍を超え、
 * 段階 3 が 0.3 秒で溜まって「静止のリスク」が消えてしまうため蓋をする。
 */
export const CHARGE_RATE_CAP = 3.2;
