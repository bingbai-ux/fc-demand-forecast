/**
 * 需要予測エンジン（統合版）
 *
 * ── 設計方針 ──
 * 1. 全DBクエリにページネーション（Supabase 1000行制限対応）
 * 2. 曜日別需要パターン（加重曜日インデックス法）— 食品小売で最も効果的
 * 3. ABC分析は1回だけ計算し、全箇所で同じランクを使用
 * 4. 安全在庫は計算にも表示にも同じ値を使用（二重人格の解消）
 * 5. JSTタイムゾーン統一
 *
 * ── 発注数の計算式 ──
 *   recommended = max(0, ceil(
 *     (forecast_demand + lead_time_demand + safety_stock - current_stock) / lot
 *   )) × lot
 *
 *   forecast_demand = Σ(base_rate × dow_index[曜日]) for each forecast day
 *   lead_time_demand = avg_daily × lead_time_days
 *   safety_stock = min(z × σ × √LT, max_days × avg_daily)
 */

import { supabase } from '../config/supabase';
import { ABC_RANKS, assignABCRanks, summarizeRanks } from '../config/abc-ranks';
import { getLearnedParams, LearnedParams } from './forecast-learner';
import { DEFAULT_EXCLUDED_CATEGORY_IDS } from '../config/constants';

// ════════════════════════════════════════════════
// 型定義
// ════════════════════════════════════════════════

export interface ForecastConfig {
  storeId: string;
  supplierNames: string[];
  orderDate: string;     // YYYY-MM-DD（JST）
  forecastDays: number;  // デフォルト 7
  lookbackDays: number;  // デフォルト 28
}

export interface ProductForecast {
  productId: string;
  productCode: string;
  productName: string;
  categoryName: string;
  supplierName: string;
  // ABC
  abcRank: string;
  cumulativeRatio: number;
  // 売上実績
  avgDailySales: number;
  stdDevDaily: number;
  // 在庫
  currentStock: number;
  // 予測内訳
  forecastQuantity: number;   // 予測期間需要
  leadTimeDemand: number;     // リードタイム需要
  safetyStock: number;        // 安全在庫
  safetyStockDays: number;    // 安全在庫（日数換算）
  // 発注
  recommendedOrder: number;
  orderAmount: number;        // 原価ベース
  lotSize: number;
  cost: number;
  retailPrice: number;
  // メタ
  rank: string;               // = abcRank（後方互換）
  algorithm: string;          // 'weighted_dow' | 'simple'
  breakdown: string;          // 計算式テキスト
  isActive: boolean;
  // 異常検知
  alertFlags: string[];
  stockDays: number;
  hasAnomaly: boolean;
  anomalySeverity: 'high' | 'medium' | 'low' | null;
  anomalies: string[];        // = alertFlags（後方互換）
  isAnomaly: boolean;         // = hasAnomaly（後方互換）
  // 過去売上（表示用）
  pastSales: { type: 'daily' | 'weekly'; data: { date?: string; week?: string; qty: number }[] };
}

// ════════════════════════════════════════════════
// JSTユーティリティ
// ════════════════════════════════════════════════

/** 現在日時のJST日付文字列 */
export function todayJST(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().split('T')[0];
}

/** 日付文字列 → 曜日 (0=月, 1=火, ..., 6=日) */
function getDow(dateStr: string): number {
  const d = new Date(dateStr.split('T')[0] + 'T12:00:00Z');
  const js = d.getUTCDay(); // 0=Sun
  return js === 0 ? 6 : js - 1;
}

/** 日付をN日ずらす */
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr.split('T')[0] + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function round(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

// ════════════════════════════════════════════════
// DB取得（ページネーション付き）
// ════════════════════════════════════════════════

const DB_PAGE = 1000;
const IN_CHUNK = 100; // .in() フィルタの安全なチャンクサイズ

/**
 * ページネーション付き全件取得
 * Supabaseデフォルト1000行制限を回避する。
 *
 * メモリ効率化: concat → push を使用してO(n²)コピーを回避
 */
async function fetchAll<T = any>(
  table: string,
  select: string,
  applyFilters: (q: any) => any,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  while (true) {
    let q = supabase.from(table).select(select);
    q = applyFilters(q);
    const { data, error } = await q.range(offset, offset + DB_PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    // push を使用してメモリ効率を改善（concat は新しい配列を作成する）
    all.push(...(data as T[]));
    if (data.length < DB_PAGE) break;
    offset += DB_PAGE;
  }
  return all;
}

/** product_id の .in() をチャンク分割 + ページネーション */
async function fetchByProductIds<T = any>(
  table: string,
  select: string,
  productIds: string[],
  extraFilters: (q: any) => any,
): Promise<T[]> {
  const all: T[] = [];
  for (let i = 0; i < productIds.length; i += IN_CHUNK) {
    const chunk = productIds.slice(i, i + IN_CHUNK);
    const data = await fetchAll<T>(table, select, (q) =>
      extraFilters(q.in('product_id', chunk)),
    );
    all.push(...data);
  }
  return all;
}

// ════════════════════════════════════════════════
// 曜日別需要予測（加重曜日インデックス法）
// ════════════════════════════════════════════════

/**
 * 曜日インデックスを計算
 * 各曜日の平均売上 / 全体平均 → 1.0が平均
 *
 * 例: [月0.8, 火0.7, 水0.9, 木1.0, 金1.1, 土1.3, 日1.2]
 *     → 土日に売上が集中するパターン
 *
 * @param dailySales Map<日付文字列, 売上個数>
 * @returns [月, 火, 水, 木, 金, 土, 日] の7要素
 */
function calcDowIndices(dailySales: Map<string, number>): number[] {
  const sums = new Array(7).fill(0);
  const counts = new Array(7).fill(0);

  dailySales.forEach((qty, dateStr) => {
    const dow = getDow(dateStr);
    sums[dow] += qty;
    counts[dow]++;
  });

  const avgs = sums.map((s, i) => (counts[i] > 0 ? s / counts[i] : 0));
  const overall = avgs.reduce((a, b) => a + b, 0) / 7;

  if (overall === 0) return new Array(7).fill(1);

  const indices = avgs.map((a) => (a > 0 ? a / overall : 0));

  // パターンが弱い場合（全曜日が0.8〜1.2の範囲内）はフラットに戻す
  const hasPattern = indices.some((idx) => idx > 0 && (idx < 0.75 || idx > 1.25));
  return hasPattern ? indices : new Array(7).fill(1);
}

/**
 * 外れ値を除去する（IQR法）
 * 四分位範囲の1.5倍を超える値を除去
 */
function removeOutliers(values: number[]): number[] {
  if (values.length < 4) return values;

  const sorted = [...values].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;

  return values.filter(v => v >= lowerBound && v <= upperBound);
}

/**
 * トレンド係数を計算（線形回帰の傾き）
 * 1.0 = トレンドなし、>1.0 = 上昇トレンド、<1.0 = 下降トレンド
 */
function calcTrendFactor(dailySales: Map<string, number>, endDate: string, lookbackDays: number): number {
  const values: { x: number; y: number }[] = [];

  for (let i = 0; i < lookbackDays; i++) {
    const dateStr = addDays(endDate, -i);
    const qty = dailySales.get(dateStr) ?? 0;
    values.push({ x: lookbackDays - i, y: qty }); // x: 1=最古, lookbackDays=最新
  }

  if (values.length < 7) return 1.0; // データ不足

  // 線形回帰
  const n = values.length;
  const sumX = values.reduce((s, v) => s + v.x, 0);
  const sumY = values.reduce((s, v) => s + v.y, 0);
  const sumXY = values.reduce((s, v) => s + v.x * v.y, 0);
  const sumX2 = values.reduce((s, v) => s + v.x * v.x, 0);

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgY = sumY / n;

  if (avgY === 0) return 1.0;

  // 傾きを係数に変換（次の期間の予測に適用）
  // 傾きがavgYの10%を超える場合のみトレンドを適用
  const trendStrength = (slope * lookbackDays) / avgY;
  if (Math.abs(trendStrength) < 0.1) return 1.0; // 弱いトレンドは無視

  // トレンド係数を制限（0.7〜1.3の範囲）
  return Math.max(0.7, Math.min(1.3, 1.0 + trendStrength * 0.5));
}

/**
 * 中央値ベースのベースレートを計算（外れ値に頑健）
 */
function calcMedianBaseRate(dailySales: Map<string, number>, endDate: string, lookbackDays: number): number {
  const values: number[] = [];

  for (let i = 0; i < lookbackDays; i++) {
    const dateStr = addDays(endDate, -i);
    const qty = dailySales.get(dateStr) ?? 0;
    values.push(qty);
  }

  // 外れ値を除去
  const cleaned = removeOutliers(values);
  if (cleaned.length === 0) return 0;

  // 中央値を計算
  const sorted = [...cleaned].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

/**
 * 直近 lookbackDays の指数加重平均で「ベースレート」（日販）を計算
 * 新しいデータほど重みが大きい。
 * 改善版：外れ値除去とトレンド反映を追加
 *
 * @param dailySales Map<日付文字列, 売上個数>
 * @param endDate 参照期間の最終日
 * @param lookbackDays 参照日数
 * @param dowIndices 曜日インデックス（季節性を除去して平均化するため）
 */
function calcBaseRate(
  dailySales: Map<string, number>,
  endDate: string,
  lookbackDays: number,
  dowIndices: number[],
): number {
  const alpha = 2 / (lookbackDays + 1); // 指数平滑化係数

  // まず全データを収集
  const dataPoints: { qty: number; dow: number; weight: number }[] = [];
  for (let i = 0; i < lookbackDays; i++) {
    const dateStr = addDays(endDate, -i);
    const qty = dailySales.get(dateStr) ?? 0;
    const dow = getDow(dateStr);
    const weight = Math.pow(1 - alpha, i);
    dataPoints.push({ qty, dow, weight });
  }

  // 外れ値を検出（IQR法）
  const allQtys = dataPoints.map(d => d.qty);
  const cleanedQtys = removeOutliers(allQtys);
  const maxAllowed = cleanedQtys.length > 0 ? Math.max(...cleanedQtys) * 1.5 : Infinity;

  let weightedSum = 0;
  let weightSum = 0;

  for (const dp of dataPoints) {
    // 外れ値は除外（ただしゼロは含める）
    if (dp.qty > maxAllowed) continue;

    const idx = dowIndices[dp.dow] || 1;
    const deseasonalized = idx > 0 ? dp.qty / idx : dp.qty;

    weightedSum += deseasonalized * dp.weight;
    weightSum += dp.weight;
  }

  const baseRate = weightSum > 0 ? weightedSum / weightSum : 0;

  // トレンド係数を適用
  const trendFactor = calcTrendFactor(dailySales, endDate, lookbackDays);

  return baseRate * trendFactor;
}

/**
 * 曜日別予測需要を計算
 * @returns { daily: 各日の予測値, total: 合計 }
 */
function forecastByDow(
  baseRate: number,
  dowIndices: number[],
  startDate: string,
  days: number,
): { daily: number[]; total: number } {
  const daily: number[] = [];
  for (let i = 0; i < days; i++) {
    const dateStr = addDays(startDate, i);
    const dow = getDow(dateStr);
    const predicted = Math.max(0, baseRate * (dowIndices[dow] || 1));
    daily.push(round(predicted, 1));
  }
  const total = round(daily.reduce((a, b) => a + b, 0), 1);
  return { daily, total };
}

// ════════════════════════════════════════════════
// 安全在庫
// ════════════════════════════════════════════════

/**
 * 安全在庫を計算
 *   SS = min(z × σ × √LT, maxDays × avgDaily)
 *
 * @param rank ABCランク
 * @param stdDev 日次需要の標準偏差
 * @param leadTimeDays リードタイム（日）
 * @param avgDailySales 日販
 */
function calcSafetyStock(
  rank: string,
  stdDev: number,
  leadTimeDays: number,
  avgDailySales: number,
): { stock: number; days: number } {
  const cfg = ABC_RANKS[rank] || ABC_RANKS.E;
  if (cfg.safetyZScore === 0) return { stock: 0, days: 0 };

  const statistical = cfg.safetyZScore * stdDev * Math.sqrt(leadTimeDays);
  const cap = cfg.maxSafetyDays * avgDailySales;
  const stock = Math.round(Math.min(statistical, cap));
  const days = avgDailySales > 0 ? round(stock / avgDailySales, 1) : 0;

  return { stock, days };
}

// ════════════════════════════════════════════════
// 異常検知
// ════════════════════════════════════════════════

function detectAnomalies(
  currentStock: number,
  avgDailySales: number,
  pastQtys: number[],
): { alertFlags: string[]; stockDays: number; hasAnomaly: boolean; anomalySeverity: 'high' | 'medium' | 'low' | null } {
  const alertFlags: string[] = [];
  const stockDays = avgDailySales > 0 ? round(currentStock / avgDailySales, 1) : 999;

  // 欠品
  if (currentStock === 0 && avgDailySales > 0) alertFlags.push('stockout');
  // 在庫少（3日未満）
  else if (stockDays < 3 && avgDailySales > 0) alertFlags.push('low_stock');
  // 在庫過剰（30日超）
  else if (stockDays > 30 && currentStock > 0) alertFlags.push('overstock');

  // 売上急増（直近3日平均 vs 全体平均、2倍以上）
  if (pastQtys.length >= 5) {
    const recent3 = pastQtys.slice(-3).reduce((a, b) => a + b, 0) / 3;
    const overall = pastQtys.reduce((a, b) => a + b, 0) / pastQtys.length;
    if (overall > 0 && recent3 > overall * 2) alertFlags.push('order_surge');
  }

  const hasAnomaly = alertFlags.length > 0;
  const anomalySeverity = alertFlags.includes('stockout')
    ? 'high'
    : hasAnomaly
      ? 'medium'
      : null;

  return { alertFlags, stockDays, hasAnomaly, anomalySeverity };
}

// ════════════════════════════════════════════════
// メインエントリポイント
// ════════════════════════════════════════════════

export async function executeForecast(config: ForecastConfig) {
  const {
    storeId,
    supplierNames,
    forecastDays: fDays = 7,
    lookbackDays: lbDays = 28,
  } = config;
  const orderDate = config.orderDate || todayJST();

  console.log('=== 需要予測（統合版エンジン） ===');
  console.log('店舗:', storeId, '仕入先:', supplierNames.join(', '));
  console.log('発注日:', orderDate, '予測日数:', fDays, '参照日数:', lbDays);

  // ── 参照期間 ──
  const refEnd = addDays(orderDate, -1);                      // 発注日の前日まで
  const refStart = addDays(refEnd, -(lbDays - 1));            // lookbackDays 分
  // 曜日インデックス用に最低84日（12週）確保
  const dowDays = Math.max(lbDays, 84);
  const dowStart = addDays(refEnd, -(dowDays - 1));
  // 現行品/廃盤判定用
  const activeStart = addDays(orderDate, -60);

  console.log('参照期間:', refStart, '〜', refEnd, `(${lbDays}日)`);
  console.log('曜日分析:', dowStart, '〜', refEnd, `(${dowDays}日)`);

  // ── 1. 商品マスタ ──
  const productsRaw = await fetchAll(
    'products_cache', '*',
    (q) => q.in('supplier_name', supplierNames),
  );
  // 青果・果物カテゴリを除外
  const products = productsRaw.filter(
    (p: any) => !DEFAULT_EXCLUDED_CATEGORY_IDS.includes(String(p.category_id))
  );
  const excludedCount = productsRaw.length - products.length;
  if (excludedCount > 0) {
    console.log(`カテゴリ除外: ${excludedCount}商品（青果・果物）`);
  }
  if (!products.length) {
    return emptyResponse(storeId, supplierNames, orderDate, fDays, lbDays);
  }
  const pids = products.map((p: any) => String(p.product_id));
  console.log('商品数:', pids.length);

  // ── 2. 売上データ（曜日分析用の長期間） ──
  // 注意: .eq()ではなく.in()を使用（型変換の違いで取得件数が異なる問題を回避）
  const salesRaw = await fetchByProductIds(
    'sales_daily_summary',
    'product_id, sale_date, total_quantity',
    pids,
    (q) => q.in('store_id', [String(storeId)]).gte('sale_date', dowStart).lte('sale_date', refEnd),
  );
  console.log('売上レコード:', salesRaw.length);

  // 商品ごとに日付→売上のMapを構築
  const salesMap = new Map<string, Map<string, number>>();
  salesRaw.forEach((r: any) => {
    const pid = String(r.product_id);
    const date = String(r.sale_date).split('T')[0];
    if (!salesMap.has(pid)) salesMap.set(pid, new Map());
    const m = salesMap.get(pid)!;
    m.set(date, (m.get(date) || 0) + (Number(r.total_quantity) || 0));
  });

  // ── 3. 直近2ヶ月売上（現行品判定用） ──
  const recentSalesRaw = await fetchByProductIds(
    'sales_daily_summary',
    'product_id, total_quantity',
    pids,
    (q) => q.in('store_id', [String(storeId)]).gte('sale_date', activeStart).lte('sale_date', orderDate),
  );
  const recentTotals = new Map<string, number>();
  recentSalesRaw.forEach((r: any) => {
    const pid = String(r.product_id);
    recentTotals.set(pid, (recentTotals.get(pid) || 0) + (Number(r.total_quantity) || 0));
  });

  // ── 4. 在庫 ──
  const stockRaw = await fetchByProductIds(
    'stock_cache', 'product_id, stock_amount',
    pids,
    (q) => q.in('store_id', [String(storeId)]),
  );
  const stockMap = new Map<string, number>();
  stockRaw.forEach((r: any) => stockMap.set(String(r.product_id), Number(r.stock_amount) || 0));

  // ── 5. 発注ロット ──
  const lotRaw = await fetchByProductIds(
    'product_order_lots', 'product_id, lot_size',
    pids,
    (q) => q,
  );
  const lotMap = new Map<string, number>();
  lotRaw.forEach((r: any) => lotMap.set(String(r.product_id), Number(r.lot_size) || 1));

  // ── 6. 仕入先設定 ──
  const suppRaw = await fetchAll(
    'suppliers', '*',
    (q) => q.in('supplier_name', supplierNames),
  );
  const suppMap = new Map<string, any>();
  suppRaw.forEach((s: any) => suppMap.set(s.supplier_name, s));

  // ── 6b. 学習済みパラメータを取得（自動学習システム） ──
  let learnedMap = new Map<string, LearnedParams>();
  try {
    learnedMap = await getLearnedParams(storeId, pids);
    if (learnedMap.size > 0) {
      console.log(`学習済みパラメータ適用: ${learnedMap.size}商品`);
    }
  } catch (e) {
    // テーブルが存在しない場合等は無視して続行
    console.log('学習済みパラメータ取得スキップ（テーブル未作成の可能性）');
  }

  // ── 7. 各商品の日販・標準偏差を計算 ──
  //    同時に ABC 分析用の売上金額も集計
  const abcInput: { productId: string; salesValue: number }[] = [];
  const statsMap = new Map<string, {
    avgDaily: number; stdDev: number; totalSales: number;
    dowIndices: number[]; baseRate: number;
    dailySalesInLookback: Map<string, number>;
  }>();

  products.forEach((p: any) => {
    const pid = String(p.product_id);
    const allDays = salesMap.get(pid) || new Map<string, number>();

    // lookback 期間の売上を抽出
    const lbSales = new Map<string, number>();
    for (let i = 0; i < lbDays; i++) {
      const d = addDays(refEnd, -i);
      if (allDays.has(d)) lbSales.set(d, allDays.get(d)!);
    }
    const totalSales = [...lbSales.values()].reduce((a, b) => a + b, 0);
    const avgDaily = totalSales / lbDays; // lookbackDays で割る（ゼロ販売日も含む）

    // 標準偏差（lookback期間、売上ゼロ日も含む）
    const dailyValues: number[] = [];
    for (let i = 0; i < lbDays; i++) {
      const d = addDays(refEnd, -i);
      dailyValues.push(lbSales.get(d) || 0);
    }
    const variance =
      dailyValues.reduce((sum, v) => sum + Math.pow(v - avgDaily, 2), 0) / lbDays;
    const stdDev = Math.sqrt(variance);

    // 曜日インデックス（長期間データから）
    const dowIndices = calcDowIndices(allDays);

    // ベースレート（直近重視の加重平均、曜日季節性除去済み）
    const baseRate = calcBaseRate(allDays, refEnd, lbDays, dowIndices);

    const retailPrice = parseFloat(p.price) || 0;
    abcInput.push({ productId: pid, salesValue: avgDaily * retailPrice });

    statsMap.set(pid, {
      avgDaily: round(avgDaily, 2),
      stdDev: round(stdDev, 2),
      totalSales,
      dowIndices,
      baseRate,
      dailySalesInLookback: lbSales,
    });
  });

  // ── 8. ABC ランク（1回だけ計算） ──
  const abcRankMap = assignABCRanks(abcInput);
  const abcSummary = summarizeRanks(abcRankMap);
  console.log('ABC分析完了:', Object.entries(abcSummary).map(([k, v]) => `${k}:${v.count}`).join(' '));

  // ── 9. 商品ごとの予測計算 ──
  const pastSalesType: 'daily' | 'weekly' = lbDays <= 14 ? 'daily' : 'weekly';
  const results: ProductForecast[] = [];

  products.forEach((p: any) => {
    const pid = String(p.product_id);
    const stats = statsMap.get(pid)!;
    const abc = abcRankMap.get(pid) || { rank: 'E', cumulativeRatio: 1 };
    const rankCfg = ABC_RANKS[abc.rank] || ABC_RANKS.E;
    const currentStock = stockMap.get(pid) || 0;
    const lotSize = lotMap.get(pid) || 1;
    const cost = parseFloat(p.cost) || 0;
    const retailPrice = parseFloat(p.price) || 0;
    const supplierName = p.supplier_name || '';
    const suppSettings = suppMap.get(supplierName);
    const leadTimeDays = suppSettings?.lead_time_days || 3;

    // ── 学習済みパラメータ（あれば適用） ──
    const learned = learnedMap.get(pid);
    const biasCorrection = learned?.biasCorrection ?? 1.0;
    const safetyMultiplier = learned?.safetyMultiplier ?? 1.0;
    const dowReliability = learned?.dowReliability ?? 1.0;
    const learningCycles = learned?.learningCycles ?? 0;

    // ── アルゴリズム選択 ──
    const dataPoints = stats.dailySalesInLookback.size;
    // 曜日パターンの信頼度が低い場合もフォールバック
    const useWeightedDow =
      rankCfg.algorithm === 'weighted_dow' && dataPoints >= 14 && dowReliability >= 0.3;
    const algorithm = useWeightedDow ? 'weighted_dow' : 'simple';

    // ── 予測需要 ──
    let forecastQuantity: number;
    if (useWeightedDow) {
      // dowReliability で曜日パターンと単純平均をブレンド
      const dowFc = forecastByDow(stats.baseRate, stats.dowIndices, orderDate, fDays);
      const simpleFc = round(stats.avgDaily * fDays, 1);
      forecastQuantity = round(
        dowFc.total * dowReliability + simpleFc * (1 - dowReliability), 1,
      );
    } else {
      forecastQuantity = round(stats.avgDaily * fDays, 1);
    }

    // ── バイアス補正を適用 ──
    if (learningCycles >= 3 && biasCorrection !== 1.0) {
      forecastQuantity = round(forecastQuantity * biasCorrection, 1);
    }

    // ── リードタイム需要 ──
    const leadTimeDemand = round(stats.avgDaily * leadTimeDays, 1);

    // ── 安全在庫（学習済み倍率を適用） ──
    const ssBase = calcSafetyStock(abc.rank, stats.stdDev, leadTimeDays, stats.avgDaily);
    const adjustedSafetyStock = learningCycles >= 3
      ? Math.round(ssBase.stock * safetyMultiplier)
      : ssBase.stock;
    const adjustedSafetyDays = stats.avgDaily > 0
      ? round(adjustedSafetyStock / stats.avgDaily, 1)
      : 0;

    // ── 発注数 ──
    const grossDemand = forecastQuantity + leadTimeDemand + adjustedSafetyStock;
    const netDemand = Math.max(0, grossDemand - currentStock);
    let recommendedOrder = Math.max(0, Math.ceil(netDemand));

    // ロット切り上げ
    if (lotSize > 1 && recommendedOrder > 0) {
      recommendedOrder = Math.ceil(recommendedOrder / lotSize) * lotSize;
    }
    // Eランク少量発注抑制
    if (abc.rank === 'E' && recommendedOrder > 0 && recommendedOrder < rankCfg.minOrderLot) {
      recommendedOrder = 0;
    }

    const orderAmount = Math.round(recommendedOrder * cost);

    // ── 計算式テキスト（表示と実計算が一致） ──
    const biasLabel = learningCycles >= 3 && biasCorrection !== 1.0
      ? ` ×補正${biasCorrection}`
      : '';
    const safetyLabel = learningCycles >= 3 && safetyMultiplier !== 1.0
      ? `(×${safetyMultiplier})`
      : '';
    const breakdown =
      `予測${forecastQuantity}${biasLabel} + LT${leadTimeDemand}` +
      ` + 安全${adjustedSafetyStock}${safetyLabel}` +
      ` - 在庫${currentStock} = 純需要${round(netDemand, 1)}`;

    // ── 過去売上（表示用） ──
    const pastSalesData = buildPastSales(
      pastSalesType, salesRaw, pid, orderDate,
    );

    // ── 異常検知 ──
    const pastQtys = pastSalesData.map((d) => d.qty);
    const anomaly = detectAnomalies(currentStock, stats.avgDaily, pastQtys);

    // ── 現行品判定 ──
    const isActive = (recentTotals.get(pid) || 0) > 0;

    results.push({
      productId: pid,
      productCode: p.product_code || '',
      productName: p.product_name || '',
      categoryName: p.category_name || '',
      supplierName,
      abcRank: abc.rank,
      cumulativeRatio: abc.cumulativeRatio,
      avgDailySales: stats.avgDaily,
      stdDevDaily: stats.stdDev,
      currentStock,
      forecastQuantity,
      leadTimeDemand,
      safetyStock: adjustedSafetyStock,
      safetyStockDays: adjustedSafetyDays,
      recommendedOrder,
      orderAmount,
      lotSize,
      cost,
      retailPrice,
      rank: abc.rank,
      algorithm,
      breakdown,
      isActive,
      ...anomaly,
      anomalies: anomaly.alertFlags,
      isAnomaly: anomaly.hasAnomaly,
      pastSales: { type: pastSalesType, data: pastSalesData },
    });
  });

  // ── 10. 仕入先グループ化 ──
  const groupMap = new Map<string, any>();
  results.forEach((r) => {
    const sn = r.supplierName || '不明';
    if (!groupMap.has(sn)) {
      groupMap.set(sn, {
        supplierName: sn,
        products: [],
        totalOrderQuantity: 0,
        totalOrderAmount: 0,
      });
    }
    const g = groupMap.get(sn)!;
    g.products.push(r);
    g.totalOrderQuantity += r.recommendedOrder;
    g.totalOrderAmount += r.orderAmount;
  });

  const orderDateObj = new Date(orderDate + 'T12:00:00Z');
  const supplierGroups = Array.from(groupMap.values())
    .map((g) => {
      const s = suppMap.get(g.supplierName);
      const lt = s?.lead_time_days || 3;
      const minOrd = s?.min_order_amount || 0;
      const freeShip = s?.free_shipping_amount || null;
      const arrival = new Date(orderDateObj);
      arrival.setUTCDate(arrival.getUTCDate() + lt);

      return {
        ...g,
        supplierSettings: {
          leadTimeDays: lt,
          minOrderAmount: minOrd,
          freeShippingAmount: freeShip,
          shippingFee: s?.shipping_fee || 0,
          orderMethod: s?.order_method || 'manual',
          email: s?.email || '',
          contactPerson: s?.contact_person || '',
        },
        orderConditions: {
          meetsMinOrder: g.totalOrderAmount >= minOrd,
          amountToMinOrder: Math.max(0, minOrd - g.totalOrderAmount),
          meetsFreeShipping: freeShip ? g.totalOrderAmount >= freeShip : true,
          amountToFreeShipping: freeShip ? Math.max(0, freeShip - g.totalOrderAmount) : 0,
          estimatedArrival: arrival.toISOString().split('T')[0],
        },
      };
    })
    .sort((a, b) => b.totalOrderAmount - a.totalOrderAmount);

  // グループ内ソート
  supplierGroups.forEach((g) => {
    g.products.sort((a: any, b: any) => b.orderAmount - a.orderAmount);
  });

  // ── 11. サマリー ──
  const active = results.filter((r) => r.isActive);
  const anomalySummary = {
    stockout: results.filter((r) => r.alertFlags.includes('stockout')).length,
    low_stock: results.filter((r) => r.alertFlags.includes('low_stock')).length,
    order_surge: results.filter((r) => r.alertFlags.includes('order_surge')).length,
    overstock: results.filter((r) => r.alertFlags.includes('overstock')).length,
    total: 0,
  };
  anomalySummary.total =
    anomalySummary.stockout + anomalySummary.low_stock +
    anomalySummary.order_surge + anomalySummary.overstock;

  // 欠品コスト
  const stockoutProducts = results
    .filter((r) => r.currentStock === 0 && r.avgDailySales > 0)
    .map((r) => ({
      productId: r.productId,
      productName: r.productName,
      dailySales: r.avgDailySales,
      unitPrice: r.retailPrice,
      estimatedLoss: Math.round(r.avgDailySales * r.retailPrice * 2),
    }));

  // 過去売上ラベル
  const pastSalesDates: string[] = [];
  const pastSalesWeeks: string[] = [];
  if (pastSalesType === 'daily') {
    for (let i = 6; i >= 0; i--) {
      const d = new Date(addDays(orderDate, -i - 1) + 'T12:00:00Z');
      pastSalesDates.push(`${d.getUTCMonth() + 1}/${d.getUTCDate()}`);
    }
  } else {
    for (let i = 3; i >= 0; i--) {
      const we = addDays(orderDate, -(i * 7) - 1);
      const ws = addDays(we, -6);
      const weD = new Date(we + 'T12:00:00Z');
      const wsD = new Date(ws + 'T12:00:00Z');
      pastSalesWeeks.push(
        `${wsD.getUTCMonth() + 1}/${wsD.getUTCDate()}〜${weD.getUTCMonth() + 1}/${weD.getUTCDate()}`,
      );
    }
  }

  console.log('=== 計算完了 ===');
  console.log('商品数:', results.length, '発注金額:', results.reduce((s, r) => s + r.orderAmount, 0));

  return {
    success: true,
    supplierGroups,
    summary: {
      totalProducts: results.length,
      activeProducts: active.length,
      discontinuedProducts: results.length - active.length,
      productsWithOrder: results.filter((r) => r.recommendedOrder > 0).length,
      activeProductsWithOrder: active.filter((r) => r.recommendedOrder > 0).length,
      totalOrderQuantity: results.reduce((s, r) => s + r.recommendedOrder, 0),
      totalOrderAmount: results.reduce((s, r) => s + r.orderAmount, 0),
      anomalyProducts: anomalySummary.total,
      highSeverityAnomalies: anomalySummary.stockout,
      mediumSeverityAnomalies: anomalySummary.low_stock + anomalySummary.order_surge,
      lowSeverityAnomalies: anomalySummary.overstock,
    },
    abcSummary,
    anomalySummary,
    stockoutCost: {
      totalLoss: stockoutProducts.reduce((s, p) => s + p.estimatedLoss, 0),
      stockoutProducts,
    },
    pastSalesType,
    pastSalesDates,
    pastSalesWeeks,
    debug: {
      storeId,
      supplierNames,
      orderDate,
      forecastDays: fDays,
      lookbackDays: lbDays,
      referenceFrom: refStart,
      referenceTo: refEnd,
      dowAnalysisFrom: dowStart,
      productsCount: products.length,
      salesRecords: salesRaw.length,
      stockRecords: stockRaw.length,
      forecastMethod: 'unified: weighted_dow + simple (ABC-based)',
    },
  };
}

// ════════════════════════════════════════════════
// ヘルパー
// ════════════════════════════════════════════════

function buildPastSales(
  type: 'daily' | 'weekly',
  salesRaw: any[],
  pid: string,
  orderDate: string,
): { date?: string; week?: string; qty: number }[] {
  const data: any[] = [];

  if (type === 'daily') {
    for (let i = 6; i >= 0; i--) {
      const d = addDays(orderDate, -i - 1);
      const dObj = new Date(d + 'T12:00:00Z');
      const qty = salesRaw
        .filter((s: any) => String(s.product_id) === pid && String(s.sale_date).split('T')[0] === d)
        .reduce((sum: number, s: any) => sum + (Number(s.total_quantity) || 0), 0);
      data.push({ date: `${dObj.getUTCMonth() + 1}/${dObj.getUTCDate()}`, qty });
    }
  } else {
    for (let i = 3; i >= 0; i--) {
      const we = addDays(orderDate, -(i * 7) - 1);
      const ws = addDays(we, -6);
      const weD = new Date(we + 'T12:00:00Z');
      const wsD = new Date(ws + 'T12:00:00Z');
      const qty = salesRaw
        .filter((s: any) => {
          const sd = String(s.sale_date).split('T')[0];
          return String(s.product_id) === pid && sd >= ws && sd <= we;
        })
        .reduce((sum: number, s: any) => sum + (Number(s.total_quantity) || 0), 0);
      data.push({
        week: `${wsD.getUTCMonth() + 1}/${wsD.getUTCDate()}〜${weD.getUTCMonth() + 1}/${weD.getUTCDate()}`,
        qty,
      });
    }
  }
  return data;
}

function emptyResponse(storeId: string, supplierNames: string[], orderDate: string, fDays: number, lbDays: number) {
  return {
    success: true,
    supplierGroups: [],
    summary: {
      totalProducts: 0, activeProducts: 0, discontinuedProducts: 0,
      productsWithOrder: 0, activeProductsWithOrder: 0,
      totalOrderQuantity: 0, totalOrderAmount: 0,
      anomalyProducts: 0, highSeverityAnomalies: 0,
      mediumSeverityAnomalies: 0, lowSeverityAnomalies: 0,
    },
    abcSummary: {},
    anomalySummary: { stockout: 0, low_stock: 0, order_surge: 0, overstock: 0, total: 0 },
    stockoutCost: { totalLoss: 0, stockoutProducts: [] },
    pastSalesType: 'daily' as const,
    pastSalesDates: [],
    pastSalesWeeks: [],
    debug: { message: '対象商品なし', storeId, supplierNames, orderDate, forecastDays: fDays, lookbackDays: lbDays },
  };
}
