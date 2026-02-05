/**
 * 新宿店 売上予測精度分析スクリプト
 *
 * バックエンドAPI経由でデータを取得し、複数の参照期間での予測精度を分析
 */

const API_BASE = 'https://fc-demand-forecast-production.up.railway.app';

// ════════════════════════════════════════════════
// 定数
// ════════════════════════════════════════════════
const STORE_ID = '1'; // 新宿店
const TARGET_DATE = '2026-02-04'; // 在庫取得日
const FORECAST_START = '2026-01-29'; // 予測対象期間の開始
const FORECAST_END = '2026-02-04'; // 予測対象期間の終了
const FORECAST_DAYS = 7;

// 参照期間（lookbackDays）
const LOOKBACK_PERIODS = [
  { name: '1週間', days: 7 },
  { name: '2週間', days: 14 },
  { name: '4週間', days: 28 },
  { name: '3ヶ月', days: 90 },
];

// ════════════════════════════════════════════════
// API呼び出しヘルパー
// ════════════════════════════════════════════════
async function fetchApi(endpoint: string, options?: RequestInit): Promise<any> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

// ════════════════════════════════════════════════
// ユーティリティ
// ════════════════════════════════════════════════
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
// メイン分析関数
// ════════════════════════════════════════════════
async function analyzeShinjukuForecast() {
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('【新宿店 売上予測精度分析】');
  console.log(`予測対象期間: ${FORECAST_START} 〜 ${FORECAST_END} (${FORECAST_DAYS}日間)`);
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  // ── 1. 在庫情報取得 ──
  console.log('📦 Step 1: 新宿店の在庫情報を取得中...');
  let stockData;
  try {
    stockData = await fetchApi(`/api/stock?storeIds=${STORE_ID}`);
    console.log(`  - 在庫データ取得成功`);
  } catch (e) {
    console.error('  - 在庫データ取得失敗:', e);
    stockData = { products: {} };
  }

  const stockMap = new Map<string, { productId: string; productName: string; stock: number; categoryName: string; supplierName: string }>();
  if (stockData.products) {
    Object.entries(stockData.products).forEach(([pid, info]: [string, any]) => {
      const storeStock = info.stores?.[STORE_ID] || { stockAmount: 0 };
      if (storeStock.stockAmount > 0) {
        stockMap.set(pid, {
          productId: pid,
          productName: info.productName || '不明',
          stock: storeStock.stockAmount,
          categoryName: info.categoryName || '不明',
          supplierName: info.supplierName || '不明'
        });
      }
    });
  }

  console.log(`  - 在庫あり商品数: ${stockMap.size}`);

  // ── 2. 全仕入先リスト取得 ──
  console.log('\n📋 Step 2: 仕入先リストを取得中...');
  let suppliersData;
  try {
    suppliersData = await fetchApi('/api/forecast/suppliers?limit=1000');
    console.log(`  - 仕入先数: ${suppliersData.suppliers?.length || 0}`);
  } catch (e) {
    console.error('  - 仕入先取得失敗:', e);
    suppliersData = { suppliers: [] };
  }

  const supplierNames = suppliersData.suppliers?.map((s: any) => s.supplier_name) || [];

  // ── 3. 各参照期間で予測を実行 ──
  console.log('\n🔮 Step 3: 各参照期間で売上予測を実行中...');

  interface ForecastResult {
    lookbackName: string;
    lookbackDays: number;
    products: any[];
    totalForecast: number;
    summary: any;
  }

  const forecastResults: ForecastResult[] = [];

  for (const period of LOOKBACK_PERIODS) {
    console.log(`  - ${period.name}（${period.days}日）の予測を計算中...`);

    try {
      // 予測のorderDateはFORECAST_STARTの前日（1/28）に設定
      // そうすることでFORECAST_START（1/29）から7日間の予測になる
      const orderDate = addDays(FORECAST_START, -1); // 2026-01-28

      const result = await fetchApi('/api/forecast/calculate', {
        method: 'POST',
        body: JSON.stringify({
          storeId: STORE_ID,
          supplierNames: supplierNames.slice(0, 50), // 上位50社
          orderDate: orderDate,
          forecastDays: FORECAST_DAYS,
          lookbackDays: period.days
        })
      });

      const products: any[] = [];
      result.supplierGroups?.forEach((g: any) => {
        g.products?.forEach((p: any) => {
          products.push(p);
        });
      });

      forecastResults.push({
        lookbackName: period.name,
        lookbackDays: period.days,
        products,
        totalForecast: products.reduce((sum: number, p: any) => sum + (p.forecastQuantity || 0), 0),
        summary: result.summary
      });

      console.log(`    予測商品数: ${products.length}, 予測合計: ${products.reduce((sum: number, p: any) => sum + (p.forecastQuantity || 0), 0).toFixed(0)}個`);
    } catch (e) {
      console.error(`    ${period.name}の予測失敗:`, e);
      forecastResults.push({
        lookbackName: period.name,
        lookbackDays: period.days,
        products: [],
        totalForecast: 0,
        summary: {}
      });
    }
  }

  // ── 4. 実売上データを取得（商品詳細APIから） ──
  console.log('\n📊 Step 4: 実売上データを取得中...');

  // forecastResultsから全商品IDを収集
  const allProductIds = new Set<string>();
  forecastResults.forEach(fr => {
    fr.products.forEach(p => allProductIds.add(p.productId));
  });
  stockMap.forEach((_, pid) => allProductIds.add(pid));

  console.log(`  - 分析対象商品数: ${allProductIds.size}`);

  // 商品ごとの実売上を取得（サンプリング）
  const actualSalesMap = new Map<string, number>();
  const sampleProductIds = Array.from(allProductIds).slice(0, 100); // 最大100商品をサンプル

  console.log(`  - ${sampleProductIds.length}商品の売上詳細を取得中...`);

  for (const pid of sampleProductIds) {
    try {
      const detail = await fetchApi(`/api/forecast/product-sales-history?productId=${pid}&storeId=${STORE_ID}&weeks=8`);

      // 週別データから1/29-2/4の週を特定
      // detail.weeksは週ごとのデータ。週の開始日(weekStart)で判定
      if (detail.weeks) {
        for (const week of detail.weeks) {
          const weekStart = week.weekStart;
          // 1/29-2/4に該当する週を探す
          if (weekStart && weekStart >= '2026-01-27' && weekStart <= '2026-02-02') {
            actualSalesMap.set(pid, week.quantity || 0);
            break;
          }
        }
      }
    } catch (e) {
      // 個別商品のエラーは無視
    }
  }

  console.log(`  - 売上データ取得完了: ${actualSalesMap.size}商品`);

  // ── 5. 分析・レポート出力 ──
  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('【分析結果】');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  // 5.1 在庫サマリー
  console.log('▼ 新宿店 在庫サマリー（2/4時点）');
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log(`  在庫あり商品数: ${stockMap.size}件`);
  console.log(`  在庫総数: ${Array.from(stockMap.values()).reduce((a, b) => a + b.stock, 0)}個`);

  // 5.2 参照期間別の予測結果
  console.log('\n▼ 参照期間別 予測結果');
  console.log('─────────────────────────────────────────────────────────────────────');
  console.log('参照期間 | 予測商品数 |  予測合計 | 発注推奨商品 |  発注合計金額');
  console.log('─────────────────────────────────────────────────────────────────────');

  for (const fr of forecastResults) {
    const productsWithOrder = fr.products.filter(p => p.recommendedOrder > 0).length;
    const totalOrderAmount = fr.products.reduce((sum, p) => sum + (p.orderAmount || 0), 0);

    console.log(
      `${fr.lookbackName.padEnd(6)} | ` +
      `${String(fr.products.length).padStart(9)} | ` +
      `${fr.totalForecast.toFixed(0).padStart(8)}個 | ` +
      `${String(productsWithOrder).padStart(11)} | ` +
      `¥${totalOrderAmount.toLocaleString().padStart(12)}`
    );
  }

  // 5.3 精度比較（実売上データがある場合）
  if (actualSalesMap.size > 10) {
    console.log('\n▼ 参照期間別 予測精度比較（サンプル商品）');
    console.log('─────────────────────────────────────────────────────────────────────');
    console.log('参照期間 |   予測合計 |   実売上 |   誤差 |  誤差率 | 評価');
    console.log('─────────────────────────────────────────────────────────────────────');

    interface PeriodStat {
      name: string;
      totalForecast: number;
      totalActual: number;
      error: number;
      errorRate: number;
    }
    const periodStats: PeriodStat[] = [];

    for (const fr of forecastResults) {
      let totalForecast = 0;
      let totalActual = 0;

      fr.products.forEach(p => {
        if (actualSalesMap.has(p.productId)) {
          totalForecast += p.forecastQuantity || 0;
          totalActual += actualSalesMap.get(p.productId) || 0;
        }
      });

      const error = totalForecast - totalActual;
      const errorRate = totalActual > 0 ? (error / totalActual * 100) : 0;
      const evaluation =
        Math.abs(errorRate) < 10 ? '◎ 優秀' :
        Math.abs(errorRate) < 20 ? '○ 良好' :
        Math.abs(errorRate) < 30 ? '△ 許容' : '✕ 要改善';

      console.log(
        `${fr.lookbackName.padEnd(6)} | ` +
        `${totalForecast.toFixed(0).padStart(9)} | ` +
        `${totalActual.toFixed(0).padStart(7)} | ` +
        `${(error > 0 ? '+' : '') + error.toFixed(0).padStart(5)} | ` +
        `${(errorRate > 0 ? '+' : '') + errorRate.toFixed(1).padStart(5)}% | ` +
        `${evaluation}`
      );

      periodStats.push({
        name: fr.lookbackName,
        totalForecast,
        totalActual,
        error,
        errorRate
      });
    }

    // 最適な参照期間を特定
    const bestPeriod = periodStats.reduce((best, current) =>
      Math.abs(current.error) < Math.abs(best.error) ? current : best
    );

    console.log('\n═══════════════════════════════════════════════════════════════════');
    console.log(`【推奨】総誤差が最小の参照期間: ${bestPeriod.name}`);
    console.log(`  - 誤差: ${bestPeriod.error.toFixed(0)}個 (${bestPeriod.errorRate.toFixed(1)}%)`);
    console.log('═══════════════════════════════════════════════════════════════════');
  }

  // 5.4 カテゴリ別集計（4週間参照）
  const fr4w = forecastResults.find(fr => fr.lookbackName === '4週間');
  if (fr4w && fr4w.products.length > 0) {
    console.log('\n▼ カテゴリ別 予測サマリー（参照期間: 4週間）');
    console.log('─────────────────────────────────────────────────────────────────────');

    const categoryStats = new Map<string, {
      categoryName: string;
      productCount: number;
      totalForecast: number;
      totalStock: number;
      totalOrder: number;
    }>();

    fr4w.products.forEach(p => {
      const cat = p.categoryName || '不明';
      const existing = categoryStats.get(cat) || {
        categoryName: cat,
        productCount: 0,
        totalForecast: 0,
        totalStock: 0,
        totalOrder: 0
      };
      existing.productCount++;
      existing.totalForecast += p.forecastQuantity || 0;
      existing.totalStock += p.currentStock || 0;
      existing.totalOrder += p.recommendedOrder || 0;
      categoryStats.set(cat, existing);
    });

    const sortedCategories = [...categoryStats.values()]
      .sort((a, b) => b.totalForecast - a.totalForecast)
      .slice(0, 15);

    console.log('カテゴリ               | 商品数 |  予測数 |  在庫 |  発注推奨');
    console.log('─────────────────────────────────────────────────────────────────────');

    for (const cat of sortedCategories) {
      console.log(
        `${cat.categoryName.slice(0, 20).padEnd(20)} | ` +
        `${String(cat.productCount).padStart(5)} | ` +
        `${cat.totalForecast.toFixed(0).padStart(6)} | ` +
        `${cat.totalStock.toFixed(0).padStart(4)} | ` +
        `${cat.totalOrder.toFixed(0).padStart(8)}`
      );
    }
  }

  // 5.5 仕入先別集計
  if (fr4w && fr4w.products.length > 0) {
    console.log('\n▼ 仕入先別 予測サマリー（上位10社、参照期間: 4週間）');
    console.log('─────────────────────────────────────────────────────────────────────');

    const supplierStats = new Map<string, {
      supplierName: string;
      productCount: number;
      totalForecast: number;
      totalStock: number;
      totalOrder: number;
      totalOrderAmount: number;
    }>();

    fr4w.products.forEach(p => {
      const supp = p.supplierName || '不明';
      const existing = supplierStats.get(supp) || {
        supplierName: supp,
        productCount: 0,
        totalForecast: 0,
        totalStock: 0,
        totalOrder: 0,
        totalOrderAmount: 0
      };
      existing.productCount++;
      existing.totalForecast += p.forecastQuantity || 0;
      existing.totalStock += p.currentStock || 0;
      existing.totalOrder += p.recommendedOrder || 0;
      existing.totalOrderAmount += p.orderAmount || 0;
      supplierStats.set(supp, existing);
    });

    const sortedSuppliers = [...supplierStats.values()]
      .sort((a, b) => b.totalOrderAmount - a.totalOrderAmount)
      .slice(0, 10);

    console.log('仕入先                 | 商品数 |  予測数 |  発注数 |    発注金額');
    console.log('─────────────────────────────────────────────────────────────────────');

    for (const supp of sortedSuppliers) {
      console.log(
        `${supp.supplierName.slice(0, 20).padEnd(20)} | ` +
        `${String(supp.productCount).padStart(5)} | ` +
        `${supp.totalForecast.toFixed(0).padStart(6)} | ` +
        `${supp.totalOrder.toFixed(0).padStart(6)} | ` +
        `¥${supp.totalOrderAmount.toLocaleString().padStart(10)}`
      );
    }
  }

  // 5.6 ABC分析サマリー
  if (fr4w && fr4w.summary?.abcSummary) {
    console.log('\n▼ ABCランク別 予測サマリー（参照期間: 4週間）');
    console.log('─────────────────────────────────────────────────────────────────────');

    const abcStats = new Map<string, {
      rank: string;
      productCount: number;
      totalForecast: number;
      totalOrder: number;
    }>();

    fr4w.products.forEach(p => {
      const rank = p.abcRank || 'E';
      const existing = abcStats.get(rank) || {
        rank,
        productCount: 0,
        totalForecast: 0,
        totalOrder: 0
      };
      existing.productCount++;
      existing.totalForecast += p.forecastQuantity || 0;
      existing.totalOrder += p.recommendedOrder || 0;
      abcStats.set(rank, existing);
    });

    console.log('ランク | 商品数 |  予測数 |  発注数 | 備考');
    console.log('─────────────────────────────────────────────────────────────────────');

    ['A', 'B', 'C', 'D', 'E'].forEach(rank => {
      const stat = abcStats.get(rank);
      if (stat) {
        const note = rank === 'A' ? '売上上位50%、高安全在庫' :
                    rank === 'B' ? '売上50-75%、中安全在庫' :
                    rank === 'C' ? '売上75-90%、低安全在庫' :
                    rank === 'D' ? '売上90-97%、最小在庫' : '売上下位3%、発注抑制';
        console.log(
          `   ${rank}   | ` +
          `${String(stat.productCount).padStart(5)} | ` +
          `${stat.totalForecast.toFixed(0).padStart(6)} | ` +
          `${stat.totalOrder.toFixed(0).padStart(6)} | ` +
          `${note}`
        );
      }
    });
  }

  // 5.7 改善提案
  console.log('\n════════════════════════════════════════════════════════════════════════════════');
  console.log('【調整すべき点・改善提案】');
  console.log('════════════════════════════════════════════════════════════════════════════════\n');

  const recommendations: string[] = [];

  // 参照期間の比較から提案
  if (forecastResults.length >= 4) {
    const fr1w = forecastResults.find(f => f.lookbackName === '1週間');
    const fr3m = forecastResults.find(f => f.lookbackName === '3ヶ月');

    if (fr1w && fr3m && fr4w) {
      // 短期と長期の予測差を分析
      const diff1w4w = Math.abs(fr1w.totalForecast - fr4w.totalForecast);
      const diff3m4w = Math.abs(fr3m.totalForecast - fr4w.totalForecast);

      if (diff1w4w > fr4w.totalForecast * 0.2) {
        recommendations.push('【トレンド変化の可能性】1週間と4週間の予測差が大きいです。直近の売上トレンドに変化がある可能性があります。短期データをより重視する設定を検討してください。');
      }

      if (diff3m4w < fr4w.totalForecast * 0.1) {
        recommendations.push('【安定した売上パターン】3ヶ月と4週間の予測がほぼ同等です。季節性が安定しているため、現行の4週間参照が適切です。');
      }
    }
  }

  // カテゴリ別の問題検出
  if (fr4w) {
    const perishableProducts = fr4w.products.filter(p => p.perishableConstrained);
    if (perishableProducts.length > 0) {
      recommendations.push(`【ペリシャブル制約】${perishableProducts.length}商品でペリシャブル制約が適用されています。賞味期限の短い商品は発注量が自動調整されています。`);
    }

    const anomalyProducts = fr4w.products.filter(p => p.hasAnomaly);
    if (anomalyProducts.length > 0) {
      const stockouts = anomalyProducts.filter(p => p.alertFlags?.includes('stockout')).length;
      const lowStock = anomalyProducts.filter(p => p.alertFlags?.includes('low_stock')).length;
      recommendations.push(`【在庫アラート】${anomalyProducts.length}商品で異常を検知（欠品: ${stockouts}, 在庫少: ${lowStock}）。これらの商品の発注優先度を上げることを検討してください。`);
    }
  }

  // 一般的な提案
  recommendations.push('【参照期間の調整】季節商品やイベント商品は短い参照期間（1-2週間）、定番商品は長い参照期間（4週間以上）を使い分けることで精度向上が期待できます。');
  recommendations.push('【曜日パターンの活用】新宿店は週末の売上が高い傾向がある場合、曜日インデックスの重み付けを強化することで予測精度が向上します。');

  recommendations.forEach((rec, i) => {
    console.log(`${i + 1}. ${rec}\n`);
  });

  // 最終サマリー
  console.log('════════════════════════════════════════════════════════════════════════════════');
  console.log('【最終サマリー】');
  console.log('════════════════════════════════════════════════════════════════════════════════');

  const totalStock = Array.from(stockMap.values()).reduce((a, b) => a + b.stock, 0);

  console.log(`
  ■ 分析日時: ${new Date().toISOString()}
  ■ 対象店舗: 新宿店（storeId: ${STORE_ID}）
  ■ 予測対象期間: ${FORECAST_START} 〜 ${FORECAST_END} (${FORECAST_DAYS}日間)

  ■ 在庫状況（2/4時点）:
    - 在庫あり商品: ${stockMap.size}件
    - 在庫総数: ${totalStock}個

  ■ 予測結果（4週間参照、現行設定）:
    - 予測商品数: ${fr4w?.products.length || 0}件
    - 予測需要合計: ${fr4w?.totalForecast.toFixed(0) || 0}個
    - 発注推奨商品: ${fr4w?.products.filter(p => p.recommendedOrder > 0).length || 0}件
    - 発注金額合計: ¥${(fr4w?.products.reduce((sum, p) => sum + (p.orderAmount || 0), 0) || 0).toLocaleString()}

  ■ 参照期間別予測合計:
    - 1週間: ${forecastResults.find(f => f.lookbackName === '1週間')?.totalForecast.toFixed(0) || 0}個
    - 2週間: ${forecastResults.find(f => f.lookbackName === '2週間')?.totalForecast.toFixed(0) || 0}個
    - 4週間: ${forecastResults.find(f => f.lookbackName === '4週間')?.totalForecast.toFixed(0) || 0}個
    - 3ヶ月: ${forecastResults.find(f => f.lookbackName === '3ヶ月')?.totalForecast.toFixed(0) || 0}個
  `);

  console.log('\n分析完了');
}

// 実行
analyzeShinjukuForecast().catch(console.error);
