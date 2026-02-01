const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStock() {
  // 在庫データの総件数
  const { count: totalCount } = await supabase
    .from('stock_cache')
    .select('*', { count: 'exact', head: true });
  
  console.log('在庫データ総件数:', totalCount);
  
  // 店舗ごとの在庫件数
  const { data: storeData } = await supabase
    .from('stock_cache')
    .select('store_id');
  
  const storeCount = {};
  storeData.forEach(s => {
    storeCount[s.store_id] = (storeCount[s.store_id] || 0) + 1;
  });
  console.log('店舗ごとの在庫件数:', storeCount);
  
  // 特定の商品の在庫を確認（例：最初の商品）
  const { data: sampleStock } = await supabase
    .from('stock_cache')
    .select('*')
    .limit(10);
  
  console.log('サンプル在庫データ:', sampleStock);
  
  // 特定の商品の店舗別在庫を確認
  if (sampleStock && sampleStock.length > 0) {
    const productId = sampleStock[0].product_id;
    const { data: productStock } = await supabase
      .from('stock_cache')
      .select('*')
      .eq('product_id', productId);
    
    console.log(`商品ID ${productId} の店舗別在庫:`, productStock);
  }
}

checkStock().catch(console.error);
