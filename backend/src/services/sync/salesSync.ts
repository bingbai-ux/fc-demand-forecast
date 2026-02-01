import { supabase } from '../../config/supabase';
import { smaregiClient } from '../smaregi/client';

/**
 * 特定日の売上データを集計テーブルに追加/更新する
 * @param dateStr 日付（YYYY-MM-DD形式）
 * @returns 更新されたレコード数
 */
export async function updateDailySummaryForDate(dateStr: string): Promise<number> {
  console.log(`   📊 集計テーブルを更新中: ${dateStr}`);
  
  // 該当日の売上データを取得
  const { data: salesData, error: salesError } = await supabase
    .from('sales_cache')
    .select('product_id, store_id, sale_date, quantity, sales_amount, cost_amount')
    .gte('sale_date', dateStr)
    .lte('sale_date', dateStr + 'T23:59:59');
  
  if (salesError) {
    console.error(`   集計エラー: ${salesError.message}`);
    return 0;
  }
  
  if (!salesData || salesData.length === 0) {
    console.log(`   ${dateStr}の売上データなし`);
    return 0;
  }
  
  // 日次集計を計算
  const summaryMap = new Map<string, { product_id: string; store_id: string; sale_date: string; total_quantity: number; total_sales: number; total_cost: number }>();
  
  for (const sale of salesData) {
    const saleDateStr = typeof sale.sale_date === 'string' ? sale.sale_date.split('T')[0] : sale.sale_date;
    const key = `${sale.product_id}_${sale.store_id}_${saleDateStr}`;
    
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        product_id: sale.product_id,
        store_id: sale.store_id,
        sale_date: saleDateStr,
        total_quantity: 0,
        total_sales: 0,
        total_cost: 0,
      });
    }
    
    const summary = summaryMap.get(key)!;
    summary.total_quantity += sale.quantity || 0;
    summary.total_sales += parseFloat(sale.sales_amount) || 0;
    summary.total_cost += parseFloat(sale.cost_amount) || 0;
  }
  
  // バッチでupsert
  const summaries = Array.from(summaryMap.values());
  
  if (summaries.length > 0) {
    const { error: upsertError } = await supabase
      .from('sales_daily_summary')
      .upsert(summaries, { onConflict: 'product_id,store_id,sale_date' });
    
    if (upsertError) {
      console.error(`   Upsertエラー: ${upsertError.message}`);
      return 0;
    }
    
    console.log(`   集計テーブル: ${summaries.length}件を追加/更新`);
    return summaries.length;
  }
  
  return 0;
}

interface SaleRecord {
  product_id: string;
  store_id: string;
  sale_date: string;
  quantity: number;
  sales_amount: number;
  cost_amount: number;
}

// 指定日の売上を同期
export const syncSalesForDate = async (date: string): Promise<{ success: boolean; count: number; error?: string }> => {
  console.log(`🔄 売上データの同期を開始: ${date}`);
  
  try {
    const fromDateTime = `${date}T00:00:00+09:00`;
    const toDateTime = `${date}T23:59:59+09:00`;
    
    let allSales: SaleRecord[] = [];
    let page = 1;
    const limit = 100;
    const processedIds = new Set<string>();
    
    const MAX_PAGES = 10000;
    
    while (true) {
      const response = await smaregiClient.get('/transactions', {
        params: {
          'transaction_date_time-from': fromDateTime,
          'transaction_date_time-to': toDateTime,
          'with_details': 'all',
          limit,
          page,
        },
      });
      
      if (response.data.length === 0) break;
      
      response.data.forEach((t: any) => {
        // 重複チェック
        if (processedIds.has(t.transactionHeadId)) return;
        processedIds.add(t.transactionHeadId);
        
        // 通常取引のみ
        if (t.transactionHeadDivision !== '1' || t.cancelDivision !== '0') return;
        
        (t.details || []).forEach((d: any) => {
          const quantity = parseInt(d.quantity, 10) || 0;
          if (quantity <= 0) return;
          
          // product_idがnullまたは空の場合はスキップ
          if (!d.productId) {
            console.log(`   ⚠️ productIdがnullのレコードをスキップ: transactionHeadId=${t.transactionHeadId}`);
            return;
          }
          
          allSales.push({
            product_id: d.productId,
            store_id: t.storeId,
            sale_date: date,
            quantity,
            sales_amount: (parseFloat(d.salesPrice || d.price) || 0) * quantity,
            cost_amount: (parseFloat(d.cost || '0') || 0) * quantity,
          });
        });
      });
      
      if (response.data.length < limit) break;
      page++;
      
      if (page > MAX_PAGES) {
        console.log('⚠️ 最大ページ数に達しました');
        break;
      }
    }
    
    console.log(`   ${date}の売上レコード数: ${allSales.length}`);
    
    if (allSales.length === 0) {
      return { success: true, count: 0 };
    }
    
    // 同じ日・同じ店舗・同じ商品の売上を集約
    const aggregated = new Map<string, SaleRecord>();
    allSales.forEach(sale => {
      const key = `${sale.product_id}_${sale.store_id}_${sale.sale_date}`;
      if (aggregated.has(key)) {
        const existing = aggregated.get(key)!;
        existing.quantity += sale.quantity;
        existing.sales_amount += sale.sales_amount;
        existing.cost_amount += sale.cost_amount;
      } else {
        aggregated.set(key, { ...sale });
      }
    });
    
    const salesRecords = Array.from(aggregated.values()).map(s => ({
      ...s,
      updated_at: new Date().toISOString(),
    }));
    
    // 該当日のデータを削除してから挿入
    await supabase
      .from('sales_cache')
      .delete()
      .eq('sale_date', date);
    
    // バッチ挿入
    const batchSize = 1000;
    for (let i = 0; i < salesRecords.length; i += batchSize) {
      const batch = salesRecords.slice(i, i + batchSize);
      const { error } = await supabase
        .from('sales_cache')
        .insert(batch);
      
      if (error) {
        throw new Error(`売上挿入エラー: ${error.message}`);
      }
    }
    
    console.log(`✅ ${date}の売上同期完了: ${salesRecords.length}件`);
    
    // 売上同期完了後、集計テーブルも自動更新
    await updateDailySummaryForDate(date);
    
    return { success: true, count: salesRecords.length };
    
  } catch (error: any) {
    console.error(`❌ 売上同期エラー (${date}):`, error.message);
    return { success: false, count: 0, error: error.message };
  }
};

// 期間の売上を同期（日付ごとに処理）
export const syncSalesForPeriod = async (
  fromDate: string, 
  toDate: string
): Promise<{ success: boolean; totalCount: number; error?: string }> => {
  console.log(`🔄 売上データの同期を開始: ${fromDate} 〜 ${toDate}`);
  
  try {
    await supabase
      .from('sync_status')
      .update({ status: 'syncing', error_message: null })
      .eq('sync_type', 'sales');
    
    let totalCount = 0;
    const startDate = new Date(fromDate);
    const endDate = new Date(toDate);
    
    // 日付ごとに同期
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      const result = await syncSalesForDate(dateStr);
      
      if (!result.success) {
        throw new Error(`${dateStr}の同期失敗: ${result.error}`);
      }
      
      totalCount += result.count;
      
      // レート制限対策：1日処理ごとに500ms待機
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    
    await supabase
      .from('sync_status')
      .update({ 
        status: 'idle', 
        last_synced_at: new Date().toISOString(),
        last_synced_date: toDate,
        error_message: null 
      })
      .eq('sync_type', 'sales');
    
    console.log(`✅ 売上同期完了: 合計${totalCount}件`);
    return { success: true, totalCount };
    
  } catch (error: any) {
    console.error('❌ 売上同期エラー:', error.message);
    
    await supabase
      .from('sync_status')
      .update({ status: 'error', error_message: error.message })
      .eq('sync_type', 'sales');
    
    return { success: false, totalCount: 0, error: error.message };
  }
};
