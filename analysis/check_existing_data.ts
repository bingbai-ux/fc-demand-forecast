import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function checkExistingData() {
  console.log('=== Supabase既存データ確認 ===\n');
  
  // 1. sales_daily_summaryの日付範囲
  const { data: dateRange, error: dateError } = await supabase
    .from('sales_daily_summary')
    .select('sale_date')
    .order('sale_date', { ascending: true })
    .limit(1)
    .single();
    
  const { data: maxDate, error: maxError } = await supabase
    .from('sales_daily_summary')
    .select('sale_date')
    .order('sale_date', { ascending: false })
    .limit(1)
    .single();
  
  if (dateRange && maxDate) {
    console.log('📅 データ保持期間:');
    console.log(`   最古: ${dateRange.sale_date}`);
    console.log(`   最新: ${maxDate.sale_date}`);
  }
  
  // 2. レコード数
  const { count: salesCount, error: countError } = await supabase
    .from('sales_daily_summary')
    .select('*', { count: 'exact', head: true });
    
  console.log(`\n📊 レコード数: ${salesCount?.toLocaleString() || 'N/A'}件`);
  
  // 3. 商品数
  const { data: products, error: prodError } = await supabase
    .from('products_cache')
    .select('product_id', { count: 'exact' });
    
  console.log(`📦 商品マスタ: ${products?.length?.toLocaleString() || 'N/A'}SKU`);
  
  // 4. 店舗数
  const { data: stores, error: storeError } = await supabase
    .from('stores_cache')
    .select('store_id');
    
  console.log(`🏪 店舗数: ${stores?.length || 'N/A'}店`);
  
  // 5. 日次のユニーク日付数
  const { data: uniqueDates, error: uniqueError } = await supabase
    .from('sales_daily_summary')
    .select('sale_date', { count: 'exact' });
    
  // 重複を除去してカウント
  const uniqueDateSet = new Set(uniqueDates?.map(d => d.sale_date));
  console.log(`📆 ユニーク日付: ${uniqueDateSet.size}日分`);
  
  // 6. ABC分析用の売上データサンプル
  const { data: sampleSales, error: sampleError } = await supabase
    .from('sales_daily_summary')
    .select('product_id, total_quantity, sale_date')
    .order('total_quantity', { ascending: false })
    .limit(5);
    
  console.log('\n💰 売上Top5サンプル:');
  sampleSales?.forEach((s, i) => {
    console.log(`   ${i+1}. ${s.product_id}: ${s.total_quantity}個 (${s.sale_date})`);
  });
}

checkExistingData().catch(console.error);
