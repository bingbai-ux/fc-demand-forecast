import { Router } from 'express';
import { calculateOrderQuantityV2, calculateOrdersBatch } from '../services/order-calculator-v2';
import { calculateABCRanks, getABCSummary } from '../config/abc-ranks';
import { prisma } from '../config/database';

const router = Router();

/**
 * POST /api/v2/forecast/calculate
 * V2発注計算（ARIMA + ABC最適化）
 */
router.post('/calculate', async (req, res) => {
  try {
    const { 
      storeId, 
      supplierId, 
      targetDate = new Date().toISOString().split('T')[0],
      forecastDays = 7,
      referenceDays = 60
    } = req.body;

    if (!storeId || !supplierId) {
      return res.status(400).json({ 
        error: 'storeIdとsupplierIdが必要です' 
      });
    }

    console.log(`[V2] 発注計算開始: store=${storeId}, supplier=${supplierId}`);

    // 1. 仕入先の商品を取得（supplier_nameでも検索）
    let { data: products, error: prodError } = await prisma
      .from('products_cache')
      .select('product_id, product_name, cost, price, category_name, supplier_name')
      .eq('supplier_id', supplierId);
    
    // supplier_idで見つからない場合はsupplier_nameで検索
    if (!products || products.length === 0) {
      const { data: productsByName } = await prisma
        .from('products_cache')
        .select('product_id, product_name, cost, price, category_name, supplier_name')
        .eq('supplier_name', supplierId);
      products = productsByName;
    }

    if (prodError || !products || products.length === 0) {
      return res.status(404).json({ error: '商品が見つかりません' });
    }

    // 2. 在庫データ取得
    const productIds = products.map((p: any) => p.product_id);
    const { data: stocks } = await prisma
      .from('stock_cache')
      .select('product_id, stock_amount')
      .eq('store_id', storeId)
      .in('product_id', productIds);

    const stockMap = new Map(stocks?.map((s: any) => [s.product_id, s.stock_amount]) || []);

    // 3. 発注済未入庫データ取得（purchase_ordersテーブルから）
    const { data: onOrders } = await prisma
      .from('purchase_orders')
      .select('product_id, quantity')
      .eq('store_id', storeId)
      .eq('status', 'ordered');

    const onOrderMap = new Map();
    onOrders?.forEach((o: any) => {
      const current = onOrderMap.get(o.product_id) || 0;
      onOrderMap.set(o.product_id, current + (o.quantity || 0));
    });

    // 4. 過去売上データ取得（ABC分析用）
    const startDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const { data: salesData } = await prisma
      .from('sales_daily_summary')
      .select('product_id, total_quantity, sale_date')
      .eq('store_id', storeId)
      .in('product_id', productIds)
      .gte('sale_date', startDate);

    // 5. 商品別売上集計（ABC分析）
    const productSales: Record<string, number> = {};
    salesData?.forEach((s: any) => {
      productSales[s.product_id] = (productSales[s.product_id] || 0) + s.total_quantity;
    });

    // 6. ABCランク計算（売上がある商品のみで計算）
    const productsWithSales = products.filter((p: any) => (productSales[p.product_id] || 0) > 0);
    
    // 売上がある商品が少ない場合（5件未満）は全商品を対象に
    const abcTargetProducts = productsWithSales.length >= 5 ? productsWithSales : products;
    
    const abcInput = abcTargetProducts.map((p: any) => ({
      productId: p.product_id,
      totalSales: productSales[p.product_id] || 0
    }));
    
    console.log(`[V2] ABC分析対象: ${abcInput.length}商品, 売上あり: ${productsWithSales.length}商品`);
    
    const abcRanks = calculateABCRanks(abcInput);
    
    // デバッグ: ABCランク分布
    const rankCounts: Record<string, number> = {};
    abcRanks.forEach(({ rank }) => {
      rankCounts[rank] = (rankCounts[rank] || 0) + 1;
    });
    console.log('[V2] ABCランク分布:', rankCounts);

    // 7. 仕入先情報（リードタイム）
    const { data: supplier } = await prisma
      .from('suppliers')
      .select('lead_time_days, min_order_amount')
      .eq('supplier_id', supplierId)
      .single();

    const leadTimeDays = supplier?.lead_time_days || 3;

    // 8. 一括計算
    const calculationParams = products.map((p: any) => {
      const abc = abcRanks.get(p.product_id) || { rank: 'C', cumulativeRatio: 0.8 };
      const dailySalesAvg = (productSales[p.product_id] || 0) / 60;

      return {
        productId: p.product_id,
        currentStock: stockMap.get(p.product_id) || 0,
        onOrderQuantity: onOrderMap.get(p.product_id) || 0,
        supplierLeadTimeDays: leadTimeDays,
        dailySalesAvg,
        cumulativeSalesRatio: abc.cumulativeRatio,
        lotSize: 1, // デフォルト、発注ロットテーブルから取得可能
        forecastDays,
        referenceDays,
        productPrice: parseFloat(p.cost) || 0
      };
    });

    const results = await calculateOrdersBatch(calculationParams);

    // 9. レスポンス整形
    const response = {
      success: true,
      summary: {
        targetDate,
        storeId,
        supplierId,
        totalProducts: products.length,
        orderableProducts: results.filter(r => r.suggestedOrder > 0).length,
        totalOrderAmount: results.reduce((sum, r) => sum + r.orderAmount, 0),
        abcSummary: getABCSummary(abcRanks)
      },
      algorithmBreakdown: {
        arima: results.filter(r => r.algorithm === 'arima').length,
        simple: results.filter(r => r.algorithm === 'simple').length
      },
      products: results.map((result, i) => {
        const product = products[i];
        const abc = abcRanks.get(product.product_id);
        return {
          productId: product.product_id,
          productName: product.product_name,
          category: product.category_name,
          rank: result.rank,
          cumulativeRatio: abc?.cumulativeRatio,
          algorithm: result.algorithm,
          confidence: result.confidence,
          stock: {
            current: result.currentStock,
            onOrder: result.onOrderQuantity,
            safety: result.safetyStock
          },
          forecast: {
            days: forecastDays,
            demand: result.forecastDemand,
            leadTimeDemand: result.leadTimeDemand
          },
          order: {
            suggested: result.suggestedOrder,
            amount: result.orderAmount,
            isRecommended: result.isRecommended
          },
          breakdown: result.breakdown
        };
      })
    };

    console.log(`[V2] 計算完了: ${results.length}商品, 発注合計${response.summary.totalOrderAmount.toLocaleString()}円`);

    res.json(response);

  } catch (error: any) {
    console.error('[V2] 計算エラー:', error);
    res.status(500).json({ 
      error: '計算中にエラーが発生しました',
      message: error.message 
    });
  }
});

/**
 * GET /api/v2/forecast/abc-config
 * ABCランク設定取得
 */
router.get('/abc-config', async (req, res) => {
  try {
    const { data, error } = await prisma
      .from('abc_config')
      .select('*')
      .order('rank');

    if (error) throw error;

    res.json({
      success: true,
      configs: data || []
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/v2/forecast/stats
 * 統計情報（アルゴリズム使用状況等）
 */
router.get('/stats', async (req, res) => {
  try {
    const { data: logs } = await prisma
      .from('order_calculation_logs')
      .select('algorithm, rank')
      .order('calculated_at', { ascending: false })
      .limit(1000);

    const stats = {
      algorithmUsage: {
        arima: logs?.filter((l: any) => l.algorithm === 'arima').length || 0,
        simple: logs?.filter((l: any) => l.algorithm === 'simple').length || 0
      },
      rankDistribution: {
        A: logs?.filter((l: any) => l.rank === 'A').length || 0,
        B: logs?.filter((l: any) => l.rank === 'B').length || 0,
        C: logs?.filter((l: any) => l.rank === 'C').length || 0,
        D: logs?.filter((l: any) => l.rank === 'D').length || 0,
        E: logs?.filter((l: any) => l.rank === 'E').length || 0
      }
    };

    res.json({ success: true, stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
