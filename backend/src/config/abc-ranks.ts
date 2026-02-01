/**
 * ABC分析 設定（統合版）
 *
 * 売上累積構成比に基づくランク分けと、ランク別パラメータの唯一の定義。
 * forecast-engine.ts がこの設定を参照する。
 *
 * ── 閾値の根拠 ──
 *   A（〜50%）: パレートの法則 — 売上の50%を占める少数の主力商品
 *   B（〜75%）: 次の25%を占める準主力
 *   C（〜90%）: 次の15%
 *   D（〜97%）: ロングテール上位
 *   E（残り）  : 超ロングテール・廃盤候補
 */

// ── ランク別設定 ──────────────────────────────────
export interface ABCRankConfig {
  /** 累積構成比の上限（0–1） */
  threshold: number;
  /** 安全在庫の z-score（サービス率: A≈95%, B≈90%, C≈80%） */
  safetyZScore: number;
  /** 安全在庫の上限（日販×この日数） */
  maxSafetyDays: number;
  /** 予測アルゴリズム */
  algorithm: 'weighted_dow' | 'simple';
  /** 最小発注ロット（これ未満なら発注しない） */
  minOrderLot: number;
  /** UI表示ラベル */
  label: string;
  /** UI表示色（Tailwind） */
  color: string;
}

export const ABC_RANKS: Record<string, ABCRankConfig> = {
  A: {
    threshold: 0.50,
    safetyZScore: 1.65,
    maxSafetyDays: 3,
    algorithm: 'weighted_dow',
    minOrderLot: 1,
    label: '最重要',
    color: 'bg-red-100 text-red-800 border-red-200',
  },
  B: {
    threshold: 0.75,
    safetyZScore: 1.28,
    maxSafetyDays: 2,
    algorithm: 'weighted_dow',
    minOrderLot: 1,
    label: '重要',
    color: 'bg-orange-100 text-orange-800 border-orange-200',
  },
  C: {
    threshold: 0.90,
    safetyZScore: 0.84,
    maxSafetyDays: 1,
    algorithm: 'weighted_dow',
    minOrderLot: 1,
    label: '標準',
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  },
  D: {
    threshold: 0.97,
    safetyZScore: 0,
    maxSafetyDays: 0,
    algorithm: 'simple',
    minOrderLot: 1,
    label: '低優先',
    color: 'bg-green-100 text-green-800 border-green-200',
  },
  E: {
    threshold: 1.0,
    safetyZScore: 0,
    maxSafetyDays: 0,
    algorithm: 'simple',
    minOrderLot: 3,
    label: '最少',
    color: 'bg-gray-100 text-gray-600 border-gray-200',
  },
};

// ── ユーティリティ関数 ────────────────────────────

/** 累積構成比 → ランク */
export function getRank(cumulativeRatio: number): string {
  if (cumulativeRatio <= ABC_RANKS.A.threshold) return 'A';
  if (cumulativeRatio <= ABC_RANKS.B.threshold) return 'B';
  if (cumulativeRatio <= ABC_RANKS.C.threshold) return 'C';
  if (cumulativeRatio <= ABC_RANKS.D.threshold) return 'D';
  return 'E';
}

/**
 * 商品リストに対し ABC ランクを一括計算（累積売上金額ベース）
 * @returns Map<productId, { rank, cumulativeRatio }>
 */
export function assignABCRanks(
  products: { productId: string; salesValue: number }[],
): Map<string, { rank: string; cumulativeRatio: number }> {
  const result = new Map<string, { rank: string; cumulativeRatio: number }>();

  const sorted = [...products].sort((a, b) => b.salesValue - a.salesValue);
  const total = sorted.reduce((s, p) => s + p.salesValue, 0);

  // 全商品の売上がゼロ → 順位ベースで割り当て
  if (total === 0) {
    sorted.forEach((p, i) => {
      const ratio = (i + 1) / sorted.length;
      result.set(p.productId, { rank: getRank(ratio), cumulativeRatio: round(ratio, 3) });
    });
    return result;
  }

  let cumulative = 0;
  sorted.forEach((p) => {
    cumulative += p.salesValue;
    const ratio = cumulative / total;
    result.set(p.productId, { rank: getRank(ratio), cumulativeRatio: round(ratio, 3) });
  });

  // 売上ゼロの商品は E ランク
  products.forEach((p) => {
    if (!result.has(p.productId)) {
      result.set(p.productId, { rank: 'E', cumulativeRatio: 1 });
    }
  });

  return result;
}

/** ランク別の商品数サマリー */
export function summarizeRanks(
  rankMap: Map<string, { rank: string }>,
): Record<string, { count: number; salesRatio: number }> {
  const summary: Record<string, { count: number; salesRatio: number }> = {
    A: { count: 0, salesRatio: 50 },
    B: { count: 0, salesRatio: 25 },
    C: { count: 0, salesRatio: 15 },
    D: { count: 0, salesRatio: 7 },
    E: { count: 0, salesRatio: 3 },
  };
  rankMap.forEach(({ rank }) => {
    if (summary[rank]) summary[rank].count++;
  });
  return summary;
}

function round(v: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}
