const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkData() {
  console.log('=== Supabase既存データ確認 ===\n');
  
  try {
    // 1. 日付範囲
    const { data: minDate } = await supabase
      .from('sales_daily_summary')
      .select('sale_date')
      .order('sale_date', { ascending: true })
      .limit(1)
      .single();
      
    const { data: maxDate } = await supabase
      .from('sales_daily_summary')
      .select('sale_date')
      .order('sale_date', { ascending: false })
      .limit(1)
      .single();
    
    if (minDate && maxDate) {
      console.log('📅 データ保持期間:');
      console.log(`   最古: ${minDate.sale_date}`);
      console.log(`   最新: ${maxDate.sale_date}`);
      
      const days = Math.ceil((new Date(maxDate.sale_date) - new Date(minDate.sale_date)) / (1000 * 60 * 60 * 24));
      console.log(`   期間: 約${days}日分`);
    }
    
    // 2. レコード数
    const { count } = await supabase
      .from('sales_daily_summary')
      .select('*', { count: 'exact', head: true });
      
    console.log(`\n📊 レコード数: ${count?.toLocaleString() || 'N/A'}件`);
    
    // 3. 商品数
    const { data: products } = await supabase
      .from('products_cache')
      .select('product_id', { count: 'exact' });
      
    console.log(`📦 商品マスタ: ${products?.length?.toLocaleString() || 'N/A'}SKU`);
    
    // 4. 店舗数
    const { data: stores } = await supabase
      .from('stores_cache')
      .select('store_id');
      
    console.log(`🏪 店舗数: ${stores?.length || 'N/A'}店`);
    
    // 5. 売上Top5
    const { data: topSales } = await supabase
      .from('sales_daily_summary')
      .select('product_id, total_quantity, sale_date')
      .order('total_quantity', { ascending: false })
      .limit(5);
      
    console.log('\n💰 売上Top5サンプル:');
    topSales?.forEach((s, i) => {
      console.log(`   ${i+1}. ${s.product_id}: ${s.total_quantity}個 (${s.sale_date})`);
    });
    
    console.log('\n✅ データ確認完了');
    
  } catch (err) {
    console.error('❌ エラー:', err.message);
  }
}

checkData();
