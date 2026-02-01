import express from 'express';
import { BacktestService } from '../services/backtest';

const router = express.Router();
const backtestService = new BacktestService();

/**
 * POST /api/backtest/run
 * バックテスト実行
 */
router.post('/run', async (req, res) => {
  try {
    const { productId, startDate, endDate, algorithm = 'prophet', trainRatio = 0.8 } = req.body;
    
    // バリデーション
    if (!productId || !startDate || !endDate) {
      return res.status(400).json({ 
        error: '必須パラメータが不足しています（productId, startDate, endDate）' 
      });
    }

    // 日付妥当性チェック
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ error: '無効な日付形式です' });
    }

    const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff > 180) {
      return res.status(400).json({ error: 'バックテスト期間は最大180日までです' });
    }

    console.log(`[API] バックテストリクエスト: ${productId} (${startDate} ~ ${endDate})`);

    const results = await backtestService.run({
      productId,
      startDate: start,
      endDate: end,
      algorithm,
      trainRatio
    });

    res.json({
      success: true,
      summary: {
        productId,
        algorithm,
        period: { start: startDate, end: endDate },
        totalDays: results.predictions.length,
        accuracy: `${(100 - results.metrics.mape).toFixed(1)}%`,
        reliability: results.metrics.r2 > 0.7 ? 'high' : results.metrics.r2 > 0.4 ? 'medium' : 'low'
      },
      metrics: results.metrics,
      predictions: results.predictions.slice(0, 30), // レスポンス軽量化（最新30日のみ）
      optimization: results.optimalParams
    });

  } catch (error: any) {
    console.error('[API] バックテストエラー:', error);
    res.status(500).json({ 
      error: 'バックテスト実行中にエラーが発生しました',
      message: error.message 
    });
  }
});

/**
 * POST /api/backtest/optimize
 * 自動最適化
 */
router.post('/optimize', async (req, res) => {
  try {
    const { productId, days = 90 } = req.body;
    
    if (!productId) {
      return res.status(400).json({ error: 'productIdが必要です' });
    }

    console.log(`[API] 最適化リクエスト: ${productId}`);
    
    const optimization = await backtestService.optimize(productId, days);
    
    res.json({
      success: true,
      optimization,
      timestamp: new Date().toISOString(),
      nextStep: '最適化結果を本番適用する場合は /api/forecast/update-algorithm を使用してください'
    });
  } catch (error: any) {
    console.error('[API] 最適化エラー:', error);
    res.status(500).json({ error: '最適化処理に失敗しました' });
  }
});

/**
 * GET /api/backtest/results/:productId
 * 最新バックテスト結果取得（軽量）
 */
router.get('/results/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { days = '30' } = req.query;
    
    const endDate = new Date();
    const startDate = new Date(Date.now() - parseInt(days as string) * 24 * 60 * 60 * 1000);
    
    const results = await backtestService.run({
      productId,
      startDate,
      endDate,
      algorithm: 'prophet',
      trainRatio: 0.8
    });
    
    res.json({
      productId,
      metrics: results.metrics,
      optimization: results.optimalParams
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/backtest/health
 * ヘルスチェック
 */
router.get('/health', async (req, res) => {
  res.json({
    status: 'healthy',
    service: 'backtest',
    timestamp: new Date().toISOString()
  });
});

export default router;
