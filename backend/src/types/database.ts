/**
 * Supabaseデータベース型定義
 *
 * DBテーブルの型を一元管理し、any型の使用を排除する。
 * Supabaseクエリの戻り値に使用することで、型安全性を確保。
 */

// ══════════════════════════════════════════════════════════════
// 売上関連
// ══════════════════════════════════════════════════════════════

/** sales_cache テーブル */
export interface SalesCache {
  id?: number;
  product_id: string;
  store_id: string;
  sale_date: string;
  quantity: number;
  sales_amount: number;
  cost_amount: number;
  updated_at?: string;
}

/** sales_daily_summary テーブル */
export interface SalesDailySummary {
  product_id: string;
  store_id: string;
  sale_date: string;
  total_quantity: number;
  total_sales: number;
  total_cost: number;
  updated_at?: string;
}

// ══════════════════════════════════════════════════════════════
// 商品・在庫関連
// ══════════════════════════════════════════════════════════════

/** products_cache テーブル */
export interface ProductsCache {
  product_id: string;
  product_name: string;
  product_code: string | null;
  category_id: string | null;
  category_name: string | null;
  brand_name: string | null;
  supplier_name: string | null;
  price: number;
  cost: number;
  updated_at?: string;
}

/** stock_cache テーブル */
export interface StockCache {
  product_id: string;
  store_id: string;
  stock_amount: number;
  updated_at?: string;
}

/** product_order_lots テーブル */
export interface ProductOrderLots {
  product_id: string;
  lot_size: number;
}

// ══════════════════════════════════════════════════════════════
// 店舗・仕入先関連
// ══════════════════════════════════════════════════════════════

/** stores テーブル */
export interface Store {
  store_id: string;
  store_name: string;
  is_active: boolean;
}

/** suppliers テーブル */
export interface Supplier {
  supplier_name: string;
  lead_time_days: number;
  min_order_amount: number;
  free_shipping_amount: number | null;
  shipping_fee: number;
  order_method: 'manual' | 'email' | 'fax';
  email: string | null;
  contact_person: string | null;
}

// ══════════════════════════════════════════════════════════════
// 同期関連
// ══════════════════════════════════════════════════════════════

/** sync_status テーブル */
export interface SyncStatus {
  sync_type: 'sales' | 'products' | 'stock';
  status: 'idle' | 'syncing' | 'error';
  last_synced_at: string | null;
  last_synced_date: string | null;
  error_message: string | null;
  updated_at?: string;
}

// ══════════════════════════════════════════════════════════════
// 予測・学習関連
// ══════════════════════════════════════════════════════════════

/** forecast_snapshots テーブル */
export interface ForecastSnapshot {
  id?: number;
  store_id: string;
  product_id: string;
  forecast_date: string;
  period_start: string;
  period_end: string;
  predicted_quantity: number;
  lookback_days: number;
  algorithm: string;
  abc_rank: string;
  safety_stock: number;
  recommended_order: number;
  evaluated: boolean;
  created_at?: string;
}

/** forecast_accuracy テーブル */
export interface ForecastAccuracy {
  id?: number;
  store_id: string;
  product_id: string;
  period_start: string;
  period_end: string;
  predicted: number;
  actual: number;
  error: number;
  abs_error: number;
  mape: number;
  bias: number;
  lookback_days?: number;
  evaluated_at?: string;
}

/** product_forecast_params テーブル */
export interface ProductForecastParams {
  id?: number;
  store_id: string;
  product_id: string;
  bias_correction: number;
  safety_multiplier: number;
  best_lookback_days: number;
  dow_reliability: number;
  weekly_mape: number;
  weekly_bias: number;
  stockout_rate_7d: number;
  learning_cycles: number;
  last_learned_at: string;
  created_at?: string;
}

// ══════════════════════════════════════════════════════════════
// 発注関連
// ══════════════════════════════════════════════════════════════

/** orders テーブル */
export interface Order {
  id?: number;
  order_id: string;
  store_id: string;
  supplier_name: string;
  order_date: string;
  status: 'draft' | 'confirmed' | 'sent' | 'received' | 'cancelled';
  total_amount: number;
  total_quantity: number;
  created_at?: string;
  updated_at?: string;
}

/** order_items テーブル */
export interface OrderItem {
  id?: number;
  order_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_cost: number;
  amount: number;
}

// ══════════════════════════════════════════════════════════════
// API認証関連
// ══════════════════════════════════════════════════════════════

/** api_tokens テーブル */
export interface ApiToken {
  id?: number;
  service: string;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
  updated_at?: string;
}

// ══════════════════════════════════════════════════════════════
// ユーティリティ型
// ══════════════════════════════════════════════════════════════

/** Supabaseクエリの標準レスポンス型 */
export type SupabaseResult<T> = {
  data: T[] | null;
  error: { message: string; code?: string } | null;
};

/** Supabaseクエリの単一レコードレスポンス型 */
export type SupabaseSingleResult<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
};
