import { smaregiClient } from './client';
import axios from 'axios';

// 取引明細の型
interface TransactionDetail {
  productId: string;
  productName: string;
  productCode: string | null;
  categoryId: string;
  categoryName: string;
  groupCode: string | null;  // 仕入先
  price: string;
  cost: string | null;
  quantity: string;
  salesPrice: string;
  costSum: string | null;
}

// 取引ヘッダー（明細含む）の型
interface Transaction {
  transactionHeadId: string;
  transactionDateTime: string;
  storeId: string;
  total: string;
  costTotal: string | null;
  details: TransactionDetail[];
}

// 商品別売上集計の型
export interface ProductSalesSummary {
  productId: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  groupCode: string | null;
  salesByDate: { [date: string]: number };       // 日付別販売数
  salesByStore: { [storeId: string]: number };   // 店舗別販売数
  totalQuantity: number;                          // 合計販売数
  totalSales: number;                             // 合計売上金額
  totalCost: number;                              // 合計原価
  grossMargin: number;                            // 粗利率 (%)
}

// 売上データを取得（期間・店舗指定）
export const getSales = async (
  fromDate: string,  // YYYY-MM-DD
  toDate: string,    // YYYY-MM-DD
  storeIds?: string[]
): Promise<ProductSalesSummary[]> => {
  console.log(`📈 売上データを取得中: ${fromDate} 〜 ${toDate}`);
  
  // ISO8601形式に変換
  const fromDateTime = `${fromDate}T00:00:00+09:00`;
  const toDateTime = `${toDate}T23:59:59+09:00`;
  
  let allTransactions: Transaction[] = [];
  let page = 1;
  const limit = 100;  // with_details=allの場合は100以下の制限あり
  
  // 重複チェック用Set
  const processedIds = new Set<string>();
  
  while (true) {
    console.log(`   ページ ${page} を取得中...`);
    
    const params: any = {
      'transaction_date_time-from': fromDateTime,
      'transaction_date_time-to': toDateTime,
      'with_details': 'all',
      limit,
      page,
    };
    
    console.log('   リクエストパラメータ:', JSON.stringify(params));
    
    let response;
    try {
      response = await smaregiClient.get('/transactions', { params });
      console.log('   レスポンス件数:', response.data?.length || 0);
    } catch (error) {
      if (axios.isAxiosError(error)) {
        console.error('   APIエラー:', error.response?.status, error.response?.data);
      }
      throw error;
    }
    
    // 重複を除外してフィルタ
    const transactions: Transaction[] = response.data
      .filter((t: any) => {
        if (processedIds.has(t.transactionHeadId)) {
          return false;
        }
        processedIds.add(t.transactionHeadId);
        return true;
      })
      .filter((t: any) => {
        // 店舗フィルタ
        if (storeIds && storeIds.length > 0) {
          return storeIds.includes(t.storeId);
        }
        return true;
      })
      .filter((t: any) => {
        // 通常取引のみ（キャンセルや返品を除外）
        return t.transactionHeadDivision === '1' && t.cancelDivision === '0';
      })
      .map((t: any) => ({
        transactionHeadId: t.transactionHeadId,
        transactionDateTime: t.transactionDateTime,
        storeId: t.storeId,
        total: t.total,
        costTotal: t.costTotal,
        details: (t.details || []).map((d: any) => ({
          productId: d.productId,
          productName: d.productName,
          productCode: d.productCode,
          categoryId: d.categoryId,
          categoryName: d.categoryName,
          groupCode: d.groupCode,
          price: d.price,
          cost: d.cost,
          quantity: d.quantity,
          salesPrice: d.salesPrice || d.price,
          costSum: d.costSum,
        })),
      }));
    
    allTransactions.push(...transactions);
    
    console.log(`   累計: ${allTransactions.length}件の取引`);
    
    // 取得件数がlimit未満なら終了
    if (response.data.length < limit) {
      break;
    }
    
    page++;
    
    // 安全のため最大10000ページで停止
    const MAX_PAGES = 10000;
    if (page > MAX_PAGES) {
      console.log('⚠️ 最大ページ数に達しました');
      break;
    }
  }
  
  console.log(`✅ 取引データ取得完了: ${allTransactions.length}件`);
  
  // 商品別に集計
  const productSummaryMap = new Map<string, ProductSalesSummary>();
  
  allTransactions.forEach((transaction) => {
    // 日付を抽出（YYYY-MM-DD）
    const date = transaction.transactionDateTime.split('T')[0];
    const storeId = transaction.storeId;
    
    transaction.details.forEach((detail) => {
      const quantity = parseInt(detail.quantity, 10) || 0;
      const salesPrice = parseFloat(detail.salesPrice) || 0;
      const cost = parseFloat(detail.cost || '0') || 0;
      
      // 数量が0以下の場合はスキップ（返品等）
      if (quantity <= 0) return;
      
      if (!productSummaryMap.has(detail.productId)) {
        productSummaryMap.set(detail.productId, {
          productId: detail.productId,
          productName: detail.productName,
          categoryId: detail.categoryId,
          categoryName: detail.categoryName || '不明',
          groupCode: detail.groupCode,
          salesByDate: {},
          salesByStore: {},
          totalQuantity: 0,
          totalSales: 0,
          totalCost: 0,
          grossMargin: 0,
        });
      }
      
      const summary = productSummaryMap.get(detail.productId)!;
      
      // 日付別集計
      summary.salesByDate[date] = (summary.salesByDate[date] || 0) + quantity;
      
      // 店舗別集計
      summary.salesByStore[storeId] = (summary.salesByStore[storeId] || 0) + quantity;
      
      // 合計
      summary.totalQuantity += quantity;
      summary.totalSales += salesPrice * quantity;
      summary.totalCost += cost * quantity;
    });
  });
  
  // 粗利率を計算
  productSummaryMap.forEach((summary) => {
    if (summary.totalSales > 0) {
      summary.grossMargin = Math.round(
        ((summary.totalSales - summary.totalCost) / summary.totalSales) * 10000
      ) / 100; // 小数点2桁
    }
  });
  
  const result = Array.from(productSummaryMap.values());
  console.log(`✅ 商品別集計完了: ${result.length}商品`);
  
  return result;
};
