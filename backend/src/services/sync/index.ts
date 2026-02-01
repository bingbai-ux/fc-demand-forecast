import { syncProducts } from './productSync';
import { syncStock } from './stockSync';
import { syncSalesForPeriod } from './salesSync';

export { syncProducts } from './productSync';
export { syncStock } from './stockSync';
export { syncSalesForDate, syncSalesForPeriod } from './salesSync';

// 全データを同期
export const syncAll = async (salesFromDate: string, salesToDate: string) => {
  console.log('🔄 全データの同期を開始...');
  
  const results = {
    products: await syncProducts(),
    stock: await syncStock(),
    sales: await syncSalesForPeriod(salesFromDate, salesToDate),
  };
  
  console.log('✅ 全データの同期完了');
  console.log(`   商品: ${results.products.count}件`);
  console.log(`   在庫: ${results.stock.count}件`);
  console.log(`   売上: ${results.sales.totalCount}件`);
  
  return results;
};
