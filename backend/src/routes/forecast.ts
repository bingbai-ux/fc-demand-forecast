/**
 * 需要予測APIルート（統合版）
 *
 * V1・V2を統合。HTTPルーティングのみを担当し、
 * 計算ロジックは forecast-engine.ts に委譲する。
 *
 * ── エンドポイント一覧 ──
 *   POST /calculate              需要予測計算（メイン）
 *   GET  /stores                 店舗一覧
 *   GET  /suppliers              仕入先一覧
 *   GET  /product-sales-history  商品の時系列売上
 *   GET  /product-detail/:id     商品詳細
 *   POST /simulate-stock         在庫シミュレーション
 *   GET  /stockout-analysis/:id  欠品コスト分析
 *   GET  /adjustments            調整係数取得
 *   POST /adjustments            調整係数保存
 */

import { Router } from 'express';
import { supabase } from '../config/supabase';
import { executeForecast, todayJST } from '../services/forecast-engine';
import { saveForecastSnapshot, runDailyLearning, getAccuracySummary } from '../services/forecast-learner';
import { DEFAULT_EXCLUDED_CATEGORY_IDS, ACTIVE_PRODUCT_LOOKBACK_DAYS } from '../config/constants';

const router = Router();

// ════════════════════════════════════════════════
// POST /calculate — 需要予測メイン
// ════════════════════════════════════════════════
router.post('/calculate', async (req, res) => {
  try {
    const { storeId, supplierNames, orderDate, forecastDays, lookbackDays } = req.body;

    if (!storeId) {
      return res.status(400).json({ success: false, error: '店舗IDが必要です' });
    }
    if (!supplierNames || !Array.isArray(supplierNames) || supplierNames.length === 0) {
      return res.status(400).json({ success: false, error: '仕入先を選択してください' });
    }

    const od = orderDate || todayJST();
    const fd = forecastDays || 7;
    const lb = lookbackDays || 28;

    const result = await executeForecast({
      storeId,
      supplierNames,
      orderDate: od,
      forecastDays: fd,
      lookbackDays: lb,
    });

    // 予測スナップショットを非同期で保存（レスポンスを遅延させない）
    if (result.success && result.supplierGroups) {
      const allProducts = result.supplierGroups.flatMap((g: any) => g.products || []);
      saveForecastSnapshot(storeId, od, fd, lb, allProducts).catch((err) => {
        console.error('[Snapshot] 保存エラー（無視）:', err.message);
      });
    }

    res.json(result);
  } catch (error: any) {
    console.error('需要予測計算エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════
// POST /learn — 手動で学習を実行
// ════════════════════════════════════════════════
router.post('/learn', async (_req, res) => {
  try {
    const result = await runDailyLearning();
    res.json({ success: true, ...result });
  } catch (error: any) {
    console.error('学習実行エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════
// GET /accuracy/:storeId — 精度ダッシュボード
// ════════════════════════════════════════════════
router.get('/accuracy/:storeId', async (req, res) => {
  try {
    const summary = await getAccuracySummary(req.params.storeId);
    res.json({ success: true, ...summary });
  } catch (error: any) {
    console.error('精度サマリー取得エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════
// GET /stores — 店舗一覧
// ════════════════════════════════════════════════
router.get('/stores', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('stores_cache')
      .select('*')
      .order('store_id');
    if (error) throw error;
    res.json({ success: true, data: data || [] });
  } catch (error: any) {
    console.error('店舗一覧取得エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════
// GET /suppliers — 仕入先一覧（ページネーション対応）
// ════════════════════════════════════════════════
router.get('/suppliers', async (_req, res) => {
  try {
    const PAGE = 1000;
    let all: { supplier_name: string | null }[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from('products_cache')
        .select('supplier_name')
        .not('supplier_name', 'is', null)
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      all = all.concat(data);
      if (data.length < PAGE) break;
      from += PAGE;
    }

    const unique = [...new Set(
      all.map((d) => d.supplier_name).filter((n): n is string => !!n && n.trim() !== ''),
    )].sort((a, b) => a.localeCompare(b, 'ja'));

    res.json({ success: true, data: unique });
  } catch (error: any) {
    console.error('仕入先一覧取得エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════
// GET /product-sales-history — 商品の時系列売上
// ════════════════════════════════════════════════
router.get('/product-sales-history', async (req, res) => {
  try {
    const { productId, storeId, weeks = 8 } = req.query;
    if (!productId || !storeId) {
      return res.status(400).json({ success: false, error: 'productId and storeId are required' });
    }

    const today = todayJST();
    const numWeeks = Number(weeks);
    const startDate = addDaysSimple(today, -(numWeeks * 7));

    const { data: salesData, error } = await supabase
      .from('sales_daily_summary')
      .select('sale_date, total_quantity')
      .eq('product_id', String(productId))
      .eq('store_id', String(storeId))
      .gte('sale_date', startDate)
      .lte('sale_date', today)
      .order('sale_date', { ascending: true });
    if (error) throw error;

    // 週ごと集計
    const weeklyData: { weekStart: string; weekEnd: string; quantity: number }[] = [];
    for (let w = numWeeks - 1; w >= 0; w--) {
      const weStr = addDaysSimple(today, -(w * 7));
      const wsStr = addDaysSimple(weStr, -6);
      const qty = (salesData || [])
        .filter((s: any) => s.sale_date >= wsStr && s.sale_date <= weStr)
        .reduce((sum: number, s: any) => sum + (Number(s.total_quantity) || 0), 0);
      const wsD = new Date(wsStr + 'T12:00:00Z');
      const weD = new Date(weStr + 'T12:00:00Z');
      weeklyData.push({
        weekStart: `${wsD.getUTCMonth() + 1}/${wsD.getUTCDate()}`,
        weekEnd: `${weD.getUTCMonth() + 1}/${weD.getUTCDate()}`,
        quantity: qty,
      });
    }

    const quantities = weeklyData.map((w) => w.quantity);
    const avgQuantity = quantities.length > 0
      ? quantities.reduce((s, q) => s + q, 0) / quantities.length
      : 0;

    res.json({
      success: true,
      productId,
      storeId,
      period: { start: startDate, end: today, weeks: numWeeks },
      weeklyData,
      avgQuantity: Math.round(avgQuantity * 10) / 10,
    });
  } catch (error: any) {
    console.error('商品売上履歴取得エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════
// GET /product-detail/:productId — 商品詳細
// ════════════════════════════════════════════════
router.get('/product-detail/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { storeId, days = '30' } = req.query;
    const today = todayJST();
    const startDate = addDaysSimple(today, -Number(days));

    const [salesRes, productRes, lotRes, stockRes] = await Promise.all([
      supabase.from('sales_daily_summary')
        .select('sale_date, total_quantity')
        .eq('product_id', String(productId))
        .eq('store_id', String(storeId))
        .gte('sale_date', startDate)
        .lte('sale_date', today)
        .order('sale_date', { ascending: true }),
      supabase.from('products_cache').select('*').eq('product_id', productId).single(),
      supabase.from('product_order_lots').select('*').eq('product_id', productId).single(),
      supabase.from('stock_cache').select('*').eq('product_id', productId).eq('store_id', storeId).single(),
    ]);

    const salesHistory = salesRes.data || [];
    const product = productRes.data;
    const lot = lotRes.data;
    const stock = stockRes.data;

    const quantities = salesHistory.map((s: any) => Number(s.total_quantity) || 0);
    const avgDailySales = quantities.length > 0
      ? quantities.reduce((a: number, b: number) => a + b, 0) / Number(days)
      : 0;

    const currentStock = stock?.stock_amount || 0;
    const leadTime = lot?.lead_time || 2;

    const simulation = simulateStock({
      currentStock,
      avgDailySales,
      leadTime,
      days: 14,
    });

    res.json({
      success: true,
      data: {
        productId,
        productName: product?.product_name || '',
        productCode: product?.product_code || '',
        category: product?.category_name || '',
        currentStock,
        unitPrice: parseFloat(product?.price) || 0,
        orderLot: lot?.order_lot || 1,
        leadTime,
        supplierName: lot?.supplier_name || product?.supplier_name || '',
        avgDailySales: Math.round(avgDailySales * 100) / 100,
        salesHistory: salesHistory.map((s: any) => ({
          date: s.sale_date,
          quantity: Number(s.total_quantity) || 0,
        })),
        simulation,
      },
    });
  } catch (error: any) {
    console.error('商品詳細取得エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════
// POST /simulate-stock — 在庫シミュレーション
// ════════════════════════════════════════════════
router.post('/simulate-stock', async (req, res) => {
  try {
    const {
      currentStock,
      avgDailySales,
      leadTime,
      orderQuantity = 0,
      safetyStock = 0,
      days = 14,
    } = req.body;

    const simulation = simulateStock({ currentStock, avgDailySales, leadTime, days, orderQuantity });
    const stockoutEntry = simulation.find((s) => s.stock <= 0 && s.projected);
    const belowSafety = simulation.find((s) => s.stock < safetyStock && s.projected);

    res.json({
      success: true,
      simulation,
      analysis: {
        willStockout: !!stockoutEntry,
        stockoutDate: stockoutEntry?.date,
        daysUntilStockout: stockoutEntry ? simulation.indexOf(stockoutEntry) : null,
        willBelowSafety: !!belowSafety,
        belowSafetyDate: belowSafety?.date,
        minStock: Math.min(...simulation.map((s) => s.stock)),
        maxStock: Math.max(...simulation.map((s) => s.stock)),
      },
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════
// GET /stockout-analysis/:storeId — 欠品コスト分析
// ════════════════════════════════════════════════
// 改善版: 現行品（在庫>0 OR 直近60日売上あり）のみを対象
// 青果・果物カテゴリは除外
router.get('/stockout-analysis/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;
    const { month } = req.query;
    const targetMonth = month ? String(month) : todayJST().slice(0, 7);
    const [year, monthNum] = targetMonth.split('-').map(Number);
    const startDate = `${year}-${String(monthNum).padStart(2, '0')}-01`;
    const endDate = new Date(year, monthNum, 0).toISOString().split('T')[0];
    const daysInMonth = new Date(year, monthNum, 0).getDate();

    // Step 1: 全在庫データを取得
    const { data: allStockData } = await supabase
      .from('stock_cache')
      .select('product_id, stock_amount')
      .eq('store_id', storeId);

    // Step 2: 直近N日に売上がある商品IDを取得（現行品判定用）
    const activeStartDate = addDaysSimple(startDate, -ACTIVE_PRODUCT_LOOKBACK_DAYS);
    const { data: recentSalesData } = await supabase
      .from('sales_daily_summary')
      .select('product_id')
      .eq('store_id', storeId)
      .gte('sale_date', activeStartDate)
      .lte('sale_date', endDate);

    const recentSalesIds = new Set(
      (recentSalesData || []).map((s: any) => String(s.product_id))
    );

    // Step 3: 在庫マップを構築
    const stockMap = new Map<string, number>();
    (allStockData || []).forEach((s: any) =>
      stockMap.set(String(s.product_id), Number(s.stock_amount) || 0)
    );

    // Step 4: 現行品かつ在庫ゼロの商品を特定
    // 現行品 = 在庫 > 0 OR 直近60日に売上あり
    const stockoutIds = (allStockData || [])
      .filter((s: any) => {
        const pid = String(s.product_id);
        const stock = Number(s.stock_amount) || 0;
        const hasRecentSales = recentSalesIds.has(pid);
        // 在庫ゼロかつ現行品（直近売上あり）の場合のみ欠品
        return stock <= 0 && hasRecentSales;
      })
      .map((s: any) => String(s.product_id));

    if (stockoutIds.length === 0) {
      return res.json({
        success: true,
        data: {
          month: targetMonth,
          summary: { totalLoss: 0, totalStockoutDays: 0, totalProducts: 0, stockoutRate: 0, lossChangePercent: 0, daysChangePercent: 0 },
          byRank: defaultRankSummary(),
          topStockoutProducts: [],
          allStockoutProducts: [],
        },
      });
    }

    // Step 5: 商品マスタを取得（青果・果物カテゴリは除外）
    const { data: products } = await supabase
      .from('products_cache')
      .select('product_id, product_name, price, cost, category_id')
      .in('product_id', stockoutIds.slice(0, 500));

    // 除外カテゴリをフィルタ
    const filteredProducts = (products || []).filter(
      (p: any) => !DEFAULT_EXCLUDED_CATEGORY_IDS.includes(String(p.category_id))
    );

    const productMap = new Map<string, any>();
    filteredProducts.forEach((p: any) => productMap.set(String(p.product_id), p));

    // フィルタ後のIDリスト
    const filteredStockoutIds = stockoutIds.filter((pid) => productMap.has(pid));

    // Step 6: 売上データを取得
    const { data: salesData } = await supabase
      .from('sales_daily_summary')
      .select('product_id, total_quantity')
      .eq('store_id', storeId)
      .gte('sale_date', startDate)
      .lte('sale_date', endDate)
      .in('product_id', filteredStockoutIds.slice(0, 500));

    const salesTotals = new Map<string, number>();
    (salesData || []).forEach((s: any) => {
      const pid = String(s.product_id);
      salesTotals.set(pid, (salesTotals.get(pid) || 0) + Number(s.total_quantity || 0));
    });

    // Step 7: 結果を構築
    const result = filteredStockoutIds.map((pid) => {
      const p = productMap.get(pid);
      const totalSales = salesTotals.get(pid) || 0;
      const avgDaily = Math.round((totalSales / daysInMonth) * 10) / 10;
      const price = parseFloat(p?.price) || 0;
      const loss = Math.round(avgDaily * price);
      const salesAmount = totalSales * price;
      const rank = salesAmount > 100000 ? 'A' : salesAmount > 50000 ? 'B' : salesAmount > 20000 ? 'C' : salesAmount > 5000 ? 'D' : 'E';
      return { productId: pid, productName: p?.product_name || '不明', abcRank: rank, stockoutDays: 1, avgDailySales: avgDaily, unitPrice: price, estimatedLoss: loss };
    });

    const sorted = [...result].sort((a, b) => b.estimatedLoss - a.estimatedLoss);
    const totalLoss = result.reduce((s, r) => s + r.estimatedLoss, 0);

    const byRank = defaultRankSummary();
    result.forEach((r) => {
      if (byRank[r.abcRank]) {
        byRank[r.abcRank].count++;
        byRank[r.abcRank].days += r.stockoutDays;
        byRank[r.abcRank].loss += r.estimatedLoss;
      }
    });

    // 現行品数を計算（stockoutRate計算用）
    // 修正: stock_cache と sales_daily_summary の UNION を取る
    // stock_cache に存在しない商品（在庫管理対象外）も売上があれば現行品としてカウント
    const productsWithStock = new Set(
      (allStockData || [])
        .filter((s: any) => Number(s.stock_amount) > 0)
        .map((s: any) => String(s.product_id))
    );
    const activeProductIds = new Set([...productsWithStock, ...recentSalesIds]);
    const activeProductCount = activeProductIds.size;

    res.json({
      success: true,
      data: {
        month: targetMonth,
        summary: {
          totalLoss,
          totalStockoutDays: result.length,
          totalProducts: result.length,
          stockoutRate: Math.round((result.length / Math.max(activeProductCount, 1)) * 100),
          lossChangePercent: 0,
          daysChangePercent: 0,
          // デバッグ情報
          activeProductCount,
          excludedCategories: DEFAULT_EXCLUDED_CATEGORY_IDS,
        },
        byRank,
        topStockoutProducts: sorted.slice(0, 10),
        allStockoutProducts: sorted,
      },
    });
  } catch (error: any) {
    console.error('欠品コスト分析エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════
// GET/POST /adjustments — 調整係数
// ════════════════════════════════════════════════
router.get('/adjustments', async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('forecast_adjustments')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    res.json({ success: true, data: data?.[0] || null });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post('/adjustments', async (req, res) => {
  try {
    const { adjustments } = req.body;
    const { data, error } = await supabase
      .from('forecast_adjustments')
      .insert([{ adjustments }])
      .select();
    if (error) throw error;
    res.json({ success: true, data: data?.[0] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ════════════════════════════════════════════════
// ヘルパー関数
// ════════════════════════════════════════════════

function addDaysSimple(dateStr: string, n: number): string {
  const d = new Date(dateStr.split('T')[0] + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().split('T')[0];
}

function simulateStock(params: {
  currentStock: number;
  avgDailySales: number;
  leadTime: number;
  days: number;
  orderQuantity?: number;
}): Array<{ date: string; stock: number; projected: boolean; event?: string }> {
  const { currentStock, avgDailySales, leadTime, days, orderQuantity = 0 } = params;
  const result: Array<{ date: string; stock: number; projected: boolean; event?: string }> = [];
  let stock = currentStock;
  const today = todayJST();

  for (let i = 0; i <= days; i++) {
    const dateStr = addDaysSimple(today, i);
    let event: string | undefined;

    if (i === leadTime && orderQuantity > 0) {
      stock += orderQuantity;
      event = `入荷 +${orderQuantity}`;
    }

    result.push({
      date: dateStr,
      stock: Math.max(0, Math.round(stock * 10) / 10),
      projected: i > 0,
      event,
    });

    if (i < days) stock -= avgDailySales;
  }

  return result;
}

function defaultRankSummary(): Record<string, { count: number; days: number; loss: number; targetRate: number }> {
  return {
    A: { count: 0, days: 0, loss: 0, targetRate: 2 },
    B: { count: 0, days: 0, loss: 0, targetRate: 5 },
    C: { count: 0, days: 0, loss: 0, targetRate: 10 },
    D: { count: 0, days: 0, loss: 0, targetRate: 15 },
    E: { count: 0, days: 0, loss: 0, targetRate: 20 },
  };
}

export default router;
