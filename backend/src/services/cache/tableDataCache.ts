import { supabase } from '../../config/supabase';

export interface CachedProductData {
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
  stockByStore: { [storeId: string]: number };
  salesByDate: { [date: string]: number };
  salesByStore: { [storeId: string]: number };
  totalQuantity: number;
  totalSales: number;
  totalCost: number;
  grossMargin: number;
}

export interface CachedTableDataResponse {
  products: CachedProductData[];
  meta: {
    totalProducts: number;
    productsWithSales: number;
    period: { from: string; to: string };
    storeIds: string[] | 'all';
    fetchedAt: string;
    source: string;
    elapsedMs: number;
    stockUpdatedAt: string | null;
  };
}

// サーバーサイドページネーション用のレスポンス型
export interface PaginatedTableDataResponse {
  products: CachedProductData[];
  pagination: {
    page: number;
    limit: number;
    totalItems: number;
    totalPages: number;
  };
  meta: {
    period: { from: string; to: string };
    storeIds: string[] | 'all';
    fetchedAt: string;
    source: string;
    elapsedMs: number;
    stockUpdatedAt: string | null;
  };
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

// 在庫の最終更新日時を取得
async function getStockUpdatedAt(): Promise<string | null> {
  const { data: syncStatus } = await supabase
    .from('sync_status')
    .select('last_synced_at')
    .eq('sync_type', 'stock')
    .single();
  
  return syncStatus?.last_synced_at || null;
}

// 日次集計テーブルから売上データを取得（最適化版）
async function fetchSalesFromSummary(
  fromDate: string,
  toDate: string,
  storeIds?: string[]
): Promise<any[]> {
  console.log('=== fetchSalesFromSummary 開始 ===');
  console.log('期間:', fromDate, '～', toDate);
  console.log('店舗IDs:', storeIds);
  
  const PAGE_SIZE = 1000;
  let allData: any[] = [];
  let from = 0;
  let hasMore = true;
  
  while (hasMore) {
    let query = supabase
      .from('sales_daily_summary')
      .select('product_id, store_id, sale_date, total_quantity, total_sales, total_cost')
      .gte('sale_date', fromDate)
      .lte('sale_date', toDate)
      .range(from, from + PAGE_SIZE - 1);
    
    if (storeIds && storeIds.length > 0) {
      // store_idは文字列型としてクエリ（テーブルの型に合わせる）
      query = query.in('store_id', storeIds);
      if (from === 0) {
        console.log('店舗フィルター適用（文字列）:', storeIds);
      }
    }
    
    const { data, error } = await query;
    
    if (error) {
      console.error('売上集計取得エラー:', error);
      throw new Error(`売上集計取得エラー: ${error.message}`);
    }
    
    if (data && data.length > 0) {
      allData = allData.concat(data);
      
      // 最初のページでサンプルデータをログ出力
      if (from === 0 && data.length > 0) {
        console.log('サンプルデータ（最初の3件）:', JSON.stringify(data.slice(0, 3)));
      }
      
      from += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }
  
  console.log('取得した売上レコード数:', allData.length);
  
  // 店舗別の件数をログ出力
  const storeCount: { [key: string]: number } = {};
  allData.forEach(d => {
    const sid = String(d.store_id);
    storeCount[sid] = (storeCount[sid] || 0) + 1;
  });
  console.log('店舗別件数:', JSON.stringify(storeCount));
  
  return allData;
}

// 売上がある商品IDのセットを取得
async function getProductIdsWithSales(
  fromDate: string,
  toDate: string,
  storeIds?: string[]
): Promise<Set<string>> {
  let query = supabase
    .from('sales_daily_summary')
    .select('product_id')
    .gte('sale_date', fromDate)
    .lte('sale_date', toDate);
  
  if (storeIds && storeIds.length > 0) {
    // store_idは文字列型としてクエリ（テーブルの型に合わせる）
    query = query.in('store_id', storeIds);
  }
  
  const { data, error } = await query;
  
  if (error) {
    throw new Error(`売上商品ID取得エラー: ${error.message}`);
  }
  
  const productIds = new Set<string>();
  (data || []).forEach((item: any) => {
    productIds.add(item.product_id);
  });
  
  return productIds;
}

// 特定の商品IDのみを取得
async function fetchProductsByIds(productIds: string[]): Promise<any[]> {
  if (productIds.length === 0) return [];
  
  const PAGE_SIZE = 500;
  let allData: any[] = [];
  
  // 商品IDを分割して取得（Supabaseの制限回避）
  for (let i = 0; i < productIds.length; i += PAGE_SIZE) {
    const chunk = productIds.slice(i, i + PAGE_SIZE);
    
    const { data, error } = await supabase
      .from('products_cache')
      .select('product_id, product_name, product_code, category_id, category_name, brand_name, supplier_name, price, cost')
      .in('product_id', chunk);
    
    if (error) {
      throw new Error(`商品取得エラー: ${error.message}`);
    }
    
    if (data) {
      allData = allData.concat(data);
    }
  }
  
  return allData;
}

// 特定の商品IDの在庫のみを取得
async function fetchStockByProductIds(productIds: string[], storeIds?: string[]): Promise<any[]> {
  if (productIds.length === 0) return [];
  
  const PAGE_SIZE = 500;
  let allData: any[] = [];
  
  for (let i = 0; i < productIds.length; i += PAGE_SIZE) {
    const chunk = productIds.slice(i, i + PAGE_SIZE);
    
    let query = supabase
      .from('stock_cache')
      .select('product_id, store_id, stock_amount')
      .in('product_id', chunk);
    
    if (storeIds && storeIds.length > 0) {
      query = query.in('store_id', storeIds);
    }
    
    const { data, error } = await query;
    
    if (error) {
      throw new Error(`在庫取得エラー: ${error.message}`);
    }
    
    if (data) {
      allData = allData.concat(data);
    }
  }
  
  return allData;
}

// サーバーサイドページネーション付きでデータを取得（最適化版）
export const getTableDataPaginated = async (
  fromDate: string,
  toDate: string,
  page: number = 1,
  limit: number = 50,
  storeIds?: string[],
  filters?: FilterOptions,
  sort?: SortOptions
): Promise<PaginatedTableDataResponse> => {
  console.log(`📊 データを取得中... (page: ${page}, limit: ${limit})`);
  const startTime = Date.now();
  
  // excludeNoSalesがtrueの場合は、売上がある商品のみを取得
  const excludeNoSales = filters?.excludeNoSales ?? false;
  
  let productsData: any[];
  let stockData: any[];
  let salesData: any[];
  
  if (excludeNoSales) {
    // 最適化パス: 売上がある商品のみを取得
    console.log('   最適化パス: 売上がある商品のみを取得');
    
    // 1. 売上データを取得
    salesData = await fetchSalesFromSummary(fromDate, toDate, storeIds);
    console.log(`   売上: ${salesData.length}件 (日次集計) - ${Date.now() - startTime}ms`);
    
    // 2. 売上がある商品IDを抽出
    const productIdsWithSales = new Set<string>();
    salesData.forEach((s: any) => productIdsWithSales.add(s.product_id));
    const productIdArray = Array.from(productIdsWithSales);
    console.log(`   売上がある商品: ${productIdArray.length}件 - ${Date.now() - startTime}ms`);
    
    // 3. 該当商品のみを取得
    productsData = await fetchProductsByIds(productIdArray);
    console.log(`   商品: ${productsData.length}件 - ${Date.now() - startTime}ms`);
    
    // 4. 該当商品の在庫のみを取得
    stockData = await fetchStockByProductIds(productIdArray, storeIds);
    console.log(`   在庫: ${stockData.length}件 - ${Date.now() - startTime}ms`);
  } else {
    // 通常パス: 全商品を取得
    console.log('   通常パス: 全商品を取得');
    
    // 並列で取得
    const [productsResult, stockResult, salesResult] = await Promise.all([
      // 商品データ
      (async () => {
        const PAGE_SIZE = 1000;
        let allData: any[] = [];
        let from = 0;
        let hasMore = true;
        
        while (hasMore) {
          const { data, error } = await supabase
            .from('products_cache')
            .select('product_id, product_name, product_code, category_id, category_name, brand_name, supplier_name, price, cost')
            .range(from, from + PAGE_SIZE - 1);
          
          if (error) throw new Error(`商品取得エラー: ${error.message}`);
          
          if (data && data.length > 0) {
            allData = allData.concat(data);
            from += PAGE_SIZE;
            hasMore = data.length === PAGE_SIZE;
          } else {
            hasMore = false;
          }
        }
        return allData;
      })(),
      // 在庫データ
      (async () => {
        let query = supabase.from('stock_cache').select('product_id, store_id, stock_amount');
        if (storeIds && storeIds.length > 0) {
          query = query.in('store_id', storeIds);
        }
        const { data, error } = await query;
        if (error) throw new Error(`在庫取得エラー: ${error.message}`);
        return data || [];
      })(),
      // 売上データ
      fetchSalesFromSummary(fromDate, toDate, storeIds)
    ]);
    
    productsData = productsResult;
    stockData = stockResult;
    salesData = salesResult;
    
    console.log(`   商品: ${productsData.length}件, 在庫: ${stockData.length}件, 売上: ${salesData.length}件 - ${Date.now() - startTime}ms`);
  }
  
  // 在庫の最終更新日時を取得
  const stockUpdatedAt = await getStockUpdatedAt();
  
  // 在庫をproductIdでグループ化
  const stockByProduct = new Map<string, { total: number; byStore: { [storeId: string]: number } }>();
  stockData.forEach((s: any) => {
    // product_idを文字列に統一
    const productId = String(s.product_id);
    const storeId = String(s.store_id);
    
    if (!stockByProduct.has(productId)) {
      stockByProduct.set(productId, { total: 0, byStore: {} });
    }
    const stock = stockByProduct.get(productId)!;
    stock.total += s.stock_amount;
    stock.byStore[storeId] = s.stock_amount;
  });
  
  // 売上をproductIdでグループ化
  const salesByProduct = new Map<string, {
    byDate: { [date: string]: number };
    byStore: { [storeId: string]: number };
    totalQuantity: number;
    totalSales: number;
    totalCost: number;
  }>();
  
  console.log('=== 売上データ集計開始 ===');
  console.log('売上データ件数:', salesData.length);
  
  salesData.forEach((s: any) => {
    // product_idを文字列に統一
    const productId = String(s.product_id);
    
    if (!salesByProduct.has(productId)) {
      salesByProduct.set(productId, {
        byDate: {},
        byStore: {},
        totalQuantity: 0,
        totalSales: 0,
        totalCost: 0,
      });
    }
    const sale = salesByProduct.get(productId)!;
    
    // 日付をYYYY-MM-DD形式に変換
    const dateStr = s.sale_date ? String(s.sale_date).split('T')[0] : '';
    
    // store_idを文字列に統一
    const storeId = String(s.store_id);
    
    if (dateStr) {
      sale.byDate[dateStr] = (sale.byDate[dateStr] || 0) + (s.total_quantity || 0);
    }
    if (storeId) {
      sale.byStore[storeId] = (sale.byStore[storeId] || 0) + (s.total_quantity || 0);
    }
    sale.totalQuantity += s.total_quantity || 0;
    sale.totalSales += parseFloat(s.total_sales) || 0;
    sale.totalCost += parseFloat(s.total_cost) || 0;
  });
  
  console.log('集計された商品数:', salesByProduct.size);
  
  // サンプル出力
  const sampleProductId = salesByProduct.keys().next().value;
  if (sampleProductId) {
    console.log('サンプル商品の売上:', JSON.stringify({
      productId: sampleProductId,
      sales: salesByProduct.get(sampleProductId)
    }));
  }
  
  // 商品データに結合
  console.log('商品データ数:', productsData.length);
  
  // 売上がある商品IDと、商品マスタのIDが重複しているか確認
  const salesProductIds = new Set(Array.from(salesByProduct.keys()));
  const productIds = new Set(productsData.map((p: any) => String(p.product_id)));
  const intersection = [...salesProductIds].filter(id => productIds.has(id));
  
  console.log('=== product_id マッチング確認 ===');
  console.log('売上商品ID数:', salesProductIds.size);
  console.log('商品マスタID数:', productIds.size);
  console.log('重複するID数:', intersection.length);
  console.log('売上商品IDサンプル:', Array.from(salesProductIds).slice(0, 5));
  console.log('商品マスタIDサンプル:', Array.from(productIds).slice(0, 5));
  console.log('重複するIDサンプル:', intersection.slice(0, 5));
  
  let matchCount = 0;
  let products: CachedProductData[] = productsData.map((p: any) => {
    // product_idを文字列に統一して取得
    const productId = String(p.product_id);
    const stock = stockByProduct.get(productId);
    const sale = salesByProduct.get(productId);
    
    if (sale && sale.totalQuantity > 0) {
      matchCount++;
    }
    
    const totalSales = sale?.totalSales || 0;
    const totalCost = sale?.totalCost || 0;
    const grossMargin = totalSales > 0 
      ? Math.round(((totalSales - totalCost) / totalSales) * 10000) / 100 
      : 0;
    
    return {
      productId: p.product_id,
      productName: p.product_name,
      productCode: p.product_code,
      categoryId: p.category_id,
      categoryName: p.category_name || '不明',
      brandName: p.brand_name,
      supplierName: p.supplier_name,
      price: parseFloat(p.price) || 0,
      cost: parseFloat(p.cost) || 0,
      stockTotal: stock?.total || 0,
      stockByStore: stock?.byStore || {},
      salesByDate: sale?.byDate || {},
      salesByStore: sale?.byStore || {},
      totalQuantity: sale?.totalQuantity || 0,
      totalSales,
      totalCost,
      grossMargin,
    };
  });
  
  console.log('売上とマッチした商品数:', matchCount);
  
  // サーバーサイドフィルタリング（excludeNoSalesは既に処理済み）
  if (filters) {
    if (filters.hiddenProducts && filters.hiddenProducts.length > 0) {
      products = products.filter(p => !filters.hiddenProducts!.includes(p.productId));
    }
    
    if (filters.excludedCategories && filters.excludedCategories.length > 0) {
      products = products.filter(p => !filters.excludedCategories!.includes(p.categoryId));
    }
    
    if (filters.search) {
      const search = filters.search.toLowerCase();
      products = products.filter(p => {
        const matchName = p.productName.toLowerCase().includes(search);
        const matchBrand = p.brandName?.toLowerCase().includes(search);
        const matchCategory = p.categoryName.toLowerCase().includes(search);
        const matchSupplier = p.supplierName?.toLowerCase().includes(search);
        return matchName || matchBrand || matchCategory || matchSupplier;
      });
    }
    
    if (filters.categoryIds && filters.categoryIds.length > 0) {
      products = products.filter(p => filters.categoryIds!.includes(p.categoryId));
    }
    
    if (filters.supplierIds && filters.supplierIds.length > 0) {
      products = products.filter(p => p.supplierName && filters.supplierIds!.includes(p.supplierName));
    }
    
    // 在庫フィルタ:
    // - 'all': 全商品を表示（デフォルト、フィルタなし）
    // - 'inStock': 在庫あり（stockTotal > 0）のみ表示
    // - 'outOfStock': 在庫なし含む = 全商品を表示（在庫ありも在庫なしも両方）
    if (filters.stockFilter === 'inStock') {
      products = products.filter(p => p.stockTotal > 0);
    }
    // 'outOfStock'（在庫なし含む）と 'all' はフィルタリングしない
    
    // excludeNoSalesは最適化パスで既に処理済み
    if (!excludeNoSales && filters.excludeNoSales) {
      products = products.filter(p => p.totalQuantity > 0);
    }
  }
  
  // サーバーサイドソート
  if (sort) {
    products.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      
      switch (sort.column) {
        case 'productName':
          aVal = a.productName;
          bVal = b.productName;
          break;
        case 'brandName':
          aVal = a.brandName || '';
          bVal = b.brandName || '';
          break;
        case 'categoryName':
          aVal = a.categoryName;
          bVal = b.categoryName;
          break;
        case 'supplierName':
          aVal = a.supplierName || '';
          bVal = b.supplierName || '';
          break;
        case 'price':
          aVal = a.price;
          bVal = b.price;
          break;
        case 'cost':
          aVal = a.cost;
          bVal = b.cost;
          break;
        case 'stockTotal':
          aVal = a.stockTotal;
          bVal = b.stockTotal;
          break;
        case 'totalQuantity':
          aVal = a.totalQuantity;
          bVal = b.totalQuantity;
          break;
        case 'totalSales':
          aVal = a.totalSales;
          bVal = b.totalSales;
          break;
        case 'totalCost':
          aVal = a.totalCost;
          bVal = b.totalCost;
          break;
        case 'grossMargin':
          aVal = a.grossMargin;
          bVal = b.grossMargin;
          break;
        default:
          aVal = a.totalQuantity;
          bVal = b.totalQuantity;
      }
      
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sort.direction === 'asc' 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      }
      
      return sort.direction === 'asc' 
        ? (aVal as number) - (bVal as number)
        : (bVal as number) - (aVal as number);
    });
  }
  
  // ページネーション
  const totalItems = products.length;
  const totalPages = Math.ceil(totalItems / limit);
  const startIndex = (page - 1) * limit;
  const paginatedProducts = products.slice(startIndex, startIndex + limit);
  
  const elapsed = Date.now() - startTime;
  console.log(`✅ データ取得完了: ${elapsed}ms`);
  
  return {
    products: paginatedProducts,
    pagination: {
      page,
      limit,
      totalItems,
      totalPages,
    },
    meta: {
      period: { from: fromDate, to: toDate },
      storeIds: storeIds || 'all',
      fetchedAt: new Date().toISOString(),
      source: 'daily_summary_optimized',
      elapsedMs: elapsed,
      stockUpdatedAt,
    },
  };
};

// 全データを取得（ページネーションなし）- 最適化版
export const getTableDataFromCache = async (
  fromDate: string,
  toDate: string,
  storeIds?: string[]
): Promise<CachedTableDataResponse> => {
  console.log('📊 データを取得中...');
  const startTime = Date.now();
  
  // 並列で取得
  const [productsResult, stockResult, salesResult, stockUpdatedAt] = await Promise.all([
    // 商品データ
    (async () => {
      const PAGE_SIZE = 1000;
      let allData: any[] = [];
      let from = 0;
      let hasMore = true;
      
      while (hasMore) {
        const { data, error } = await supabase
          .from('products_cache')
          .select('product_id, product_name, product_code, category_id, category_name, brand_name, supplier_name, price, cost')
          .range(from, from + PAGE_SIZE - 1);
        
        if (error) throw new Error(`商品取得エラー: ${error.message}`);
        
        if (data && data.length > 0) {
          allData = allData.concat(data);
          from += PAGE_SIZE;
          hasMore = data.length === PAGE_SIZE;
        } else {
          hasMore = false;
        }
      }
      return allData;
    })(),
    // 在庫データ
    (async () => {
      let query = supabase.from('stock_cache').select('product_id, store_id, stock_amount');
      if (storeIds && storeIds.length > 0) {
        query = query.in('store_id', storeIds);
      }
      const { data, error } = await query;
      if (error) throw new Error(`在庫取得エラー: ${error.message}`);
      return data || [];
    })(),
    // 売上データ
    fetchSalesFromSummary(fromDate, toDate, storeIds),
    // 在庫更新日時
    getStockUpdatedAt()
  ]);
  
  const productsData = productsResult;
  const stockData = stockResult;
  const salesData = salesResult;
  
  console.log(`   商品: ${productsData.length}件, 在庫: ${stockData.length}件, 売上: ${salesData.length}件 - ${Date.now() - startTime}ms`);
  
  // 在庫をproductIdでグループ化
  const stockByProduct = new Map<string, { total: number; byStore: { [storeId: string]: number } }>();
  stockData.forEach((s: any) => {
    // product_idを文字列に統一
    const productId = String(s.product_id);
    const storeId = String(s.store_id);
    
    if (!stockByProduct.has(productId)) {
      stockByProduct.set(productId, { total: 0, byStore: {} });
    }
    const stock = stockByProduct.get(productId)!;
    stock.total += s.stock_amount;
    stock.byStore[storeId] = s.stock_amount;
  });
  
  // 売上をproductIdでグループ化
  const salesByProduct = new Map<string, {
    byDate: { [date: string]: number };
    byStore: { [storeId: string]: number };
    totalQuantity: number;
    totalSales: number;
    totalCost: number;
  }>();
  
  console.log('=== 売上データ集計開始 ===');
  console.log('売上データ件数:', salesData.length);
  
  salesData.forEach((s: any) => {
    // product_idを文字列に統一
    const productId = String(s.product_id);
    
    if (!salesByProduct.has(productId)) {
      salesByProduct.set(productId, {
        byDate: {},
        byStore: {},
        totalQuantity: 0,
        totalSales: 0,
        totalCost: 0,
      });
    }
    const sale = salesByProduct.get(productId)!;
    
    // 日付をYYYY-MM-DD形式に変換
    const dateStr = s.sale_date ? String(s.sale_date).split('T')[0] : '';
    
    // store_idを文字列に統一
    const storeId = String(s.store_id);
    
    if (dateStr) {
      sale.byDate[dateStr] = (sale.byDate[dateStr] || 0) + (s.total_quantity || 0);
    }
    if (storeId) {
      sale.byStore[storeId] = (sale.byStore[storeId] || 0) + (s.total_quantity || 0);
    }
    sale.totalQuantity += s.total_quantity || 0;
    sale.totalSales += parseFloat(s.total_sales) || 0;
    sale.totalCost += parseFloat(s.total_cost) || 0;
  });
  
  console.log('集計された商品数:', salesByProduct.size);
  
  // サンプル出力
  const sampleProductId = salesByProduct.keys().next().value;
  if (sampleProductId) {
    console.log('サンプル商品の売上:', JSON.stringify({
      productId: sampleProductId,
      sales: salesByProduct.get(sampleProductId)
    }));
  }
  
  // 商品データに結合
  console.log('商品データ数:', productsData.length);
  
  // 売上がある商品IDと、商品マスタのIDが重複しているか確認
  const salesProductIds = new Set(Array.from(salesByProduct.keys()));
  const productIds = new Set(productsData.map((p: any) => String(p.product_id)));
  const intersection = [...salesProductIds].filter(id => productIds.has(id));
  
  console.log('=== product_id マッチング確認 ===');
  console.log('売上商品ID数:', salesProductIds.size);
  console.log('商品マスタID数:', productIds.size);
  console.log('重複するID数:', intersection.length);
  console.log('売上商品IDサンプル:', Array.from(salesProductIds).slice(0, 5));
  console.log('商品マスタIDサンプル:', Array.from(productIds).slice(0, 5));
  console.log('重複するIDサンプル:', intersection.slice(0, 5));
  
  let matchCount = 0;
  const products: CachedProductData[] = productsData.map((p: any) => {
    // product_idを文字列に統一して取得
    const productId = String(p.product_id);
    const stock = stockByProduct.get(productId);
    const sale = salesByProduct.get(productId);
    
    if (sale && sale.totalQuantity > 0) {
      matchCount++;
    }
    
    const totalSales = sale?.totalSales || 0;
    const totalCost = sale?.totalCost || 0;
    const grossMargin = totalSales > 0 
      ? Math.round(((totalSales - totalCost) / totalSales) * 10000) / 100 
      : 0;
    
    return {
      productId: p.product_id,
      productName: p.product_name,
      productCode: p.product_code,
      categoryId: p.category_id,
      categoryName: p.category_name || '不明',
      brandName: p.brand_name,
      supplierName: p.supplier_name,
      price: parseFloat(p.price) || 0,
      cost: parseFloat(p.cost) || 0,
      stockTotal: stock?.total || 0,
      stockByStore: stock?.byStore || {},
      salesByDate: sale?.byDate || {},
      salesByStore: sale?.byStore || {},
      totalQuantity: sale?.totalQuantity || 0,
      totalSales,
      totalCost,
      grossMargin,
    };
  });
  
  console.log('売上とマッチした商品数:', matchCount);
  
  const productsWithSales = products.filter(p => p.totalQuantity > 0).length;
  
  const elapsed = Date.now() - startTime;
  console.log(`✅ データ取得完了: ${elapsed}ms`);
  
  return {
    products,
    meta: {
      totalProducts: products.length,
      productsWithSales,
      period: { from: fromDate, to: toDate },
      storeIds: storeIds || 'all',
      fetchedAt: new Date().toISOString(),
      source: 'daily_summary_optimized',
      elapsedMs: elapsed,
      stockUpdatedAt,
    },
  };
};

// 仕入先リストを取得
export const getSuppliersFromCache = async (): Promise<string[]> => {
  console.log('📊 仕入先リストを取得中...');
  
  const PAGE_SIZE = 1000;
  let allData: any[] = [];
  let from = 0;
  let hasMore = true;
  
  while (hasMore) {
    const { data, error } = await supabase
      .from('products_cache')
      .select('supplier_name')
      .range(from, from + PAGE_SIZE - 1);
    
    if (error) throw new Error(`商品取得エラー: ${error.message}`);
    
    if (data && data.length > 0) {
      allData = allData.concat(data);
      from += PAGE_SIZE;
      hasMore = data.length === PAGE_SIZE;
    } else {
      hasMore = false;
    }
  }
  
  const suppliers = new Set<string>();
  allData.forEach((p: any) => {
    if (p.supplier_name) {
      suppliers.add(p.supplier_name);
    }
  });
  
  const sortedSuppliers = Array.from(suppliers).sort();
  console.log(`✅ 仕入先リスト取得完了: ${sortedSuppliers.length}件`);
  
  return sortedSuppliers;
};

// キャッシュが利用可能かどうかを確認
export const isCacheAvailable = async (): Promise<boolean> => {
  try {
    const { count, error } = await supabase
      .from('products_cache')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.error('キャッシュ確認エラー:', error.message);
      return false;
    }
    
    return (count || 0) > 0;
  } catch (error: any) {
    console.error('キャッシュ確認エラー:', error.message);
    return false;
  }
};
