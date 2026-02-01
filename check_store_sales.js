const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStoreSales() {
  console.log('=== 店舗別売上データ確認 ===');
  
  // 店舗マスタを取得
  const { data: stores } = await supabase
    .from('stores_cache')
    .select('store_id, store_name');
  
  console.log('\n店舗一覧:');
  stores?.forEach(s => console.log(`  ${s.store_id}: ${s.store_name}`));
  
  // sales_daily_summaryの店舗別件数を確認
  console.log('\n=== sales_daily_summary 店舗別件数 ===');
  
  for (const store of (stores || [])) {
    const { count, error } = await supabase
      .from('sales_daily_summary')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', store.store_id);
    
    console.log(`  店舗${store.store_id} (${store.store_name}): ${count || 0}件`);
  }
  
  // sales_cacheの店舗別件数も確認
  console.log('\n=== sales_cache 店舗別件数 ===');
  
  for (const store of (stores || [])) {
    const { count, error } = await supabase
      .from('sales_cache')
      .select('*', { count: 'exact', head: true })
      .eq('store_id', store.store_id);
    
    console.log(`  店舗${store.store_id} (${store.store_name}): ${count || 0}件`);
  }
  
  // 最近の売上データをサンプル表示
  console.log('\n=== 最近の売上サンプル（sales_daily_summary） ===');
  const { data: recentSales } = await supabase
    .from('sales_daily_summary')
    .select('store_id, sale_date, product_id, total_quantity')
    .order('sale_date', { ascending: false })
    .limit(20);
  
  recentSales?.forEach(s => {
    console.log(`  店舗${s.store_id} | ${s.sale_date} | 商品${s.product_id} | 数量${s.total_quantity}`);
  });
}

checkStoreSales().catch(console.error);
