// 店舗
export interface Store {
  storeId: string;
  storeName: string;
  storeCode: string;
}

// カテゴリ
export interface Category {
  categoryId: string;
  categoryName: string;
}

// 商品テーブルデータ
export interface ProductTableData {
  productId: string;
  productName: string;
  productCode: string | null;
  categoryId: string;
  categoryName: string;
  brandName: string | null;
  supplierName: string | null;
  price: number;
  cost: number;
  stockTotal: number;
  stockByStore: Record<string, number>;
  salesByDate: Record<string, number>;
  salesByStore: Record<string, number>;
  totalQuantity: number;
  totalSales: number;
  totalCost: number;
  grossMargin: number;
}

// メタ情報
export interface TableDataMeta {
  totalProducts: number;
  productsWithSales: number;
  period: {
    from: string;
    to: string;
  };
  storeIds: string | string[];
  fetchedAt: string;
}

// APIレスポンス
export interface TableDataResponse {
  success: boolean;
  cached: boolean;
  cacheAge?: number;
  products: ProductTableData[];
  meta: TableDataMeta;
}

export interface StoresResponse {
  success: boolean;
  count: number;
  data: Store[];
}

export interface CategoriesResponse {
  success: boolean;
  count: number;
  data: Category[];
}

// フィルター状態
export interface FilterState {
  search: string;
  categoryIds: string[]; // 複数選択対応
  supplierIds: string[]; // 複数選択対応
  stockFilter: 'all' | 'inStock' | 'outOfStock';
  excludeNoSales: boolean;
}

// ソート状態
export interface SortState {
  column: string;
  direction: 'asc' | 'desc';
}

// 期間単位
export type PeriodUnit = 'day' | 'week' | 'month';

// localStorage保存用
export interface AppSettings {
  excludedCategories: string[];
  hiddenProducts: string[];
  selectedStores: string[];
  periodUnit: PeriodUnit;
}
