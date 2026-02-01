import type {
  StoresResponse,
  CategoriesResponse,
} from '../types';

// 環境変数からAPIベースURLを取得（本番/開発で切り替え）
// VITE_API_URLには末尾に/apiを含めない（例: https://xxx.railway.app）
const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const API_BASE = `${API_BASE_URL}/api`;
const FETCH_TIMEOUT = 300000; // 5分（長期間のデータ取得に対応）
const SYNC_TIMEOUT = 600000; // 10分（同期処理用）

// タイムアウト付きfetch（外部AbortSignal対応）
async function fetchWithTimeout(
  url: string, 
  options?: RequestInit, 
  timeout: number = FETCH_TIMEOUT,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  // 外部のAbortSignalがあれば連動
  if (externalSignal) {
    externalSignal.addEventListener('abort', () => controller.abort());
  }
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 店舗一覧を取得
export async function fetchStores(): Promise<StoresResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/stores`);
  if (!response.ok) {
    throw new Error('店舗一覧の取得に失敗しました');
  }
  return response.json();
}

// カテゴリ一覧を取得
export async function fetchCategories(): Promise<CategoriesResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/categories`);
  if (!response.ok) {
    throw new Error('カテゴリ一覧の取得に失敗しました');
  }
  return response.json();
}

// フィルターオプション
export interface FilterOptions {
  search?: string;
  categoryIds?: string[];
  supplierIds?: string[];
  stockFilter?: 'all' | 'inStock' | 'outOfStock';
  excludeNoSales?: boolean;
  excludedCategories?: string[];
  hiddenProducts?: string[];
}

// ソートオプション
export interface SortOptions {
  column: string;
  direction: 'asc' | 'desc';
}

// ページネーション情報
export interface PaginationInfo {
  page: number;
  limit: number;
  totalItems: number;
  totalPages: number;
}

// ページネーション付きレスポンス
export interface PaginatedTableDataResponse {
  success: boolean;
  data: import('../types').ProductTableData[];
  pagination: PaginationInfo;
  meta: {
    period: { from: string; to: string };
    storeIds: string[] | 'all';
    fetchedAt: string;
    source: 'cache' | 'api';
    responseTime: string;
    stockUpdatedAt?: string | null;  // 在庫の最終更新日時
  };
}

// 同期結果
export interface SyncResult {
  success: boolean;
  message?: string;
  count?: number;
  error?: string;
}

// サーバーサイドページネーション対応のデータ取得（AbortSignal対応）
export async function fetchTableDataPaginated(params: {
  from: string;
  to: string;
  storeIds?: string[];
  page?: number;
  limit?: number;
  filters?: FilterOptions;
  sort?: SortOptions;
  signal?: AbortSignal;  // リクエストキャンセル用
}): Promise<PaginatedTableDataResponse> {
  const searchParams = new URLSearchParams({
    from: params.from,
    to: params.to,
    page: String(params.page || 1),
    limit: String(params.limit || 50),
  });
  
  if (params.storeIds && params.storeIds.length > 0) {
    searchParams.set('storeIds', params.storeIds.join(','));
  }
  
  // フィルターパラメータ
  if (params.filters) {
    if (params.filters.search) {
      searchParams.set('search', params.filters.search);
    }
    if (params.filters.categoryIds && params.filters.categoryIds.length > 0) {
      searchParams.set('categoryIds', params.filters.categoryIds.join(','));
    }
    if (params.filters.supplierIds && params.filters.supplierIds.length > 0) {
      searchParams.set('supplierIds', params.filters.supplierIds.join(','));
    }
    if (params.filters.stockFilter && params.filters.stockFilter !== 'all') {
      searchParams.set('stockFilter', params.filters.stockFilter);
    }
    if (params.filters.excludeNoSales) {
      searchParams.set('excludeNoSales', 'true');
    }
    if (params.filters.excludedCategories && params.filters.excludedCategories.length > 0) {
      searchParams.set('excludedCategories', params.filters.excludedCategories.join(','));
    }
    if (params.filters.hiddenProducts && params.filters.hiddenProducts.length > 0) {
      searchParams.set('hiddenProducts', params.filters.hiddenProducts.join(','));
    }
  }
  
  // ソートパラメータ
  if (params.sort) {
    searchParams.set('sortColumn', params.sort.column);
    searchParams.set('sortDirection', params.sort.direction);
  }
  
  const response = await fetchWithTimeout(
    `${API_BASE}/table-data?${searchParams}`,
    undefined,
    FETCH_TIMEOUT,
    params.signal  // AbortSignalを渡す
  );
  if (!response.ok) {
    throw new Error('データの取得に失敗しました');
  }
  return response.json();
}

// キャッシュクリア
export async function clearCache(): Promise<void> {
  await fetchWithTimeout(`${API_BASE}/table-data/cache`, { method: 'DELETE' });
}

// 売上データを同期（スマレジAPIから取得してSupabaseに保存）
export async function syncSales(from: string, to: string): Promise<SyncResult> {
  const response = await fetchWithTimeout(
    `${API_BASE}/sync/sales`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to }),
    },
    SYNC_TIMEOUT
  );
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '同期に失敗しました' }));
    throw new Error(error.error || '売上データの同期に失敗しました');
  }
  
  return response.json();
}

// 仕入先一覧を取得
export interface SuppliersResponse {
  success: boolean;
  count: number;
  data: string[];
}

export async function fetchSuppliers(): Promise<SuppliersResponse> {
  const response = await fetchWithTimeout(`${API_BASE}/suppliers`);
  if (!response.ok) {
    throw new Error('仕入先一覧の取得に失敗しました');
  }
  return response.json();
}

// 在庫データのみを更新
export interface StockUpdateResult {
  success: boolean;
  stockCount: number;
  updatedAt: string;
  message: string;
  error?: string;
}

export async function updateStock(): Promise<StockUpdateResult> {
  const response = await fetchWithTimeout(
    `${API_BASE}/sync/stock-only`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    SYNC_TIMEOUT
  );
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: '在庫更新に失敗しました' }));
    throw new Error(error.error || '在庫データの更新に失敗しました');
  }
  
  return response.json();
}


