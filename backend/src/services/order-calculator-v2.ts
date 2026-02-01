import { ABC_RANKS, getRankByCumulativeRatio } from '../config/abc-ranks';
import { ArimaForecastService } from './arima-forecast';

export interface OrderCalculationParams {
  productId: string;
  currentStock: number;
  onOrderQuantity: number;        // 発注済未入庫
  supplierLeadTimeDays: number;
  dailySalesAvg: number;
  cumulativeSalesRatio: number;   // ABC判定用累積構成比
  lotSize: number;
  forecastDays: number;
  referenceDays?: number;
  productPrice?: number;          // 原価（在庫金額計算用）
}

export interface OrderCalculationResult {
  rank: string;
  algorithm: string;
  forecastDemand: number;
  leadTimeDemand: number;
  safetyStock: number;
  currentStock: number;
  onOrderQuantity: number;
  suggestedOrder: number;
  orderAmount: number;            // 発注金額
  breakdown: string;
  confidence: number;
  isRecommended: boolean;         // 発注推奨か（Eランク少量はfalse）
}

const arimaService = new ArimaForecastService();

/**
 * V2発注数量計算（ARIMA + ABC最適化）
 */
export async function calculateOrderQuantityV2(
  params: OrderCalculationParams
): Promise<OrderCalculationResult> {
  const {
    productId,
    currentStock,
    onOrderQuantity,
    supplierLeadTimeDays,
    dailySalesAvg,
    cumulativeSalesRatio,
    lotSize,
    forecastDays,
    referenceDays = 60,
    productPrice = 0
  } = params;

  // 1. ABCランク判定
  const rank = getRankByCumulativeRatio(cumulativeSalesRatio);
  const rankConfig = ABC_RANKS[rank];

  // 2. 予測実行（ABC別アルゴリズム）
  let forecastResult;
  if (rankConfig.algorithm === 'arima') {
    forecastResult = await arimaService.predict(productId, forecastDays, referenceDays);
  } else {
    // Simple: 過去平均
    const avg = dailySalesAvg || 0;
    forecastResult = {
      values: new Array(forecastDays).fill(Math.round(avg)),
      total: Math.round(avg) * forecastDays,
      algorithm: 'simple' as const,
      confidence: 0.5,
      trend: 0,
      seasonality: []
    };
  }

  // 3. リードタイム需要（×1.2バッファ）
  const leadTimeDemand = Math.round(
    dailySalesAvg * supplierLeadTimeDays * 1.2
  );

  // 4. 安全在庫（ABC別日数 × 日平均）
  const safetyStock = Math.round(dailySalesAvg * rankConfig.safetyDays);

  // 5. 純需要計算
  // 予測期間需要 + リードタイム需要 + 安全在庫 - 現在庫 - 発注済未入庫
  const grossDemand = forecastResult.total + leadTimeDemand + safetyStock;
  const availableInventory = currentStock + onOrderQuantity;
  const netDemand = grossDemand - availableInventory;

  // 6. 発注数量決定
  let finalOrder = 0;
  let isRecommended = true;

  if (netDemand > 0) {
    // ロット換算（切り上げ）
    const rawOrder = Math.ceil(netDemand / lotSize) * lotSize;
    
    // Eランク特殊処理：最小ロット未満は発注しない
    if (rank === 'E' && rawOrder < rankConfig.minOrderLot) {
      finalOrder = 0;
      isRecommended = false;
    } else {
      finalOrder = rawOrder;
    }
  }

  // 7. 発注金額計算
  const orderAmount = finalOrder * (productPrice || 0);

  // 8. 計算式テキスト（表示用）
  const breakdown = 
    `予測${forecastResult.total} + LT${leadTimeDemand} + 安全${safetyStock} - 在庫${currentStock} - 発注済${onOrderQuantity} = 純需要${Math.max(0, Math.round(netDemand))}`;

  return {
    rank,
    algorithm: forecastResult.algorithm,
    forecastDemand: forecastResult.total,
    leadTimeDemand,
    safetyStock,
    currentStock,
    onOrderQuantity,
    suggestedOrder: finalOrder,
    orderAmount,
    breakdown,
    confidence: forecastResult.confidence,
    isRecommended
  };
}

/**
 * バッチ計算（複数商品一括）
 */
export async function calculateOrdersBatch(
  items: OrderCalculationParams[]
): Promise<OrderCalculationResult[]> {
  const results: OrderCalculationResult[] = [];
  
  for (const item of items) {
    try {
      const result = await calculateOrderQuantityV2(item);
      results.push(result);
    } catch (error) {
      console.error(`[OrderV2] 計算エラー ${item.productId}:`, error);
      // エラー時はSimpleフォールバック
      results.push({
        rank: 'C',
        algorithm: 'simple',
        forecastDemand: item.dailySalesAvg * item.forecastDays,
        leadTimeDemand: Math.round(item.dailySalesAvg * item.supplierLeadTimeDays * 1.2),
        safetyStock: 0,
        currentStock: item.currentStock,
        onOrderQuantity: item.onOrderQuantity,
        suggestedOrder: 0,
        orderAmount: 0,
        breakdown: '計算エラー - 手動確認要',
        confidence: 0,
        isRecommended: false
      });
    }
  }
  
  return results;
}
