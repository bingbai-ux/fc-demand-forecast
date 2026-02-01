const API_BASE = 'https://fc-demand-forecast-production.up.railway.app';

async function fetchAPI(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  return response.json();
}

async function runAnalysis() {
  console.log('=== 本番API検証分析 ===\n');
  
  // 1. ヘルスチェック
  console.log('1️⃣ APIヘルスチェック...');
  const health = await fetchAPI('/api/backtest/health');
  console.log(`   ステータス: ${health.status}\n`);
  
  // 2. バックテスト実行（テストデータ）
  console.log('2️⃣ バックテスト実行（テスト商品）...');
  const testProductId = 'test-analysis-001';
  
  const backtestResult = await fetchAPI('/api/backtest/run', {
    method: 'POST',
    body: JSON.stringify({
      productId: testProductId,
      startDate: '2024-01-01',
      endDate: '2024-03-31',
      algorithm: 'prophet',
      trainRatio: 0.8,
    }),
  });
  
  if (backtestResult.success) {
    console.log(`   アルゴリズム: ${backtestResult.summary.algorithm}`);
    console.log(`   精度(MAPE): ${backtestResult.metrics.mape}%`);
    console.log(`   信頼度(R²): ${backtestResult.metrics.r2}`);
    console.log(`   推奨アルゴ: ${backtestResult.optimization.recommendedAlgorithm}\n`);
  }
  
  // 3. 自動最適化
  console.log('3️⃣ 自動最適化実行...');
  const optimizeResult = await fetchAPI('/api/backtest/optimize', {
    method: 'POST',
    body: JSON.stringify({
      productId: testProductId,
      days: 90,
    }),
  });
  
  if (optimizeResult.success) {
    console.log(`   最良アルゴ: ${optimizeResult.optimization.bestAlgorithm}`);
    console.log(`   最良MAPE: ${optimizeResult.optimization.metrics.mape}%`);
    console.log(`   推奨: ${optimizeResult.optimization.recommendation}\n`);
    
    console.log('   アルゴリズム比較結果:');
    optimizeResult.optimization.allResults.forEach(r => {
      console.log(`     - ${r.algorithm}: MAPE=${r.mape}%, R²=${r.r2}`);
    });
  }
  
  // 4. 複数アルゴリズム比較
  console.log('\n4️⃣ 複数アルゴリズム比較...');
  const algorithms = ['moving_average', 'arima', 'prophet'];
  const comparison = [];
  
  for (const algo of algorithms) {
    const result = await fetchAPI('/api/backtest/run', {
      method: 'POST',
      body: JSON.stringify({
        productId: `${testProductId}-${algo}`,
        startDate: '2024-01-01',
        endDate: '2024-02-29',
        algorithm: algo,
      }),
    });
    
    if (result.success) {
      comparison.push({
        algorithm: algo,
        mape: result.metrics.mape,
        rmse: result.metrics.rmse,
        r2: result.metrics.r2,
        reliability: result.summary.reliability,
      });
    }
  }
  
  // 結果サマリー
  console.log('\n=== 分析結果サマリー ===');
  console.log('\n| アルゴリズム | MAPE(%) | RMSE | R² | 信頼度 |');
  console.log('|-------------|---------|------|-----|--------|');
  
  comparison.sort((a, b) => a.mape - b.mape);
  comparison.forEach(c => {
    const r2Str = c.r2 > 0 ? c.r2.toFixed(3) : 'N/A';
    console.log(`| ${c.algorithm.padEnd(13)} | ${String(c.mape).padStart(7)} | ${String(c.rmse).padStart(4)} | ${r2Str} | ${c.reliability.padEnd(6)} |`);
  });
  
  const best = comparison[0];
  console.log(`\n✅ 最良アルゴリズム: ${best.algorithm}`);
  console.log(`   MAPE: ${best.mape}%（平均誤差${best.mape}%)`);
  console.log(`   信頼度: ${best.reliability}`);
  
  // 推奨事項
  console.log('\n=== 推奨事項 ===');
  if (best.mape < 20) {
    console.log('✨ 現状の予測精度は良好です（MAPE < 20%）');
    console.log(`   → ${best.algorithm}アルゴリズムを継続使用`);
  } else if (best.mape < 40) {
    console.log('⚠️ 予測精度に改善余地あり（MAPE 20-40%）');
    console.log('   → アンサンブル手法の導入を検討');
    console.log('   → 安全在庫の見直し（現状0% → 10%程度）');
  } else {
    console.log('🔴 予測精度に課題あり（MAPE > 40%）');
    console.log('   → データ品質の確認（異常値、欠損値）');
    console.log('   → 季節性パラメータの調整');
    console.log('   → 外部要因（イベント、天候等）の考慮');
  }
}

runAnalysis().catch(err => console.error('エラー:', err.message));
