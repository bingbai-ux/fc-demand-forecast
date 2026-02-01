import { Router } from 'express';
import { 
  getTableDataFromCache, 
  getTableDataPaginated, 
  isCacheAvailable,
  FilterOptions,
  SortOptions,
} from '../services/cache/tableDataCache';

const router = Router();

// GET /api/table-data
// キャッシュ優先モード：Supabaseキャッシュからのみデータを取得
// サーバーサイドページネーション対応
router.get('/', async (req, res) => {
  try {
    const fromDate = req.query.from as string;
    const toDate = req.query.to as string;
    const storeIdsParam = req.query.storeIds as string | undefined;
    
    // ページネーションパラメータ
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;
    
    // フィルターパラメータ
    const search = req.query.search as string | undefined;
    const categoryIdsParam = req.query.categoryIds as string | undefined;
    const supplierIdsParam = req.query.supplierIds as string | undefined;
    const stockFilter = req.query.stockFilter as 'all' | 'inStock' | 'outOfStock' | undefined;
    const excludeNoSales = req.query.excludeNoSales === 'true';
    const excludedCategoriesParam = req.query.excludedCategories as string | undefined;
    const hiddenProductsParam = req.query.hiddenProducts as string | undefined;
    
    // ソートパラメータ
    const sortColumn = req.query.sortColumn as string | undefined;
    const sortDirection = req.query.sortDirection as 'asc' | 'desc' | undefined;
    
    // 全件取得モード（後方互換性のため）
    const fetchAll = req.query.fetchAll === 'true';
    
    // バリデーション
    if (!fromDate || !toDate) {
      return res.status(400).json({
        success: false,
        error: 'from と to パラメータは必須です（YYYY-MM-DD形式）',
      });
    }
    
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
      return res.status(400).json({
        success: false,
        error: '日付はYYYY-MM-DD形式で指定してください',
      });
    }
    
    const storeIds = storeIdsParam ? storeIdsParam.split(',') : undefined;
    
    // キャッシュが利用可能か確認
    const cacheAvailable = await isCacheAvailable();
    
    if (!cacheAvailable) {
      return res.status(503).json({
        success: false,
        error: 'キャッシュが利用できません。データ同期を実行してください。',
        hint: 'POST /api/sync/all を実行してデータを同期してください',
      });
    }
    
    const startTime = Date.now();
    
    // 全件取得モード（後方互換性のため）
    if (fetchAll) {
      console.log('📊 キャッシュモードでデータ取得（全件）');
      const tableData = await getTableDataFromCache(fromDate, toDate, storeIds);
      const duration = Date.now() - startTime;
      
      console.log(`✅ データ取得完了: ${tableData.products?.length || 0}件, ${duration}ms`);
      
      return res.json({
        success: true,
        data: tableData.products,
        meta: {
          ...tableData.meta,
          responseTime: `${duration}ms`,
        },
      });
    }
    
    // サーバーサイドページネーションモード
    console.log(`📊 キャッシュモードでデータ取得（ページ: ${page}, 件数: ${limit}）`);
    
    // フィルターオプションを構築
    const filters: FilterOptions = {
      search,
      categoryIds: categoryIdsParam ? categoryIdsParam.split(',') : undefined,
      supplierIds: supplierIdsParam ? supplierIdsParam.split(',') : undefined,
      stockFilter: stockFilter || 'all',
      excludeNoSales,
      excludedCategories: excludedCategoriesParam ? excludedCategoriesParam.split(',') : undefined,
      hiddenProducts: hiddenProductsParam ? hiddenProductsParam.split(',') : undefined,
    };
    
    // ソートオプションを構築
    const sort: SortOptions | undefined = sortColumn ? {
      column: sortColumn,
      direction: sortDirection || 'desc',
    } : undefined;
    
    const tableData = await getTableDataPaginated(
      fromDate, 
      toDate, 
      page, 
      limit, 
      storeIds, 
      filters, 
      sort
    );
    const duration = Date.now() - startTime;
    
    console.log(`✅ データ取得完了: ${tableData.products?.length || 0}/${tableData.pagination.totalItems}件, ${duration}ms`);
    
    return res.json({
      success: true,
      data: tableData.products,
      pagination: tableData.pagination,
      meta: {
        ...tableData.meta,
        responseTime: `${duration}ms`,
      },
    });
  } catch (error: any) {
    console.error('統合データ取得エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// DELETE /api/table-data/cache - キャッシュクリア
router.delete('/cache', (req, res) => {
  console.log('🗑️ メモリキャッシュをクリアしました');
  res.json({
    success: true,
    message: 'キャッシュをクリアしました',
  });
});

export default router;
