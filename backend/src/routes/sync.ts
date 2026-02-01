import { Router } from 'express';
import { syncProducts, syncStock, syncSalesForPeriod, syncSalesForDate, syncAll } from '../services/sync';
import { updateDailySummaryForDate } from '../services/sync/salesSync';
import { supabase } from '../config/supabase';

const router = Router();

// 同期状態を取得
router.get('/status', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('sync_status')
      .select('*');
    
    if (error) throw error;
    
    res.json({ success: true, data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 商品を同期
router.post('/products', async (req, res) => {
  try {
    const result = await syncProducts();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 在庫を同期
router.post('/stock', async (req, res) => {
  try {
    const result = await syncStock();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 在庫のみ更新（手動用・フロントエンドから呼び出し）
router.post('/stock-only', async (req, res) => {
  try {
    console.log('📊 在庫データを同期中...');
    const result = await syncStock();
    
    // 最新の更新日時を取得
    const { data: syncStatus } = await supabase
      .from('sync_status')
      .select('last_synced_at')
      .eq('sync_type', 'stock')
      .single();
    
    res.json({
      success: true,
      stockCount: result.count,
      updatedAt: syncStatus?.last_synced_at,
      message: '在庫データを更新しました',
    });
  } catch (error: any) {
    console.error('❌ 在庫同期エラー:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 売上を同期
router.post('/sales', async (req, res) => {
  try {
    const { from, to } = req.body;
    
    if (!from || !to) {
      return res.status(400).json({ 
        success: false, 
        error: 'from と to は必須です（YYYY-MM-DD形式）' 
      });
    }
    
    const result = await syncSalesForPeriod(from, to);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 同期状態をリセット
router.post('/reset/:type', async (req, res) => {
  try {
    const { type } = req.params;
    
    const { error } = await supabase
      .from('sync_status')
      .update({ status: 'idle', error_message: null })
      .eq('sync_type', type);
    
    if (error) throw error;
    
    res.json({ success: true, message: `${type}の同期状態をリセットしました` });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 毎日の自動同期（売上 + 商品マスタ + 在庫 + 集計テーブル更新）
router.post('/daily', async (req, res) => {
  try {
    // 認証キーの確認（外部からの不正アクセス防止）
    const authKey = req.headers['x-sync-key'];
    if (authKey !== process.env.SYNC_SECRET_KEY) {
      return res.status(401).json({ success: false, error: '認証エラー' });
    }
    
    console.log('🔄 毎日の自動同期を開始...');
    
    // 日本時間ベースで昨日の日付を計算
    // UTC+9 = 日本時間
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000; // 9時間をミリ秒に変換
    const jstNow = new Date(now.getTime() + jstOffset);
    const jstYesterday = new Date(jstNow);
    jstYesterday.setDate(jstYesterday.getDate() - 1);
    const dateStr = jstYesterday.toISOString().split('T')[0];
    
    console.log(`   現在時刻(UTC): ${now.toISOString()}`);
    console.log(`   現在時刻(JST): ${jstNow.toISOString()}`);
    console.log(`   同期対象日(JST): ${dateStr}`);
    
    // 1. 商品マスタを同期
    console.log('📦 商品マスタを同期中...');
    const productsResult = await syncProducts();
    console.log(`   商品: ${productsResult.count}件`);
    
    // 2. 在庫を同期
    console.log('📊 在庫を同期中...');
    const stockResult = await syncStock();
    console.log(`   在庫: ${stockResult.count}件`);
    
    // 3. 売上データを同期（昨日分）
    console.log(`💰 売上データを同期中: ${dateStr}`);
    const salesResult = await syncSalesForDate(dateStr);
    console.log(`   売上: ${salesResult.count}件`);
    
    // 4. 集計テーブルは syncSalesForDate 内部で既に更新済みなのでスキップ
    
    console.log('✅ 毎日の自動同期完了');
    
    res.json({
      success: true,
      date: dateStr,
      productsCount: productsResult.count,
      stockCount: stockResult.count,
      salesCount: salesResult.count,
      summaryCount: salesResult.count,
    });
  } catch (error: any) {
    console.error('❌ 自動同期エラー:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 日次集計テーブルを作成/更新
router.post('/build-summary', async (req, res) => {
  try {
    console.log('📊 日次集計テーブルを構築中...');
    const startTime = Date.now();
    
    // 期間を取得（指定がなければ全期間）
    const { from, to } = req.body;
    
    // sales_cacheの日付範囲を取得
    const { data: dateRange } = await supabase
      .from('sales_cache')
      .select('sale_date')
      .order('sale_date', { ascending: true })
      .limit(1);
    
    const { data: dateRangeMax } = await supabase
      .from('sales_cache')
      .select('sale_date')
      .order('sale_date', { ascending: false })
      .limit(1);
    
    const minDate = from || (dateRange?.[0]?.sale_date?.split('T')[0] || '2024-01-01');
    const maxDate = to || (dateRangeMax?.[0]?.sale_date?.split('T')[0] || '2026-12-31');
    
    console.log(`   期間: ${minDate} 〜 ${maxDate}`);
    
    // 月ごとに処理（タイムアウト回避）
    const startDate = new Date(minDate);
    const endDate = new Date(maxDate);
    let totalInserted = 0;
    
    while (startDate <= endDate) {
      const monthStart = startDate.toISOString().split('T')[0];
      const monthEnd = new Date(startDate.getFullYear(), startDate.getMonth() + 1, 0).toISOString().split('T')[0];
      const actualEnd = monthEnd > maxDate ? maxDate : monthEnd;
      
      console.log(`   処理中: ${monthStart} 〜 ${actualEnd}`);
      
      // 該当月の売上データを取得（ページネーション対応）
      const PAGE_SIZE = 1000;
      let allSalesData: any[] = [];
      let from = 0;
      let hasMore = true;
      
      while (hasMore) {
        const { data: salesData, error: salesError } = await supabase
          .from('sales_cache')
          .select('product_id, store_id, sale_date, quantity, sales_amount, cost_amount')
          .gte('sale_date', monthStart)
          .lte('sale_date', actualEnd + 'T23:59:59')
          .range(from, from + PAGE_SIZE - 1);
        
        if (salesError) {
          console.error(`   エラー: ${salesError.message}`);
          break;
        }
        
        if (salesData && salesData.length > 0) {
          allSalesData = allSalesData.concat(salesData);
          from += PAGE_SIZE;
          hasMore = salesData.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }
      
      if (allSalesData.length === 0) {
        startDate.setMonth(startDate.getMonth() + 1);
        continue;
      }
      
      console.log(`   sales_cacheから ${allSalesData.length}件取得`);
      
      // 日次集計を計算
      const summaryMap = new Map<string, { product_id: string; store_id: string; sale_date: string; total_quantity: number; total_sales: number; total_cost: number }>();
      
      for (const sale of allSalesData) {
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
        } else {
          totalInserted += summaries.length;
          console.log(`   ${summaries.length}件を追加/更新`);
        }
      }
      
      startDate.setMonth(startDate.getMonth() + 1);
    }
    
    const elapsed = Date.now() - startTime;
    console.log(`✅ 日次集計テーブル構築完了: ${totalInserted}件 (${elapsed}ms)`);
    
    res.json({
      success: true,
      totalRecords: totalInserted,
      period: { from: minDate, to: maxDate },
      elapsedMs: elapsed,
    });
  } catch (error: any) {
    console.error('❌ 集計テーブル構築エラー:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 全データを同期
router.post('/all', async (req, res) => {
  try {
    const { from, to } = req.body;
    
    if (!from || !to) {
      return res.status(400).json({ 
        success: false, 
        error: 'from と to は必須です（YYYY-MM-DD形式）' 
      });
    }
    
    const results = await syncAll(from, to);
    res.json({ success: true, results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// デバッグ: POS APIの在庫レスポンスを直接確認
router.get('/debug/smaregi-stock-raw', async (req, res) => {
  try {
    const { smaregiClient } = await import('../services/smaregi/client');
    
    // POS APIから1ページ目のデータを取得
    const response = await smaregiClient.get('/stock', { params: { limit: 10, page: 1 } });
    
    res.json({ 
      success: true, 
      apiType: 'POS API (/pos/stock)',
      sampleData: response.data.slice(0, 10),
      totalInPage: response.data.length,
      dataStructure: response.data[0] ? Object.keys(response.data[0]) : []
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// デバッグ: 在庫管理APIのレスポンスを直接確認
// IMG_7781.JPGのリファレンスに基づき、エンドポイントは GET /stock（単数形）
router.get('/debug/smaregi-storage-raw', async (req, res) => {
  try {
    const { smaregiStorageClient } = await import('../services/smaregi/storageClient');
    
    // 在庫管理APIから1ページ目のデータを取得
    // エンドポイント: GET /stock（単数形）
    const response = await smaregiStorageClient.get('/stock', { params: { limit: 10, page: 1 } });
    
    res.json({ 
      success: true, 
      apiType: 'Storage API (GET /stock)',
      rawResponse: response.data,
      sampleCount: Array.isArray(response.data) ? response.data.length : 0,
      dataStructure: Array.isArray(response.data) && response.data[0] ? Object.keys(response.data[0]) : []
    });
  } catch (error: any) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      responseData: error.response?.data,
      hint: '在庫管理APIのスコープ（pos.stock:read）が許可されていない可能性があります'
    });
  }
});

// デバッグ: stock_cacheの店舗別サマリー
router.get('/debug/stock-summary', async (req, res) => {
  try {
    // 店舗別の在庫レコード数と合計を取得
    const { data, error } = await supabase
      .from('stock_cache')
      .select('store_id, stock_amount');
    
    if (error) throw error;
    
    // 店舗別に集計
    const storeMap = new Map<string, { count: number; totalStock: number; positiveStock: number; negativeStock: number }>();
    
    for (const row of data || []) {
      const storeId = String(row.store_id);
      if (!storeMap.has(storeId)) {
        storeMap.set(storeId, { count: 0, totalStock: 0, positiveStock: 0, negativeStock: 0 });
      }
      const store = storeMap.get(storeId)!;
      store.count++;
      store.totalStock += row.stock_amount || 0;
      if (row.stock_amount > 0) store.positiveStock += row.stock_amount;
      if (row.stock_amount < 0) store.negativeStock += row.stock_amount;
    }
    
    // 配列に変換してソート
    const summary = Array.from(storeMap.entries())
      .map(([storeId, stats]) => ({ storeId, ...stats }))
      .sort((a, b) => parseInt(a.storeId) - parseInt(b.storeId));
    
    res.json({ 
      success: true, 
      totalRecords: data?.length || 0,
      storesSummary: summary 
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 診断: sales_daily_summary テーブルのデータ状況確認（一時的）
router.get('/debug/daily-summary-stats', async (req, res) => {
  try {
    console.log('📊 sales_daily_summary テーブルの診断を開始...');
    
    // 1. レコード総数を取得
    const { count: totalCount, error: countError } = await supabase
      .from('sales_daily_summary')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      throw new Error(`レコード数取得エラー: ${countError.message}`);
    }
    
    if (!totalCount || totalCount === 0) {
      console.log('📊 データ未登録');
      return res.json({
        success: true,
        message: 'データ未登録',
        totalRecords: 0,
        dateRange: null,
        missingDays: null,
      });
    }
    
    // 2. 最古・最新の日付を取得
    const { data: minDateData, error: minError } = await supabase
      .from('sales_daily_summary')
      .select('sale_date')
      .order('sale_date', { ascending: true })
      .limit(1);
    
    const { data: maxDateData, error: maxError } = await supabase
      .from('sales_daily_summary')
      .select('sale_date')
      .order('sale_date', { ascending: false })
      .limit(1);
    
    if (minError || maxError) {
      throw new Error(`日付範囲取得エラー: ${minError?.message || maxError?.message}`);
    }
    
    const minDate = minDateData?.[0]?.sale_date?.split('T')[0] || 'N/A';
    const maxDate = maxDateData?.[0]?.sale_date?.split('T')[0] || 'N/A';
    
    // 3. 日付の欠損状況を確認（2024/1/1 ～ 2026/1/31）
    const startDate = new Date('2024-01-01');
    const endDate = new Date('2026-01-31');
    const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // 実際に存在する日付を取得
    const { data: distinctDates, error: datesError } = await supabase
      .from('sales_daily_summary')
      .select('sale_date')
      .gte('sale_date', '2024-01-01')
      .lte('sale_date', '2026-01-31T23:59:59');
    
    if (datesError) {
      throw new Error(`日付リスト取得エラー: ${datesError.message}`);
    }
    
    // 重複を除去してユニークな日付数をカウント
    const uniqueDates = new Set(distinctDates?.map(d => d.sale_date?.split('T')[0]));
    const availableDays = uniqueDates.size;
    const missingDays = totalDays - availableDays;
    
    // コンソール出力
    console.log('');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║      sales_daily_summary テーブル診断結果              ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║ 総レコード数: ${String(totalCount).padStart(10)}件                          ║`);
    console.log(`║ データ期間:   ${minDate} ～ ${maxDate}                    ║`);
    console.log(`║ 欠損日数:     ${String(missingDays).padStart(10)}日（全体${totalDays}日に対して）          ║`);
    console.log(`║ データあり:   ${String(availableDays).padStart(10)}日                          ║`);
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('');
    
    res.json({
      success: true,
      totalRecords: totalCount,
      dateRange: {
        min: minDate,
        max: maxDate,
      },
      coverage: {
        totalDays,
        availableDays,
        missingDays,
        percentage: ((availableDays / totalDays) * 100).toFixed(2) + '%',
      },
    });
    
  } catch (error: any) {
    console.error('❌ 診断エラー:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 店舗別・日付別の売上データを取得（欠損分のみ）
router.post('/sales/store-by-store', async (req, res) => {
  const { from, to, forceUpdate = false } = req.body;
  
  // デフォルト期間: 2024/1/1 ～ 2026/1/31
  const targetFrom = from || '2024-01-01';
  const targetTo = to || '2026-01-31';
  
  console.log(`🏪 店舗別売上同期を開始: ${targetFrom} 〜 ${targetTo}`);
  console.log(`   forceUpdate: ${forceUpdate}`);
  
  try {
    // 1. 全店舗リストを取得
    const { data: stores, error: storesError } = await supabase
      .from('stores')
      .select('store_id, store_name')
      .eq('is_active', true);
    
    if (storesError) {
      throw new Error(`店舗リスト取得エラー: ${storesError.message}`);
    }
    
    if (!stores || stores.length === 0) {
      return res.json({ success: true, message: '有効な店舗が見つかりません', results: [] });
    }
    
    console.log(`   対象店舗数: ${stores.length}店舗`);
    
    // 2. 各店舗ごとに処理
    const results: any[] = [];
    
    for (const store of stores) {
      const storeId = store.store_id;
      const storeName = store.store_name;
      
      console.log(`\n📍 店舗「${storeName}」(${storeId})の処理を開始...`);
      
      try {
        // 2-1. この店舗の既存データ期間を確認
        const { data: existingDates, error: datesError } = await supabase
          .from('sales_daily_summary')
          .select('sale_date')
          .eq('store_id', storeId)
          .gte('sale_date', targetFrom)
          .lte('sale_date', targetTo + 'T23:59:59');
        
        if (datesError) {
          throw new Error(`既存データ確認エラー: ${datesError.message}`);
        }
        
        const existingDateSet = new Set(existingDates?.map(d => d.sale_date?.split('T')[0]) || []);
        console.log(`   既存データ: ${existingDateSet.size}日分`);
        
        // 2-2. 欠損日付を計算
        const targetStart = new Date(targetFrom);
        const targetEnd = new Date(targetTo);
        const missingDates: string[] = [];
        
        for (let d = new Date(targetStart); d <= targetEnd; d.setDate(d.getDate() + 1)) {
          const dateStr = d.toISOString().split('T')[0];
          if (forceUpdate || !existingDateSet.has(dateStr)) {
            missingDates.push(dateStr);
          }
        }
        
        console.log(`   取得対象: ${missingDates.length}日分`);
        
        if (missingDates.length === 0) {
          console.log(`   ✅ 全期間のデータが揃っています。スキップします。`);
          results.push({
            storeId,
            storeName,
            status: 'skipped',
            message: '全期間のデータが揃っています',
            existingDays: existingDateSet.size,
            syncedDays: 0,
            totalRecords: 0,
          });
          continue;
        }
        
        // 2-3. 欠損日付をAPIから取得（日付ごとに処理）
        let totalRecords = 0;
        let syncedDays = 0;
        
        for (let i = 0; i < missingDates.length; i++) {
          const dateStr = missingDates[i];
          const progress = `[${i + 1}/${missingDates.length}]`;
          
          console.log(`   ${progress} ${dateStr}のデータを取得中...`);
          
          try {
            // スマレジAPIから特定日・特定店舗のデータを取得
            const syncResult = await syncSalesForDateAndStore(dateStr, storeId);
            
            if (syncResult.success) {
              totalRecords += syncResult.count;
              syncedDays++;
              console.log(`      ✅ ${syncResult.count}件`);
            } else {
              console.log(`      ⚠️ エラー: ${syncResult.error}`);
            }
            
            // レート制限対策: 500ms待機
            await new Promise(resolve => setTimeout(resolve, 500));
            
          } catch (error: any) {
            console.error(`      ❌ 取得失敗: ${error.message}`);
            // 1つの日付で失敗しても続行
          }
        }
        
        console.log(`   ✅ 店舗「${storeName}」完了: ${syncedDays}日, ${totalRecords}件`);
        
        results.push({
          storeId,
          storeName,
          status: 'completed',
          existingDays: existingDateSet.size,
          syncedDays,
          totalRecords,
        });
        
      } catch (error: any) {
        console.error(`   ❌ 店舗「${storeName}」処理エラー:`, error.message);
        results.push({
          storeId,
          storeName,
          status: 'error',
          error: error.message,
        });
        // 1店舗で失敗しても次の店舗は続行
      }
    }
    
    // 3. 結果サマリーを出力
    const completedStores = results.filter(r => r.status === 'completed');
    const skippedStores = results.filter(r => r.status === 'skipped');
    const errorStores = results.filter(r => r.status === 'error');
    const totalSyncedRecords = completedStores.reduce((sum, r) => sum + (r.totalRecords || 0), 0);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 店舗別売上同期 完了サマリー');
    console.log('='.repeat(60));
    console.log(`完了店舗: ${completedStores.length}店舗`);
    console.log(`スキップ店舗: ${skippedStores.length}店舗`);
    console.log(`エラー店舗: ${errorStores.length}店舗`);
    console.log(`総同期レコード数: ${totalSyncedRecords}件`);
    console.log('='.repeat(60));
    
    res.json({
      success: true,
      period: { from: targetFrom, to: targetTo },
      summary: {
        totalStores: stores.length,
        completed: completedStores.length,
        skipped: skippedStores.length,
        errors: errorStores.length,
        totalRecords: totalSyncedRecords,
      },
      results,
    });
    
  } catch (error: any) {
    console.error('❌ 店舗別売上同期エラー:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 特定日・特定店舗の売上をスマレジAPIから取得して保存
async function syncSalesForDateAndStore(
  date: string,
  storeId: string
): Promise<{ success: boolean; count: number; error?: string }> {
  try {
    const fromDateTime = `${date}T00:00:00+09:00`;
    const toDateTime = `${date}T23:59:59+09:00`;
    
    // スマレジAPIクライアントを動的インポート
    const { smaregiClient } = await import('../services/smaregi/client');
    
    let allSales: Array<{
      product_id: string;
      store_id: string;
      sale_date: string;
      quantity: number;
      sales_amount: number;
      cost_amount: number;
    }> = [];
    
    let page = 1;
    const limit = 100;
    const processedIds = new Set<string>();
    const MAX_PAGES = 10000;
    
    while (true) {
      const response = await smaregiClient.get('/transactions', {
        params: {
          'transaction_date_time-from': fromDateTime,
          'transaction_date_time-to': toDateTime,
          'store_id': storeId,
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
        
        // 店舗IDが一致するか確認
        if (t.storeId !== storeId) return;
        
        (t.details || []).forEach((d: any) => {
          const quantity = parseInt(d.quantity, 10) || 0;
          if (quantity <= 0) return;
          
          if (!d.productId) return;
          
          allSales.push({
            product_id: d.productId,
            store_id: storeId,
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
    
    if (allSales.length === 0) {
      return { success: true, count: 0 };
    }
    
    // 同じ日・同じ店舗・同じ商品の売上を集約
    const aggregated = new Map<string, typeof allSales[0]>();
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
    
    // sales_cacheに挿入（同じ日付・店舗のデータは上書き）
    // まず該当日付・店舗のデータを削除
    await supabase
      .from('sales_cache')
      .delete()
      .eq('sale_date', date)
      .eq('store_id', storeId);
    
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
    
    // デイリーサマリーを更新
    await updateDailySummaryForDate(date);
    
    return { success: true, count: salesRecords.length };
    
  } catch (error: any) {
    return { success: false, count: 0, error: error.message };
  }
}

// 店舗別・日付別のデータ欠損状況を詳細診断（6店舗対象）
router.get('/debug/store-gap-analysis', async (req, res) => {
  try {
    console.log('🔍 店舗別データ欠損診断を開始...');
    
    // 診断対象の6店舗（store_nameで検索）
    const targetStoreNames = ['新宿', '湘南', '学大', '代官山', 'YYYard', 'YYcafe'];
    
    // 1. 6店舗のstore_idを取得
    const { data: stores, error: storesError } = await supabase
      .from('stores')
      .select('store_id, store_name')
      .in('store_name', targetStoreNames);
    
    if (storesError) {
      throw new Error(`店舗リスト取得エラー: ${storesError.message}`);
    }
    
    if (!stores || stores.length === 0) {
      return res.json({ success: true, message: '対象店舗が見つかりません', results: [] });
    }
    
    console.log(`   対象店舗数: ${stores.length}店舗`);
    
    // 診断期間
    const ANALYSIS_START = '2024-01-01';
    const ANALYSIS_END = '2026-01-31';
    const BACKTEST_TRAIN_START = '2024-01-01';
    const BACKTEST_TRAIN_END = '2024-12-31';
    const BACKTEST_TEST_START = '2025-01-01';
    const BACKTEST_TEST_END = '2025-01-31';
    
    // 総応在日数を計算
    const startDate = new Date(ANALYSIS_START);
    const endDate = new Date(ANALYSIS_END);
    const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // バックテスト期間の日数
    const trainStart = new Date(BACKTEST_TRAIN_START);
    const trainEnd = new Date(BACKTEST_TRAIN_END);
    const trainDays = Math.floor((trainEnd.getTime() - trainStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    const testStart = new Date(BACKTEST_TEST_START);
    const testEnd = new Date(BACKTEST_TEST_END);
    const testDays = Math.floor((testEnd.getTime() - testStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    
    // 2. 各店舗ごとに診断
    const results: any[] = [];
    
    for (const store of stores) {
      const storeId = store.store_id;
      const storeName = store.store_name;
      
      // 既存データを取得
      const { data: existingData, error: dataError } = await supabase
        .from('sales_daily_summary')
        .select('sale_date')
        .eq('store_id', storeId)
        .gte('sale_date', ANALYSIS_START)
        .lte('sale_date', ANALYSIS_END + 'T23:59:59');
      
      if (dataError) {
        console.error(`   ❌ 店舗「${storeName}」データ取得エラー:`, dataError.message);
        continue;
      }
      
      // 既存日付をSetに変換
      const existingDates = new Set(existingData?.map(d => d.sale_date?.split('T')[0]) || []);
      const existingCount = existingDates.size;
      
      // 欠損日付を特定
      const missingDates: string[] = [];
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        if (!existingDates.has(dateStr)) {
          missingDates.push(dateStr);
        }
      }
      
      // 欠損期間をグループ化（連続した欠損をまとめる）
      const missingPeriods: Array<{ start: string; end: string; days: number }> = [];
      if (missingDates.length > 0) {
        let periodStart = missingDates[0];
        let prevDate = new Date(missingDates[0]);
        
        for (let i = 1; i < missingDates.length; i++) {
          const currentDate = new Date(missingDates[i]);
          const diffDays = Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
          
          if (diffDays > 1) {
            // 連続が途切れたので、前の期間を確定
            missingPeriods.push({
              start: periodStart,
              end: prevDate.toISOString().split('T')[0],
              days: Math.floor((prevDate.getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1
            });
            periodStart = missingDates[i];
          }
          prevDate = currentDate;
        }
        
        // 最後の期間を追加
        missingPeriods.push({
          start: periodStart,
          end: prevDate.toISOString().split('T')[0],
          days: Math.floor((prevDate.getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1
        });
      }
      
      // バックテスト期間の欠損を計算
      const trainMissing = [];
      const testMissing = [];
      for (const dateStr of missingDates) {
        const d = new Date(dateStr);
        if (d >= trainStart && d <= trainEnd) trainMissing.push(dateStr);
        if (d >= testStart && d <= testEnd) testMissing.push(dateStr);
      }
      
      results.push({
        storeId,
        storeName,
        totalDays,
        existingDays: existingCount,
        missingDays: missingDates.length,
        missingPeriods,
        backtest: {
          trainPeriod: { start: BACKTEST_TRAIN_START, end: BACKTEST_TRAIN_END, totalDays: trainDays },
          testPeriod: { start: BACKTEST_TEST_START, end: BACKTEST_TEST_END, totalDays: testDays },
          trainMissingDays: trainMissing.length,
          testMissingDays: testMissing.length,
          trainMissingPercentage: ((trainMissing.length / trainDays) * 100).toFixed(1),
          testMissingPercentage: ((testMissing.length / testDays) * 100).toFixed(1),
        }
      });
    }
    
    // 3. コンソール出力
    console.log('');
    console.log('='.repeat(70));
    console.log('🏪 店舗別データ診断結果（2024/1/1 ～ 2026/1/31）');
    console.log('='.repeat(70));
    console.log('');
    
    let totalMissingDaysAllStores = 0;
    
    for (const r of results) {
      console.log(`📍 店舗: ${r.storeName} (store_id: ${r.storeId})`);
      console.log(`   総応在日数: ${r.totalDays}日`);
      console.log(`   既存データ: ${r.existingDays}日`);
      console.log(`   欠損: ${r.missingDays}日`);
      
      if (r.missingPeriods.length > 0) {
        console.log(`   欠損期間:`);
        for (const period of r.missingPeriods) {
          console.log(`     - ${period.start} ～ ${period.end} (${period.days}日)`);
        }
      } else {
        console.log(`   欠損期間: なし（全期間データあり）`);
      }
      
      console.log(`   バックテスト期間欠損:`);
      console.log(`     - 訓練期間(${r.backtest.trainPeriod.start}～${r.backtest.trainPeriod.end}): ${r.backtest.trainMissingDays}日欠損 (${r.backtest.trainMissingPercentage}%)`);
      console.log(`     - テスト期間(${r.backtest.testPeriod.start}～${r.backtest.testPeriod.end}): ${r.backtest.testMissingDays}日欠損 (${r.backtest.testMissingPercentage}%)`);
      console.log('');
      
      totalMissingDaysAllStores += r.missingDays;
    }
    
    console.log('='.repeat(70));
    console.log('📊 サマリー');
    console.log('='.repeat(70));
    console.log(`総欠損日数（全店舗合計）: ${totalMissingDaysAllStores}日`);
    console.log('');
    console.log('バックテストに必要な過去データ（2024/1～2024/12）の欠損状況:');
    for (const r of results) {
      const status = parseFloat(r.backtest.trainMissingPercentage) > 50 ? '⚠️' : '✅';
      console.log(`  ${status} ${r.storeName}: ${r.backtest.trainMissingPercentage}% 欠損 (${r.backtest.trainMissingDays}/${r.backtest.trainPeriod.totalDays}日)`);
    }
    console.log('');
    console.log('バックテストテスト期間（2025/1）の欠損状況:');
    for (const r of results) {
      const status = parseFloat(r.backtest.testMissingPercentage) > 50 ? '⚠️' : '✅';
      console.log(`  ${status} ${r.storeName}: ${r.backtest.testMissingPercentage}% 欠損 (${r.backtest.testMissingDays}/${r.backtest.testPeriod.totalDays}日)`);
    }
    console.log('');
    console.log('💡 推奨アクション:');
    const highMissingStores = results.filter(r => parseFloat(r.backtest.trainMissingPercentage) > 20);
    if (highMissingStores.length > 0) {
      console.log(`   欠損が多い店舗（>20%）: ${highMissingStores.map(s => s.storeName).join(', ')}`);
      console.log(`   → POST /api/sync/sales/store-by-store で欠損分を補完することを推奨`);
    } else {
      console.log('   全店舗のデータが十分に揃っています。バックテストを実行できます。');
    }
    console.log('='.repeat(70));
    console.log('');
    
    res.json({
      success: true,
      analysisPeriod: { start: ANALYSIS_START, end: ANALYSIS_END, totalDays },
      summary: {
        totalStores: results.length,
        totalMissingDaysAllStores,
      },
      results,
    });
    
  } catch (error: any) {
    console.error('❌ 診断エラー:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
