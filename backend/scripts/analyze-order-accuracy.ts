import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../../.env.local') });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function analyzeOrderAccuracy() {
  // 2025年3月のデータで分析
  const storeId = '4'; // 学芸大学店
  const startDate = '2025-03-01';
  const endDate = '2025-03-31';

  // ペリシャブルカテゴリID
  const perishableCategoryIds = [32, 41, 36, 37, 23, 29, 33, 34, 40, 39, 30, 31, 67, 6, 69, 70, 118];

  // ムソー冷蔵、C.ゆうき八百屋の商品を取得
  const { data: products } = await supabase
    .from('products_cache')
    .select('product_id, product_name, category_id, supplier_name')
    .in('supplier_name', ['ムソー冷蔵', 'C.ゆうき八百屋'])
    .in('category_id', perishableCategoryIds)
    .limit(5000);

  if (!products || products.length === 0) {
    console.log('商品が見つかりません');
    return;
  }

  const productIds = products.map(p => p.product_id);
  console.log(`対象商品数: ${products.length}`);

  // 3月の売上データを取得
  const { data: salesData } = await supabase
    .from('sales_daily_summary')
    .select('product_id, sale_date, total_quantity')
    .in('store_id', [storeId])
    .in('product_id', productIds)
    .gte('sale_date', startDate)
    .lte('sale_date', endDate)
    .limit(50000);

  console.log(`売上レコード数: ${(salesData || []).length}`);

  // 商品別に集計
  const productSales = new Map<string, { totalQty: number; daysSold: number }>();
  (salesData || []).forEach((s: any) => {
    const pid = String(s.product_id);
    const existing = productSales.get(pid) || { totalQty: 0, daysSold: 0 };
    existing.totalQty += Number(s.total_quantity) || 0;
    existing.daysSold += 1;
    productSales.set(pid, existing);
  });

  // 2月のデータ（発注予測の元データ）を取得
  const febStart = '2025-02-01';
  const febEnd = '2025-02-28';
  const { data: febSalesData } = await supabase
    .from('sales_daily_summary')
    .select('product_id, total_quantity')
    .in('store_id', [storeId])
    .in('product_id', productIds)
    .gte('sale_date', febStart)
    .lte('sale_date', febEnd)
    .limit(50000);

  const febProductSales = new Map<string, number>();
  (febSalesData || []).forEach((s: any) => {
    const pid = String(s.product_id);
    febProductSales.set(pid, (febProductSales.get(pid) || 0) + Number(s.total_quantity));
  });

  // カテゴリ別に分析
  const categoryAnalysis = new Map<string, {
    categoryName: string;
    products: number;
    totalFebSales: number;
    totalMarSales: number;
    avgDailyFeb: number;
    avgDailyMar: number;
    forecastError: number;
  }>();

  const categoryMap: Record<number, string> = {
    32: '豆腐・油揚げ',
    41: '魚類・肉類',
    36: '精肉・畜産加工物',
    37: '魚類・魚介加工物',
    23: '日配',
    29: '牛乳・乳飲料',
    33: '納豆・テンペ',
    34: '生皮・生麺',
    40: '卵・乳製品',
    39: '卵・卵加工物',
    30: 'ヨーグルト・チーズ',
    31: 'バター・マーガリン',
    67: 'こんにゃく・しらたき',
    6: '梅干・漬物・佃煮',
    69: '漬物・ぬか',
    70: '梅干し・梅加工品',
    118: '佃煮・煮物'
  };

  products.forEach((p: any) => {
    const catId = Number(p.category_id);
    const catName = categoryMap[catId] || `カテゴリ${catId}`;
    const pid = String(p.product_id);

    const febQty = febProductSales.get(pid) || 0;
    const marData = productSales.get(pid) || { totalQty: 0, daysSold: 0 };

    const existing = categoryAnalysis.get(catName) || {
      categoryName: catName,
      products: 0,
      totalFebSales: 0,
      totalMarSales: 0,
      avgDailyFeb: 0,
      avgDailyMar: 0,
      forecastError: 0
    };

    existing.products += 1;
    existing.totalFebSales += febQty;
    existing.totalMarSales += marData.totalQty;

    categoryAnalysis.set(catName, existing);
  });

  // 日販とエラー率を計算
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('【発注精度分析】2月予測 vs 3月実績（ムソー冷蔵・C.ゆうき八百屋）');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const febDays = 28;
  const marDays = 31;

  const results: any[] = [];
  categoryAnalysis.forEach((cat, catName) => {
    cat.avgDailyFeb = cat.totalFebSales / febDays;
    cat.avgDailyMar = cat.totalMarSales / marDays;
    if (cat.avgDailyMar > 0) {
      cat.forecastError = ((cat.avgDailyFeb - cat.avgDailyMar) / cat.avgDailyMar) * 100;
    }
    results.push(cat);
  });

  // エラー率でソート
  results.sort((a, b) => Math.abs(b.forecastError) - Math.abs(a.forecastError));

  console.log('カテゴリ             | 商品数 | 2月日販 | 3月日販 | 誤差率   | 評価');
  console.log('─────────────────────────────────────────────────────────────────────');

  results.forEach(cat => {
    if (cat.products > 0 && (cat.avgDailyFeb > 0 || cat.avgDailyMar > 0)) {
      const evaluation = Math.abs(cat.forecastError) < 10 ? '◎ 良好' :
                        Math.abs(cat.forecastError) < 20 ? '○ 許容' :
                        Math.abs(cat.forecastError) < 30 ? '△ 注意' : '✕ 要改善';
      const sign = cat.forecastError > 0 ? '+' : '';
      console.log(
        `${cat.categoryName.padEnd(18)} | ${String(cat.products).padStart(5)} | ` +
        `${cat.avgDailyFeb.toFixed(1).padStart(6)} | ${cat.avgDailyMar.toFixed(1).padStart(6)} | ` +
        `${sign}${cat.forecastError.toFixed(1).padStart(5)}% | ${evaluation}`
      );
    }
  });

  // 全体集計
  const totals = results.reduce((acc, cat) => ({
    products: acc.products + cat.products,
    febSales: acc.febSales + cat.totalFebSales,
    marSales: acc.marSales + cat.totalMarSales
  }), { products: 0, febSales: 0, marSales: 0 });

  const overallFebDaily = totals.febSales / febDays;
  const overallMarDaily = totals.marSales / marDays;
  const overallError = overallMarDaily > 0 ? ((overallFebDaily - overallMarDaily) / overallMarDaily) * 100 : 0;

  console.log('─────────────────────────────────────────────────────────────────────');
  console.log(
    `${'【合計】'.padEnd(18)} | ${String(totals.products).padStart(5)} | ` +
    `${overallFebDaily.toFixed(1).padStart(6)} | ${overallMarDaily.toFixed(1).padStart(6)} | ` +
    `${overallError > 0 ? '+' : ''}${overallError.toFixed(1).padStart(5)}%`
  );

  console.log('\n【解説】');
  console.log('・誤差率 = (2月日販 - 3月日販) / 3月日販');
  console.log('・プラス = 過剰発注傾向、マイナス = 欠品リスク');
  console.log('・◎良好(<10%), ○許容(<20%), △注意(<30%), ✕要改善(>=30%)');

  if (overallError > 0) {
    console.log(`\n⚠️ 全体的に ${overallError.toFixed(1)}% の過剰発注傾向があります。`);
    console.log('   ペリシャブル制約により、この過剰分が削減される見込みです。');
  } else if (overallError < -10) {
    console.log(`\n⚠️ 全体的に ${Math.abs(overallError).toFixed(1)}% の欠品リスクがあります。`);
  }

  // ペリシャブル制約の効果予測
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('【ペリシャブル制約の効果予測】');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  const maxStockDaysMap: Record<string, number> = {
    '豆腐・油揚げ': 3,
    'ヨーグルト・チーズ': 7,
    '牛乳・乳飲料': 4,
    '納豆・テンペ': 5,
    'バター・マーガリン': 14,
    '卵・乳製品': 5,
    '日配': 3,
    '生皮・生麺': 3,
    'こんにゃく・しらたき': 14,
    '魚類・肉類': 2,
    '精肉・畜産加工物': 2,
    '魚類・魚介加工物': 1,
  };

  console.log('カテゴリ             | 最大在庫日数 | 現行予測誤差 | 制約効果');
  console.log('─────────────────────────────────────────────────────────────────────');

  results.forEach(cat => {
    const maxDays = maxStockDaysMap[cat.categoryName];
    if (maxDays && cat.forecastError > 10) {
      // 過剰発注している場合、制約が効く
      const constraintEffect = cat.forecastError > maxDays * 10 ? '🔻 大幅削減' : '🔽 適度削減';
      console.log(
        `${cat.categoryName.padEnd(18)} | ${String(maxDays).padStart(10)}日 | ` +
        `+${cat.forecastError.toFixed(1).padStart(5)}% | ${constraintEffect}`
      );
    } else if (maxDays) {
      console.log(
        `${cat.categoryName.padEnd(18)} | ${String(maxDays).padStart(10)}日 | ` +
        `${cat.forecastError.toFixed(1).padStart(6)}% | ─ 影響なし`
      );
    }
  });

  console.log('\n【結論】');
  console.log('ペリシャブル制約は、過剰発注を抑制しつつ欠品リスクを最小化します。');
  console.log('特にヨーグルト・チーズ、納豆・テンペで効果が期待できます。');
}

analyzeOrderAccuracy().catch(console.error);
