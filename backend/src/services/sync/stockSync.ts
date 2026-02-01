import { supabase } from '../../config/supabase';
import { getStock } from '../smaregi/stock';

export const syncStock = async (): Promise<{ success: boolean; count: number; error?: string }> => {
  console.log('🔄 在庫データの同期を開始...');
  
  try {
    await supabase
      .from('sync_status')
      .update({ status: 'syncing', error_message: null })
      .eq('sync_type', 'stock');
    
    // スマレジから在庫データを取得
    const stockList = await getStock();
    console.log(`   取得した在庫データ数: ${stockList.length}`);
    
    // 既存データを削除して新規挿入（在庫は全件更新）
    await supabase.from('stock_cache').delete().neq('id', 0);
    
    // バッチ処理
    const batchSize = 1000;
    let processedCount = 0;
    
    for (let i = 0; i < stockList.length; i += batchSize) {
      const batch = stockList.slice(i, i + batchSize).map(s => ({
        product_id: s.productId,
        store_id: s.storeId,
        stock_amount: parseInt(s.stockAmount, 10) || 0,
        updated_at: new Date().toISOString(),
      }));
      
      const { error } = await supabase
        .from('stock_cache')
        .insert(batch);
      
      if (error) {
        throw new Error(`在庫バッチ挿入エラー: ${error.message}`);
      }
      
      processedCount += batch.length;
      console.log(`   処理済み: ${processedCount}/${stockList.length}`);
    }
    
    await supabase
      .from('sync_status')
      .update({ 
        status: 'idle', 
        last_synced_at: new Date().toISOString(),
        error_message: null 
      })
      .eq('sync_type', 'stock');
    
    console.log(`✅ 在庫データの同期完了: ${processedCount}件`);
    return { success: true, count: processedCount };
    
  } catch (error: any) {
    console.error('❌ 在庫同期エラー:', error.message);
    
    await supabase
      .from('sync_status')
      .update({ status: 'error', error_message: error.message })
      .eq('sync_type', 'stock');
    
    return { success: false, count: 0, error: error.message };
  }
};
