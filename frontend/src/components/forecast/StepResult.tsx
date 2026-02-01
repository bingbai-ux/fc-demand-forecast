import React, { useState, useMemo } from 'react';
import OrderSummary from './OrderSummary';
import ProductDetailModal from './ProductDetailModal';
import StockoutCostDashboard from './StockoutCostDashboard';
import { AlgorithmBadge, RankBadge, OrderBreakdown, AlertIcon } from '../ForecastTable/SimpleBadges';

interface PastSale {
  date?: string;
  week?: string;
  qty: number;
}

interface Product {
  productId: string;
  productCode?: string;
  productName: string;
  categoryName?: string;
  supplierName?: string;
  retailPrice?: number;
  cost: number;
  currentStock: number;
  consumptionUntilOrder?: number;
  forecastQuantity: number;
  safetyStock: number;
  recommendedOrder: number;
  lotSize?: number;
  orderAmount: number;
  rank: string;
  algorithm?: 'arima' | 'simple' | 'ensemble';
  breakdown?: string;
  abcRank?: string;
  avgDailySales?: number;
  stockDays?: number;
  pastSales?: {
    type: 'daily' | 'weekly';
    data: PastSale[];
  };
  // 現行品/廃盤ステータス
  isActive?: boolean;
  recentSales?: number;
  // 異常検知
  hasAnomaly?: boolean;
  isAnomaly?: boolean;
  anomalySeverity?: 'high' | 'medium' | 'low' | null;
  alertFlags?: string[];
}

// getAlertIconはSimpleBadgesのAlertIconに移行済み

interface SupplierSettings {
  leadTimeDays: number;
  minOrderAmount: number;
  freeShippingAmount: number | null;
  shippingFee: number;
  orderMethod: 'manual' | 'email';
  email: string;
  contactPerson: string;
}

interface OrderConditions {
  meetsMinOrder: boolean;
  amountToMinOrder: number;
  meetsFreeShipping: boolean;
  amountToFreeShipping: number;
  estimatedArrival: string;
}

interface SupplierGroup {
  supplierName: string;
  products: Product[];
  totalOrderQuantity: number;
  totalOrderAmount: number;
  supplierSettings?: SupplierSettings;
  orderConditions?: OrderConditions;
}

interface StepResultProps {
  storeId: string;
  storeName: string;
  selectedSuppliers: string[];
  orderDate: string;
  forecastDays: number;
  lookbackDays: number;
  daysUntilOrder: number;
  supplierGroups: SupplierGroup[];
  totalProducts: number;
  totalOrderQuantity: number;
  totalOrderAmount: number;
  pastSalesType?: 'daily' | 'weekly';
  pastSalesDates?: string[];
  pastSalesWeeks?: string[];
  isLoading: boolean;
  onBack: () => void;
  onDownloadCSV: (supplierName?: string) => void;
  // 現行品/廃盤の内訳
  activeProducts?: number;
  discontinuedProducts?: number;
  productsWithOrder?: number;
  activeProductsWithOrder?: number;
  // 表示オプション
  showAllProducts?: boolean;
  onShowAllProductsChange?: (show: boolean) => void;
  // 一括発注完了コールバック
  onOrderComplete?: () => void;
  // ABC分析・異常検知
  abcSummary?: {
    A: { count: number; salesRatio: number };
    B: { count: number; salesRatio: number };
    C: { count: number; salesRatio: number };
    D: { count: number; salesRatio: number };
    E: { count: number; salesRatio: number };
  };
  anomalySummary?: {
    stockout: number;
    low_stock: number;
    order_surge: number;
    overstock: number;
    total: number;
  };
  stockoutCost?: {
    totalLoss: number;
    stockoutProducts: any[];
  };
  // 月末在庫コントロール
  monthEndInfo?: {
    isMonthEndMode: boolean;
    daysToMonthEnd: number;
    safetyStockReductionPercent: number;
    orderDate: string;
    monthEndDate?: string;
  };
  nextMonthOrders?: Array<{
    productId: string;
    productName: string;
    suggestedQuantity: number;
    reason: string;
  }>;
}

// ========== 異常検知サマリーコンポーネント ==========
interface AnomalySummaryComponentProps {
  anomalySummary: {
    stockout: number;
    low_stock: number;
    order_surge: number;
    overstock: number;
    total: number;
  };
  onFilterChange: (filter: string | null) => void;
  currentFilter: string | null;
}

const AnomalySummaryComponent: React.FC<AnomalySummaryComponentProps> = ({ 
  anomalySummary, 
  onFilterChange, 
  currentFilter 
}) => {
  const alerts = [
    { key: 'stockout', label: '欠品中', icon: '🔴', count: anomalySummary.stockout },
    { key: 'low_stock', label: '欠品リスク', icon: '🟠', count: anomalySummary.low_stock },
    { key: 'order_surge', label: '発注急増', icon: '🟡', count: anomalySummary.order_surge },
    { key: 'overstock', label: '過剰在庫', icon: '🔵', count: anomalySummary.overstock },
  ];
  
  if (anomalySummary.total === 0) {
    return null;
  }
  
  return (
    <div className="flex items-center gap-4 flex-wrap text-sm">
      <span className="font-medium text-gray-700">
        ⚠️ 要確認: {anomalySummary.total}件
      </span>
      <div className="flex gap-2 flex-wrap">
        {alerts.filter(a => a.count > 0).map(alert => (
          <button
            key={alert.key}
            onClick={() => onFilterChange(currentFilter === alert.key ? null : alert.key)}
            className={`px-2 py-0.5 rounded text-xs border ${
              currentFilter === alert.key 
                ? 'bg-[#0D4F4F] text-white border-[#0D4F4F]' 
                : 'bg-white text-gray-600 border-gray-200 hover:border-[#0D4F4F]/50'
            }`}
          >
            {alert.icon} {alert.label}: {alert.count}件
          </button>
        ))}
      </div>
      <label className="flex items-center gap-1 text-xs text-gray-600">
        <input
          type="checkbox"
          checked={currentFilter === 'anomaly'}
          onChange={(e) => onFilterChange(e.target.checked ? 'anomaly' : null)}
          className="rounded accent-[#0D4F4F]"
        />
        異常のみ表示
      </label>
    </div>
  );
};

// ========== 欠品コスト表示コンポーネント ==========
interface StockoutCostDisplayProps {
  stockoutCost: {
    totalLoss: number;
    stockoutProducts: any[];
  };
}

const StockoutCostDisplay: React.FC<StockoutCostDisplayProps> = ({ stockoutCost }) => {
  if (stockoutCost.totalLoss === 0) return null;
  
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-gray-600">
        💰 推定欠品コスト: 
      </span>
      <span className="text-[#0D4F4F] font-bold">
        ¥{stockoutCost.totalLoss.toLocaleString()}
      </span>
      <span className="text-gray-500 text-xs">
        （{stockoutCost.stockoutProducts.length}商品）
      </span>
    </div>
  );
};

const StepResult: React.FC<StepResultProps> = ({
  storeId,
  storeName,
  selectedSuppliers,
  orderDate,
  forecastDays,
  lookbackDays: _lookbackDays,
  daysUntilOrder: _daysUntilOrder,
  supplierGroups,
  totalProducts,
  totalOrderQuantity: _totalOrderQuantity,
  totalOrderAmount: _totalOrderAmount,
  pastSalesType,
  pastSalesDates,
  pastSalesWeeks,
  isLoading,
  onBack,
  onDownloadCSV,
  activeProducts: _activeProducts = 0,
  discontinuedProducts: _discontinuedProducts = 0,
  productsWithOrder: _productsWithOrder = 0,
  activeProductsWithOrder: _activeProductsWithOrder = 0,
  showAllProducts = false,
  onShowAllProductsChange,
  onOrderComplete,
  abcSummary: _abcSummary,
  anomalySummary,
  stockoutCost,
  monthEndInfo: _monthEndInfo,
  nextMonthOrders: _nextMonthOrders = [],
}) => {
  // 異常フィルター状態
  const [anomalyFilter, setAnomalyFilter] = useState<string | null>(null);
  const [showFormulaDetail, setShowFormulaDetail] = useState(false);
  const [sortColumn, setSortColumn] = useState<string>('recommendedOrder');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  // 発注数の編集状態を管理
  const [orderQuantities, setOrderQuantities] = useState<Record<string, number>>({});
  // 商品詳細モーダル
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [selectedProductForDetail, setSelectedProductForDetail] = useState<any>(null);
  // 発注処理中
  const [isOrdering, setIsOrdering] = useState(false);
  // 発注済み仕入先を管理
  const [orderedSuppliers, setOrderedSuppliers] = useState<Set<string>>(new Set());
  // 発注確認ダイアログ
  const [confirmOrderDialog, setConfirmOrderDialog] = useState<{ isOpen: boolean; group: SupplierGroup | null }>({
    isOpen: false,
    group: null,
  });
  // 欠品コストダッシュボード
  const [isStockoutDashboardOpen, setIsStockoutDashboardOpen] = useState(false);

  // 発注数の変更ハンドラー
  const handleOrderQuantityChange = (productId: string, quantity: number) => {
    setOrderQuantities(prev => ({
      ...prev,
      [productId]: quantity
    }));
  };

  // 仕入先ごとの合計を計算（ユーザーが変更した発注数を反映）
  const getSupplierTotals = (group: SupplierGroup) => {
    let totalQuantity = 0;
    let totalAmount = 0;
    
    group.products.forEach(product => {
      const qty = orderQuantities[product.productId] ?? product.recommendedOrder;
      totalQuantity += qty;
      totalAmount += qty * product.cost;
    });
    
    return { totalQuantity, totalAmount };
  };

  // 過去売数のヘッダーを生成（日付を短縮形式に）
  const pastSalesHeaders = useMemo(() => {
    if (pastSalesType === 'daily' && pastSalesDates && pastSalesDates.length > 0) {
      // pastSalesDatesはすでに"1/22"形式なのでそのまま使用
      return pastSalesDates;
    } else if (pastSalesType === 'weekly' && pastSalesWeeks && pastSalesWeeks.length > 0) {
      // 週次の場合は短縮形式に変換（例: "1/2〜1/8" → "1/2-8"）
      return pastSalesWeeks.map(week => {
        // "1/2〜1/8" または "1/2~1/8" の形式を想定
        const match = week.match(/(\d+)\/(\d+)[\u301c~](\d+)\/(\d+)/);
        if (match) {
          const [, startMonth, startDay, endMonth, endDay] = match;
          if (startMonth === endMonth) {
            // 同じ月の場合: "1/2-8"
            return `${startMonth}/${startDay}-${endDay}`;
          } else {
            // 月をまたぐ場合: "1/30-2/5"
            return `${startMonth}/${startDay}-${endMonth}/${endDay}`;
          }
        }
        return week;
      });
    }
    return [];
  }, [pastSalesType, pastSalesDates, pastSalesWeeks]);

  // 日付フォーマット
  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // 商品詳細モーダルを開く
  const openProductDetail = (product: Product) => {
    setSelectedProductForDetail(product);
    setIsDetailModalOpen(true);
  };

  // ソート処理
  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  const getSortIndicator = (column: string) => {
    if (sortColumn !== column) return '';
    return sortDirection === 'asc' ? ' ↑' : ' ↓';
  };

  const sortProducts = (products: Product[]) => {
    return [...products].sort((a, b) => {
      let aVal: any, bVal: any;
      
      switch (sortColumn) {
        case 'productName':
          aVal = a.productName;
          bVal = b.productName;
          break;
        case 'cost':
          aVal = a.cost;
          bVal = b.cost;
          break;
        case 'currentStock':
          aVal = a.currentStock;
          bVal = b.currentStock;
          break;
        case 'forecastQuantity':
          aVal = a.forecastQuantity;
          bVal = b.forecastQuantity;
          break;
        case 'safetyStock':
          aVal = a.safetyStock;
          bVal = b.safetyStock;
          break;
        case 'recommendedOrder':
          aVal = a.recommendedOrder;
          bVal = b.recommendedOrder;
          break;
        case 'orderAmount':
          aVal = a.orderAmount;
          bVal = b.orderAmount;
          break;
        case 'rank':
          const rankOrder: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5 };
          aVal = rankOrder[a.rank] || 99;
          bVal = rankOrder[b.rank] || 99;
          break;
        default:
          return 0;
      }
      
      if (typeof aVal === 'string') {
        return sortDirection === 'asc' 
          ? aVal.localeCompare(bVal) 
          : bVal.localeCompare(aVal);
      }
      
      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
    });
  };

  // 異常フィルター適用
  const filteredSupplierGroups = useMemo(() => {
    return supplierGroups.map(group => ({
      ...group,
      products: group.products.filter(product => {
        // 発注不要・廃盤商品のフィルタリング
        if (!showAllProducts) {
          // 発注が必要な現行品のみ表示
          const isActive = product.isActive !== false;
          const needsOrder = product.recommendedOrder > 0;
          if (!isActive || !needsOrder) return false;
        }
        
        // 異常フィルター
        if (anomalyFilter) {
          if (anomalyFilter === 'anomaly') {
            return product.hasAnomaly;
          }
          return product.alertFlags?.includes(anomalyFilter);
        }
        
        return true;
      })
    })).filter(group => group.products.length > 0);
  }, [supplierGroups, anomalyFilter, showAllProducts]);

  // 発注確認ダイアログを開く
  const handleOrderClick = (group: SupplierGroup) => {
    setConfirmOrderDialog({ isOpen: true, group });
  };

  // 発注確認ダイアログを閉じる
  const handleCancelOrder = () => {
    setConfirmOrderDialog({ isOpen: false, group: null });
  };

  // 発注を実行
  const handleConfirmOrder = async () => {
    const group = confirmOrderDialog.group;
    if (!group) return;
    
    setConfirmOrderDialog({ isOpen: false, group: null });
    setIsOrdering(true);
    
    try {
      const settings = group.supplierSettings;
      
      // 発注データを準備（バックエンドAPIの形式に合わせる）
      const orderData = {
        supplierCode: group.supplierName, // 仕入先コードとして使用
        supplierName: group.supplierName,
        storeId,
        storeName,
        orderDate,
        expectedArrival: settings?.leadTimeDays 
          ? new Date(new Date(orderDate).getTime() + settings.leadTimeDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
          : orderDate,
        items: group.products.map(p => ({
          productId: p.productId,
          productName: p.productName,
          unitPrice: p.cost,
          quantity: orderQuantities[p.productId] ?? p.recommendedOrder,
          amount: (orderQuantities[p.productId] ?? p.recommendedOrder) * p.cost,
        })).filter(p => p.quantity > 0),
        orderMethod: settings?.orderMethod || 'manual',
      };

      // まず発注履歴を保存
      const createResponse = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(orderData),
      });
      
      if (!createResponse.ok) {
        const errorData = await createResponse.json();
        throw new Error(errorData.error || '発注履歴の保存に失敗しました');
      }
      
      const createResult = await createResponse.json();
      const orderId = createResult.order?.id;

      if (settings?.orderMethod === 'email' && orderId) {
        // メール発注（保存した発注IDを使用）
        const emailResponse = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/orders/${orderId}/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        
        if (!emailResponse.ok) {
          const errorData = await emailResponse.json();
          throw new Error(errorData.error || 'メール送信に失敗しました');
        }
        alert(`${group.supplierName}への発注メールを送信しました`);
      } else {
        // 手動発注の場合は履歴保存のみで完了
        alert(`${group.supplierName}の発注を登録しました`);
      }
      
      // 発注済みとして記録
      setOrderedSuppliers(prev => new Set(prev).add(group.supplierName));
      
      onOrderComplete?.();
    } catch (error: any) {
      console.error('発注処理エラー:', error);
      alert(`発注処理中にエラーが発生しました: ${error.message}`);
    } finally {
      setIsOrdering(false);
    }
  };

  // 表示商品数のカウント
  const displayedProductCount = useMemo(() => {
    return filteredSupplierGroups.reduce((sum, group) => sum + group.products.length, 0);
  }, [filteredSupplierGroups]);

  const hiddenProductCount = totalProducts - displayedProductCount;

  // ローディング中
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#0D4F4F] mx-auto mb-4"></div>
          <p className="text-gray-600">需要予測を計算中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* 一括発注サマリー */}
      <OrderSummary
        supplierGroups={filteredSupplierGroups}
        orderQuantities={orderQuantities}
        onBulkOrder={async () => {
          for (const group of filteredSupplierGroups) {
            const totals = getSupplierTotals(group);
            if (totals.totalQuantity > 0 && !orderedSuppliers.has(group.supplierName)) {
              handleOrderClick(group);
              return; // 一つずつ確認ダイアログを表示
            }
          }
        }}
        isOrdering={isOrdering}
      />

      {/* 条件表示 */}
      <div className="flex items-center justify-between text-sm text-gray-600">
        <div>
          店舗: {storeName}　仕入先: {selectedSuppliers.length}件　発注日: {orderDate}　期間: {forecastDays}日分
        </div>
        <button
          onClick={onBack}
          className="text-[#0D4F4F] hover:underline"
        >
          条件を変更
        </button>
      </div>

      {/* フィルター・異常サマリー行 */}
      <div className="flex items-center justify-between flex-wrap gap-2 py-2 border-b">
        <div className="flex items-center gap-4 flex-wrap">
          {anomalySummary && (
            <AnomalySummaryComponent
              anomalySummary={anomalySummary}
              onFilterChange={setAnomalyFilter}
              currentFilter={anomalyFilter}
            />
          )}
          {stockoutCost && <StockoutCostDisplay stockoutCost={stockoutCost} />}
          {stockoutCost && stockoutCost.totalLoss > 0 && (
            <button
              onClick={() => setIsStockoutDashboardOpen(true)}
              className="px-2 py-1 text-xs text-white rounded"
              style={{ background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' }}
            >
              📊 詳細分析
            </button>
          )}
          {/* ロジック詳細ボタン */}
          <button
            onClick={() => setShowFormulaDetail(true)}
            className="px-2 py-1 text-xs border border-[#0D4F4F] text-[#0D4F4F] rounded hover:bg-[#0D4F4F]/10"
          >
            📐 ロジック詳細
          </button>
        </div>
        
        <div className="flex items-center gap-4 text-sm">
          <label className="flex items-center gap-1 text-gray-600">
            <input
              type="checkbox"
              checked={showAllProducts}
              onChange={(e) => onShowAllProductsChange?.(e.target.checked)}
              className="rounded accent-[#0D4F4F]"
            />
            発注不要・廃盤商品も表示
          </label>
          <span className="text-gray-500 text-xs">
            発注が必要な現行品 {displayedProductCount} 件を表示中（非表示: {hiddenProductCount} 件）
          </span>
        </div>
      </div>

      {/* ロジック詳細ポップアップ */}
      {showFormulaDetail && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowFormulaDetail(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-gray-800">📊 ロジック詳細</h3>
              <button
                onClick={() => setShowFormulaDetail(false)}
                className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="space-y-4 text-sm">
              <div>
                <h4 className="font-medium text-gray-700 mb-2">■ 推奨発注数の計算式（最小限ロジック）</h4>
                <div className="text-gray-600 ml-4 space-y-1">
                  <p><span className="font-medium">推奨発注</span> = max(0, 予測売数 − 現在庫)</p>
                  <p><span className="font-medium">予測売数</span> = 日平均売上 × 発注期間（日数）</p>
                  <p><span className="font-medium">日平均売上</span> = 過去データの単純平均</p>
                  <p className="text-gray-500 mt-2">※ 検証結果に基づき、安全在庫なしの最小限ロジックを採用</p>
                  <p className="text-gray-500">※ 在庫金額を約12%削減しつつ、欠品リスクは増加しません</p>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-700 mb-2">■ ABCランク付け（累積構成比方式）</h4>
                <div className="flex flex-wrap gap-2 ml-4">
                  <span className="px-2 py-0.5 rounded bg-red-500 text-white text-xs font-bold">A</span>
                  <span className="text-xs text-gray-600">〜50%</span>
                  <span className="px-2 py-0.5 rounded bg-orange-500 text-white text-xs font-bold">B</span>
                  <span className="text-xs text-gray-600">50〜75%</span>
                  <span className="px-2 py-0.5 rounded bg-yellow-500 text-white text-xs font-bold">C</span>
                  <span className="text-xs text-gray-600">75〜90%</span>
                  <span className="px-2 py-0.5 rounded bg-green-500 text-white text-xs font-bold">D</span>
                  <span className="text-xs text-gray-600">90〜97%</span>
                  <span className="px-2 py-0.5 rounded bg-gray-400 text-white text-xs font-bold">E</span>
                  <span className="text-xs text-gray-600">97〜100%</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CSVダウンロード */}
      <div className="flex justify-end">
        <button
          onClick={() => onDownloadCSV()}
          className="px-3 py-1.5 text-white rounded text-sm hover:opacity-90"
          style={{ background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' }}
        >
          📥 全体CSVダウンロード
        </button>
      </div>

      {/* 統合テーブル（全仕入先を一つの表として表示） */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            {/* 共通ヘッダー（1回だけ表示） */}
            <thead className="bg-gray-50 sticky top-0 z-10">
              <tr className="border-b">
                <th className="px-1 py-2 text-center font-semibold whitespace-nowrap cursor-pointer hover:bg-gray-100 bg-white text-xs" onClick={() => handleSort('rank')}>
                  ランク{getSortIndicator('rank')}
                </th>
                <th className="px-1 py-2 text-center font-semibold whitespace-nowrap bg-white text-xs">
                  予測方式
                </th>
                <th className="px-1 py-2 text-center font-semibold whitespace-nowrap bg-white text-xs">
                  状態
                </th>
                <th 
                  className="px-2 py-2 text-left font-semibold bg-white border-r whitespace-nowrap text-xs"
                  style={{
                    position: 'sticky',
                    left: 0,
                    zIndex: 20,
                    minWidth: 200,
                    boxShadow: '2px 0 4px rgba(0,0,0,0.1)',
                  }}
                >
                  商品名
                </th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap cursor-pointer hover:bg-gray-100 text-xs" onClick={() => handleSort('cost')}>
                  原価{getSortIndicator('cost')}
                </th>
                <th className="px-2 py-2 text-right font-semibold whitespace-nowrap cursor-pointer hover:bg-gray-100 bg-blue-50 text-xs" onClick={() => handleSort('currentStock')}>
                  在庫{getSortIndicator('currentStock')}
                </th>
                {/* 過去売数のヘッダー - 緑背景（コンパクト表示） */}
                {pastSalesHeaders.map((header, idx) => (
                  <th key={idx} className="px-1 py-2 text-right font-semibold whitespace-nowrap bg-green-50 text-xs">
                    {header}
                  </th>
                ))}
                <th className="px-1 py-2 text-center font-semibold whitespace-nowrap cursor-pointer hover:bg-gray-100 text-xs" onClick={() => handleSort('forecastQuantity')}>
                  予測{getSortIndicator('forecastQuantity')}
                </th>
                <th className="px-1 py-2 text-right font-semibold whitespace-nowrap cursor-pointer hover:bg-gray-100 text-xs" onClick={() => handleSort('safetyStock')}>
                  安全{getSortIndicator('safetyStock')}
                </th>
                <th className="px-1 py-2 text-right font-semibold whitespace-nowrap cursor-pointer hover:bg-gray-100 text-[#0D4F4F] text-xs" onClick={() => handleSort('recommendedOrder')}>
                  推奨{getSortIndicator('recommendedOrder')}
                </th>
                <th className="px-1 py-2 text-center font-semibold whitespace-nowrap text-xs">ロット</th>
                <th className="px-1 py-2 text-right font-semibold whitespace-nowrap bg-yellow-100 text-xs">発注</th>
                <th className="px-1 py-2 text-right font-semibold whitespace-nowrap cursor-pointer hover:bg-gray-100 bg-yellow-100 text-xs" onClick={() => handleSort('orderAmount')}>
                  金額{getSortIndicator('orderAmount')}
                </th>
                <th className="px-1 py-2 text-center font-semibold whitespace-nowrap text-xs"></th>
              </tr>
            </thead>
            <tbody>
              {filteredSupplierGroups.map((group, groupIdx) => {
                const supplierTotals = getSupplierTotals(group);
                const settings = group.supplierSettings;
                const conditions = group.orderConditions;
                
                // 発注条件を再計算
                const meetsMinOrder = settings ? supplierTotals.totalAmount >= settings.minOrderAmount : true;
                const amountToMinOrder = settings ? Math.max(0, settings.minOrderAmount - supplierTotals.totalAmount) : 0;
                const meetsFreeShipping = settings?.freeShippingAmount ? supplierTotals.totalAmount >= settings.freeShippingAmount : true;
                const amountToFreeShipping = settings?.freeShippingAmount ? Math.max(0, settings.freeShippingAmount - supplierTotals.totalAmount) : 0;
                
                return (
                  <React.Fragment key={groupIdx}>
                    {/* 仕入先セパレーター行 */}
                    <tr className="bg-gradient-to-r from-[#0D4F4F] to-[#1A365D] text-white">
                      <td colSpan={12 + pastSalesHeaders.length} className="px-3 py-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className="font-bold">{group.supplierName}</span>
                            <span className="text-gray-300 text-xs">(｛{group.products.length}件）</span>
                            {settings && conditions && (
                              <span className="text-gray-300 text-xs">
                                リードタイム: {settings.leadTimeDays}日 → 届く予定: {formatDate(conditions.estimatedArrival)}
                              </span>
                            )}
                            {/* 最低発注金額・送料無料金額の表示 */}
                            {settings && settings.minOrderAmount > 0 && (
                              <span className={`text-xs ${meetsMinOrder ? 'text-green-300' : 'text-gray-300'}`}>
                                最低発注: ¥{settings.minOrderAmount.toLocaleString()}
                                {meetsMinOrder && ' ✓'}
                              </span>
                            )}
                            {settings && settings.freeShippingAmount && settings.freeShippingAmount > 0 && (
                              <span className={`text-xs ${meetsFreeShipping ? 'text-green-300' : 'text-gray-300'}`}>
                                送料無料: ¥{settings.freeShippingAmount.toLocaleString()}
                                {meetsFreeShipping && ' ✓'}
                              </span>
                            )}
                            {/* 警告メッセージ */}
                            {settings && !meetsMinOrder && settings.minOrderAmount > 0 && (
                              <span className="text-red-300 text-xs">
                                ⚠️ 最低発注まであと ¥{amountToMinOrder.toLocaleString()}
                              </span>
                            )}
                            {settings && !meetsFreeShipping && settings.freeShippingAmount && (
                              <span className="text-yellow-300 text-xs">
                                🚚 送料無料まであと ¥{amountToFreeShipping.toLocaleString()}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-4">
                            <span className="text-sm">{supplierTotals.totalQuantity}個</span>
                            <span className="font-bold">¥{supplierTotals.totalAmount.toLocaleString()}</span>
                            {orderedSuppliers.has(group.supplierName) ? (
                              <span className="px-4 py-1.5 bg-green-100 text-green-700 font-medium rounded text-sm whitespace-nowrap">
                                ✓ 発注済み
                              </span>
                            ) : (
                              <button
                                onClick={() => handleOrderClick(group)}
                                disabled={isOrdering || supplierTotals.totalQuantity === 0}
                                className="px-4 py-1.5 bg-white text-[#0D4F4F] font-medium rounded text-sm hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                              >
                                {isOrdering ? '発注中...' : '発注'}
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                    
                    {/* 商品行 */}
                    {sortProducts(group.products).map((product, idx) => {
                      const currentOrderQty = orderQuantities[product.productId] ?? product.recommendedOrder;
                      const currentOrderAmount = currentOrderQty * product.cost;
                      const isDiscontinued = product.isActive === false;
                      const rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-gray-50';
                      
                      return (
                        <tr 
                          key={`${groupIdx}-${idx}`} 
                          className={`border-b border-gray-200 hover:bg-gray-100 ${isDiscontinued ? 'opacity-50' : ''} ${rowBg}`}
                        >
                          {/* ランク */}
                          <td className={`px-1 py-1.5 text-center whitespace-nowrap ${rowBg}`}>
                            <RankBadge rank={product.rank as 'A' | 'B' | 'C' | 'D' | 'E'} />
                          </td>
                          {/* ARIMA/Simpleアルゴリズム */}
                          <td className={`px-1 py-1.5 text-center whitespace-nowrap ${rowBg}`}>
                            <AlgorithmBadge algorithm={product.algorithm || 'simple'} />
                          </td>
                          {/* 状態（アラートアイコン） */}
                          <td className={`px-1 py-1.5 text-center whitespace-nowrap ${rowBg}`}>
                            <AlertIcon alertFlags={product.alertFlags} />
                          </td>
                          {/* 商品名 - sticky固定 */}
                          <td 
                            className={`px-3 py-1.5 border-r ${rowBg}`}
                            style={{
                              position: 'sticky',
                              left: 0,
                              zIndex: 5,
                              minWidth: 200,
                              boxShadow: '2px 0 4px rgba(0,0,0,0.05)',
                            }}
                          >
                            <div 
                              style={{ 
                                fontWeight: 500, 
                                fontSize: '14px',
                                whiteSpace: 'normal',
                                wordBreak: 'break-word',
                                lineHeight: '1.4'
                              }} 
                              title={product.productName}
                            >
                              {product.productName}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right text-gray-600 whitespace-nowrap text-xs">¥{product.cost?.toLocaleString() || '-'}</td>
                          <td className="px-2 py-1.5 text-right bg-blue-50 whitespace-nowrap text-xs">{product.currentStock > 0 ? product.currentStock : '-'}</td>
                          {/* 過去売数のデータ - 緑背景 */}
                          {pastSalesHeaders.map((_, saleIdx) => {
                            const saleData = product.pastSales?.data?.[saleIdx];
                            const qty = saleData?.qty;
                            return (
                              <td key={saleIdx} className="px-1 py-1.5 text-right bg-green-50 whitespace-nowrap text-xs">
                                {qty !== undefined && qty > 0 ? qty : '-'}
                              </td>
                            );
                          })}
                          <td className="px-2 py-1.5 text-center whitespace-nowrap text-xs">
                            <OrderBreakdown 
                              breakdown={product.breakdown || `予測${product.forecastQuantity} + 安全${product.safetyStock} - 在庫${product.currentStock} = 純需要${Math.max(0, product.forecastQuantity + product.safetyStock - product.currentStock)}`}
                              netDemand={Math.max(0, product.forecastQuantity + product.safetyStock - product.currentStock)}
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right text-gray-600 whitespace-nowrap text-xs">{product.safetyStock}</td>
                          <td className="px-2 py-1.5 text-right font-semibold text-[#0D4F4F] whitespace-nowrap text-xs">
                            {product.recommendedOrder}
                          </td>
                          <td className="px-1 py-1.5 text-center text-gray-400 text-xs whitespace-nowrap">
                            {(product.lotSize && product.lotSize > 1) ? product.lotSize : '-'}
                          </td>
                          <td className="px-2 py-1.5 text-right bg-yellow-50 whitespace-nowrap">
                            <input
                              type="number"
                              min="0"
                              step={product.lotSize || 1}
                              value={currentOrderQty}
                              onChange={(e) => {
                                const value = parseInt(e.target.value) || 0;
                                const lotSize = product.lotSize || 1;
                                const adjustedValue = lotSize > 1 && value > 0 
                                  ? Math.ceil(value / lotSize) * lotSize 
                                  : value;
                                handleOrderQuantityChange(product.productId, adjustedValue);
                              }}
                              className="w-12 border border-gray-300 rounded px-1 py-0.5 text-right text-xs font-medium focus:ring-2 focus:ring-[#0D4F4F] focus:border-transparent"
                            />
                          </td>
                          <td className="px-2 py-1.5 text-right bg-yellow-50 font-medium whitespace-nowrap text-xs">¥{currentOrderAmount?.toLocaleString() || '-'}</td>
                          <td className="px-1 py-1.5 text-center whitespace-nowrap">
                            <button
                              onClick={() => openProductDetail(product)}
                              className="text-[#0D4F4F] hover:underline text-xs"
                            >
                              詳細
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* 商品詳細モーダル */}
      <ProductDetailModal
        isOpen={isDetailModalOpen}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedProductForDetail(null);
        }}
        product={selectedProductForDetail}
        storeId={storeId}
        onOrderQuantityChange={handleOrderQuantityChange}
      />

      {/* 欠品コストダッシュボード */}
      <StockoutCostDashboard
        storeId={storeId}
        isOpen={isStockoutDashboardOpen}
        onClose={() => setIsStockoutDashboardOpen(false)}
      />

      {/* 発注確認ダイアログ */}
      {confirmOrderDialog.isOpen && confirmOrderDialog.group && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">
                発注確認
              </h3>
              <p className="text-gray-700 mb-4">
                <span className="font-bold text-[#0D4F4F]">{confirmOrderDialog.group.supplierName}</span>
                {confirmOrderDialog.group.supplierSettings?.orderMethod === 'email' ? (
                  <>
                    にメールを送信しますか？
                  </>
                ) : (
                  <>
                    に発注を登録しますか？
                  </>
                )}
              </p>
              <div className="bg-gray-50 rounded-lg p-4 mb-4">
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-600">商品点数:</span>
                  <span className="font-medium">{confirmOrderDialog.group.products.filter(p => (orderQuantities[p.productId] ?? p.recommendedOrder) > 0).length}点</span>
                </div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-gray-600">合計数量:</span>
                  <span className="font-medium">{getSupplierTotals(confirmOrderDialog.group).totalQuantity}個</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">合計金額:</span>
                  <span className="font-bold text-[#0D4F4F]">¥{getSupplierTotals(confirmOrderDialog.group).totalAmount.toLocaleString()}</span>
                </div>
                {confirmOrderDialog.group.supplierSettings?.orderMethod === 'email' && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-600">送信先:</span>
                      <span className="font-medium">{confirmOrderDialog.group.supplierSettings.email || '未設定'}</span>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-3 justify-end">
                <button
                  onClick={handleCancelOrder}
                  className="px-4 py-2 text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  onClick={handleConfirmOrder}
                  className="px-4 py-2 text-white bg-[#0D4F4F] rounded-lg hover:bg-[#0A3F3F] transition-colors"
                >
                  {confirmOrderDialog.group.supplierSettings?.orderMethod === 'email' ? 'メールを送信' : '発注を登録'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StepResult;
