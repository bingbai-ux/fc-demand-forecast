const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkSummary() {
  // 集計テーブルの件数を確認
  const { count: summaryCount, error: countError } = await supabase
    .from('sales_daily_summary')
    .select('*', { count: 'exact', head: true });
  
  console.log('sales_daily_summary件数:', summaryCount);
  
  // 日付範囲を確認
  const { data: minDate } = await supabase
    .from('sales_daily_summary')
    .select('sale_date')
    .order('sale_date', { ascending: true })
    .limit(1);
  
  const { data: maxDate } = await supabase
    .from('sales_daily_summary')
    .select('sale_date')
    .order('sale_date', { ascending: false })
    .limit(1);
  
  console.log('日付範囲:', minDate?.[0]?.sale_date, '〜', maxDate?.[0]?.sale_date);
  
  // sales_cacheの件数も確認
  const { count: salesCount } = await supabase
    .from('sales_cache')
    .select('*', { count: 'exact', head: true });
  
  console.log('sales_cache件数:', salesCount);
}

checkSummary().catch(console.error);
