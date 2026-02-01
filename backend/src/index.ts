import express from 'express';
import cors from 'cors';
import { config } from './config/env';
import healthRouter from './routes/health';
import storesRouter from './routes/stores';
import categoriesRouter from './routes/categories';
import productsRouter from './routes/products';
import stockRouter from './routes/stock';
import salesRouter from './routes/sales';
import tableDataRouter from './routes/tableData';
import syncRouter from './routes/sync';
import suppliersRouter from './routes/suppliers';
import authRouter from './routes/auth';
import forecastRouter from './routes/forecast';
import debugRouter from './routes/debug';
import ordersRouter from './routes/orders';
import settingsRouter from './routes/settings';
import orderGroupsRouter from './routes/orderGroups';
import analyticsRouter from './routes/analytics';
import { initializeTokens } from './services/smaregi/auth';
import { syncProducts, syncStock, syncSalesForDate } from './services/sync';
import { updateDailySummaryForDate } from './services/sync/salesSync';
import { supabase } from './config/supabase';

const app = express();

// 許可するオリジン
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  /\.vercel\.app$/,  // Vercelのドメイン
];

app.use(cors({
  origin: (origin, callback) => {
    // originがない場合（サーバー間通信など）は許可
    if (!origin) return callback(null, true);
    
    // 許可リストにあるか、Vercelドメインにマッチするか
    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return origin === allowed;
      }
      return allowed.test(origin);
    });
    
    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('CORS blocked:', origin);
      callback(null, true); // 開発中は許可
    }
  },
  credentials: true,
}));
app.use(express.json());

// ルート
app.use('/api/health', healthRouter);
app.use('/api/stores', storesRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/stock', stockRouter);
app.use('/api/sales', salesRouter);
app.use('/api/table-data', tableDataRouter);
app.use('/api/sync', syncRouter);
app.use('/api/suppliers', suppliersRouter);
app.use('/api/auth', authRouter);
app.use('/api/forecast', forecastRouter);
app.use('/api/debug', debugRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/order-groups', orderGroupsRouter);
app.use('/api/analytics', analyticsRouter);

// 毎日の自動同期を実行
async function runDailySync() {
  console.log('🔄 毎日の自動同期を開始...');
  
  try {
    // 昨日の日付を計算
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().split('T')[0];
    
    // 1. 商品マスタを同期
    console.log('📦 商品マスタを同期中...');
    const productsResult = await syncProducts();
    console.log(`   商品: ${productsResult.count}件`);
    
    // 2. 在庫を同期
    console.log('📊 在庫を同期中...');
    const stockResult = await syncStock();
    console.log(`   在庫: ${stockResult.count}件`);
    
    // 3. 売上データを同期（昨日分）
    console.log(`💰 売上データを同期中: ${dateStr}`);
    const salesResult = await syncSalesForDate(dateStr);
    console.log(`   売上: ${salesResult.count}件`);
    
    // 4. 集計テーブルを更新（昨日分）
    const summaryCount = await updateDailySummaryForDate(dateStr);
    
    console.log('✅ 毎日の自動同期完了');
    console.log(`   日付: ${dateStr}`);
    console.log(`   商品: ${productsResult.count}件`);
    console.log(`   在庫: ${stockResult.count}件`);
    console.log(`   売上: ${salesResult.count}件`);
    console.log(`   集計: ${summaryCount}件`);
    
    return { success: true, date: dateStr, productsCount: productsResult.count, stockCount: stockResult.count, salesCount: salesResult.count, summaryCount };
  } catch (error: any) {
    console.error('❌ 自動同期エラー:', error.message);
    return { success: false, error: error.message };
  }
}

// サーバー起動
const startServer = async () => {
  // Supabaseからトークンを初期化
  await initializeTokens();
  
  // Cronモードの場合は同期を実行して終了
  if (process.env.CRON_MODE === 'true') {
    console.log('🕐 Cronモードで起動');
    const result = await runDailySync();
    console.log('Cronジョブ完了:', result);
    process.exit(0);
  }
  
  app.listen(config.server.port, () => {
    console.log(`🚀 サーバー起動: http://localhost:${config.server.port}`);
    console.log(`📋 エンドポイント一覧:`);
    console.log(`   - GET  /api/health`);
    console.log(`   - GET  /api/health/smaregi`);
    console.log(`   - GET  /api/health/supabase`);
    console.log(`   - GET  /api/stores`);
    console.log(`   - GET  /api/categories`);
    console.log(`   - GET  /api/products`);
    console.log(`   - POST /api/products/refresh`);
    console.log(`   - GET  /api/stock`);
    console.log(`   - GET  /api/stock?storeIds=1,2,4`);
    console.log(`   - POST /api/stock/refresh`);
    console.log(`   - GET  /api/sales?from=YYYY-MM-DD&to=YYYY-MM-DD`);
    console.log(`   - GET  /api/sales?from=YYYY-MM-DD&to=YYYY-MM-DD&storeIds=1,4`);
    console.log(`   - DELETE /api/sales/cache`);
    console.log(`   - GET  /api/table-data?from=YYYY-MM-DD&to=YYYY-MM-DD  ← メインAPI`);
    console.log(`   - GET  /api/table-data?from=YYYY-MM-DD&to=YYYY-MM-DD&storeIds=1,4`);
    console.log(`   - DELETE /api/table-data/cache`);
    console.log(`📋 同期API:`);
    console.log(`   - GET  /api/sync/status`);
    console.log(`   - POST /api/sync/products`);
    console.log(`   - POST /api/sync/stock`);
    console.log(`   - POST /api/sync/sales`);
    console.log(`   - POST /api/sync/all`);
    console.log(`   - GET  /api/suppliers  ← 仕入先一覧`);
    console.log(`🔐 認証API:`);
    console.log(`   - GET  /api/auth/token-status  ← トークン状態確認`);
    console.log(`   - POST /api/auth/refresh-token  ← トークン手動更新`);
  });
};

startServer().catch(console.error);
