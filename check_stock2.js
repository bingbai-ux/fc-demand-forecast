const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkStock() {
  // 全在庫データを取得してstore_idごとにカウント
  const PAGE_SIZE = 1000;
  let allData = [];
  let from = 0;
  let hasMore = true;
  
  while (hasMore) {
    const { data, error } = await supabase
      .from('stock_cache')
      .select('store_id')
      .range(from, from + PAGE_SIZE - 1);
    
    if (error) {
      console.error('エラー:', error);
      break;
    }
    
    if (data && data.length > 0) {
      allData = allData.concat(data);
      from += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }
  
  const storeCount = {};
  allData.forEach(s => {
    storeCount[s.store_id] = (storeCount[s.store_id] || 0) + 1;
  });
  
  console.log('在庫データ総件数:', allData.length);
  console.log('店舗ごとの在庫件数:', storeCount);
  
  // 店舗マスタを確認
  const { data: stores } = await supabase
    .from('sync_status')
    .select('*');
  
  console.log('sync_status:', stores);
}

checkStock().catch(console.error);
