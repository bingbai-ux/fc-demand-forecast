/**
 * 需要予測APIクライアント（統合版）
 * V1/V2統合済み — 単一エンドポイントのみ
 */

const API_BASE = import.meta.env.VITE_API_URL || '';

/** 需要予測計算 */
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
    body: JSON.stringify(params),
  });
  return response.json();
}

/** 店舗一覧 */
export async function getStores() {
  const response = await fetch(`${API_BASE}/api/forecast/stores`);
  return response.json();
}

/** 仕入先一覧 */
export async function getSuppliers() {
  const response = await fetch(`${API_BASE}/api/forecast/suppliers`);
  return response.json();
}

/** 商品売上履歴 */
export async function getProductSalesHistory(productId: string, storeId: string, weeks = 8) {
  const response = await fetch(
    `${API_BASE}/api/forecast/product-sales-history?productId=${productId}&storeId=${storeId}&weeks=${weeks}`,
  );
  return response.json();
}

/** 商品詳細 */
export async function getProductDetail(productId: string, storeId: string, days = 30) {
  const response = await fetch(
    `${API_BASE}/api/forecast/product-detail/${productId}?storeId=${storeId}&days=${days}`,
  );
  return response.json();
}

/** 在庫シミュレーション */
export async function simulateStock(params: {
  currentStock: number;
  avgDailySales: number;
  leadTime: number;
  orderQuantity: number;
  safetyStock?: number;
  days?: number;
}) {
  const response = await fetch(`${API_BASE}/api/forecast/simulate-stock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return response.json();
}

/** 欠品コスト分析 */
export async function getStockoutAnalysis(storeId: string, month?: string) {
  const query = month ? `?month=${month}` : '';
  const response = await fetch(`${API_BASE}/api/forecast/stockout-analysis/${storeId}${query}`);
  return response.json();
}

/** 調整係数取得 */
export async function getAdjustments() {
  const response = await fetch(`${API_BASE}/api/forecast/adjustments`);
  return response.json();
}

/** 調整係数保存 */
export async function saveAdjustments(adjustments: any) {
  const response = await fetch(`${API_BASE}/api/forecast/adjustments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adjustments }),
  });
  return response.json();
}
