const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '../backend/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkData() {
  console.log('=== 既存売上データ確認 ===\n');
  
  try {
    // 1. 総件数
    const { count: totalCount } = await supabase
      .from('sales_daily_summary')
      .select('*', { count: 'exact', head: true });
      
    console.log(`総レコード数: ${totalCount?.toLocaleString()}件`);
    
    // 2. 日付範囲
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
      
    console.log(`データ期間: ${minDate?.sale_date} 〜 ${maxDate?.sale_date}`);
    
    // 3. 店舗数
    const { data: stores } = await supabase
      .from('sales_daily_summary')
      .select('store_id');
      
    const uniqueStores = [...new Set(stores?.map(s => s.store_id))];
    console.log(`店舗数: ${uniqueStores.length}店`);
    console.log(`店舗ID: ${uniqueStores.join(', ')}`);
    
    // 4. 2024年1月〜2026年1月のデータ有無
    const { count: targetPeriodCount } = await supabase
      .from('sales_daily_summary')
      .select('*', { count: 'exact', head: true })
      .gte('sale_date', '2024-01-01')
      .lte('sale_date', '2026-01-31');
      
    console.log(`\n対象期間(2024/1〜2026/1)データ: ${targetPeriodCount?.toLocaleString()}件`);
    
    // 5. 欠損期間の確認
    const { data: allDates } = await supabase
      .from('sales_daily_summary')
      .select('sale_date')
      .gte('sale_date', '2024-01-01')
      .lte('sale_date', '2026-01-31');
      
    const uniqueDates = [...new Set(allDates?.map(d => d.sale_date))];
    uniqueDates.sort();
    
    console.log(`\nユニーク日付数: ${uniqueDates.length}日`);
    console.log(`最初: ${uniqueDates[0]}`);
    console.log(`最後: ${uniqueDates[uniqueDates.length - 1]}`);
    
  } catch (error) {
    console.error('エラー:', error.message);
  }
}

checkData();
