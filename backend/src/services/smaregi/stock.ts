import { smaregiClient } from './client';
import { Stock } from '../../types/smaregi';

/**
 * 在庫一覧を取得
 * 
 * スマレジAPIドキュメントによると、在庫管理APIもPOS APIと同じベースURLを使用:
 * - 本番: https://api.smaregi.jp/{contract_id}/pos
 * - エンドポイント: GET /stock
 * 
 * IMG_7781.JPGのリファレンスに基づく仕様:
 * - fields: 取得項目をカンマ区切りで指定可
 * - sort: 並び替え（productId, storeId）
 * - limit: 上限数
 * - page: ページ
 * - store_id: 店舗ID
 * - product_id: 商品ID
 * - upd_date_time-from/to: 更新日時の範囲
 * 
 * Response:
 * - storeId: 店舗ID
 * - productId: 商品ID
 * - stockAmount: 在庫数
 * - updDateTime: 更新日時
 */
export const getStock = async (storeIds?: string[]): Promise<Stock[]> => {
  console.log('📊 在庫一覧を取得中...');
  
  let allStock: Stock[] = [];
  let page = 1;
  const limit = 1000;
  
  const params: any = {
    limit,
  };
  
  // 店舗IDが指定されている場合はパラメータに追加
  if (storeIds && storeIds.length > 0) {
    params.store_id = storeIds[0];
  }
  
  while (true) {
    params.page = page;
    
    // POS APIクライアントを使用（ベースURL: /{contract_id}/pos）
    const response = await smaregiClient.get('/stock', { params });
    
    let stockData: Stock[] = response.data.map((s: any) => ({
      productId: s.productId,
      storeId: s.storeId,
      stockAmount: s.stockAmount,
      updDateTime: s.updDateTime,
    }));
    
    // 複数店舗IDでフィルタ
    if (storeIds && storeIds.length > 1) {
      stockData = stockData.filter((s) => storeIds.includes(s.storeId));
    }
    
    allStock = [...allStock, ...stockData];
    
    console.log(`   取得中: ${allStock.length}件...`);
    
    // 取得件数がlimit未満なら終了
    if (response.data.length < limit) {
      break;
    }
    
    page++;
  }
  
  console.log(`✅ 在庫一覧取得完了: ${allStock.length}件`);
  return allStock;
};

// 商品IDをキーにした在庫マップを作成（店舗別 or 合計）
export interface StockSummary {
  productId: string;
  totalStock: number;
  stockByStore: { [storeId: string]: number };
}

export const getStockSummary = async (storeIds?: string[]): Promise<Map<string, StockSummary>> => {
  const stockList = await getStock(storeIds);
  
  const summaryMap = new Map<string, StockSummary>();
  
  stockList.forEach((stock) => {
    const amount = parseInt(stock.stockAmount, 10) || 0;
    
    if (!summaryMap.has(stock.productId)) {
      summaryMap.set(stock.productId, {
        productId: stock.productId,
        totalStock: 0,
        stockByStore: {},
      });
    }
    
    const summary = summaryMap.get(stock.productId)!;
    summary.totalStock += amount;
    summary.stockByStore[stock.storeId] = amount;
  });
  
  return summaryMap;
};
