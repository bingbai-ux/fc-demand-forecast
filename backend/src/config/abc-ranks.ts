/**
 * ABC分析ランク設定
 * 売上累積構成比に基づくランク分けと、ランク別の最適パラメータ
 */

export interface ABCRankConfig {
  threshold: number;      // 累積構成比の閾値（0-1）
  safetyDays: number;     // 安全在庫日数
  algorithm: 'arima' | 'simple' | 'ensemble';  // 使用アルゴリズム
  color: string;          // UI表示色（Tailwindクラス）
  label: string;          // 表示ラベル
  minOrderLot: number;    // 最小発注ロット（Eランクは発注抑制）
}

export const ABC_RANKS: Record<string, ABCRankConfig> = {
  A: { 
    threshold: 0.40, 
    safetyDays: 2.0, 
    algorithm: 'arima', 
    color: 'bg-red-100 text-red-800 border-red-200', 
    label: '最重要',
    minOrderLot: 1
  },
  B: { 
    threshold: 0.65, 
    safetyDays: 1.0, 
    algorithm: 'arima', 
    color: 'bg-orange-100 text-orange-800 border-orange-200', 
    label: '重要',
    minOrderLot: 1
  },
  C: { 
    threshold: 0.80, 
    safetyDays: 0.5, 
    algorithm: 'arima', 
    color: 'bg-yellow-100 text-yellow-800 border-yellow-200', 
    label: '標準',
    minOrderLot: 1
  },
  D: { 
    threshold: 0.92, 
    safetyDays: 0, 
    algorithm: 'simple', 
    color: 'bg-green-100 text-green-800 border-green-200', 
    label: '低優先',
    minOrderLot: 1
  },
  E: { 
    threshold: 1.00, 
    safetyDays: 0, 
    algorithm: 'simple', 
    color: 'bg-gray-100 text-gray-600 border-gray-200', 
    label: '最少',
    minOrderLot: 3  // 3個以上から発注（少量発注抑制）
  }
};

/**
 * 累積構成比からランクを判定
 */
export function getRankByCumulativeRatio(ratio: number): keyof typeof ABC_RANKS {
  if (ratio <= ABC_RANKS.A.threshold) return 'A';
  if (ratio <= ABC_RANKS.B.threshold) return 'B';
  if (ratio <= ABC_RANKS.C.threshold) return 'C';
  if (ratio <= ABC_RANKS.D.threshold) return 'D';
  return 'E';
}

/**
 * 売上金額ベースでABCランクを計算
 */
export function calculateABCRanks(
  products: Array<{ productId: string; totalSales: number }>
): Map<string, { rank: string; cumulativeRatio: number }> {
  // 売上金額で降順ソート
  const sorted = [...products].sort((a, b) => b.totalSales - a.totalSales);
  
  const totalSales = sorted.reduce((sum, p) => sum + p.totalSales, 0);
  let cumulativeSales = 0;
  
  const result = new Map<string, { rank: string; cumulativeRatio: number }>();
  
  // 売上が全て0の場合は、順位ベースでランクを割り当て
  if (totalSales === 0) {
    const totalCount = sorted.length;
    sorted.forEach((product, index) => {
      const position = (index + 1) / totalCount;
      let rank: string;
      if (position <= 0.10) rank = 'A';      // 上位10%
      else if (position <= 0.25) rank = 'B'; // 上位25%
      else if (position <= 0.50) rank = 'C'; // 上位50%
      else if (position <= 0.75) rank = 'D'; // 上位75%
      else rank = 'E';                       // 下位25%
      
      result.set(product.productId, {
        rank,
        cumulativeRatio: Math.round(position * 1000) / 1000
      });
    });
    return result;
  }
  
  // 通常の売上ベースランク計算
  sorted.forEach(product => {
    cumulativeSales += product.totalSales;
    const cumulativeRatio = cumulativeSales / totalSales;
    const rank = getRankByCumulativeRatio(cumulativeRatio);
    
    result.set(product.productId, {
      rank,
      cumulativeRatio: Math.round(cumulativeRatio * 1000) / 1000
    });
  });
  
  return result;
}

/**
 * ランク別サマリー取得
 */
export function getABCSummary(
  rankedProducts: Map<string, { rank: string; cumulativeRatio: number }>
): Record<string, number> {
  const summary: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  
  rankedProducts.forEach(({ rank }) => {
    summary[rank] = (summary[rank] || 0) + 1;
  });
  
  return summary;
}
