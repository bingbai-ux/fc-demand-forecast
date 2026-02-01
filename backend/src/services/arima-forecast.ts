import { prisma } from '../config/database';

export interface ArimaForecastResult {
  values: number[];
  total: number;
  algorithm: 'arima' | 'simple';
  confidence: number;
  trend: number;
  seasonality: number[];
}

export class ArimaForecastService {
  /**
   * ARIMA予測（簡易実装）
   * 時系列分解: トレンド + 季節性 + 残差
   */
  async predict(
    productId: string, 
    days: number, 
    referenceDays: number = 60
  ): Promise<ArimaForecastResult> {
    try {
      // 過去データ取得（Supabase経由）
      const endDate = new Date();
      const startDate = new Date(Date.now() - referenceDays * 24 * 60 * 60 * 1000);
      
      const { data, error } = await prisma
        .from('sales_daily_summary')
        .select('sale_date, total_quantity')
        .eq('product_id', productId)
        .gte('sale_date', startDate.toISOString().split('T')[0])
        .lte('sale_date', endDate.toISOString().split('T')[0])
        .order('sale_date', { ascending: true });

      if (error || !data || data.length < 14) {
        console.log(`[ARIMA] データ不足(${data?.length || 0}件)、Simpleフォールバック`);
        return this.fallbackMovingAverage(data || [], days);
      }

      const values = data.map((d: any) => Number(d.total_quantity) || 0);
      
      // ARIMA簡易実装（時系列分解）
      const trend = this.calculateTrend(values);
      const seasonal = this.calculateSeasonality(values, 7); // 週次季節性
      const residuals = this.calculateResiduals(values, trend, seasonal);
      
      // 予測生成
      const forecast: number[] = [];
      const lastValue = values[values.length - 1];
      const trendSlope = (trend[trend.length - 1] - trend[0]) / trend.length;
      
      for (let i = 1; i <= days; i++) {
        const futureTrend = lastValue + (trendSlope * i);
        const futureSeasonal = seasonal[(values.length + i - 1) % 7];
        const futureResidual = this.estimateResidual(residuals, i);
        
        const predicted = Math.max(0, Math.round(futureTrend + futureSeasonal + futureResidual));
        forecast.push(predicted);
      }
      
      // MAPE計算（直近の予測精度）
      const mape = this.calculateMAPE(values.slice(-14), trend.slice(-14));
      
      return {
        values: forecast,
        total: forecast.reduce((a, b) => a + b, 0),
        algorithm: 'arima',
        confidence: Math.max(0, 1 - mape),
        trend: trendSlope,
        seasonality: seasonal
      };
      
    } catch (error) {
      console.error('[ARIMA] 予測エラー:', error);
      return this.fallbackMovingAverage([], days);
    }
  }
  
  /**
   * トレンド成分計算（移動平均による平滑化）
   */
  private calculateTrend(values: number[]): number[] {
    const window = 7; // 7日移動平均
    const trend: number[] = [];
    
    for (let i = 0; i < values.length; i++) {
      const start = Math.max(0, i - window + 1);
      const windowValues = values.slice(start, i + 1);
      const avg = windowValues.reduce((a, b) => a + b, 0) / windowValues.length;
      trend.push(avg);
    }
    
    return trend;
  }
  
  /**
   * 季節性成分計算（週次パターン）
   */
  private calculateSeasonality(values: number[], period: number): number[] {
    const seasonal: number[] = new Array(period).fill(0);
    const counts: number[] = new Array(period).fill(0);
    
    // デトレンド（平均からの偏差）
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    
    values.forEach((v, i) => {
      const dayOfWeek = i % period;
      seasonal[dayOfWeek] += (v - mean);
      counts[dayOfWeek]++;
    });
    
    // 平均化
    return seasonal.map((s, i) => counts[i] ? s / counts[i] : 0);
  }
  
  /**
   * 残差計算
   */
  private calculateResiduals(values: number[], trend: number[], seasonal: number[]): number[] {
    return values.map((v, i) => v - trend[i] - seasonal[i % 7]);
  }
  
  /**
   * 残差予測（指数平滑法）
   */
  private estimateResidual(residuals: number[], horizon: number): number {
    const alpha = 0.3; // 平滑化係数
    let smoothed = residuals[residuals.length - 1];
    
    for (let i = 0; i < horizon; i++) {
      smoothed = alpha * residuals[residuals.length - 1] + (1 - alpha) * smoothed;
    }
    
    return smoothed;
  }
  
  /**
   * MAPE計算
   */
  private calculateMAPE(actual: number[], predicted: number[]): number {
    if (actual.length !== predicted.length || actual.length === 0) return 0.5;
    
    let sum = 0;
    let count = 0;
    
    for (let i = 0; i < actual.length; i++) {
      if (actual[i] > 0) {
        sum += Math.abs((actual[i] - predicted[i]) / actual[i]);
        count++;
      }
    }
    
    return count > 0 ? sum / count : 0.5;
  }
  
  /**
   * フォールバック: 単純移動平均
   */
  private fallbackMovingAverage(data: any[], days: number): ArimaForecastResult {
    const values = data.length > 0 
      ? data.map((d: any) => Number(d.total_quantity) || 0)
      : [0];
    
    const avg = values.reduce((a, b) => a + b, 0) / values.length || 0;
    const forecast = new Array(days).fill(Math.round(avg));
    
    return {
      values: forecast,
      total: Math.round(avg) * days,
      algorithm: 'simple',
      confidence: 0.5,
      trend: 0,
      seasonality: new Array(7).fill(0)
    };
  }
}
