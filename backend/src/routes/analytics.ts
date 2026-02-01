import express from 'express';
import { supabase } from '../config/supabase';

const router = express.Router();

// 発注分析データ取得
router.get('/orders', async (req, res) => {
  try {
    const { 
      startDate,   // 開始日 (YYYY-MM-DD)
      endDate,     // 終了日 (YYYY-MM-DD)
      storeIds,    // 店舗ID (カンマ区切り)
    } = req.query;
    
    console.log('=== 発注分析API ===');
    console.log('期間:', startDate, '〜', endDate);
    console.log('店舗:', storeIds);
    
    // 基本クエリ
    let query = supabase
      .from('order_history')
      .select(`
        *,
        order_history_items (*)
      `)
      .gte('order_date', startDate)
      .lte('order_date', endDate);
    
    // 店舗フィルター
    if (storeIds && storeIds !== 'all') {
      const storeIdArray = (storeIds as string).split(',');
      query = query.in('store_id', storeIdArray);
    }
    
    const { data: orders, error } = await query;
    
    if (error) {
      console.error('発注データ取得エラー:', error);
      return res.status(500).json({ success: false, error: error.message });
    }
    
    // 前月のデータも取得（比較用）
    const startDateObj = new Date(startDate as string);
    const prevMonthStart = new Date(startDateObj);
    prevMonthStart.setMonth(prevMonthStart.getMonth() - 1);
    const prevMonthEnd = new Date(startDateObj);
    prevMonthEnd.setDate(prevMonthEnd.getDate() - 1);
    
    let prevQuery = supabase
      .from('order_history')
      .select('*, order_history_items (*)')
      .gte('order_date', prevMonthStart.toISOString().split('T')[0])
      .lte('order_date', prevMonthEnd.toISOString().split('T')[0]);
    
    if (storeIds && storeIds !== 'all') {
      const storeIdArray = (storeIds as string).split(',');
      prevQuery = prevQuery.in('store_id', storeIdArray);
    }
    
    const { data: prevOrders } = await prevQuery;
    
    // ========== 1. サマリーKPI ==========
    const summary = calculateSummary(orders || [], prevOrders || []);
    
    // ========== 2. 時系列分析 ==========
    const timeSeries = calculateTimeSeries(orders || [], startDate as string, endDate as string);
    
    // ========== 3. 仕入先別分析 ==========
    const supplierAnalysis = calculateSupplierAnalysis(orders || [], prevOrders || []);
    
    // ========== 4. 商品別分析 ==========
    const productAnalysis = calculateProductAnalysis(orders || []);
    
    // ========== 5. 店舗別分析 ==========
    const storeAnalysis = calculateStoreAnalysis(orders || [], prevOrders || []);
    
    res.json({
      success: true,
      data: {
        summary,
        timeSeries,
        supplierAnalysis,
        productAnalysis,
        storeAnalysis,
        period: { startDate, endDate },
      },
    });
    
  } catch (error: any) {
    console.error('発注分析エラー:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ========== ヘルパー関数 ==========

// サマリー計算
function calculateSummary(orders: any[], prevOrders: any[]) {
  const totalAmount = orders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const orderCount = orders.length;
  const avgAmount = orderCount > 0 ? Math.round(totalAmount / orderCount) : 0;
  const suppliers = new Set(orders.map(o => o.supplier_code)).size;
  
  // 前月
  const prevTotalAmount = prevOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);
  const prevOrderCount = prevOrders.length;
  const prevAvgAmount = prevOrderCount > 0 ? Math.round(prevTotalAmount / prevOrderCount) : 0;
  const prevSuppliers = new Set(prevOrders.map(o => o.supplier_code)).size;
  
  return {
    totalAmount,
    orderCount,
    avgAmount,
    suppliers,
    // 前月比
    totalAmountChange: prevTotalAmount > 0 ? Math.round((totalAmount - prevTotalAmount) / prevTotalAmount * 100) : 0,
    orderCountChange: prevOrderCount > 0 ? orderCount - prevOrderCount : 0,
    avgAmountChange: prevAvgAmount > 0 ? Math.round((avgAmount - prevAvgAmount) / prevAvgAmount * 100) : 0,
    suppliersChange: suppliers - prevSuppliers,
  };
}

// 時系列計算
function calculateTimeSeries(orders: any[], startDate: string, endDate: string) {
  const dailyData: Record<string, { amount: number; count: number }> = {};
  
  // 期間内の全日付を初期化
  const start = new Date(startDate);
  const end = new Date(endDate);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0];
    dailyData[dateStr] = { amount: 0, count: 0 };
  }
  
  // データを集計
  orders.forEach(order => {
    const date = order.order_date;
    if (dailyData[date]) {
      dailyData[date].amount += order.total_amount || 0;
      dailyData[date].count += 1;
    }
  });
  
  // 配列に変換
  return Object.entries(dailyData)
    .map(([date, data]) => ({
      date,
      amount: data.amount,
      count: data.count,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// 仕入先別分析
function calculateSupplierAnalysis(orders: any[], prevOrders: any[]) {
  const supplierMap: Record<string, { 
    name: string; 
    amount: number; 
    count: number; 
  }> = {};
  
  orders.forEach(order => {
    const code = order.supplier_code || 'unknown';
    if (!supplierMap[code]) {
      supplierMap[code] = { 
        name: order.supplier_name || code, 
        amount: 0, 
        count: 0 
      };
    }
    supplierMap[code].amount += order.total_amount || 0;
    supplierMap[code].count += 1;
  });
  
  // 前月データ
  const prevSupplierMap: Record<string, number> = {};
  prevOrders.forEach(order => {
    const code = order.supplier_code || 'unknown';
    prevSupplierMap[code] = (prevSupplierMap[code] || 0) + (order.total_amount || 0);
  });
  
  const totalAmount = Object.values(supplierMap).reduce((sum, s) => sum + s.amount, 0);
  
  return Object.entries(supplierMap)
    .map(([code, data]) => ({
      supplierCode: code,
      supplierName: data.name,
      amount: data.amount,
      count: data.count,
      ratio: totalAmount > 0 ? Math.round(data.amount / totalAmount * 1000) / 10 : 0,
      prevAmount: prevSupplierMap[code] || 0,
      change: prevSupplierMap[code] 
        ? Math.round((data.amount - prevSupplierMap[code]) / prevSupplierMap[code] * 100) 
        : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// 商品別分析
function calculateProductAnalysis(orders: any[]) {
  const productMap: Record<string, {
    name: string;
    code: string;
    category: string;
    quantity: number;
    amount: number;
  }> = {};
  
  orders.forEach(order => {
    const items = order.order_history_items || [];
    items.forEach((item: any) => {
      const id = item.product_id || item.product_code;
      if (!productMap[id]) {
        productMap[id] = {
          name: item.product_name || id,
          code: item.product_code || '',
          category: item.category || 'その他',
          quantity: 0,
          amount: 0,
        };
      }
      productMap[id].quantity += item.quantity || 0;
      productMap[id].amount += item.amount || (item.quantity * item.unit_price) || 0;
    });
  });
  
  const products = Object.values(productMap);
  
  // 数量ランキング
  const byQuantity = [...products]
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 20);
  
  // 金額ランキング
  const byAmount = [...products]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 20);
  
  // カテゴリ別集計
  const categoryMap: Record<string, number> = {};
  products.forEach(p => {
    categoryMap[p.category] = (categoryMap[p.category] || 0) + p.amount;
  });
  
  const totalAmount = Object.values(categoryMap).reduce((sum, v) => sum + v, 0);
  const byCategory = Object.entries(categoryMap)
    .map(([category, amount]) => ({
      category,
      amount,
      ratio: totalAmount > 0 ? Math.round(amount / totalAmount * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
  
  return { byQuantity, byAmount, byCategory };
}

// 店舗別分析
function calculateStoreAnalysis(orders: any[], prevOrders: any[]) {
  const storeMap: Record<string, {
    name: string;
    amount: number;
    count: number;
  }> = {};
  
  orders.forEach(order => {
    const id = order.store_id || 'unknown';
    if (!storeMap[id]) {
      storeMap[id] = {
        name: order.store_name || id,
        amount: 0,
        count: 0,
      };
    }
    storeMap[id].amount += order.total_amount || 0;
    storeMap[id].count += 1;
  });
  
  // 前月
  const prevStoreMap: Record<string, number> = {};
  prevOrders.forEach(order => {
    const id = order.store_id || 'unknown';
    prevStoreMap[id] = (prevStoreMap[id] || 0) + (order.total_amount || 0);
  });
  
  const totalAmount = Object.values(storeMap).reduce((sum, s) => sum + s.amount, 0);
  
  return Object.entries(storeMap)
    .map(([id, data]) => ({
      storeId: id,
      storeName: data.name,
      amount: data.amount,
      count: data.count,
      avgAmount: data.count > 0 ? Math.round(data.amount / data.count) : 0,
      ratio: totalAmount > 0 ? Math.round(data.amount / totalAmount * 1000) / 10 : 0,
      prevAmount: prevStoreMap[id] || 0,
      change: prevStoreMap[id]
        ? Math.round((data.amount - prevStoreMap[id]) / prevStoreMap[id] * 100)
        : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

// CSV出力用エンドポイント
router.get('/orders/csv', async (req, res) => {
  try {
    const { startDate, endDate, storeIds, type } = req.query;
    
    // データ取得（上記と同じ）
    let query = supabase
      .from('order_history')
      .select('*, order_history_items (*)')
      .gte('order_date', startDate)
      .lte('order_date', endDate);
    
    if (storeIds && storeIds !== 'all') {
      const storeIdArray = (storeIds as string).split(',');
      query = query.in('store_id', storeIdArray);
    }
    
    const { data: orders } = await query;
    
    let csv = '';
    
    if (type === 'summary') {
      // サマリーCSV
      csv = '項目,値\n';
      const summary = calculateSummary(orders || [], []);
      csv += `総発注金額,${summary.totalAmount}\n`;
      csv += `発注件数,${summary.orderCount}\n`;
      csv += `平均発注金額,${summary.avgAmount}\n`;
      csv += `仕入先数,${summary.suppliers}\n`;
    } else if (type === 'supplier') {
      // 仕入先別CSV
      csv = '順位,仕入先名,発注金額,構成比(%),発注回数,前月比(%)\n';
      const suppliers = calculateSupplierAnalysis(orders || [], []);
      suppliers.forEach((s, i) => {
        csv += `${i + 1},${s.supplierName},${s.amount},${s.ratio},${s.count},${s.change}\n`;
      });
    } else if (type === 'product') {
      // 商品別CSV
      const products = calculateProductAnalysis(orders || []);
      csv = '順位,商品名,商品コード,発注数量,発注金額\n';
      products.byAmount.forEach((p, i) => {
        csv += `${i + 1},${p.name},${p.code},${p.quantity},${p.amount}\n`;
      });
    } else if (type === 'store') {
      // 店舗別CSV
      csv = '店舗名,発注金額,構成比(%),発注回数,平均発注金額,前月比(%)\n';
      const stores = calculateStoreAnalysis(orders || [], []);
      stores.forEach(s => {
        csv += `${s.storeName},${s.amount},${s.ratio},${s.count},${s.avgAmount},${s.change}\n`;
      });
    } else {
      // 全データCSV
      csv = '発注番号,発注日,店舗,仕入先,発注金額,商品数\n';
      (orders || []).forEach(o => {
        csv += `${o.order_number},${o.order_date},${o.store_name},${o.supplier_name},${o.total_amount},${o.order_history_items?.length || 0}\n`;
      });
    }
    
    // BOM付きUTF-8
    const bom = '\uFEFF';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=order-analysis-${type || 'all'}.csv`);
    res.send(bom + csv);
    
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
