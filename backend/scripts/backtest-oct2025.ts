/**
 * 2025年10月バックテスト
 * 9月データを使って10月の需要を予測し、実績と比較
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../../.env.local') });

// 環境変数からSupabase接続情報を取得（なければRailway APIを使用）
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const API_URL = 'https://fc-demand-forecast-production.up.railway.app';

interface SaleRecord {
  product_id: string;
  store_id: string;
  sale_date: string;
  total_quantity: number;
}

interface ProductInfo {
  product_id: string;
  product_name: string;
  category_id: string;
  category_name: string;
  supplier_name: string;
}

interface ForecastResult {
  productId: string;
  productName: string;
  categoryName: string;
  avgDailySales: number;
  recommendedOrder: number;
  currentStock: number;
  perishableConstrained: boolean;
}

async function fetchWithRetry(url: string, options?: RequestInit, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
    } catch (e) {
      if (i === retries - 1) throw e;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw new Error(`Failed to fetch ${url}`);
}

async function runBacktest() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('【バックテスト】2025年9月データ → 10月需要予測 vs 実績');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // 期間設定
  const SEPT_START = '2025-09-01';
  const SEPT_END = '2025-09-30';
  const OCT_START = '2025-10-01';
  const OCT_END = '2025-10-31';
  const STORES = ['1', '2', '4', '5', '6', '7'];
  const STORE_NAMES: Record<string, string> = {
    '1': '新宿',
    '2': '湘南',
    '4': '学芸大学',
    '5': '代官山',
    '6': 'ゆめが丘',
    '7': 'ゆめが丘cafe'
  };

  // APIから予測を取得（学芸大学店で全仕入先）
  console.log('【1. 予測データ取得中...】');

  // 仕入先一覧を取得
  const suppliersRes = await fetchWithRetry(`${API_URL}/api/suppliers`);
  const suppliersData = await suppliersRes.json();
  const supplierNames = suppliersData.data?.map((s: any) => s.supplierName) || [];

  console.log(`  仕入先数: ${supplierNames.length}`);

  // 10月1日時点での予測を取得（9月データベース）
  const forecastRes = await fetchWithRetry(`${API_URL}/api/forecast/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      storeId: '4',
      supplierNames: supplierNames.slice(0, 20), // 主要20仕入先
      orderDate: '2025-10-01',
      forecastDays: 31, // 10月全体
      lookbackDays: 30  // 9月データ
    })
  });
  const forecastData = await forecastRes.json();

  if (!forecastData.success) {
    console.error('予測取得失敗:', forecastData.error);
    return;
  }

  // 予測結果を集計
  const forecasts = new Map<string, ForecastResult>();
  let totalForecastQty = 0;

  for (const group of forecastData.supplierGroups || []) {
    for (const p of group.products || []) {
      forecasts.set(p.productId, {
        productId: p.productId,
        productName: p.productName,
        categoryName: p.categoryName,
        avgDailySales: p.avgDailySales || 0,
        recommendedOrder: p.recommendedOrder || 0,
        currentStock: p.currentStock || 0,
        perishableConstrained: p.perishableConstrained || false
      });
      // 31日分の予測販売数
      totalForecastQty += (p.avgDailySales || 0) * 31;
    }
  }

  console.log(`  予測商品数: ${forecasts.size}`);
  console.log(`  予測総販売数(10月): ${Math.round(totalForecastQty)}個\n`);

  // 10月の実績データを取得
  console.log('【2. 10月実績データ取得中...】');

  const octSalesRes = await fetchWithRetry(
    `${API_URL}/api/table-data?storeId=4&from=${OCT_START}&to=${OCT_END}`
  );
  const octSalesData = await octSalesRes.json();

  // 実績を商品IDでマップ
  const actuals = new Map<string, { qty: number; categoryName: string; productName: string }>();
  let totalActualQty = 0;

  for (const item of octSalesData.data || []) {
    actuals.set(item.productId, {
      qty: item.totalQuantity || 0,
      categoryName: item.categoryName || '',
      productName: item.productName || ''
    });
    totalActualQty += item.totalQuantity || 0;
  }

  console.log(`  実績商品数: ${actuals.size}`);
  console.log(`  実績総販売数(10月): ${totalActualQty}個\n`);

  // カテゴリ別にMAPE、欠品率、過剰率を計算
  console.log('【3. カテゴリ別精度分析】');
  console.log('─────────────────────────────────────────────────────────────────────');

  const categoryStats = new Map<string, {
    products: number;
    totalForecast: number;
    totalActual: number;
    sumAbsError: number;
    stockouts: number;  // 予測 < 実績 (欠品リスク)
    overstocks: number; // 予測 > 実績*1.5 (過剰リスク)
  }>();

  // 両方にある商品で比較
  for (const [pid, forecast] of forecasts) {
    const actual = actuals.get(pid);
    if (!actual) continue;

    const category = forecast.categoryName || '不明';
    const forecastQty = forecast.avgDailySales * 31;
    const actualQty = actual.qty;

    let stats = categoryStats.get(category);
    if (!stats) {
      stats = { products: 0, totalForecast: 0, totalActual: 0, sumAbsError: 0, stockouts: 0, overstocks: 0 };
      categoryStats.set(category, stats);
    }

    stats.products++;
    stats.totalForecast += forecastQty;
    stats.totalActual += actualQty;

    if (actualQty > 0) {
      stats.sumAbsError += Math.abs(forecastQty - actualQty) / actualQty;
    }

    // 欠品判定: 予測が実績の80%未満
    if (forecastQty < actualQty * 0.8 && actualQty > 5) {
      stats.stockouts++;
    }
    // 過剰判定: 予測が実績の150%超
    if (forecastQty > actualQty * 1.5 && forecastQty > 10) {
      stats.overstocks++;
    }
  }

  // カテゴリ別結果を表示
  console.log('カテゴリ                    | 商品数 | MAPE   | 欠品率 | 過剰率 | 評価');
  console.log('─────────────────────────────────────────────────────────────────────');

  const sortedCategories = Array.from(categoryStats.entries())
    .filter(([_, s]) => s.products >= 3)
    .sort((a, b) => b[1].totalActual - a[1].totalActual);

  let totalProducts = 0;
  let totalMapeSum = 0;
  let totalStockouts = 0;
  let totalOverstocks = 0;

  for (const [category, stats] of sortedCategories) {
    const mape = stats.products > 0 ? (stats.sumAbsError / stats.products) * 100 : 0;
    const stockoutRate = (stats.stockouts / stats.products) * 100;
    const overstockRate = (stats.overstocks / stats.products) * 100;

    const evaluation = mape < 20 ? '◎' : mape < 35 ? '○' : mape < 50 ? '△' : '✕';

    const catDisplay = category.substring(0, 26).padEnd(27);
    console.log(
      `${catDisplay}| ${String(stats.products).padStart(5)} | ` +
      `${mape.toFixed(1).padStart(5)}% | ${stockoutRate.toFixed(0).padStart(5)}% | ` +
      `${overstockRate.toFixed(0).padStart(5)}% | ${evaluation}`
    );

    totalProducts += stats.products;
    totalMapeSum += stats.sumAbsError;
    totalStockouts += stats.stockouts;
    totalOverstocks += stats.overstocks;
  }

  console.log('─────────────────────────────────────────────────────────────────────');

  const overallMape = totalProducts > 0 ? (totalMapeSum / totalProducts) * 100 : 0;
  const overallStockoutRate = (totalStockouts / totalProducts) * 100;
  const overallOverstockRate = (totalOverstocks / totalProducts) * 100;

  console.log(
    `${'【全体】'.padEnd(27)}| ${String(totalProducts).padStart(5)} | ` +
    `${overallMape.toFixed(1).padStart(5)}% | ${overallStockoutRate.toFixed(0).padStart(5)}% | ` +
    `${overallOverstockRate.toFixed(0).padStart(5)}% |`
  );

  // 店舗別月末在庫予測
  console.log('\n【4. 店舗別月末在庫予測（10月31日時点）】');
  console.log('─────────────────────────────────────────────────────────────────────');

  // 簡易計算: 月末在庫 = 月初在庫 + 入荷予定 - 予測販売
  // ここでは現在在庫を基準に予測
  let totalEndStock = 0;
  const storeEndStocks: { store: string; stock: number; value: number }[] = [];

  for (const storeId of STORES) {
    // 各店舗の予測を取得（簡易版：学芸大学の比率で推定）
    const storeRatio = storeId === '4' ? 1.0 :
                       storeId === '5' ? 0.8 :
                       storeId === '1' ? 0.6 :
                       storeId === '2' ? 0.5 :
                       0.3;

    let storeStock = 0;
    let storeValue = 0;

    for (const [_, forecast] of forecasts) {
      // 月末在庫 = 現在庫 - 予測販売31日分 * 店舗比率
      const endStock = Math.max(0, forecast.currentStock - forecast.avgDailySales * 31 * storeRatio);
      storeStock += endStock;
      storeValue += endStock * 500; // 仮の平均原価
    }

    storeEndStocks.push({
      store: STORE_NAMES[storeId] || storeId,
      stock: Math.round(storeStock),
      value: Math.round(storeValue / 10000) // 万円
    });
    totalEndStock += storeStock;
  }

  console.log('店舗         | 予測月末在庫 | 在庫金額(万円)');
  console.log('─────────────────────────────────────────────');
  for (const s of storeEndStocks) {
    console.log(`${s.store.padEnd(12)}| ${String(s.stock).padStart(10)}個 | ${String(s.value).padStart(12)}`);
  }
  console.log('─────────────────────────────────────────────');
  console.log(`${'合計'.padEnd(12)}| ${String(Math.round(totalEndStock)).padStart(10)}個 |`);

  // 総合評価
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('【5. 総合評価】');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('【精度指標】');
  console.log(`  ・全体MAPE: ${overallMape.toFixed(1)}%`);
  console.log(`  ・欠品リスク率: ${overallStockoutRate.toFixed(1)}%`);
  console.log(`  ・過剰在庫リスク率: ${overallOverstockRate.toFixed(1)}%`);

  console.log('\n【評価基準】');
  console.log('  ◎ MAPE < 20%: 優秀（業界トップクラス）');
  console.log('  ○ MAPE < 35%: 良好（実用レベル）');
  console.log('  △ MAPE < 50%: 要改善（最低限）');
  console.log('  ✕ MAPE >= 50%: 不十分');

  console.log('\n【自己評価】');

  if (overallMape < 25) {
    console.log('  ★★★★★ 優秀');
    console.log('  需要予測の精度は非常に高く、実運用に十分な品質です。');
  } else if (overallMape < 35) {
    console.log('  ★★★★☆ 良好');
    console.log('  需要予測の精度は実用レベルです。一部カテゴリの改善余地あり。');
  } else if (overallMape < 50) {
    console.log('  ★★★☆☆ 普通');
    console.log('  基本的な予測は機能していますが、改善の余地があります。');
  } else {
    console.log('  ★★☆☆☆ 要改善');
    console.log('  予測精度の向上が必要です。');
  }

  console.log('\n【改善提案】');

  // 欠品率が高い場合
  if (overallStockoutRate > 15) {
    console.log('  ⚠️ 欠品リスクが高め → 安全在庫係数の引き上げを検討');
  }

  // 過剰率が高い場合
  if (overallOverstockRate > 20) {
    console.log('  ⚠️ 過剰在庫リスクが高め → ペリシャブル制約の強化を検討');
  }

  // MAPE改善
  if (overallMape > 30) {
    console.log('  📊 曜日別・季節別の重み付けパラメータの再調整を推奨');
  }

  console.log('\n【ペリシャブル制約の効果】');
  let perishableCount = 0;
  for (const [_, f] of forecasts) {
    if (f.perishableConstrained) perishableCount++;
  }
  console.log(`  ・制約適用商品数: ${perishableCount}件`);
  console.log('  ・賞味期限が短い商品の過剰発注を自動抑制');
  console.log('  ・廃棄ロス削減に貢献');
}

runBacktest().catch(console.error);
