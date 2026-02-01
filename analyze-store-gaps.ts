/**
 * 店舗別データ欠損診断スクリプト
 * 実行: npx ts-node analyze-store-gaps.ts
 */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Supabase環境変数が設定されていません');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function analyzeStoreGaps() {
  console.log('🔍 店舗別データ欠損診断を開始...\n');
  
  // 診断対象の6店舗
  const targetStoreNames = ['新宿', '湘南', '学大', '代官山', 'YYYard', 'YYcafe'];
  
  // 1. 6店舗のstore_idを取得
  const { data: stores, error: storesError } = await supabase
    .from('stores')
    .select('store_id, store_name')
    .in('store_name', targetStoreNames);
  
  if (storesError) {
    console.error('❌ 店舗リスト取得エラー:', storesError.message);
    process.exit(1);
  }
  
  if (!stores || stores.length === 0) {
    console.log('⚠️ 対象店舗が見つかりません');
    process.exit(0);
  }
  
  console.log(`✅ 対象店舗数: ${stores.length}店舗\n`);
  
  // 診断期間
  const ANALYSIS_START = '2024-01-01';
  const ANALYSIS_END = '2026-01-31';
  const BACKTEST_TRAIN_START = '2024-01-01';
  const BACKTEST_TRAIN_END = '2024-12-31';
  const BACKTEST_TEST_START = '2025-01-01';
  const BACKTEST_TEST_END = '2025-01-31';
  
  // 総応在日数を計算
  const startDate = new Date(ANALYSIS_START);
  const endDate = new Date(ANALYSIS_END);
  const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  
  // バックテスト期間の日数
  const trainStart = new Date(BACKTEST_TRAIN_START);
  const trainEnd = new Date(BACKTEST_TRAIN_END);
  const trainDays = Math.floor((trainEnd.getTime() - trainStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  
  const testStart = new Date(BACKTEST_TEST_START);
  const testEnd = new Date(BACKTEST_TEST_END);
  const testDays = Math.floor((testEnd.getTime() - testStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  
  // 2. 各店舗ごとに診断
  const results: any[] = [];
  
  for (const store of stores) {
    const storeId = store.store_id;
    const storeName = store.store_name;
    
    process.stdout.write(`📍 診断中: ${storeName}... `);
    
    // 既存データを取得
    const { data: existingData, error: dataError } = await supabase
      .from('sales_daily_summary')
      .select('sale_date')
      .eq('store_id', storeId)
      .gte('sale_date', ANALYSIS_START)
      .lte('sale_date', ANALYSIS_END + 'T23:59:59');
    
    if (dataError) {
      console.error(`❌ エラー: ${dataError.message}`);
      continue;
    }
    
    // 既存日付をSetに変換
    const existingDates = new Set(existingData?.map(d => d.sale_date?.split('T')[0]) || []);
    const existingCount = existingDates.size;
    
    // 欠損日付を特定
    const missingDates: string[] = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      if (!existingDates.has(dateStr)) {
        missingDates.push(dateStr);
      }
    }
    
    // 欠損期間をグループ化
    const missingPeriods: Array<{ start: string; end: string; days: number }> = [];
    if (missingDates.length > 0) {
      let periodStart = missingDates[0];
      let prevDate = new Date(missingDates[0]);
      
      for (let i = 1; i < missingDates.length; i++) {
        const currentDate = new Date(missingDates[i]);
        const diffDays = Math.floor((currentDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60 * 24));
        
        if (diffDays > 1) {
          missingPeriods.push({
            start: periodStart,
            end: prevDate.toISOString().split('T')[0],
            days: Math.floor((prevDate.getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1
          });
          periodStart = missingDates[i];
        }
        prevDate = currentDate;
      }
      
      missingPeriods.push({
        start: periodStart,
        end: prevDate.toISOString().split('T')[0],
        days: Math.floor((prevDate.getTime() - new Date(periodStart).getTime()) / (1000 * 60 * 60 * 24)) + 1
      });
    }
    
    // バックテスト期間の欠損を計算
    const trainMissing = [];
    const testMissing = [];
    for (const dateStr of missingDates) {
      const d = new Date(dateStr);
      if (d >= trainStart && d <= trainEnd) trainMissing.push(dateStr);
      if (d >= testStart && d <= testEnd) testMissing.push(dateStr);
    }
    
    const trainMissingPct = ((trainMissing.length / trainDays) * 100);
    const testMissingPct = ((testMissing.length / testDays) * 100);
    
    console.log(`既存: ${existingCount}日 / 欠損: ${missingDates.length}日`);
    
    results.push({
      storeId,
      storeName,
      totalDays,
      existingDays: existingCount,
      missingDays: missingDates.length,
      missingPercentage: ((missingDates.length / totalDays) * 100).toFixed(1),
      missingPeriods,
      backtest: {
        trainMissingDays: trainMissing.length,
        testMissingDays: testMissing.length,
        trainMissingPercentage: trainMissingPct.toFixed(1),
        testMissingPercentage: testMissingPct.toFixed(1),
      }
    });
  }
  
  // 3. 詳細出力
  console.log('\n' + '='.repeat(70));
  console.log('🏪 店舗別データ診断結果（2024/1/1 ～ 2026/1/31）');
  console.log('='.repeat(70));
  console.log('');
  
  let totalMissingDaysAllStores = 0;
  
  for (const r of results) {
    console.log(`📍 店舗: ${r.storeName} (store_id: ${r.storeId})`);
    console.log(`   総応在日数: ${r.totalDays}日`);
    console.log(`   既存データ: ${r.existingDays}日`);
    console.log(`   欠損: ${r.missingDays}日 (${r.missingPercentage}%)`);
    
    if (r.missingPeriods.length > 0) {
      console.log(`   欠損期間:`);
      // 最大5つまで表示
      const displayPeriods = r.missingPeriods.slice(0, 5);
      for (const period of displayPeriods) {
        console.log(`     - ${period.start} ～ ${period.end} (${period.days}日)`);
      }
      if (r.missingPeriods.length > 5) {
        console.log(`     ... 他 ${r.missingPeriods.length - 5} 期間`);
      }
    } else {
      console.log(`   欠損期間: なし（全期間データあり）`);
    }
    
    console.log(`   バックテスト期間欠損:`);
    console.log(`     - 訓練期間(${BACKTEST_TRAIN_START}～${BACKTEST_TRAIN_END}): ${r.backtest.trainMissingDays}日欠損 (${r.backtest.trainMissingPercentage}%)`);
    console.log(`     - テスト期間(${BACKTEST_TEST_START}～${BACKTEST_TEST_END}): ${r.backtest.testMissingDays}日欠損 (${r.backtest.testMissingPercentage}%)`);
    console.log('');
    
    totalMissingDaysAllStores += r.missingDays;
  }
  
  console.log('='.repeat(70));
  console.log('📊 サマリー');
  console.log('='.repeat(70));
  console.log(`総欠損日数（全店舗合計）: ${totalMissingDaysAllStores}日`);
  console.log('');
  console.log('【訓練期間（2024/1～2024/12）の欠損状況】');
  console.log('（バックテストに必要な過去データ）');
  for (const r of results) {
    const pct = parseFloat(r.backtest.trainMissingPercentage);
    let status = '✅';
    if (pct > 50) status = '🔴';
    else if (pct > 20) status = '🟡';
    else if (pct > 10) status = '🟠';
    console.log(`  ${status} ${r.storeName.padEnd(8)}: ${r.backtest.trainMissingPercentage.padStart(5)}% 欠損 (${String(r.backtest.trainMissingDays).padStart(3)}/${trainDays}日)`);
  }
  console.log('');
  console.log('【テスト期間（2025/1）の欠損状況】');
  for (const r of results) {
    const pct = parseFloat(r.backtest.testMissingPercentage);
    let status = '✅';
    if (pct > 50) status = '🔴';
    else if (pct > 20) status = '🟡';
    else if (pct > 10) status = '🟠';
    console.log(`  ${status} ${r.storeName.padEnd(8)}: ${r.backtest.testMissingPercentage.padStart(5)}% 欠損 (${String(r.backtest.testMissingDays).padStart(2)}/${testDays}日)`);
  }
  console.log('');
  
  // 判定
  console.log('【判定】');
  const highMissingStores = results.filter(r => parseFloat(r.backtest.trainMissingPercentage) > 10);
  if (highMissingStores.length > 0) {
    console.log(`🟠 訓練期間の欠損が10%以上の店舗: ${highMissingStores.map(s => s.storeName).join(', ')}`);
    console.log('');
    console.log('💡 推奨アクション:');
    console.log('   → ステップ2.7: 欠損データ補完を実行');
    console.log('   → POST /api/sync/sales/store-by-store APIで欠損分を取得');
  } else {
    console.log('✅ 全店舗で訓練期間の欠損が10%未満です');
    console.log('');
    console.log('💡 推奨アクション:');
    console.log('   → ステップ3: バックテストへ進む');
  }
  console.log('='.repeat(70));
  console.log('');
  
  return results;
}

analyzeStoreGaps()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ エラー:', err);
    process.exit(1);
  });
