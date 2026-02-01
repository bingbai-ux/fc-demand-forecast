/**
 * バックエンドAPI経由で売上データを取得
 * 2024年1月〜2026年1月の全期間
 */

const API_BASE = 'https://fc-demand-forecast-production.up.railway.app';

// 月次データ取得
async function fetchMonthlySales(year, month) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  
  console.log(`📅 ${year}年${month}月: ${startDate} 〜 ${endDate}`);
  
  try {
    // 店舗一覧を取得（一度だけ）
    let stores = [];
    try {
      const storesRes = await fetch(`${API_BASE}/api/stores`);
      const storesData = await storesRes.json();
      if (storesData.success && storesData.data) {
        stores = storesData.data;
      }
    } catch (e) {
      console.log('  店舗取得失敗、デフォルト使用');
      stores = [
        { storeId: '1', storeName: '新宿' },
        { storeId: '2', storeName: '湘南' },
        { storeId: '4', storeName: '学芸大学' },
        { storeId: '5', storeName: '代官山' },
        { storeId: '6', storeName: 'ゆめが丘1' },
        { storeId: '7', storeName: 'ゆめが丘2' }
      ];
    }
    
    console.log(`  店舗数: ${stores.length}店`);
    
    const allSales = [];
    
    // 各店舗のデータを取得
    for (const store of stores.slice(0, 3)) { // 最初の3店舗のみ（テスト用）
      const storeId = store.storeId;
      const storeName = store.storeName;
      
      try {
        // table-data APIを使用して売上データ取得
        const url = `${API_BASE}/api/table-data?from=${startDate}&to=${endDate}&storeIds=${storeId}`;
        console.log(`  → ${storeName}(${storeId}) 取得中...`);
        
        const res = await fetch(url);
        const data = await res.json();
        
        // APIレスポンスは data.data または data.items の形式
        const items = data.data || data.items || [];
        
        if (data.success && items.length > 0) {
          // 売上がある商品のみをフィルタ
          const salesItems = items.filter(item => 
            (item.totalQuantity || item.total_quantity || 0) > 0 ||
            Object.keys(item.salesByDate || item.sales_by_date || {}).length > 0
          );
          
          console.log(`    ✓ 商品: ${items.length}件, 売上あり: ${salesItems.length}件`);
          
          // 日次データに展開
          salesItems.forEach(product => {
            const salesByDate = product.salesByDate || product.sales_by_date || {};
            
            Object.entries(salesByDate).forEach(([date, qty]) => {
              if (qty > 0) {
                allSales.push({
                  date,
                  store_id: storeId,
                  store_name: storeName,
                  product_id: product.productId || product.product_id,
                  product_name: product.productName || product.product_name,
                  quantity: qty,
                  year,
                  month
                });
              }
            });
          });
        } else {
          console.log(`    - データなし (${items.length}件)`);
        }
        
        // レート制限対策
        await new Promise(r => setTimeout(r, 300));
      } catch (err) {
        console.log(`  ✗ 店舗${storeId} エラー: ${err.message}`);
      }
    }
    
    console.log(`  月次合計: ${allSales.length}件`);
    return allSales;
    
  } catch (error) {
    console.error(`  ✗ エラー: ${error.message}`);
    return [];
  }
}

// メイン処理
async function main() {
  console.log('=== 2024年1月〜2026年1月 売上データ取得 ===\n');
  
  const allData = [];
  
  // 2024年1月〜2026年1月（25ヶ月）
  for (let year = 2024; year <= 2026; year++) {
    const endMonth = year === 2026 ? 1 : 12;
    const startMonth = year === 2024 ? 1 : 1;
    
    for (let month = startMonth; month <= endMonth; month++) {
      if (year === 2026 && month > 1) break;
      
      const data = await fetchMonthlySales(year, month);
      allData.push(...data);
      
      // 月次の間隔
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  console.log(`\n=== 取得完了 ===`);
  console.log(`総レコード数: ${allData.length}件`);
  
  // サンプル表示
  if (allData.length > 0) {
    console.log('\nサンプルデータ:');
    console.log(JSON.stringify(allData.slice(0, 3), null, 2));
    
    // 店舗別集計
    const storeSummary = {};
    allData.forEach(d => {
      const storeId = d.store_id;
      if (!storeSummary[storeId]) {
        storeSummary[storeId] = { count: 0, totalQuantity: 0, name: d.store_name };
      }
      storeSummary[storeId].count++;
      storeSummary[storeId].totalQuantity += d.quantity || 0;
    });
    
    console.log('\n店舗別サマリー:');
    Object.entries(storeSummary).forEach(([storeId, summary]) => {
      console.log(`  ${summary.name}(${storeId}): ${summary.count}件, 総数量: ${summary.totalQuantity}`);
    });
    
    // 年月別集計
    const monthSummary = {};
    allData.forEach(d => {
      const key = `${d.year}-${String(d.month).padStart(2, '0')}`;
      if (!monthSummary[key]) monthSummary[key] = 0;
      monthSummary[key]++;
    });
    
    console.log('\n年月別レコード数:');
    Object.entries(monthSummary).slice(0, 10).forEach(([key, count]) => {
      console.log(`  ${key}: ${count}件`);
    });
    
    // JSONファイル保存
    const fs = require('fs');
    fs.writeFileSync(
      './sales_data_2024_2026.json', 
      JSON.stringify(allData, null, 2)
    );
    console.log('\n💾 データ保存: sales_data_2024_2026.json');
    
    // CSV出力
    const csvHeader = 'date,store_id,store_name,product_id,product_name,quantity,year,month\n';
    const csvRows = allData.map(d => 
      `${d.date},${d.store_id},"${d.store_name}",${d.product_id},"${(d.product_name || '').replace(/"/g, '""')}",${d.quantity},${d.year},${d.month}`
    ).join('\n');
    fs.writeFileSync('./sales_data_2024_2026.csv', csvHeader + csvRows);
    console.log('💾 CSV保存: sales_data_2024_2026.csv');
  } else {
    console.log('\n⚠️ データが取得できませんでした');
  }
}

main().catch(console.error);
