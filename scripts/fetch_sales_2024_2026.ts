import { createClient } from '@supabase/supabase-js';
import axios from 'axios';
import * as dotenv from 'dotenv';

dotenv.config({ path: './backend/.env' });

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const SMAREGI_BASE_URL = 'https://api.smaregi.jp';

interface SmaregiConfig {
  contractId: string;
  accessToken: string;
}

class SmaregiAPIClient {
  private config: SmaregiConfig;

  constructor(config: SmaregiConfig) {
    this.config = config;
  }

  async getTransactions(startDate: string, endDate: string, page: number = 1) {
    const url = `${SMAREGI_BASE_URL}/${this.config.contractId}/pos/transactions`;
    
    try {
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
        params: {
          transactionDateTimeFrom: `${startDate}T00:00:00`,
          transactionDateTimeTo: `${endDate}T23:59:59`,
          limit: 1000,
          page: page,
        },
      });
      
      return response.data;
    } catch (error: any) {
      console.error(`APIエラー ${startDate}:`, error.message);
      throw error;
    }
  }
}

// 既存データの確認
async function checkExistingData() {
  console.log('=== 既存データ確認 ===\n');
  
  const { data: existingData, error } = await supabase
    .from('sales_daily_summary')
    .select('sale_date, store_id, product_id')
    .gte('sale_date', '2024-01-01')
    .lte('sale_date', '2026-01-31')
    .order('sale_date', { ascending: true });
    
  if (error) {
    console.error('既存データ取得エラー:', error);
    return new Set();
  }
  
  // 重複チェック用のキー作成
  const existingKeys = new Set(existingData?.map(d => `${d.sale_date}_${d.store_id}_${d.product_id}`) || []);
  
  console.log(`既存データ: ${existingData?.length || 0}件`);
  
  // 日付範囲を確認
  if (existingData && existingData.length > 0) {
    const dates = existingData.map(d => d.sale_date);
    console.log(`データ期間: ${Math.min(...dates)} 〜 ${Math.max(...dates)}`);
  }
  
  return existingKeys;
}

// 月次でデータ取得
async function fetchMonthlyData(year: number, month: number, existingKeys: Set<string>) {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
  
  console.log(`\n📅 ${year}年${month}月 (${startDate} 〜 ${endDate})`);
  
  const config: SmaregiConfig = {
    contractId: process.env.SMAREGI_CONTRACT_ID!,
    accessToken: process.env.SMAREGI_ACCESS_TOKEN!,
  };
  
  const client = new SmaregiAPIClient(config);
  let allTransactions: any[] = [];
  let page = 1;
  let hasMore = true;
  
  // ページネーションで全件取得
  while (hasMore && page <= 10) { // 安全のため10ページ制限
    try {
      console.log(`  ページ ${page} 取得中...`);
      const data = await client.getTransactions(startDate, endDate, page);
      
      if (!data || data.length === 0) {
        hasMore = false;
        break;
      }
      
      allTransactions = allTransactions.concat(data);
      
      // 1000件未満なら最終ページ
      if (data.length < 1000) {
        hasMore = false;
      } else {
        page++;
        // レート制限対策（1秒待機）
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    } catch (error) {
      console.error(`  ページ ${page} 取得失敗`);
      hasMore = false;
    }
  }
  
  console.log(`  取得件数: ${allTransactions.length}件`);
  
  // 重複排除
  const newRecords = allTransactions.filter(t => {
    const date = t.transactionDateTime?.split('T')[0];
    const storeId = t.storeId;
    const productId = t.productId || t.product_id;
    const key = `${date}_${storeId}_${productId}`;
    return !existingKeys.has(key);
  });
  
  console.log(`  新規データ: ${newRecords.length}件（重複除外後）`);
  
  return newRecords;
}

// メイン処理
async function main() {
  console.log('=== 2024年1月〜2026年1月 売上データ取得開始 ===\n');
  
  // 既存データのキーを取得
  const existingKeys = await checkExistingData();
  
  // 月次でデータ取得（2024年1月〜2026年1月）
  const allNewRecords: any[] = [];
  
  for (let year = 2024; year <= 2026; year++) {
    const endMonth = year === 2026 ? 1 : 12;
    const startMonth = year === 2024 ? 1 : 1;
    
    for (let month = startMonth; month <= endMonth; month++) {
      // 2026年1月を超えたら終了
      if (year === 2026 && month > 1) break;
      
      const records = await fetchMonthlyData(year, month, existingKeys);
      allNewRecords.push(...records);
      
      // 月次のレート制限対策（3秒待機）
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  
  console.log(`\n=== 取得完了 ===`);
  console.log(`総新規データ: ${allNewRecords.length}件`);
  
  // サンプル表示
  if (allNewRecords.length > 0) {
    console.log('\nサンプルデータ:');
    console.log(allNewRecords[0]);
  }
}

main().catch(console.error);
