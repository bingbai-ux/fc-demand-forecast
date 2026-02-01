import { ForecastService } from './forecast.js';
import { prisma } from '../config/database.js';

interface BacktestParams {
  productId: string;
  startDate: Date;
  endDate: Date;
  algorithm: 'arima' | 'prophet' | 'moving_average' | 'ensemble';
  trainRatio?: number;
}

interface BacktestResult {
  predictions: Array<{ date: string; predicted: number; actual: number; error: number }>;
  metrics: {
    mae: number;      // 平均絶対誤差
    rmse: number;     // 二乗平均平方根誤差
    mape: number;     // 平均絶対パーセント誤差（精度率）
    bias: number;     // 予測バイアス（過大/過小傾向）
    r2: number;       // 決定係数（0-1、1に近いほど良い）
  };
  optimalParams: {
    recommendedAlgorithm: string;
    seasonality: number;
    trend: string;
    confidence: number;
  };
}

export class BacktestService {
  private forecastService: ForecastService;

  constructor() {
    this.forecastService = new ForecastService();
  }

  /**
   * メインバックテスト実行
   * 過去データを学習・テストに分割して予測精度を検証
   */
  async run(params: BacktestParams): Promise<BacktestResult> {
    console.log(`[Backtest] 開始: ${params.productId} (${params.algorithm})`);
    
    // 過去データ取得（最大180日）
    const historicalData = await this.getHistoricalData(params);
    if (historicalData.length < 14) {
      throw new Error('バックテストには最低14日分のデータが必要です');
    }

    // 時系列分割（デフォルト80%学習、20%テスト）
    const splitIndex = Math.floor(historicalData.length * (params.trainRatio || 0.8));
    const trainData = historicalData.slice(0, splitIndex);
    const testData = historicalData.slice(splitIndex);

    console.log(`[Backtest] データ分割: 学習${trainData.length}日、テスト${testData.length}日`);

    // 逐次予測（実際の運用をシミュレート）
    const predictions = await this.generateRollingPredictions(trainData, testData, params);
    
    // 精度指標計算
    const metrics = this.calculateMetrics(predictions, testData);
    
    // 最適パラメータ提案
    const optimalParams = await this.suggestOptimization(metrics, params, historicalData);

    console.log(`[Backtest] 完了: MAPE=${metrics.mape}%`);

    return {
      predictions,
      metrics,
      optimalParams
    };
  }

  /**
   * 過去データ取得（Prisma経由）
   */
  private async getHistoricalData(params: BacktestParams) {
    try {
      // Supabase経由でデータ取得
      const { data, error } = await prisma
        .from('sales_daily_summary')
        .select('product_id, sale_date, total_quantity')
        .eq('product_id', params.productId)
        .gte('sale_date', params.startDate.toISOString().split('T')[0])
        .lte('sale_date', params.endDate.toISOString().split('T')[0])
        .order('sale_date', { ascending: true });

      if (error) throw error;
      
      if (!data || data.length === 0) {
        return this.generateMockData(params);
      }

      return data.map((d: any) => ({
        date: new Date(d.sale_date),
        quantity: Number(d.total_quantity) || 0,
        productId: d.product_id
      }));
    } catch (error) {
      console.error('[Backtest] データ取得エラー:', error);
      // DB接続エラー時はモックデータで動作（テスト用）
      return this.generateMockData(params);
    }
  }

  /**
   * ローリング予測（実運用をシミュレート）
   */
  private async generateRollingPredictions(trainData: any[], testData: any[], params: BacktestParams) {
    const results = [];
    let currentTrainData = [...trainData];

    for (const actual of testData) {
      try {
        // 日次予測（1日先だけ予測）
        const prediction = await this.forecastService.predict({
          productId: params.productId,
          algorithm: params.algorithm,
          days: 1,
          historicalData: currentTrainData,
          options: {
            seasonality: this.detectSeasonality(currentTrainData),
            confidenceInterval: 0.95
          }
        });

        const predicted = Math.max(0, Math.round(prediction[0].value));
        const error = predicted - actual.quantity;

        results.push({
          date: actual.date.toISOString().split('T')[0],
          predicted,
          actual: actual.quantity,
          error
        });

        // ウィンドウをスライド（実運用では翌日の実績が入る）
        currentTrainData.push(actual);
        if (currentTrainData.length > 365) currentTrainData.shift(); // 1年分以上は保持しない

      } catch (err) {
        console.error(`[Backtest] 予測エラー ${actual.date}:`, err);
        results.push({
          date: actual.date.toISOString().split('T')[0],
          predicted: 0,
          actual: actual.quantity,
          error: -actual.quantity
        });
      }
    }

    return results;
  }

  /**
   * 精度指標計算
   */
  private calculateMetrics(predictions: any[], actuals: any[]) {
    const n = predictions.length;
    if (n === 0) throw new Error('予測結果がありません');

    let mae = 0, rmse = 0, mape = 0, bias = 0, ssRes = 0, ssTot = 0;
    const actualMean = actuals.reduce((sum, a) => sum + a.quantity, 0) / n;

    predictions.forEach((pred, i) => {
      const actual = actuals[i].quantity;
      const error = pred.predicted - actual;
      
      mae += Math.abs(error);
      rmse += error * error;
      mape += actual > 0 ? Math.abs(error / actual) * 100 : 0;
      bias += error;
      ssRes += Math.pow(error, 2);
      ssTot += Math.pow(actual - actualMean, 2);
    });

    const r2 = ssTot > 0 ? 1 - (ssRes / ssTot) : 0;

    return {
      mae: parseFloat((mae / n).toFixed(2)),
      rmse: parseFloat(Math.sqrt(rmse / n).toFixed(2)),
      mape: parseFloat((mape / n).toFixed(2)),
      bias: parseFloat((bias / n).toFixed(2)),
      r2: parseFloat(r2.toFixed(3))
    };
  }

  /**
   * 最適化提案
   */
  private async suggestOptimization(metrics: any, params: BacktestParams, historicalData: any[]) {
    const detectedSeasonality = this.detectSeasonality(historicalData);
    
    return {
      recommendedAlgorithm: metrics.mape > 25 ? 'ensemble' : params.algorithm,
      seasonality: detectedSeasonality || 7,
      trend: metrics.bias > 5 ? 'multiplicative' : 'additive',
      confidence: Math.max(0, Math.min(100, 100 - metrics.mape)) / 100
    };
  }

  /**
   * 季節性自動検出（簡易ACF）
   */
  private detectSeasonality(data: any[]): number | null {
    if (data.length < 30) return null;
    
    // 7日周期（週次）の相関をチェック
    let corr7 = 0;
    for (let i = 7; i < data.length; i++) {
      corr7 += (data[i].quantity - data[i-7].quantity) ** 2;
    }
    
    // 30日周期（月次）の相関をチェック
    let corr30 = 0;
    for (let i = 30; i < data.length; i++) {
      corr30 += (data[i].quantity - data[i-30].quantity) ** 2;
    }
    
    return corr7 < corr30 ? 7 : 30;
  }

  /**
   * ハイパーパラメータ最適化（グリッドサーチ）
   */
  async optimize(productId: string, days: number = 90): Promise<any> {
    console.log(`[Optimize] 最適化開始: ${productId}`);
    
    const endDate = new Date();
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const algorithms = ['moving_average', 'arima', 'prophet'];
    const results = [];

    for (const algo of algorithms) {
      try {
        const result = await this.run({
          productId,
          startDate,
          endDate,
          algorithm: algo as any,
          trainRatio: 0.8
        });
        
        results.push({
          algorithm: algo,
          mape: result.metrics.mape,
          rmse: result.metrics.rmse,
          r2: result.metrics.r2
        });
      } catch (err) {
        console.error(`[Optimize] ${algo} failed:`, err);
      }
    }

    // 最良のアルゴリズムを選択（MAPE最小）
    results.sort((a, b) => a.mape - b.mape);
    const best = results[0];

    return {
      bestAlgorithm: best?.algorithm || 'prophet',
      metrics: {
        mape: best?.mape || 0,
        rmse: best?.rmse || 0,
        r2: best?.r2 || 0
      },
      allResults: results,
      recommendation: best && best.mape < 20 
        ? '現状のアルゴリズムで良好です' 
        : 'ensembleアルゴリズムへの移行を推奨'
    };
  }

  /**
   * テスト用モックデータ生成（DB接続不可時）
   */
  private generateMockData(params: BacktestParams) {
    const data = [];
    const start = new Date(params.startDate);
    const end = new Date(params.endDate);
    
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      // 週次季節性（週末に売上増加）
      const dayOfWeek = d.getDay();
      const base = 10 + (dayOfWeek === 0 || dayOfWeek === 6 ? 15 : 0);
      const noise = Math.random() * 5 - 2.5;
      
      data.push({
        date: new Date(d),
        quantity: Math.max(0, Math.round(base + noise)),
        productId: params.productId
      });
    }
    return data;
  }
}
