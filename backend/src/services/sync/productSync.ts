import { supabase } from '../../config/supabase';
import { getProductsWithCategory } from '../smaregi/products';

export const syncProducts = async (): Promise<{ success: boolean; count: number; error?: string }> => {
  console.log('🔄 商品データの同期を開始...');
  
  try {
    // 同期状態を更新
    await supabase
      .from('sync_status')
      .update({ status: 'syncing', error_message: null })
      .eq('sync_type', 'products');
    
    // スマレジから商品データを取得
    const products = await getProductsWithCategory();
    console.log(`   取得した商品数: ${products.length}`);
    
    // Supabaseにupsert（存在すれば更新、なければ挿入）
    // 1000件ずつバッチ処理
    const batchSize = 1000;
    let processedCount = 0;
    
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize).map(p => ({
        product_id: p.productId,
        product_name: p.productName,
        product_code: p.productCode,
        category_id: p.categoryId,
        category_name: p.categoryName,
        brand_name: p.tag,
        supplier_name: p.groupCode,
        price: parseFloat(p.price) || 0,
        cost: parseFloat(p.cost || '0') || 0,
        updated_at: new Date().toISOString(),
      }));
      
      const { error } = await supabase
        .from('products_cache')
        .upsert(batch, { onConflict: 'product_id' });
      
      if (error) {
        throw new Error(`商品バッチ挿入エラー: ${error.message}`);
      }
      
      processedCount += batch.length;
      console.log(`   処理済み: ${processedCount}/${products.length}`);
    }
    
    // 同期状態を更新
    await supabase
      .from('sync_status')
      .update({ 
        status: 'idle', 
        last_synced_at: new Date().toISOString(),
        error_message: null 
      })
      .eq('sync_type', 'products');
    
    console.log(`✅ 商品データの同期完了: ${processedCount}件`);
    return { success: true, count: processedCount };
    
  } catch (error: any) {
    console.error('❌ 商品同期エラー:', error.message);
    
    await supabase
      .from('sync_status')
      .update({ status: 'error', error_message: error.message })
      .eq('sync_type', 'products');
    
    return { success: false, count: 0, error: error.message };
  }
};
