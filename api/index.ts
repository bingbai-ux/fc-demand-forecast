import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BacktestService } from './services/backtest.js';

const backtestService = new BacktestService();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS設定
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const path = req.url?.replace(/^\/?/, '').split('?')[0] || '';

  try {
    // GET /api/backtest/health
    if (req.method === 'GET' && path === 'backtest/health') {
      return res.json({
        status: 'healthy',
        service: 'backtest',
        timestamp: new Date().toISOString()
      });
    }

    // POST /api/backtest/run
    if (req.method === 'POST' && path === 'backtest/run') {
      const { productId, startDate, endDate, algorithm = 'prophet', trainRatio = 0.8 } = req.body;
      
      if (!productId || !startDate || !endDate) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      const start = new Date(startDate);
      const end = new Date(endDate);
      
      const daysDiff = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
      if (daysDiff > 180) {
        return res.status(400).json({ error: 'Backtest period must be <= 180 days' });
      }

      const results = await backtestService.run({
        productId,
        startDate: start,
        endDate: end,
        algorithm,
        trainRatio
      });

      return res.json({
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
        predictions: results.predictions.slice(0, 20),
        optimization: results.optimalParams
      });
    }

    // POST /api/backtest/optimize
    if (req.method === 'POST' && path === 'backtest/optimize') {
      const { productId, days = 90 } = req.body;
      
      if (!productId) {
        return res.status(400).json({ error: 'productId is required' });
      }

      const optimization = await backtestService.optimize(productId, days);
      
      return res.json({
        success: true,
        optimization,
        timestamp: new Date().toISOString()
      });
    }

    // GET /api/backtest/results/:productId
    if (req.method === 'GET' && path.startsWith('backtest/results/')) {
      const productId = path.split('/')[2];
      const days = parseInt(req.query.days as string) || 30;
      
      const endDate = new Date();
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      
      const results = await backtestService.run({
        productId,
        startDate,
        endDate,
        algorithm: 'prophet',
        trainRatio: 0.8
      });
      
      return res.json({
        productId,
        metrics: results.metrics,
        optimization: results.optimalParams
      });
    }

    return res.status(404).json({ error: 'Not found', path });
    
  } catch (error: any) {
    console.error('Backtest API error:', error);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
}
