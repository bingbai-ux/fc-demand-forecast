import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 既存「サキヨミ」ロジック（単純移動平均）
function sakiyomiForecast(
  historicalData: Array<{ date: string; quantity: number }>,
  referenceDays: number,
  forecastDays: number,
  safetyStockRatio: number
): number {
  const recentData = historicalData.slice(-referenceDays);
  const avgDaily = recentData.reduce((sum, d) => sum + d.quantity, 0) / referenceDays;
  const forecast = avgDaily * forecastDays;
  const safetyStock = forecast * safetyStockRatio;
  return Math.round(forecast + safetyStock);
}

// Prophet風ロジック（簡易版：トレンド+季節性）
function prophetForecast(
  historicalData: Array<{ date: string; quantity: number }>,
  forecastDays: number,
  safetyStockRatio: number
): number {
  if (historicalData.length < 14) {
    return sakiyomiForecast(historicalData, 14, forecastDays, safetyStockRatio);
  }

  // 線形トレンド計算
  const half = Math.floor(historicalData.length / 2);
  const firstHalf = historicalData.slice(0, half);
  const secondHalf = historicalData.slice(half);
  
  const firstAvg = firstHalf.reduce((sum, d) => sum + d.quantity, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((sum, d) => sum + d.quantity, 0) / secondHalf.length;
  const trend = (secondAvg - firstAvg) / half;
  
  // 最新値にトレンドを適用
  const lastValue = historicalData[historicalData.length - 1].quantity;
  const forecast = lastValue + (trend * forecastDays);
  
  // 週次季節性（曜日別平均）
  const dayOfWeekAvg = calculateWeeklySeasonality(historicalData);
  const seasonalFactor = dayOfWeekAvg[new Date().getDay()] || 1;
  
  const adjustedForecast = Math.max(0, forecast * seasonalFactor);
  const safetyStock = adjustedForecast * safetyStockRatio;
  
  return Math.round(adjustedForecast + safetyStock);
}

function calculateWeeklySeasonality(data: Array<{ date: string; quantity: number }>): number[] {
  const daySums: number[][] = Array(7).fill(null).map(() => []);
  
  data.forEach(d => {
    const day = new Date(d.date).getDay();
    daySums[day].push(d.quantity);
  });
  
  const avgs = daySums.map(dayData => 
    dayData.length > 0 ? dayData.reduce((a, b) => a + b, 0) / dayData.length : 1
  );
  
  const overallAvg = avgs.reduce((a, b) => a + b, 0) / 7;
  return avgs.map(avg => overallAvg > 0 ? avg / overallAvg : 1);
}

// KPI計算
function calculateKPIs(
  predictions: Array<{ date: string; predicted: number; actual: number }>,
  productPrice: number
) {
  let totalPredicted = 0;
  let totalActual = 0;
  let stockoutCount = 0;
  let overstockCount = 0;
  let totalError = 0;
  
  predictions.forEach(p => {
    totalPredicted += p.predicted;
    totalActual += p.actual;
    
    // 欠品: 予測 < 実際
    if (p.predicted < p.actual) {
      stockoutCount++;
    }
    // 過剰在庫: 予測 > 実際×1.5
    if (p.predicted > p.actual * 1.5) {
      overstockCount++;
    }
    
    totalError += Math.abs(p.predicted - p.actual);
  });
  
  const mape = totalActual > 0 ? (totalError / totalActual) * 100 : 0;
  const stockoutRate = (stockoutCount / predictions.length) * 100;
  const inventoryCost = totalPredicted * productPrice;
  
  return {
    mape: Math.round(mape * 100) / 100,
    stockoutRate: Math.round(stockoutRate * 100) / 100,
    stockoutCount,
    overstockCount,
    inventoryCost: Math.round(inventoryCost),
    avgDailyError: Math.round(totalError / predictions.length * 100) / 100,
  };
}

// メイン分析
async function runComparison() {
  console.log('=== 予測ロジック比較分析 ===\n');
  
  // 分析対象期間（直近90日で検証）
  const endDate = '2025-01-31';
  const startDate = '2024-11-01'; // 90日分の履歴 + 30日分の検証
  
  console.log(`📅 分析期間: ${startDate} 〜 ${endDate}`);
  
  // 主要商品を取得（売上高上位50SKU）
  const { data: topProducts, error } = await supabase
    .from('sales_daily_summary')
    .select('product_id, total_quantity, sale_date')
    .gte('sale_date', startDate)
    .lte('sale_date', endDate)
    .order('total_quantity', { ascending: false })
    .limit(1000);
    
  if (error || !topProducts) {
    console.error('データ取得エラー:', error);
    return;
  }
  
  // 商品別に集計
  const productSales: Record<string, number> = {};
  topProducts.forEach(p => {
    productSales[p.product_id] = (productSales[p.product_id] || 0) + p.total_quantity;
  });
  
  // Top 20商品を選択
  const targetProducts = Object.entries(productSales)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([id]) => id);
    
  console.log(`📦 分析対象: ${targetProducts.length}SKU\n`);
  
  // 検証パターン
  const patterns = [
    { name: 'サキヨミ現行', logic: 'sakiyomi', referenceDays: 14, safetyStock: 0 },
    { name: 'サキヨミ+安全10%', logic: 'sakiyomi', referenceDays: 14, safetyStock: 0.1 },
    { name: 'サキヨミ+安全20%', logic: 'sakiyomi', referenceDays: 14, safetyStock: 0.2 },
    { name: 'サキヨミ長期', logic: 'sakiyomi', referenceDays: 21, safetyStock: 0 },
    { name: 'Prophet', logic: 'prophet', referenceDays: 30, safetyStock: 0 },
    { name: 'Prophet+安全10%', logic: 'prophet', referenceDays: 30, safetyStock: 0.1 },
  ];
  
  const results: Record<string, any> = {};
  
  for (const pattern of patterns) {
    console.log(`🔍 検証: ${pattern.name}...`);
    
    let totalMAPE = 0;
    let totalStockoutRate = 0;
    let productCount = 0;
    
    for (const productId of targetProducts) {
      // 商品の時系列データ取得
      const { data: salesData } = await supabase
        .from('sales_daily_summary')
        .select('sale_date, total_quantity')
        .eq('product_id', productId)
        .gte('sale_date', startDate)
        .lte('sale_date', endDate)
        .order('sale_date', { ascending: true });
        
      if (!salesData || salesData.length < 30) continue;
      
      // ローリング予測シミュレーション
      const predictions = [];
      const testStart = 30; // 30日目から検証開始
      
      for (let i = testStart; i < salesData.length; i++) {
        const historicalData = salesData.slice(0, i).map(d => ({
          date: d.sale_date,
          quantity: d.total_quantity || 0,
        }));
        
        let predicted: number;
        if (pattern.logic === 'sakiyomi') {
          predicted = sakiyomiForecast(
            historicalData,
            pattern.referenceDays,
            1, // 1日先予測
            pattern.safetyStock
          );
        } else {
          predicted = prophetForecast(
            historicalData,
            1,
            pattern.safetyStock
          );
        }
        
        predictions.push({
          date: salesData[i].sale_date,
          predicted,
          actual: salesData[i].total_quantity || 0,
        });
      }
      
      // KPI計算（仮の単価1000円で計算）
      const kpis = calculateKPIs(predictions, 1000);
      
      totalMAPE += kpis.mape;
      totalStockoutRate += kpis.stockoutRate;
      productCount++;
    }
    
    results[pattern.name] = {
      avgMAPE: productCount > 0 ? Math.round((totalMAPE / productCount) * 100) / 100 : 0,
      avgStockoutRate: productCount > 0 ? Math.round((totalStockoutRate / productCount) * 100) / 100 : 0,
      productCount,
    };
    
    console.log(`   MAPE: ${results[pattern.name].avgMAPE}%, 欠品率: ${results[pattern.name].avgStockoutRate}%`);
  }
  
  // レポート出力
  console.log('\n=== 分析結果サマリー ===\n');
  console.log('| パターン | MAPE(%) | 欠品率(%) | 評価 |');
  console.log('|----------|---------|-----------|------|');
  
  Object.entries(results).forEach(([name, result]: [string, any]) => {
    const score = Math.round((100 - result.avgMAPE) * (100 - result.avgStockoutRate) / 100);
    const eval_ = score > 80 ? '◎' : score > 60 ? '○' : '△';
    console.log(`| ${name.padEnd(16)} | ${String(result.avgMAPE).padStart(7)} | ${String(result.avgStockoutRate).padStart(9)} | ${eval_} |`);
  });
  
  // 最良パターン特定
  const bestPattern = Object.entries(results).reduce((best, [name, result]: [string, any]) => {
    const score = (100 - result.avgMAPE) * (100 - result.avgStockoutRate);
    return score > best.score ? { name, score, result } : best;
  }, { name: '', score: 0, result: null });
  
  console.log(`\n✅ 最良パターン: ${bestPattern.name}`);
  console.log(`   MAPE: ${(bestPattern.result as any).avgMAPE}%`);
  console.log(`   欠品率: ${(bestPattern.result as any).avgStockoutRate}%`);
}

runComparison().catch(console.error);
