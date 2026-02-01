import { getProductsWithCategory } from './smaregi/products';
import { getStockSummary } from './smaregi/stock';
import { getSales } from './smaregi/sales';
import { ProductTableData } from '../types/smaregi';

export interface TableDataParams {
  fromDate: string;      // YYYY-MM-DD
  toDate: string;        // YYYY-MM-DD
  storeIds?: string[];   // 店舗ID（省略時は全店舗）
}

export interface TableDataResponse {
  products: ProductTableData[];
  meta: {
    totalProducts: number;
    productsWithSales: number;
    period: { from: string; to: string };
    storeIds: string[] | 'all';
    fetchedAt: string;
  };
}

export const getTableData = async (params: TableDataParams): Promise<TableDataResponse> => {
  const { fromDate, toDate, storeIds } = params;
  
  console.log('📊 統合データを取得中...');
  console.log(`   期間: ${fromDate} 〜 ${toDate}`);
  console.log(`   店舗: ${storeIds?.join(',') || '全店舗'}`);
  
  // 並行して全データを取得
  const [products, stockSummary, sales] = await Promise.all([
    getProductsWithCategory(),
    getStockSummary(storeIds),
    getSales(fromDate, toDate, storeIds),
  ]);
  
  console.log(`   商品: ${products.length}件`);
  console.log(`   在庫: ${stockSummary.size}件`);
  console.log(`   売上: ${sales.length}件`);
  
  // 売上データをMapに変換
  const salesMap = new Map(sales.map((s) => [s.productId, s]));
  
  // 商品データに在庫・売上を結合
  const tableData: ProductTableData[] = products.map((product) => {
    const stock = stockSummary.get(product.productId);
    const sale = salesMap.get(product.productId);
    
    // 店舗フィルタがある場合、在庫を再計算
    let stockTotal = stock?.totalStock || 0;
    let stockByStore = stock?.stockByStore || {};
    
    if (storeIds && storeIds.length > 0 && stock) {
      stockByStore = {};
      stockTotal = 0;
      storeIds.forEach((sid) => {
        if (stock.stockByStore[sid] !== undefined) {
          stockByStore[sid] = stock.stockByStore[sid];
          stockTotal += stock.stockByStore[sid];
        }
      });
    }
    
    return {
      productId: product.productId,
      productName: product.productName,
      productCode: product.productCode,
      categoryId: product.categoryId,
      categoryName: product.categoryName,
      brandName: product.tag,
      supplierName: product.groupCode,
      price: parseFloat(product.price) || 0,
      cost: parseFloat(product.cost || '0') || 0,
      stockTotal,
      stockByStore,
      salesByDate: sale?.salesByDate || {},
      salesByStore: sale?.salesByStore || {},
      totalQuantity: sale?.totalQuantity || 0,
      totalSales: sale?.totalSales || 0,
      totalCost: sale?.totalCost || 0,
      grossMargin: sale?.grossMargin || 0,
    };
  });
  
  // 売上がある商品数をカウント
  const productsWithSales = tableData.filter((p) => p.totalQuantity > 0).length;
  
  console.log(`✅ 統合データ作成完了: ${tableData.length}件（売上あり: ${productsWithSales}件）`);
  
  return {
    products: tableData,
    meta: {
      totalProducts: tableData.length,
      productsWithSales,
      period: { from: fromDate, to: toDate },
      storeIds: storeIds || 'all',
      fetchedAt: new Date().toISOString(),
    },
  };
};
