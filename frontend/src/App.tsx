import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { format, subDays } from 'date-fns';
import { ChevronDown, ChevronUp } from 'lucide-react';
import {
  Header,
  StorePeriodSelector,
  FilterBar,
  DataTable,
  Pagination,
  CategorySettingsModal,
  HiddenProductsModal,
  InlineSalesChart,
  LoadingProgress,
  Sidebar,
} from './components';
import type { MenuType } from './components/Sidebar';
import DemandForecast from './pages/DemandForecast';
import SettingsPage from './pages/SettingsPage';
import OrderHistory from './pages/OrderHistory';
import OrderAnalyticsPage from './pages/OrderAnalyticsPage';
import { fetchStores, fetchCategories, fetchSuppliers, fetchTableDataPaginated, syncSales, clearCache, updateStock } from './api/client';
import type { PaginationInfo } from './api/client';
import { useLocalStorage } from './hooks/useLocalStorage';
import type {
  Store,
  Category,
  ProductTableData,
  FilterState,
  SortState,
  PeriodUnit,
} from './types';

const ITEMS_PER_PAGE = 50;

function App() {
  // サイドバー状態
  const [currentMenu, setCurrentMenu] = useLocalStorage<MenuType>('currentMenu', 'sales-analysis');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useLocalStorage<boolean>('sidebarCollapsed', false);

  // マスターデータ
  const [stores, setStores] = useState<Store[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<ProductTableData[]>([]);

  // ローディング状態
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  
  // 在庫更新関連
  const [stockUpdatedAt, setStockUpdatedAt] = useState<string | null>(null);
  const [isUpdatingStock, setIsUpdatingStock] = useState(false);

  // サーバーサイドページネーション情報
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);

  // 期間設定（初期表示は前日1日分のみで高速化）
  const [fromDate, setFromDate] = useState(() => format(subDays(new Date(), 1), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(() => format(subDays(new Date(), 1), 'yyyy-MM-dd'));
  const [periodUnit, setPeriodUnit] = useLocalStorage<PeriodUnit>('periodUnit-v2', 'week');

  // 店舗選択（localStorage保存）
  const [selectedStores, setSelectedStores] = useLocalStorage<string[]>('selectedStores', []);

  // フィルター
  const [filters, setFilters] = useState<FilterState>({
    search: '',
    categoryIds: [], // 複数選択対応（空配列 = 全て）
    supplierIds: [], // 複数選択対応（空配列 = 全て）
    stockFilter: 'all',
    excludeNoSales: true, // デフォルト: 売れ数なしを除外
  });

  // ソート
  const [sortState, setSortState] = useState<SortState>({
    column: 'totalQuantity',
    direction: 'desc',
  });

  // ページネーション
  const [currentPage, setCurrentPage] = useState(1);

  // カテゴリ除外（localStorage保存）
  const [excludedCategories, setExcludedCategories] = useLocalStorage<string[]>('excludedCategories', []);

  // 非表示商品（localStorage保存）
  const [hiddenProducts, setHiddenProducts] = useLocalStorage<string[]>('hiddenProducts', []);

  // モーダル
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isHiddenModalOpen, setIsHiddenModalOpen] = useState(false);

  // 選択された商品（クリックで選択）
  const [selectedProduct, setSelectedProduct] = useState<ProductTableData | null>(null);

  // グラフの表示/非表示
  const [isChartExpanded, setIsChartExpanded] = useLocalStorage<boolean>('isChartExpanded', true);

  // デバウンス用のタイマーref
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // 自動更新を一時的に無効化するフラグ
  const skipAutoUpdateRef = useRef(false);
  
  // リクエストキャンセル用のAbortController
  const abortControllerRef = useRef<AbortController | null>(null);

  // 仕入先リスト（APIから取得）
  const [suppliers, setSuppliers] = useState<string[]>([]);

  // 日付カラム（期間から生成）
  const dateColumns = useMemo(() => {
    const columns: string[] = [];
    const start = new Date(fromDate);
    const end = new Date(toDate);
    const current = new Date(start);
    while (current <= end) {
      columns.push(format(current, 'yyyy-MM-dd'));
      current.setDate(current.getDate() + 1);
    }
    return columns;
  }, [fromDate, toDate]);

  // 非表示商品データ（サーバーサイドでフィルタリングされるため、別途取得が必要）
  const [hiddenProductsData, setHiddenProductsData] = useState<ProductTableData[]>([]);

  // マスターデータ取得（初回のみ）
  const loadMasterData = useCallback(async () => {
    const [storesRes, categoriesRes, suppliersRes] = await Promise.all([
      fetchStores(),
      fetchCategories(),
      fetchSuppliers(),
    ]);
    setStores(storesRes.data);
    setCategories(categoriesRes.data);
    setSuppliers(suppliersRes.data);
    return storesRes.data;
  }, []);

  // メインデータ取得（サーバーサイドページネーション対応 + リクエストキャンセル対応）
  const loadTableData = useCallback(async (
    storeIdsToUse?: string[], 
    from?: string, 
    to?: string,
    page?: number
  ) => {
    // 前のリクエストをキャンセル
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    
    // 新しいAbortControllerを作成
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    setIsLoading(true);
    setError(null);

    // 引数で渡された日付を使用、なければstateの値を使用
    const fromDateToUse = from || fromDate;
    const toDateToUse = to || toDate;
    const pageToUse = page || currentPage;

    try {
      const tableDataRes = await fetchTableDataPaginated({
        from: fromDateToUse,
        to: toDateToUse,
        storeIds: storeIdsToUse && storeIdsToUse.length > 0 ? storeIdsToUse : undefined,
        page: pageToUse,
        limit: ITEMS_PER_PAGE,
        filters: {
          search: filters.search || undefined,
          categoryIds: filters.categoryIds.length > 0 ? filters.categoryIds : undefined,
          supplierIds: filters.supplierIds.length > 0 ? filters.supplierIds : undefined,
          stockFilter: filters.stockFilter,
          excludeNoSales: filters.excludeNoSales,
          excludedCategories: excludedCategories.length > 0 ? excludedCategories : undefined,
          hiddenProducts: hiddenProducts.length > 0 ? hiddenProducts : undefined,
        },
        sort: {
          column: sortState.column,
          direction: sortState.direction,
        },
        signal: controller.signal,  // AbortSignalを渡す
      });

      // リクエストがキャンセルされていたら結果を無視
      if (controller.signal.aborted) {
        return;
      }

      setProducts(tableDataRes.data);
      setPagination(tableDataRes.pagination);
      setLastUpdated(format(new Date(), 'yyyy/MM/dd HH:mm:ss'));
      
      // 在庫更新日時を保存
      if (tableDataRes.meta?.stockUpdatedAt) {
        setStockUpdatedAt(tableDataRes.meta.stockUpdatedAt);
      }
    } catch (err: unknown) {
      // AbortErrorは無視（正常なキャンセル）
      if (err instanceof Error && err.name === 'AbortError') {
        console.log('リクエストがキャンセルされました');
        return;
      }
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
    } finally {
      setIsLoading(false);
      setIsInitialLoad(false);
    }
  }, [fromDate, toDate, currentPage, filters, sortState, excludedCategories, hiddenProducts]);

  // 初回読み込み
  useEffect(() => {
    const init = async () => {
      try {
        const storesData = await loadMasterData();
        // 初回の場合は全店舗を選択
        if (selectedStores.length === 0) {
          const allStoreIds = storesData.map((s: Store) => s.storeId);
          setSelectedStores(allStoreIds);
          await loadTableData(allStoreIds, undefined, undefined, 1);
        } else {
          await loadTableData(selectedStores, undefined, undefined, 1);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
        setIsLoading(false);
        setIsInitialLoad(false);
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 「更新が必要」フラグ（フィルター変更時に立てる）
  const [needsRefresh, setNeedsRefresh] = useState(false);

  // 店舗・期間・フィルター・ソート変更時はフラグを立てるのみ（自動更新しない）
  useEffect(() => {
    // 初回読み込み中はスキップ
    if (isInitialLoad) return;
    
    // 手動更新後は一時的にスキップ
    if (skipAutoUpdateRef.current) {
      skipAutoUpdateRef.current = false;
      return;
    }

    // フィルター変更時は「更新が必要」フラグを立てるのみ
    setNeedsRefresh(true);
  }, [selectedStores, fromDate, toDate, filters, sortState, excludedCategories, hiddenProducts]); // eslint-disable-line react-hooks/exhaustive-deps

  // ページ変更時の更新
  useEffect(() => {
    // 初回読み込み中はスキップ
    if (isInitialLoad) return;

    loadTableData(selectedStores, fromDate, toDate, currentPage);
  }, [currentPage]); // eslint-disable-line react-hooks/exhaustive-deps

  // 表示を更新（現在の条件でデータを再取得）
  const handleDisplayRefresh = useCallback(async () => {
    // デバウンスタイマーをキャンセル
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    // 自動更新を一時的にスキップ
    skipAutoUpdateRef.current = true;
    
    setIsLoading(true);
    setError(null);
    
    try {
      // ページを1にリセットしてデータを取得
      setCurrentPage(1);
      await loadTableData(selectedStores, fromDate, toDate, 1);
      // 更新フラグをリセット
      setNeedsRefresh(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの取得に失敗しました');
    } finally {
      setIsLoading(false);
    }
  }, [loadTableData, selectedStores, fromDate, toDate]);

  // 売上データを同期（スマレジから最新の売上を取得）
  const handleRefresh = useCallback(async () => {
    // デバウンスタイマーをキャンセル
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    // 自動更新を一時的にスキップ
    skipAutoUpdateRef.current = true;
    
    setIsSyncing(true);
    setSyncMessage('売上データを同期中...');
    setError(null);
    
    try {
      // 1. 売上データを同期（スマレジAPIから取得してSupabaseに保存）
      await syncSales(fromDate, toDate);
      setSyncMessage('キャッシュをクリア中...');
      
      // 2. キャッシュをクリア
      await clearCache();
      setSyncMessage('データを取得中...');
      
      // 3. データを再取得
      await loadTableData(selectedStores, fromDate, toDate, currentPage);
      setSyncMessage(null);
      // 更新フラグをリセット
      setNeedsRefresh(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'データの同期に失敗しました');
      setSyncMessage(null);
    } finally {
      setIsSyncing(false);
    }
  }, [loadTableData, selectedStores, fromDate, toDate, currentPage]);

  // 在庫更新ハンドラー
  const handleUpdateStock = useCallback(async () => {
    if (isUpdatingStock) return;
    
    setIsUpdatingStock(true);
    setError(null);
    
    try {
      const result = await updateStock();
      
      if (result.success) {
        setStockUpdatedAt(result.updatedAt);
        // データを再取得
        await loadTableData(selectedStores, fromDate, toDate, currentPage);
        alert(`在庫を更新しました（${result.stockCount.toLocaleString()}件）`);
      } else {
        throw new Error(result.error || '在庫更新に失敗しました');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '在庫更新に失敗しました');
    } finally {
      setIsUpdatingStock(false);
    }
  }, [isUpdatingStock, loadTableData, selectedStores, fromDate, toDate, currentPage]);

  // ソート変更
  const handleSort = (column: SortState['column']) => {
    setSortState(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  // 商品非表示
  const handleHideProduct = (productId: string) => {
    // 非表示リストに追加
    if (!hiddenProducts.includes(productId)) {
      setHiddenProducts([...hiddenProducts, productId]);
    }
    // 現在のproductsから該当商品を取得してhiddenProductsDataに追加
    const productToHide = products.find(p => p.productId === productId);
    if (productToHide) {
      setHiddenProductsData(prev => [...prev, productToHide]);
    }
  };

  // 商品復元
  const handleRestoreProduct = (productId: string) => {
    setHiddenProductsData(prev => prev.filter(p => p.productId !== productId));
    setHiddenProducts(hiddenProducts.filter(id => id !== productId));
  };

  // 全商品復元
  const handleRestoreAllProducts = () => {
    setHiddenProductsData([]);
    setHiddenProducts([]);
  };

  // カテゴリ除外切り替え
  const handleToggleCategory = (categoryId: string) => {
    if (excludedCategories.includes(categoryId)) {
      setExcludedCategories(excludedCategories.filter(id => id !== categoryId));
    } else {
      setExcludedCategories([...excludedCategories, categoryId]);
    }
  };

  // カテゴリ全選択
  const handleSelectAllCategories = () => {
    setExcludedCategories([]);
  };

  // カテゴリ全解除
  const handleDeselectAllCategories = () => {
    setExcludedCategories(categories.map(c => c.categoryId));
  };

  // フィルター変更
  const handleFilterChange = (newFilters: FilterState) => {
    setFilters(newFilters);
  };

  // ページ変更
  const handlePageChange = (page: number) => {
    setCurrentPage(page);
  };

  // 商品選択（クリック）
  const handleSelectProduct = (product: ProductTableData | null) => {
    setSelectedProduct(product);
    // グラフが閉じている場合は開く
    if (product && !isChartExpanded) {
      setIsChartExpanded(true);
    }
  };

  // 総ページ数と総件数
  const totalPages = pagination?.totalPages || 1;
  const totalItems = pagination?.totalItems || 0;

  // 売上分析コンテンツ
  const renderSalesAnalysis = () => (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* 固定ヘッダー部分 */}
      <div className="sticky top-0 z-40 bg-gray-50">
        <Header
          lastUpdated={lastUpdated}
          stockUpdatedAt={stockUpdatedAt}
          isLoading={isLoading || isSyncing}
          isUpdatingStock={isUpdatingStock}
          needsRefresh={needsRefresh}
          onRefresh={handleRefresh}
          onUpdateStock={handleUpdateStock}
          onDisplayRefresh={handleDisplayRefresh}
        />

        <div className="max-w-full mx-auto px-4 py-2 space-y-2">
          {/* 店舗・期間選択 */}
          <StorePeriodSelector
            stores={stores}
            selectedStores={selectedStores}
            onStoreChange={setSelectedStores}
            fromDate={fromDate}
            toDate={toDate}
            periodUnit={periodUnit}
            onFromDateChange={setFromDate}
            onToDateChange={setToDate}
            onPeriodUnitChange={setPeriodUnit}
          />

          {/* フィルターバー */}
          <FilterBar
            filters={filters}
            categories={categories.filter(c => !excludedCategories.includes(c.categoryId))}
            suppliers={suppliers}
            hiddenProductCount={hiddenProducts.length}
            onFilterChange={handleFilterChange}
            onOpenCategorySettings={() => setIsCategoryModalOpen(true)}
            onOpenHiddenProducts={() => setIsHiddenModalOpen(true)}
          />

          {/* グラフセクション（折りたたみ可能） */}
          <div 
            className="bg-white rounded-lg shadow-sm border border-gray-200"
            style={{ position: 'relative', zIndex: 20 }}
          >
            {/* グラフヘッダー（クリックで折りたたみ） */}
            <button
              onClick={() => setIsChartExpanded(!isChartExpanded)}
              className="w-full px-4 py-2 flex items-center justify-between text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <span className="flex items-center gap-2">
                売上グラフ
                {selectedProduct && (
                  <span className="text-[#0D4F4F] font-normal">
                    - {selectedProduct.productName}
                  </span>
                )}
                {!selectedProduct && (
                  <span className="text-gray-400 font-normal">
                    （商品をクリックして選択）
                  </span>
                )}
              </span>
              {isChartExpanded ? (
                <ChevronUp className="w-5 h-5 text-gray-400" />
              ) : (
                <ChevronDown className="w-5 h-5 text-gray-400" />
              )}
            </button>
            
            {/* グラフ本体 */}
            {isChartExpanded && (
              <div className="border-t border-gray-200">
                <InlineSalesChart
                  product={selectedProduct}
                  fromDate={fromDate}
                  toDate={toDate}
                />
              </div>
            )}
          </div>

          {/* 同期メッセージ */}
          {syncMessage && (
            <div className="bg-[#0D4F4F]/5 border border-[#0D4F4F]/20 rounded-lg p-3 text-[#0D4F4F] flex items-center gap-2 text-sm">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {syncMessage}
            </div>
          )}

          {/* エラー表示 */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">
              {error}
            </div>
          )}
        </div>
      </div>

      {/* テーブル部分 */}
      <main className="flex-1 max-w-full mx-auto px-4 py-4">
        <div className="relative">
          {isLoading && !isInitialLoad && (
            <div className="absolute inset-0 bg-white/80 z-20 flex items-center justify-center rounded-lg">
              <div className="w-full max-w-md">
                <LoadingProgress isLoading={isLoading} />
              </div>
            </div>
          )}
          
          {isInitialLoad ? (
            <LoadingProgress isLoading={isLoading} />
          ) : (
            <>
              {/* データテーブル */}
              <DataTable
                products={products}
                sortState={sortState}
                periodUnit={periodUnit}
                dateColumns={dateColumns}
                totalDays={Math.ceil((new Date(toDate).getTime() - new Date(fromDate).getTime()) / (1000 * 60 * 60 * 24)) + 1}
                selectedProductId={selectedProduct?.productId}
                onSort={handleSort}
                onHideProduct={handleHideProduct}
                onShowChart={() => {}}
                onSelectProduct={handleSelectProduct}
              />

              {/* ページネーション */}
              {totalPages > 1 && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={totalPages}
                  totalItems={totalItems}
                  itemsPerPage={ITEMS_PER_PAGE}
                  onPageChange={handlePageChange}
                />
              )}
            </>
          )}
        </div>
      </main>

      {/* カテゴリ設定モーダル */}
      <CategorySettingsModal
        isOpen={isCategoryModalOpen}
        onClose={() => setIsCategoryModalOpen(false)}
        categories={categories}
        excludedCategories={excludedCategories}
        onToggleCategory={handleToggleCategory}
        onSelectAll={handleSelectAllCategories}
        onDeselectAll={handleDeselectAllCategories}
      />

      {/* 非表示商品モーダル */}
      <HiddenProductsModal
        isOpen={isHiddenModalOpen}
        onClose={() => setIsHiddenModalOpen(false)}
        hiddenProducts={hiddenProductsData}
        onRestoreProduct={handleRestoreProduct}
        onRestoreAll={handleRestoreAllProducts}
      />
    </div>
  );

  return (
    <div className="flex h-screen bg-gray-100">
      {/* サイドバー */}
      <Sidebar
        currentMenu={currentMenu}
        onMenuChange={setCurrentMenu}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
      />
      
      {/* メインコンテンツ */}
      <div className="flex-1 overflow-auto">
        {currentMenu === 'sales-analysis' && renderSalesAnalysis()}
        
        {currentMenu === 'demand-forecast' && <DemandForecast />}
        
        {currentMenu === 'order-history' && <OrderHistory />}
        
        {currentMenu === 'order-analytics' && <OrderAnalyticsPage />}
        
        {currentMenu === 'settings' && <SettingsPage />}
      </div>
    </div>
  );
}

export default App;
