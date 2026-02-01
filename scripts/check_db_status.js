const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: './backend/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  console.log('=== データベース状況調査 ===\n');
  
  // 1. sales_daily_summary のデータ状況
  const { data: summary, error: e1 } = await supabase
    .from('sales_daily_summary')
    .select('sale_date, store_id')
    .gte('sale_date', '2024-01-01')
    .lte('sale_date', '2026-01-31');
    
  if (e1) {
    console.log('エラー:', e1.message);
  } else {
    console.log('1. sales_daily_summary:');
    console.log('   総件数:', summary?.length || 0);
    
    // 店舗別集計
    const storeCount = {};
    const dates = [];
    summary?.forEach(r => {
      storeCount[r.store_id] = (storeCount[r.store_id] || 0) + 1;
      dates.push(r.sale_date);
    });
    console.log('   データ期間:', dates.length > 0 ? Math.min(...dates) + ' 〜 ' + Math.max(...dates) : 'N/A');
    console.log('   店舗別件数:');
    Object.entries(storeCount).sort().forEach(([sid, cnt]) => {
      console.log('     店舗' + sid + ':', cnt + '件');
    });
  }
  
  // 2. sync_status確認
  const { data: sync, error: e2 } = await supabase
    .from('sync_status')
    .select('*');
  console.log('\n2. sync_status:');
  console.log(JSON.stringify(sync, null, 2));
  
  // 3. sales_cacheの件数
  const { count: cacheCount, error: e3 } = await supabase
    .from('sales_cache')
    .select('*', { count: 'exact', head: true });
  console.log('\n3. sales_cache 総件数:', cacheCount || 0, e3 ? '(エラー: ' + e3.message + ')' : '');
  
  // 4. products_cache件数
  const { count: prodCount, error: e4 } = await supabase
    .from('products_cache')
    .select('*', { count: 'exact', head: true });
  console.log('4. products_cache 総件数:', prodCount || 0);
  
  // 5. stock_cache件数
  const { count: stockCount, error: e5 } = await supabase
    .from('stock_cache')
    .select('*', { count: 'exact', head: true });
  console.log('5. stock_cache 総件数:', stockCount || 0);
}

check().catch(console.error);
