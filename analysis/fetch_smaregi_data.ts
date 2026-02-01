import axios from 'axios';

const SMAREGI_BASE_URL = 'https://api.smaregi.jp';

interface SmaregiConfig {
  contractId: string;
  clientId: string;
  clientSecret: string;
  accessToken: string;
  refreshToken: string;
}

class SmaregiAPIClient {
  private config: SmaregiConfig;
  private accessToken: string;

  constructor(config: SmaregiConfig) {
    this.config = config;
    this.accessToken = config.accessToken;
  }

  async getDailySales(startDate: string, endDate: string, storeId?: string) {
    const url = `${SMAREGI_BASE_URL}/${this.config.contractId}/pos/transactions`;
    
    try {
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        params: {
          transactionDateTimeFrom: `${startDate}T00:00:00`,
          transactionDateTimeTo: `${endDate}T23:59:59`,
          limit: 1000,
          ...(storeId && { storeId }),
        },
      });
      
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 401) {
        console.log('Token expired, attempting refresh...');
        await this.refreshToken();
        return this.getDailySales(startDate, endDate, storeId);
      }
      throw error;
    }
  }

  private async refreshToken() {
    try {
      const response = await axios.post(
        'https://id.smaregi.jp/op/token',
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          refresh_token: this.config.refreshToken,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );
      
      this.accessToken = response.data.access_token;
      console.log('Token refreshed successfully');
    } catch (error) {
      console.error('Token refresh failed:', error);
      throw error;
    }
  }

  async getProducts(limit: number = 1000) {
    const url = `${SMAREGI_BASE_URL}/${this.config.contractId}/pos/products`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
      params: { limit },
    });
    
    return response.data;
  }

  async getStores() {
    const url = `${SMAREGI_BASE_URL}/${this.config.contractId}/pos/stores`;
    
    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    
    return response.data;
  }
}

// データ取得戦略
async function analyzeDataAvailability() {
  const config: SmaregiConfig = {
    contractId: process.env.SMAREGI_CONTRACT_ID!,
    clientId: process.env.SMAREGI_CLIENT_ID!,
    clientSecret: process.env.SMAREGI_CLIENT_SECRET!,
    accessToken: process.env.SMAREGI_ACCESS_TOKEN!,
    refreshToken: process.env.SMAREGI_REFRESH_TOKEN!,
  };

  const client = new SmaregiAPIClient(config);

  console.log('=== スマレジAPIデータ確認 ===\n');

  try {
    // 1. 店舗一覧取得
    console.log('🏪 店舗一覧取得中...');
    const stores = await client.getStores();
    console.log(`   店舗数: ${stores.length || stores.totalCount || 'N/A'}店`);
    if (stores[0]) {
      console.log(`   例: ${stores[0].storeId} - ${stores[0].storeName}`);
    }

    // 2. 商品マスタ取得
    console.log('\n📦 商品マスタ取得中...');
    const products = await client.getProducts(100);
    console.log(`   サンプル取得: ${products.length || 0}SKU`);
    if (products[0]) {
      console.log(`   例: ${products[0].productId} - ${products[0].productName}`);
    }

    // 3. 直近1日の売上データ取得（テスト）
    const today = new Date().toISOString().split('T')[0];
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    
    console.log(`\n💰 直近売上データ確認 (${yesterday}〜${today})...`);
    const sales = await client.getDailySales(yesterday, today);
    console.log(`   取得件数: ${sales.length || sales.totalCount || 0}件`);

    console.log('\n✅ API接続成功');
    console.log('\n📊 2年間のデータ取得見積もり:');
    console.log('   - 期間: 2024/2/1 〜 2026/1/31 (730日)');
    console.log('   - APIレート制限: 60回/分');
    console.log('   - 推定所要時間: 約12分（月次バッチで取得）');

  } catch (error: any) {
    console.error('❌ APIエラー:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
  }
}

analyzeDataAvailability();
