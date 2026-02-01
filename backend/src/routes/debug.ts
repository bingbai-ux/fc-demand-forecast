import { Router } from 'express';
import { supabase } from '../config/supabase';

const router = Router();

// 売上データの状態を確認
router.get('/sales-check', async (req, res) => {
  try {
    const { from, to, storeId } = req.query;
    
    const fromDate = (from as string) || '2026-01-20';
    const toDate = (to as string) || '2026-01-25';
    
    // 基本クエリ
    let query = supabase
      .from('sales_daily_summary')
      .select('*')
      .gte('sale_date', fromDate)
      .lte('sale_date', toDate)
      .limit(10);
    
    if (storeId) {
      query = query.eq('store_id', storeId);
    }
    
    const { data, error } = await query;
    
    // 件数確認（全体）
    const { count: totalCount } = await supabase
      .from('sales_daily_summary')
      .select('*', { count: 'exact', head: true })
      .gte('sale_date', fromDate)
      .lte('sale_date', toDate);
    
    // 店舗別件数を取得
    const storeCountsQuery = await supabase
      .from('sales_daily_summary')
      .select('store_id')
      .gte('sale_date', fromDate)
      .lte('sale_date', toDate);
    
    const storeCounts: { [key: string]: number } = {};
    (storeCountsQuery.data || []).forEach((row: any) => {
      const sid = String(row.store_id);
      storeCounts[sid] = (storeCounts[sid] || 0) + 1;
    });
    
    res.json({
      success: true,
      period: { from: fromDate, to: toDate },
      totalCount,
      storeCounts,
      sampleData: data,
      error: error?.message,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// product_idの比較
router.get('/product-ids', async (req, res) => {
  try {
    // products_cacheのproduct_idサンプル
    const { data: productsData } = await supabase
      .from('products_cache')
      .select('product_id, product_name')
      .limit(10);
    
    // sales_daily_summaryのproduct_idサンプル
    const { data: salesData } = await supabase
      .from('sales_daily_summary')
      .select('product_id')
      .limit(10);
    
    // 一致するproduct_idを検索
    const salesProductIds = (salesData || []).map((s: any) => String(s.product_id));
    const productsProductIds = (productsData || []).map((p: any) => String(p.product_id));
    
    // products_cacheでsales_daily_summaryのproduct_idを検索
    const { data: matchingProducts } = await supabase
      .from('products_cache')
      .select('product_id, product_name')
      .in('product_id', salesProductIds.slice(0, 5));
    
    res.json({
      success: true,
      products_cache_sample: productsData,
      sales_daily_summary_sample: salesData,
      matching_products: matchingProducts,
      products_product_ids: productsProductIds,
      sales_product_ids: salesProductIds,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// stock_cacheのデータ構造を確認
router.get('/stock-check', async (req, res) => {
  try {
    const { productId, storeId } = req.query;
    
    // stock_cacheのサンプルデータを取得
    let query = supabase
      .from('stock_cache')
      .select('*')
      .limit(10);
    
    if (productId) {
      query = query.eq('product_id', productId);
    }
    if (storeId) {
      query = query.eq('store_id', storeId);
    }
    
    const { data, error } = await query;
    
    // 全体の件数
    const { count: totalCount } = await supabase
      .from('stock_cache')
      .select('*', { count: 'exact', head: true });
    
    // 店舗別件数
    const { data: storeData } = await supabase
      .from('stock_cache')
      .select('store_id');
    
    const storeCounts: { [key: string]: number } = {};
    (storeData || []).forEach((row: any) => {
      const sid = String(row.store_id);
      storeCounts[sid] = (storeCounts[sid] || 0) + 1;
    });
    
    // カラム名を確認
    const columns = data && data.length > 0 ? Object.keys(data[0]) : [];
    
    res.json({
      success: true,
      totalCount,
      storeCounts,
      columns,
      sampleData: data,
      error: error?.message,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 店舗一覧を確認
router.get('/stores', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('stores_cache')
      .select('store_id, store_name');
    
    res.json({
      success: true,
      stores: data,
      error: error?.message,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
