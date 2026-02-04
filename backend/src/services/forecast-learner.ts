/**
 * 自動学習エンジン（forecast-learner.ts）
 *
 * ── 概要 ──
 * 「予測 → 実績 → 比較 → パラメータ調整 → 次回予測に反映」の
 * フィードバックループを自動で回すシステム。
 *
 * 毎日の同期ジョブ（runDailySync）の最後に学習を実行し、
 * 次回の executeForecast() 時に学習済みパラメータを自動適用する。
 *
 * ── 学習対象パラメータ ──
 * 1. biasCorrection    — 予測が常に多い/少ない傾向を補正（0.8〜1.2）
 * 2. safetyMultiplier  — 欠品頻度に応じて安全在庫を調整（0.5〜2.0）
 * 3. bestLookbackDays  — 最も精度が高かった参照日数（14/28/42/56）
 * 4. dowReliability    — 曜日パターンの信頼度（低い→単純平均に寄せる）
 *
 * ── 設計原則 ──
 * - MLフレームワーク不要（純粋なTypeScript）
 * - 小さな段階的調整（急激な変化を防ぐダンパー付き）
 * - 全てが説明可能（ブラックボックスなし）
 * - 最低3週間分の履歴が貯まるまでは学習を適用しない
 *
 * ── DBテーブル ──
 * forecast_snapshots       予測結果のスナップショット（後で実績と比較）
 * forecast_accuracy        商品×店舗別の精度メトリクス
 * product_forecast_params  学習済みパラメータ（予測時に参照）
 */

import { supabase } from '../config/supabase';
import type {
  ForecastSnapshot as DBForecastSnapshot,
  ForecastAccuracy,
  ProductForecastParams,
  SalesDailySummary,
  StockCache,
} from '../types/database';

// ════════════════════════════════════════════════
// 型定義
// ════════════════════════════════════════════════

/** 商品×店舗ごとの学習済みパラメータ */
export interface LearnedParams {
  productId: string;
  storeId: string;
  biasCorrection: number;      // 1.0 = 補正なし, 0.9 = 10%下方修正
  safetyMultiplier: number;    // 1.0 = デフォルト, 1.5 = 安全在庫50%増
  bestLookbackDays: number;    // 最も精度が高かった参照日数
  dowReliability: number;      // 0.0〜1.0（曜日パターンの信頼度）
  weeklyMape: number;          // 直近の週次MAPE
  weeklyBias: number;          // 直近の予測バイアス（+: 過大, -: 過小）
  stockoutRate7d: number;      // 直近7日の欠品率
  learningCycles: number;      // 学習回数
  lastLearnedAt: string;       // 最終学習日時
}

/** 予測スナップショット（1商品1回分） */
interface ForecastSnapshot {
  store_id: string;
  product_id: string;
  forecast_date: string;       // 予測を実行した日
  period_start: string;        // 予測対象期間の開始日
  period_end: string;          // 予測対象期間の終了日
  predicted_quantity: number;  // 予測数量
  lookback_days: number;
  algorithm: string;
  abc_rank: string;
  safety_stock: number;
  recommended_order: number;
}

/** 精度計算の結果 */
interface AccuracyMetrics {
  productId: string;
  storeId: string;
  periodStart: string;
  periodEnd: string;
  predicted: number;
  actual: number;
  error: number;               // actual - predicted
  absError: number;
  mape: number;                // |error| / actual（actual>0の場合）
  bias: number;                // (predicted - actual) / actual
}

// ════════════════════════════════════════════════
// 定数
// ════════════════════════════════════════════════

/** パラメータの変動制限（急激な変化を防ぐ） */
const DAMPER = 0.15;             // 1回の学習で最大15%の変動
const MIN_BIAS = 0.80;           // バイアス補正の下限
const MAX_BIAS = 1.20;           // バイアス補正の上限
const MIN_SAFETY_MULT = 0.5;     // 安全在庫倍率の下限
const MAX_SAFETY_MULT = 2.0;     // 安全在庫倍率の上限
const MIN_LEARNING_WEEKS = 3;    // 学習を適用するまでの最低週数
const LOOKBACK_CANDIDATES = [14, 28, 42, 56]; // テストする参照日数

/** テーブル名 */
const T_SNAPSHOTS = 'forecast_snapshots';
const T_ACCURACY = 'forecast_accuracy';
const T_PARAMS = 'product_forecast_params';

// ════════════════════════════════════════════════
// 1. 予測スナップショットの保存
// ════════════════════════════════════════════════

/**
 * executeForecast() の結果をスナップショットとして保存する。
 * forecast.ts の /calculate エンドポイント成功時に呼ぶ。
 */
export async function saveForecastSnapshot(
  storeId: string,
  forecastDate: string,
  forecastDays: number,
  lookbackDays: number,
  products: Array<{
    productId: string;
    forecastQuantity: number;
    algorithm: string;
    abcRank: string;
    safetyStock: number;
    recommendedOrder: number;
  }>,
): Promise<void> {
  const periodStart = forecastDate;
  const periodEnd = addDaysStr(forecastDate, forecastDays - 1);

  const rows: ForecastSnapshot[] = products.map((p) => ({
    store_id: storeId,
    product_id: p.productId,
    forecast_date: forecastDate,
    period_start: periodStart,
    period_end: periodEnd,
    predicted_quantity: p.forecastQuantity,
    lookback_days: lookbackDays,
    algorithm: p.algorithm,
    abc_rank: p.abcRank,
    safety_stock: p.safetyStock,
    recommended_order: p.recommendedOrder,
  }));

  // 500件ずつ upsert（同じ store+product+forecast_date は上書き）
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await supabase
      .from(T_SNAPSHOTS)
      .upsert(chunk, { onConflict: 'store_id,product_id,forecast_date' });
    if (error) {
      console.error('[Learner] スナップショット保存エラー:', error.message);
    }
  }

  console.log(`[Learner] スナップショット保存: ${rows.length}商品, ${periodStart}〜${periodEnd}`);
}

// ════════════════════════════════════════════════
// 2. 精度計算 — 過去の予測 vs 実績を比較
// ════════════════════════════════════════════════

/**
 * 指定日に「予測対象期間が完了した」スナップショットを取得し、
 * 実績売上と比較して精度メトリクスを計算する。
 *
 * 例: 1/15に「1/15〜1/21」の予測を保存 → 1/22以降にこの予測の精度を評価
 */
export async function calculateAccuracy(
  evaluationDate: string,
): Promise<AccuracyMetrics[]> {
  console.log(`[Learner] 精度評価開始: ${evaluationDate}`);

  // 予測対象期間が完了したスナップショットを取得
  // period_end < evaluationDate のもの（まだ評価していないもの）
  const { data: snapshots, error: snapErr } = await supabase
    .from(T_SNAPSHOTS)
    .select('*')
    .lt('period_end', evaluationDate)
    .eq('evaluated', false)
    .limit(2000);

  if (snapErr) {
    console.error('[Learner] スナップショット取得エラー:', snapErr.message);
    return [];
  }
  if (!snapshots || snapshots.length === 0) {
    console.log('[Learner] 未評価のスナップショットなし');
    return [];
  }

  console.log(`[Learner] 評価対象スナップショット: ${snapshots.length}件`);

  // 実績売上を取得
  const metrics: AccuracyMetrics[] = [];

  // ══════════════════════════════════════════════════════════════
  // N+1問題解消: 全商品の実績売上を一括取得
  // ══════════════════════════════════════════════════════════════

  // 1. 全商品IDと期間の範囲を収集
  const allProductIds = [...new Set(snapshots.map((s: any) => s.product_id))];
  const allPeriodStarts = snapshots.map((s: any) => s.period_start);
  const allPeriodEnds = snapshots.map((s: any) => s.period_end);
  const minPeriodStart = allPeriodStarts.reduce((a, b) => a < b ? a : b);
  const maxPeriodEnd = allPeriodEnds.reduce((a, b) => a > b ? a : b);
  const allStoreIds = [...new Set(snapshots.map((s: any) => s.store_id))];

  // 2. 一括で実績売上を取得（100件ずつチャンク）
  let allActualSales: Array<{
    product_id: string;
    store_id: string;
    sale_date: string;
    total_quantity: number;
  }> = [];

  for (const storeId of allStoreIds) {
    for (let i = 0; i < allProductIds.length; i += 100) {
      const chunk = allProductIds.slice(i, i + 100);
      const { data } = await supabase
        .from('sales_daily_summary')
        .select('product_id, store_id, sale_date, total_quantity')
        .eq('store_id', storeId)
        .in('product_id', chunk)
        .gte('sale_date', minPeriodStart)
        .lte('sale_date', maxPeriodEnd);
      if (data) allActualSales = allActualSales.concat(data);
    }
  }

  console.log(`[Learner] 実績売上データ取得: ${allActualSales.length}件`);

  // 3. store×product×期間でグルーピング
  const groups = new Map<string, typeof snapshots>();
  snapshots.forEach((s: any) => {
    const key = `${s.store_id}|${s.period_start}|${s.period_end}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  });

  // 4. 各グループの精度を計算
  for (const [key, snaps] of groups) {
    const [storeId, periodStart, periodEnd] = key.split('|');

    // このグループに該当する売上データをフィルタリング
    const groupSales = allActualSales.filter(s =>
      s.store_id === storeId &&
      s.sale_date >= periodStart &&
      s.sale_date <= periodEnd
    );

    // 商品別合計
    const actualMap = new Map<string, number>();
    groupSales.forEach((s) => {
      const pid = String(s.product_id);
      actualMap.set(pid, (actualMap.get(pid) || 0) + (Number(s.total_quantity) || 0));
    });

    // 精度計算
    snaps.forEach((snap: any) => {
      const actual = actualMap.get(snap.product_id) || 0;
      const predicted = snap.predicted_quantity || 0;
      const error = actual - predicted;
      const absError = Math.abs(error);
      const mape = actual > 0 ? absError / actual : (predicted > 0 ? 1.0 : 0);
      const bias = actual > 0 ? (predicted - actual) / actual : 0;

      metrics.push({
        productId: snap.product_id,
        storeId: snap.store_id,
        periodStart: snap.period_start,
        periodEnd: snap.period_end,
        predicted,
        actual,
        error,
        absError,
        mape: round(mape, 4),
        bias: round(bias, 4),
      });
    });
  }

  // 精度結果を保存
  if (metrics.length > 0) {
    const rows = metrics.map((m) => ({
      store_id: m.storeId,
      product_id: m.productId,
      period_start: m.periodStart,
      period_end: m.periodEnd,
      predicted: m.predicted,
      actual: m.actual,
      error: m.error,
      abs_error: m.absError,
      mape: m.mape,
      bias: m.bias,
      evaluated_at: new Date().toISOString(),
    }));

    for (let i = 0; i < rows.length; i += 500) {
      await supabase.from(T_ACCURACY).upsert(
        rows.slice(i, i + 500),
        { onConflict: 'store_id,product_id,period_start' },
      );
    }

    // スナップショットに「評価済み」フラグを立てる
    const snapIds = snapshots.map((s: any) => s.id).filter(Boolean);
    if (snapIds.length > 0) {
      for (let i = 0; i < snapIds.length; i += 500) {
        await supabase
          .from(T_SNAPSHOTS)
          .update({ evaluated: true })
          .in('id', snapIds.slice(i, i + 500));
      }
    }
  }

  console.log(`[Learner] 精度評価完了: ${metrics.length}件, 平均MAPE: ${
    metrics.length > 0
      ? round(metrics.reduce((s, m) => s + m.mape, 0) / metrics.length * 100, 1)
      : 0
  }%`);

  return metrics;
}

// ════════════════════════════════════════════════
// 3. パラメータ学習 — 精度履歴から最適パラメータを算出
// ════════════════════════════════════════════════

/**
 * 精度履歴（forecast_accuracy）を読み、
 * 商品×店舗ごとの最適パラメータを計算・保存する。
 */
export async function learnParameters(storeId?: string): Promise<{
  updated: number;
  skipped: number;
  avgMapeImprovement: number;
}> {
  console.log('[Learner] パラメータ学習開始...');

  // 直近8週間の精度データを取得（ページネーション対応）
  // Supabaseのmax_rows制限（デフォルト1000）を回避
  const eightWeeksAgo = addDaysStr(todayJST(), -56);
  const PAGE_SIZE = 1000;
  let accuracyData: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from(T_ACCURACY)
      .select('*')
      .gte('period_start', eightWeeksAgo)
      .order('period_start', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (storeId) query = query.eq('store_id', storeId);

    const { data, error } = await query;
    if (error) {
      console.error('[Learner] 精度データ取得エラー:', error.message);
      return { updated: 0, skipped: 0, avgMapeImprovement: 0 };
    }

    if (data && data.length > 0) {
      accuracyData.push(...data);
      offset += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  if (accuracyData.length === 0) {
    console.log('[Learner] 精度データなし — 学習スキップ');
    return { updated: 0, skipped: 0, avgMapeImprovement: 0 };
  }

  // 商品×店舗ごとにグルーピング
  const groups = new Map<string, any[]>();
  accuracyData.forEach((row: any) => {
    const key = `${row.store_id}|${row.product_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  });

  // 既存パラメータを取得（ページネーション対応）
  let existingParams: any[] = [];
  let paramOffset = 0;
  let paramHasMore = true;

  while (paramHasMore) {
    const { data, error: paramError } = await supabase
      .from(T_PARAMS)
      .select('*')
      .range(paramOffset, paramOffset + PAGE_SIZE - 1);

    if (paramError) {
      console.error('[Learner] パラメータ取得エラー:', paramError.message);
      break;
    }

    if (data && data.length > 0) {
      existingParams.push(...data);
      paramOffset += PAGE_SIZE;
      paramHasMore = data.length === PAGE_SIZE;
    } else {
      paramHasMore = false;
    }
  }

  const paramMap = new Map<string, any>();
  existingParams.forEach((p: any) => {
    paramMap.set(`${p.store_id}|${p.product_id}`, p);
  });

  // ══════════════════════════════════════════════════════════════
  // N+1問題解消: 全商品の在庫データを一括取得
  // ══════════════════════════════════════════════════════════════
  const allKeys = Array.from(groups.keys());
  const productStoreMap = new Map<string, { storeId: string; productId: string }>();
  allKeys.forEach(key => {
    const [storeId, productId] = key.split('|');
    productStoreMap.set(key, { storeId, productId });
  });

  // 店舗×商品の組み合わせで在庫を一括取得
  const stockDataMap = new Map<string, number>();
  const storeProductGroups = new Map<string, string[]>();

  allKeys.forEach(key => {
    const [storeId, productId] = key.split('|');
    if (!storeProductGroups.has(storeId)) storeProductGroups.set(storeId, []);
    storeProductGroups.get(storeId)!.push(productId);
  });

  for (const [storeId, productIds] of storeProductGroups) {
    for (let i = 0; i < productIds.length; i += 100) {
      const chunk = productIds.slice(i, i + 100);
      const { data: stockBatch } = await supabase
        .from('stock_cache')
        .select('product_id, stock_amount')
        .eq('store_id', storeId)
        .in('product_id', chunk);

      (stockBatch || []).forEach((row: any) => {
        stockDataMap.set(`${storeId}|${row.product_id}`, row.stock_amount || 0);
      });
    }
  }

  console.log(`[Learner] 在庫データ一括取得: ${stockDataMap.size}件`);
  // ══════════════════════════════════════════════════════════════

  const upsertRows: any[] = [];
  let skipped = 0;
  let totalMapeImproved = 0;

  for (const [key, records] of groups) {
    const [sid, pid] = key.split('|');

    // 最低3週間分のデータが必要
    const uniqueWeeks = new Set(records.map((r: any) => r.period_start?.slice(0, 10)));
    if (uniqueWeeks.size < MIN_LEARNING_WEEKS) {
      skipped++;
      continue;
    }

    const existing = paramMap.get(key);
    const prevBias = existing?.bias_correction || 1.0;
    const prevSafety = existing?.safety_multiplier || 1.0;
    const prevLookback = existing?.best_lookback_days || 28;
    const prevCycles = existing?.learning_cycles || 0;

    // ── 3a. バイアス補正を計算 ──
    // 直近4週のバイアス（予測が多い: +, 予測が少ない: -）の加重平均
    const recentRecords = records.slice(-4);
    const biases = recentRecords.map((r: any) => r.bias || 0);
    const avgBias = biases.reduce((a: number, b: number) => a + b, 0) / biases.length;

    // バイアスが大きい場合のみ補正（ノイズ耐性）
    let newBiasCorrection = prevBias;
    if (Math.abs(avgBias) > 0.10) {
      // 過大予測(avgBias > 0) → biasCorrection を下げる
      // 過小予測(avgBias < 0) → biasCorrection を上げる
      const adjustment = -avgBias * DAMPER;
      newBiasCorrection = clamp(prevBias + adjustment, MIN_BIAS, MAX_BIAS);
    }

    // ── 3b. 安全在庫倍率を計算 ──
    // 在庫データは事前に一括取得済み
    const currentStock = stockDataMap.get(key) || 0;
    const recentActuals = recentRecords.map((r: any) => r.actual || 0);
    const avgActual = recentActuals.reduce((a: number, b: number) => a + b, 0) / recentActuals.length;
    const avgDaily = avgActual / 7; // 週→日

    let newSafetyMult = prevSafety;
    if (avgDaily > 0) {
      const stockDays = currentStock / avgDaily;
      if (stockDays < 1) {
        // 欠品気味 → 安全在庫を増やす
        newSafetyMult = clamp(prevSafety + 0.1, MIN_SAFETY_MULT, MAX_SAFETY_MULT);
      } else if (stockDays > 21) {
        // 過剰在庫 → 安全在庫を減らす
        newSafetyMult = clamp(prevSafety - 0.1, MIN_SAFETY_MULT, MAX_SAFETY_MULT);
      }
      // 3〜21日の範囲なら変更なし（安定稼働中）
    }

    // ── 3c. 最適参照日数を選択 ──
    // 各参照日数で過去のMAPEを比較（データがあれば）
    const mapeByLookback = new Map<number, number>();
    for (const lb of LOOKBACK_CANDIDATES) {
      const lbRecords = records.filter((r: any) => r.lookback_days === lb);
      if (lbRecords.length >= 2) {
        const avgMape = lbRecords.reduce((s: number, r: any) => s + (r.mape || 0), 0) / lbRecords.length;
        mapeByLookback.set(lb, avgMape);
      }
    }

    let bestLookback = prevLookback;
    if (mapeByLookback.size > 0) {
      let bestMape = Infinity;
      mapeByLookback.forEach((mape, lb) => {
        if (mape < bestMape) {
          bestMape = mape;
          bestLookback = lb;
        }
      });
    }

    // ── 3d. 曜日パターン信頼度 ──
    // MAPEが低いほど曜日パターンが有効 → 信頼度を上げる
    const recentMapes = recentRecords.map((r: any) => r.mape || 0);
    const avgMape = recentMapes.reduce((a: number, b: number) => a + b, 0) / recentMapes.length;
    const dowReliability = clamp(1.0 - avgMape, 0.0, 1.0);

    // ── 改善量の推定 ──
    const oldMape = records.slice(0, Math.min(3, records.length))
      .reduce((s: number, r: any) => s + (r.mape || 0), 0) / Math.min(3, records.length);
    totalMapeImproved += Math.max(0, oldMape - avgMape);

    upsertRows.push({
      store_id: sid,
      product_id: pid,
      bias_correction: round(newBiasCorrection, 4),
      safety_multiplier: round(newSafetyMult, 4),
      best_lookback_days: bestLookback,
      dow_reliability: round(dowReliability, 4),
      weekly_mape: round(avgMape, 4),
      weekly_bias: round(avgBias, 4),
      stockout_rate_7d: currentStock === 0 && avgDaily > 0 ? 1.0 : 0.0,
      learning_cycles: prevCycles + 1,
      last_learned_at: new Date().toISOString(),
    });
  }

  // 一括保存（並列化で高速化）
  if (upsertRows.length > 0) {
    const upsertBatch = async (batch: typeof upsertRows): Promise<void> => {
      const { error } = await supabase.from(T_PARAMS).upsert(batch, {
        onConflict: 'store_id,product_id',
      });
      if (error) console.error('[Learner] パラメータ保存エラー:', error.message);
    };

    // 最大3並列で実行
    const PARALLEL_LIMIT = 3;
    const BATCH_SIZE = 500;
    for (let i = 0; i < upsertRows.length; i += BATCH_SIZE * PARALLEL_LIMIT) {
      const batchPromises: Promise<void>[] = [];
      for (let j = 0; j < PARALLEL_LIMIT && i + j * BATCH_SIZE < upsertRows.length; j++) {
        const start = i + j * BATCH_SIZE;
        const batch = upsertRows.slice(start, start + BATCH_SIZE);
        batchPromises.push(upsertBatch(batch));
      }
      await Promise.all(batchPromises);
    }
  }

  const avgImprovement = upsertRows.length > 0
    ? round((totalMapeImproved / upsertRows.length) * 100, 1)
    : 0;

  console.log(`[Learner] 学習完了: ${upsertRows.length}商品更新, ${skipped}スキップ, 平均改善: ${avgImprovement}%`);

  return {
    updated: upsertRows.length,
    skipped,
    avgMapeImprovement: avgImprovement,
  };
}

// ════════════════════════════════════════════════
// 4. 学習済みパラメータの取得（予測時に呼ばれる）
// ════════════════════════════════════════════════

/**
 * forecast-engine.ts から呼ばれる。
 * 学習済みパラメータがあれば返す。なければデフォルト値。
 */
export async function getLearnedParams(
  storeId: string,
  productIds: string[],
): Promise<Map<string, LearnedParams>> {
  const result = new Map<string, LearnedParams>();

  if (productIds.length === 0) return result;

  for (let i = 0; i < productIds.length; i += 100) {
    const chunk = productIds.slice(i, i + 100);
    const { data } = await supabase
      .from(T_PARAMS)
      .select('*')
      .eq('store_id', storeId)
      .in('product_id', chunk);

    (data || []).forEach((row: any) => {
      result.set(row.product_id, {
        productId: row.product_id,
        storeId: row.store_id,
        biasCorrection: row.bias_correction ?? 1.0,
        safetyMultiplier: row.safety_multiplier ?? 1.0,
        bestLookbackDays: row.best_lookback_days ?? 28,
        dowReliability: row.dow_reliability ?? 1.0,
        weeklyMape: row.weekly_mape ?? 0,
        weeklyBias: row.weekly_bias ?? 0,
        stockoutRate7d: row.stockout_rate_7d ?? 0,
        learningCycles: row.learning_cycles ?? 0,
        lastLearnedAt: row.last_learned_at ?? '',
      });
    });
  }

  return result;
}

// ════════════════════════════════════════════════
// 5. 日次学習ジョブ（runDailySyncから呼ばれる）
// ════════════════════════════════════════════════

/**
 * 毎日の同期後に呼ばれるメインエントリポイント。
 * 1. 過去の予測精度を評価
 * 2. パラメータを再学習
 * 3. 結果をログ出力
 */
export async function runDailyLearning(): Promise<{
  accuracy: { evaluated: number; avgMape: number };
  learning: { updated: number; skipped: number; avgMapeImprovement: number };
}> {
  console.log('🧠 === 自動学習ジョブ開始 ===');
  const today = todayJST();

  // Step 1: 精度評価
  const metrics = await calculateAccuracy(today);
  const avgMape = metrics.length > 0
    ? round(metrics.reduce((s, m) => s + m.mape, 0) / metrics.length * 100, 1)
    : 0;

  // Step 2: パラメータ学習
  const learningResult = await learnParameters();

  console.log('🧠 === 自動学習ジョブ完了 ===');
  console.log(`   精度評価: ${metrics.length}件, 平均MAPE: ${avgMape}%`);
  console.log(`   パラメータ更新: ${learningResult.updated}件`);
  console.log(`   平均改善: ${learningResult.avgMapeImprovement}%`);

  return {
    accuracy: { evaluated: metrics.length, avgMape },
    learning: learningResult,
  };
}

// ════════════════════════════════════════════════
// 6. 精度ダッシュボード用データ取得
// ════════════════════════════════════════════════

/** 精度サマリーを取得（ダッシュボード表示用） */
export async function getAccuracySummary(storeId: string): Promise<{
  overall: { mape: number; bias: number; count: number };
  byRank: Record<string, { mape: number; count: number }>;
  trend: Array<{ week: string; mape: number }>;
  topImproved: Array<{ productId: string; productName: string; mapeChange: number }>;
  topWorsened: Array<{ productId: string; productName: string; mapeChange: number }>;
}> {
  const eightWeeksAgo = addDaysStr(todayJST(), -56);

  // ページネーション対応でデータを取得
  // Supabaseのmax_rows制限（デフォルト1000）を回避
  const PAGE_SIZE = 1000;
  let accuracyData: any[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await supabase
      .from(T_ACCURACY)
      .select('*, forecast_snapshots!inner(abc_rank)')
      .eq('store_id', storeId)
      .gte('period_start', eightWeeksAgo)
      .order('period_start', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('[Learner] 精度サマリー取得エラー:', error.message);
      break;
    }

    if (data && data.length > 0) {
      accuracyData.push(...data);
      offset += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }

  if (accuracyData.length === 0) {
    return {
      overall: { mape: 0, bias: 0, count: 0 },
      byRank: {},
      trend: [],
      topImproved: [],
      topWorsened: [],
    };
  }

  // 全体平均
  const mapes = accuracyData.map((d: any) => d.mape || 0);
  const biases = accuracyData.map((d: any) => d.bias || 0);
  const overall = {
    mape: round(mapes.reduce((a: number, b: number) => a + b, 0) / mapes.length * 100, 1),
    bias: round(biases.reduce((a: number, b: number) => a + b, 0) / biases.length * 100, 1),
    count: accuracyData.length,
  };

  // ランク別
  const byRank: Record<string, { mape: number; count: number }> = {};
  const rankGroups = new Map<string, number[]>();
  accuracyData.forEach((d: any) => {
    const rank = d.forecast_snapshots?.abc_rank || 'E';
    if (!rankGroups.has(rank)) rankGroups.set(rank, []);
    rankGroups.get(rank)!.push(d.mape || 0);
  });
  rankGroups.forEach((mapes, rank) => {
    byRank[rank] = {
      mape: round(mapes.reduce((a, b) => a + b, 0) / mapes.length * 100, 1),
      count: mapes.length,
    };
  });

  // 週次トレンド
  const weeklyGroups = new Map<string, number[]>();
  accuracyData.forEach((d: any) => {
    const week = d.period_start?.slice(0, 10) || '';
    if (!weeklyGroups.has(week)) weeklyGroups.set(week, []);
    weeklyGroups.get(week)!.push(d.mape || 0);
  });
  const trend = Array.from(weeklyGroups.entries())
    .map(([week, mapes]) => ({
      week,
      mape: round(mapes.reduce((a, b) => a + b, 0) / mapes.length * 100, 1),
    }))
    .sort((a, b) => a.week.localeCompare(b.week));

  return {
    overall,
    byRank,
    trend,
    topImproved: [], // 将来: learning_cyclesが増えた商品のMAPE変化を追跡
    topWorsened: [],
  };
}

// ════════════════════════════════════════════════
// ユーティリティ
// ════════════════════════════════════════════════

function todayJST(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split('T')[0];
}

function addDaysStr(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}
