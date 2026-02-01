// 店舗
export interface Store {
  storeId: string;
  storeName: string;
  storeCode?: string;
}

// カテゴリ
export interface Category {
  categoryId: string;
  categoryName: string;
  categoryCode?: string;
  level?: string;
  parentCategoryId?: string;
}

// 商品
export interface Product {
  productId: string;
  productName: string;
  productCode: string | null;
  categoryId: string;
  tag: string | null;           // ブランド名
  groupCode: string | null;     // 仕入先
  price: string;
  cost: string | null;
}

// カテゴリ名付き商品
export interface ProductWithCategory extends Product {
  categoryName: string;
}

// 在庫（後で使用）
export interface Stock {
  productId: string;
  storeId: string;
  stockAmount: string;
  updDateTime: string;
}

// 統合商品データ（表示用）
export interface ProductTableData {
  productId: string;
  productName: string;
  productCode: string | null;
  categoryId: string;
  categoryName: string;
  brandName: string | null;      // tag
  supplierName: string | null;   // groupCode
  price: number;                 // 販売単価
  cost: number;                  // 原価
  stockTotal: number;            // 在庫合計
  stockByStore: { [storeId: string]: number };  // 店舗別在庫
  salesByDate: { [date: string]: number };      // 日付別売上数
  salesByStore: { [storeId: string]: number };  // 店舗別売上数
  totalQuantity: number;         // 合計売上数
  totalSales: number;            // 合計売上金額
  totalCost: number;             // 合計原価
  grossMargin: number;           // 粗利率
}
