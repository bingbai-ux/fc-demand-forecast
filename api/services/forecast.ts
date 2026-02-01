/**
 * 予測サービス
 * 複数のアルゴリズムによる需要予測を提供
 */

interface ForecastParams {
  productId: string;
  algorithm: string;
  days: number;
  historicalData: Array<{ date: Date; quantity: number; productId: string }>;
  options?: {
    seasonality?: number | null;
    confidenceInterval?: number;
  };
}

interface ForecastResult {
  date: string;
  value: number;
  lower?: number;
  upper?: number;
}

export class ForecastService {
  /**
   * メイン予測メソッド
   */
  async predict(params: ForecastParams): Promise<ForecastResult[]> {
    const { algorithm, days, historicalData, options } = params;

    switch (algorithm) {
      case 'moving_average':
        return this.movingAverage(historicalData, days, options);
      case 'arima':
        return this.arima(historicalData, days, options);
      case 'prophet':
        return this.prophet(historicalData, days, options);
      case 'ensemble':
        return this.ensemble(historicalData, days, options);
      default:
        return this.prophet(historicalData, days, options);
    }
  }

  /**
   * 単純移動平均（SMA）
   */
  private movingAverage(
    data: Array<{ date: Date; quantity: number }>,
    days: number,
    options?: any
  ): ForecastResult[] {
    const window = options?.seasonality || 7;
    const recent = data.slice(-window);
    const avg = recent.reduce((sum, d) => sum + d.quantity, 0) / recent.length;
    
    const results: ForecastResult[] = [];
    const lastDate = data[data.length - 1]?.date || new Date();
    
    for (let i = 1; i <= days; i++) {
      const date = new Date(lastDate);
      date.setDate(date.getDate() + i);
      
      // 週次季節性を適用
      const dayOfWeek = date.getDay();
      const seasonalFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? 1.2 : 1.0;
      const value = Math.max(0, avg * seasonalFactor);
      
      results.push({
        date: date.toISOString().split('T')[0],
        value: Math.round(value * 100) / 100,
        lower: Math.round(value * 0.8 * 100) / 100,
        upper: Math.round(value * 1.2 * 100) / 100
      });
    }
    
    return results;
  }

  /**
   * ARIMA風の予測（簡易実装）
   */
  private arima(
    data: Array<{ date: Date; quantity: number }>,
    days: number,
    options?: any
  ): ForecastResult[] {
    if (data.length < 7) {
      return this.movingAverage(data, days, options);
    }

    // 差分系列の計算（1階差分）
    const diffs: number[] = [];
    for (let i = 1; i < data.length; i++) {
      diffs.push(data[i].quantity - data[i - 1].quantity);
    }

    // 差分の平均（ドリフト項）
    const drift = diffs.slice(-7).reduce((sum, d) => sum + d, 0) / 7;
    
    // 最近の値を取得
    const lastValues = data.slice(-3);
    let lastValue = lastValues.reduce((sum, d) => sum + d.quantity, 0) / 3;
    
    const results: ForecastResult[] = [];
    const lastDate = data[data.length - 1]?.date || new Date();
    
    for (let i = 1; i <= days; i++) {
      const date = new Date(lastDate);
      date.setDate(date.getDate() + i);
      
      // ARIMA(0,1,1)風: 前回値 + ドリフト + 季節性
      const seasonalFactor = this.getSeasonalFactor(date, data);
      lastValue = Math.max(0, lastValue + drift * 0.5); // ドリフトを弱める
      const value = lastValue * seasonalFactor;
      
      // 予測区間の広がり（日数が進むほど不確実性増大）
      const uncertainty = 1 + (i * 0.1);
      
      results.push({
        date: date.toISOString().split('T')[0],
        value: Math.round(value * 100) / 100,
        lower: Math.round(value * (2 - uncertainty) * 100) / 100,
        upper: Math.round(value * uncertainty * 100) / 100
      });
    }
    
    return results;
  }

  /**
   * Prophet風の予測（加法モデル）
   */
  private prophet(
    data: Array<{ date: Date; quantity: number }>,
    days: number,
    options?: any
  ): ForecastResult[] {
    if (data.length < 14) {
      return this.movingAverage(data, days, options);
    }

    const seasonality = options?.seasonality || 7;
    
    // トレンド成分（線形回帰）
    const trend = this.calculateTrend(data);
    
    // 週次季節性
    const weeklySeasonality = this.calculateWeeklySeasonality(data);
    
    const results: ForecastResult[] = [];
    const lastDate = data[data.length - 1]?.date || new Date();
    const lastValue = data[data.length - 1]?.quantity || 0;
    
    for (let i = 1; i <= days; i++) {
      const date = new Date(lastDate);
      date.setDate(date.getDate() + i);
      
      // トレンド予測
      const trendValue = lastValue + trend * i;
      
      // 季節性を適用
      const dayOfWeek = date.getDay();
      const seasonalValue = weeklySeasonality[dayOfWeek] || 1.0;
      
      const value = Math.max(0, trendValue * seasonalValue);
      
      // 予測区間
      const uncertainty = 1 + (i * 0.08);
      
      results.push({
        date: date.toISOString().split('T')[0],
        value: Math.round(value * 100) / 100,
        lower: Math.max(0, Math.round(value * (2 - uncertainty) * 100) / 100),
        upper: Math.round(value * uncertainty * 100) / 100
      });
    }
    
    return results;
  }

  /**
   * アンサンブル予測（複数モデルの平均）
   */
  private async ensemble(
    data: Array<{ date: Date; quantity: number }>,
    days: number,
    options?: any
  ): Promise<ForecastResult[]> {
    // 複数モデルの予測を取得
    const maResult = this.movingAverage(data, days, options);
    const arimaResult = this.arima(data, days, options);
    const prophetResult = this.prophet(data, days, options);
    
    // 平均を計算
    const results: ForecastResult[] = [];
    
    for (let i = 0; i < days; i++) {
      const avgValue = (maResult[i].value + arimaResult[i].value + prophetResult[i].value) / 3;
      const avgLower = (maResult[i].lower! + arimaResult[i].lower! + prophetResult[i].lower!) / 3;
      const avgUpper = (maResult[i].upper! + arimaResult[i].upper! + prophetResult[i].upper!) / 3;
      
      results.push({
        date: maResult[i].date,
        value: Math.round(avgValue * 100) / 100,
        lower: Math.round(avgLower * 100) / 100,
        upper: Math.round(avgUpper * 100) / 100
      });
    }
    
    return results;
  }

  /**
   * 線形トレンドを計算
   */
  private calculateTrend(data: Array<{ date: Date; quantity: number }>): number {
    const n = data.length;
    if (n < 2) return 0;
    
    // 単純な傾き計算（最近の1/3のデータを使用）
    const recent = data.slice(-Math.floor(n / 3));
    if (recent.length < 2) return 0;
    
    const first = recent[0].quantity;
    const last = recent[recent.length - 1].quantity;
    const days = (recent[recent.length - 1].date.getTime() - recent[0].date.getTime()) / (1000 * 60 * 60 * 24);
    
    return days > 0 ? (last - first) / days : 0;
  }

  /**
   * 週次季節性を計算
   */
  private calculateWeeklySeasonality(data: Array<{ date: Date; quantity: number }>): number[] {
    const dayOfWeekAvg: number[][] = Array(7).fill(null).map(() => []);
    
    data.forEach(d => {
      const dayOfWeek = d.date.getDay();
      dayOfWeekAvg[dayOfWeek].push(d.quantity);
    });
    
    const averages = dayOfWeekAvg.map(dayData => 
      dayData.length > 0 ? dayData.reduce((sum, q) => sum + q, 0) / dayData.length : 1
    );
    
    const overallAvg = averages.reduce((sum, a) => sum + a, 0) / 7;
    
    return averages.map(avg => overallAvg > 0 ? avg / overallAvg : 1);
  }

  /**
   * 季節性係数を取得
   */
  private getSeasonalFactor(date: Date, data: Array<{ date: Date; quantity: number }>): number {
    const dayOfWeek = date.getDay();
    const seasonality = this.calculateWeeklySeasonality(data);
    return seasonality[dayOfWeek] || 1.0;
  }
}
