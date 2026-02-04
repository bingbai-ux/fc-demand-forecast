/**
 * 需要予測精度検証スクリプト
 *
 * 使用方法:
 *   npx ts-node scripts/verify-accuracy.ts
 */

import { supabase } from '../src/config/supabase';

interface AccuracyResult {
  productId: string;
  productName: string;
  abcRank: string;
  predicted: number;
  actual: number;
  mape: number;
  bias: number;
}

async function verifyAccuracy() {
  console.log('🔍 需要予測精度検証を開始...');
  console.log('');

  const storeId = '4'; // 学芸大学店

  // 1. forecast_accuracy テーブルから精度データを取得
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
  const fourWeeksAgoStr = fourWeeksAgo.toISOString().split('T')[0];

  const { data: accuracyData, error: accError } = await supabase
    .from('forecast_accuracy')
    .select('*')
    .eq('store_id', storeId)
    .gte('period_start', fourWeeksAgoStr)
    .order('period_start', { ascending: false })
    .limit(1000);

  if (accError) {
    console.log('⚠️ forecast_accuracy テーブルにデータがありません');
    console.log('   精度評価には予測スナップショットの蓄積が必要です');
    console.log('');

    // 代わりに簡易バックテストを実行
    await runSimpleBacktest(storeId);
    return;
  }

  if (!accuracyData || accuracyData.length === 0) {
    console.log('⚠️ 直近4週間の精度データがありません');
    await runSimpleBacktest(storeId);
    return;
  }

  // 2. 精度を集計
  console.log(`📊 精度データ: ${accuracyData.length}件`);
  console.log('');

  const mapes = accuracyData.map((d: any) => (d.mape || 0) * 100);
  const biases = accuracyData.map((d: any) => (d.bias || 0) * 100);

  const avgMape = mapes.reduce((a, b) => a + b, 0) / mapes.length;
  const avgBias = biases.reduce((a, b) => a + b, 0) / biases.length;

  // ランク別に集計
  const rankStats: Record<string, { mapes: number[]; count: number }> = {};
  accuracyData.forEach((d: any) => {
    const rank = d.abc_rank || 'E';
    if (!rankStats[rank]) rankStats[rank] = { mapes: [], count: 0 };
    rankStats[rank].mapes.push((d.mape || 0) * 100);
    rankStats[rank].count++;
  });

  console.log('═══════════════════════════════════════════════════');
  console.log('         需要予測精度レポート（直近4週間）         ');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log(`📈 全体MAPE: ${avgMape.toFixed(1)}%`);
  console.log(`📊 全体バイアス: ${avgBias > 0 ? '+' : ''}${avgBias.toFixed(1)}%`);
  console.log('');
  console.log('ランク別MAPE:');
  ['A', 'B', 'C', 'D', 'E'].forEach(rank => {
    const stats = rankStats[rank];
    if (stats && stats.count > 0) {
      const rankMape = stats.mapes.reduce((a, b) => a + b, 0) / stats.mapes.length;
      console.log(`   ${rank}ランク: ${rankMape.toFixed(1)}% (${stats.count}商品)`);
    }
  });
  console.log('');

  // 精度分布
  const excellent = mapes.filter(m => m < 20).length;
  const good = mapes.filter(m => m >= 20 && m < 30).length;
  const fair = mapes.filter(m => m >= 30 && m < 50).length;
  const poor = mapes.filter(m => m >= 50).length;

  console.log('精度分布:');
  console.log(`   優秀 (MAPE < 20%): ${excellent}件 (${(excellent / mapes.length * 100).toFixed(1)}%)`);
  console.log(`   良好 (20-30%): ${good}件 (${(good / mapes.length * 100).toFixed(1)}%)`);
  console.log(`   普通 (30-50%): ${fair}件 (${(fair / mapes.length * 100).toFixed(1)}%)`);
  console.log(`   要改善 (>50%): ${poor}件 (${(poor / mapes.length * 100).toFixed(1)}%)`);
  console.log('');
  console.log('═══════════════════════════════════════════════════');

  process.exit(0);
}

async function runSimpleBacktest(storeId: string) {
  console.log('📊 簡易バックテストを実行します...');
  console.log('');

  // 直近7日間の実績と、その7日間を予測した場合の精度を比較
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 14日前〜7日前のデータで学習し、7日前〜今日の予測精度を検証
  const testEnd = new Date(today);
  testEnd.setDate(testEnd.getDate() - 1);
  const testStart = new Date(testEnd);
  testStart.setDate(testStart.getDate() - 6);

  const trainEnd = new Date(testStart);
  trainEnd.setDate(trainEnd.getDate() - 1);
  const trainStart = new Date(trainEnd);
  trainStart.setDate(trainStart.getDate() - 27);

  const trainStartStr = trainStart.toISOString().split('T')[0];
  const trainEndStr = trainEnd.toISOString().split('T')[0];
  const testStartStr = testStart.toISOString().split('T')[0];
  const testEndStr = testEnd.toISOString().split('T')[0];

  console.log(`訓練期間: ${trainStartStr} ～ ${trainEndStr}`);
  console.log(`テスト期間: ${testStartStr} ～ ${testEndStr}`);
  console.log('');

  // 訓練期間の売上データを取得
  const { data: trainData, error: trainErr } = await supabase
    .from('sales_daily_summary')
    .select('product_id, sale_date, total_quantity')
    .eq('store_id', storeId)
    .gte('sale_date', trainStartStr)
    .lte('sale_date', trainEndStr);

  if (trainErr || !trainData || trainData.length === 0) {
    console.log('❌ 訓練データが取得できませんでした');
    process.exit(1);
  }

  // テスト期間の売上データを取得
  const { data: testData, error: testErr } = await supabase
    .from('sales_daily_summary')
    .select('product_id, sale_date, total_quantity')
    .eq('store_id', storeId)
    .gte('sale_date', testStartStr)
    .lte('sale_date', testEndStr);

  if (testErr || !testData || testData.length === 0) {
    console.log('❌ テストデータが取得できませんでした');
    process.exit(1);
  }

  console.log(`訓練データ: ${trainData.length}レコード`);
  console.log(`テストデータ: ${testData.length}レコード`);
  console.log('');

  // 商品ごとに日次売上を集計
  const trainMap = new Map<string, Map<string, number>>();
  trainData.forEach((d: any) => {
    const pid = d.product_id;
    const date = d.sale_date.split('T')[0];
    if (!trainMap.has(pid)) trainMap.set(pid, new Map());
    const m = trainMap.get(pid)!;
    m.set(date, (m.get(date) || 0) + (d.total_quantity || 0));
  });

  const testMap = new Map<string, number>();
  testData.forEach((d: any) => {
    const pid = d.product_id;
    testMap.set(pid, (testMap.get(pid) || 0) + (d.total_quantity || 0));
  });

  // 両方にある商品で精度を計算
  const results: { pid: string; predicted: number; actual: number; mape: number }[] = [];

  trainMap.forEach((dailySales, pid) => {
    const actual = testMap.get(pid);
    if (actual === undefined || actual === 0) return;

    // 訓練期間の平均日販 × 7日 = 予測
    const values = Array.from(dailySales.values());
    const avgDaily = values.reduce((a, b) => a + b, 0) / 28; // 28日で割る
    const predicted = avgDaily * 7;

    const mape = Math.abs(predicted - actual) / actual * 100;
    results.push({ pid, predicted, actual, mape });
  });

  if (results.length === 0) {
    console.log('❌ 比較可能な商品がありませんでした');
    process.exit(1);
  }

  // 精度を集計
  const avgMape = results.reduce((s, r) => s + r.mape, 0) / results.length;
  const medianMape = results
    .map(r => r.mape)
    .sort((a, b) => a - b)[Math.floor(results.length / 2)];

  console.log('═══════════════════════════════════════════════════');
  console.log('         簡易バックテスト結果                       ');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log(`検証商品数: ${results.length}商品`);
  console.log(`平均MAPE: ${avgMape.toFixed(1)}%`);
  console.log(`中央値MAPE: ${medianMape.toFixed(1)}%`);
  console.log('');

  // 精度分布
  const excellent = results.filter(r => r.mape < 20).length;
  const good = results.filter(r => r.mape >= 20 && r.mape < 30).length;
  const fair = results.filter(r => r.mape >= 30 && r.mape < 50).length;
  const poor = results.filter(r => r.mape >= 50).length;

  console.log('精度分布:');
  console.log(`   優秀 (MAPE < 20%): ${excellent}件 (${(excellent / results.length * 100).toFixed(1)}%)`);
  console.log(`   良好 (20-30%): ${good}件 (${(good / results.length * 100).toFixed(1)}%)`);
  console.log(`   普通 (30-50%): ${fair}件 (${(fair / results.length * 100).toFixed(1)}%)`);
  console.log(`   要改善 (>50%): ${poor}件 (${(poor / results.length * 100).toFixed(1)}%)`);
  console.log('');
  console.log('═══════════════════════════════════════════════════');

  // 精度が悪い商品TOP5を表示
  console.log('');
  console.log('精度が低い商品TOP5:');
  const worst5 = results.sort((a, b) => b.mape - a.mape).slice(0, 5);
  worst5.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.pid}: MAPE=${r.mape.toFixed(1)}% (予測=${r.predicted.toFixed(1)}, 実績=${r.actual})`);
  });

  console.log('');
  console.log('精度が高い商品TOP5:');
  const best5 = results.sort((a, b) => a.mape - b.mape).slice(0, 5);
  best5.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.pid}: MAPE=${r.mape.toFixed(1)}% (予測=${r.predicted.toFixed(1)}, 実績=${r.actual})`);
  });

  process.exit(0);
}

verifyAccuracy().catch(err => {
  console.error('エラー:', err);
  process.exit(1);
});
