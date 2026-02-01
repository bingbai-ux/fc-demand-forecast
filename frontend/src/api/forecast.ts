// 発注予測APIクライアント

const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * V1発注計算（既存）
 */
export async function calculateForecast(params: {
  storeId: string;
  supplierNames: string[];
  orderDate: string;
  forecastDays: number;
  lookbackDays: number;
}) {
  const response = await fetch(`${API_BASE}/api/forecast/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  return response.json();
}

/**
 * V2発注計算（ARIMA + ABC最適化）
 */
export async function calculateForecastV2(params: {
  storeId: string;
  supplierId: string;
  targetDate?: string;
  forecastDays?: number;
  referenceDays?: number;
}) {
  const response = await fetch(`${API_BASE}/api/v2/forecast/calculate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      targetDate: new Date().toISOString().split('T')[0],
      forecastDays: 7,
      referenceDays: 60,
      ...params
    })
  });
  
  if (!response.ok) {
    throw new Error(`APIエラー: ${response.status}`);
  }
  
  return response.json();
}

/**
 * ABC設定取得
 */
export async function getABCConfig() {
  const response = await fetch(`${API_BASE}/api/v2/forecast/abc-config`);
  return response.json();
}

/**
 * 統計情報取得
 */
export async function getForecastStats() {
  const response = await fetch(`${API_BASE}/api/v2/forecast/stats`);
  return response.json();
}

/**
 * バックテスト実行
 */
export async function runBacktest(params: {
  productId: string;
  startDate: string;
  endDate: string;
  algorithm: 'arima' | 'prophet' | 'moving_average' | 'ensemble';
}) {
  const response = await fetch(`${API_BASE}/api/backtest/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  return response.json();
}

/**
 * 自動最適化
 */
export async function optimizeForecast(productId: string, days?: number) {
  const response = await fetch(`${API_BASE}/api/backtest/optimize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ productId, days })
  });
  return response.json();
}
