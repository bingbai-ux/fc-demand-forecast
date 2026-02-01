import React, { useState, useEffect, useCallback } from 'react';
import ProgressBar from '../components/forecast/ProgressBar';
import StepStoreSupplier from '../components/forecast/StepStoreSupplier';
import StepPeriodSetting from '../components/forecast/StepPeriodSetting';
import StepResult from '../components/forecast/StepResult';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const STEPS = [
  { id: 1, title: '店舗・仕入先' },
  { id: 2, title: '期間設定' },
  { id: 3, title: '結果確認' },
];

const LOOKBACK_DAYS: Record<string, number> = {
  '1week': 7,
  '2weeks': 14,
  '1month': 30,
  '3months': 90,
};

const DemandForecast: React.FC = () => {
  // ステップ管理
  const [currentStep, setCurrentStep] = useState(1);
  
  // マスタデータ
  const [stores, setStores] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  
  // Step 1: 店舗・仕入先
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [selectedSuppliers, setSelectedSuppliers] = useState<string[]>([]);
  
  // Step 2: 期間設定
  const [orderDate, setOrderDate] = useState(new Date().toISOString().split('T')[0]);
  const [forecastDays, setForecastDays] = useState(7);
  const [lookbackPeriod, setLookbackPeriod] = useState('2weeks');
  const [customLookbackStart, setCustomLookbackStart] = useState('');
  const [customLookbackEnd, setCustomLookbackEnd] = useState('');
  
  // Step 3: 結果
  const [isLoading, setIsLoading] = useState(false);
  const [supplierGroups, setSupplierGroups] = useState<any[]>([]);
  const [totalProducts, setTotalProducts] = useState(0);
  const [totalOrderQuantity, setTotalOrderQuantity] = useState(0);
  const [totalOrderAmount, setTotalOrderAmount] = useState(0);
  const [actualLookbackDays, setActualLookbackDays] = useState(30);
  const [pastSalesType, setPastSalesType] = useState<'daily' | 'weekly'>('daily');
  const [pastSalesDates, setPastSalesDates] = useState<string[]>([]);
  const [pastSalesWeeks, setPastSalesWeeks] = useState<string[]>([]);
  
  // 現行品/廃盤の内訳
  const [activeProducts, setActiveProducts] = useState(0);
  const [discontinuedProducts, setDiscontinuedProducts] = useState(0);
  const [productsWithOrder, setProductsWithOrder] = useState(0);
  const [activeProductsWithOrder, setActiveProductsWithOrder] = useState(0);
  
  // 表示オプション（デフォルト: 発注不要・廃盤商品は非表示）
  const [showAllProducts, setShowAllProducts] = useState(false);
  
  // ABC分析・異常検知サマリー
  const [abcSummary, setAbcSummary] = useState<any>(null);
  const [anomalySummary, setAnomalySummary] = useState<any>(null);
  const [stockoutCost, setStockoutCost] = useState<any>(null);
  
  // 月末在庫コントロール
  const [monthEndInfo, setMonthEndInfo] = useState<any>(null);
  const [nextMonthOrders, setNextMonthOrders] = useState<any[]>([]);
  
  // 今日から発注日までの日数
  const daysUntilOrder = Math.max(0, Math.floor(
    (new Date(orderDate).getTime() - new Date().setHours(0,0,0,0)) / (1000 * 60 * 60 * 24)
  ));
  
  // 選択した店舗の名前
  const selectedStoreName = stores.find(s => s.storeId === selectedStore)?.storeName || '';
  
  // マスタデータ取得
  useEffect(() => {
    const loadMasterData = async () => {
      try {
        // 店舗
        const storesRes = await fetch(`${API_BASE_URL}/api/stores`);
        const storesData = await storesRes.json();
        if (storesData.success) {
          setStores(storesData.stores || storesData.data || []);
        }
        
        // 仕入先
        const suppliersRes = await fetch(`${API_BASE_URL}/api/suppliers`);
        const suppliersData = await suppliersRes.json();
        if (suppliersData.success) {
          setSuppliers(suppliersData.data || suppliersData.suppliers || []);
        }
      } catch (error) {
        console.error('マスタデータ取得エラー:', error);
      }
    };
    loadMasterData();
  }, []);
  
  // 予測実行（シンプル版 - バックエンドAPIを呼ぶだけ）
  const executeForecast = useCallback(async () => {
    setIsLoading(true);
    
    try {
      // 参照期間の計算
      let lookbackDays = LOOKBACK_DAYS[lookbackPeriod] || 30;
      
      // custom_X 形式の場合（任意日数）
      if (lookbackPeriod.startsWith('custom_')) {
        lookbackDays = parseInt(lookbackPeriod.replace('custom_', ''), 10) || 30;
      } else if (lookbackPeriod === 'custom' && customLookbackStart && customLookbackEnd) {
        lookbackDays = Math.ceil(
          (new Date(customLookbackEnd).getTime() - new Date(customLookbackStart).getTime()) / (1000 * 60 * 60 * 24)
        );
      }
      
      console.log('=== 予測実行開始 ===');
      console.log('店舗ID:', selectedStore);
      console.log('仕入先数:', selectedSuppliers.length);
      console.log('発注日:', orderDate);
      console.log('予測日数:', forecastDays);
      console.log('参照日数:', lookbackDays);
      
      // 新しいAPIを呼び出し（計算はすべてバックエンドで行う）
      const response = await fetch(`${API_BASE_URL}/api/forecast/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeId: selectedStore,
          supplierNames: selectedSuppliers,
          orderDate: orderDate,
          forecastDays: forecastDays,
          lookbackDays: lookbackDays,
        }),
      });
      
      const data = await response.json();
      
      console.log('APIレスポンス:', data.success);
      console.log('対象商品数:', data.summary?.totalProducts || 0);
      
      if (!data.success) {
        throw new Error(data.error || '予測の実行に失敗しました');
      }
      
      // 結果をセット（加工しない）
      setSupplierGroups(data.supplierGroups || []);
      setTotalProducts(data.summary?.totalProducts || 0);
      setTotalOrderQuantity(data.summary?.totalOrderQuantity || 0);
      setTotalOrderAmount(data.summary?.totalOrderAmount || 0);
      setActualLookbackDays(lookbackDays);
      setPastSalesType(data.pastSalesType || 'daily');
      setPastSalesDates(data.pastSalesDates || []);
      setPastSalesWeeks(data.pastSalesWeeks || []);
      
      // 現行品/廃盤の内訳をセット
      setActiveProducts(data.summary?.activeProducts || 0);
      setDiscontinuedProducts(data.summary?.discontinuedProducts || 0);
      setProductsWithOrder(data.summary?.productsWithOrder || 0);
      setActiveProductsWithOrder(data.summary?.activeProductsWithOrder || 0);
      
      // ABC分析・異常検知サマリーをセット
      setAbcSummary(data.abcSummary || null);
      setAnomalySummary(data.anomalySummary || null);
      setStockoutCost(data.stockoutCost || null);
      
      // 月末在庫コントロール情報をセット
      setMonthEndInfo(data.monthEndInfo || null);
      setNextMonthOrders(data.nextMonthOrders || []);
      
      console.log('ABC分析:', data.abcSummary);
      console.log('異常検知:', data.anomalySummary);
      console.log('月末情報:', data.monthEndInfo);
      console.log('=== 予測実行完了 ===');
      
    } catch (error: any) {
      console.error('予測実行エラー:', error);
      alert('予測の実行に失敗しました: ' + error.message);
    } finally {
      setIsLoading(false);
    }
  }, [selectedStore, selectedSuppliers, orderDate, forecastDays, lookbackPeriod, customLookbackStart, customLookbackEnd]);
  
  // CSVダウンロード
  const handleDownloadCSV = (supplierName?: string) => {
    let products: any[] = [];
    if (supplierName) {
      const group = supplierGroups.find((g: any) => g.supplierName === supplierName);
      if (group) products = group.products;
    } else {
      products = supplierGroups.flatMap((g: any) => g.products);
    }
    
    if (products.length === 0) return;
    
    // CSVヘッダー
    const headers = ['商品ID', '商品名', '仕入先', '単価', '原価', '現在庫', '予測売数', '安全在庫', '推奨発注', '発注金額', 'ランク'];
    
    // CSVデータ
    const rows = products.map((p: any) => [
      p.productId,
      p.productName,
      p.supplierName,
      p.price,
      p.cost,
      p.currentStock,
      p.forecastQuantity,
      p.safetyStock,
      p.recommendedOrder,
      p.orderAmount,
      p.rank,
    ]);
    
    // CSV文字列生成
    const csvContent = [headers, ...rows]
      .map(row => row.map((cell: any) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    
    // BOMを追加してExcelで文字化けしないようにする
    const bom = '\uFEFF';
    const blob = new Blob([bom + csvContent], { type: 'text/csv;charset=utf-8;' });
    
    // ダウンロード
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = supplierName 
      ? `発注リスト_${supplierName}_${orderDate}.csv`
      : `発注リスト_全体_${orderDate}.csv`;
    link.click();
  };
  
  // ステップ移動
  const goToStep = (step: number) => {
    if (step < currentStep) {
      setCurrentStep(step);
    }
  };
  
  const handleNext = () => {
    if (currentStep === 1) {
      if (!selectedStore) {
        alert('店舗を選択してください');
        return;
      }
      if (selectedSuppliers.length === 0) {
        alert('仕入先を選択してください');
        return;
      }
      setCurrentStep(2);
    } else if (currentStep === 2) {
      setCurrentStep(3);
      executeForecast();
    }
  };
  
  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };
  
  // カスタム参照期間の変更ハンドラー
  const handleCustomLookbackChange = (start: string, end: string) => {
    setCustomLookbackStart(start);
    setCustomLookbackEnd(end);
  };
  
  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">需要予測・発注</h1>
      
      {/* プログレスバー */}
      <ProgressBar 
        steps={STEPS} 
        currentStep={currentStep} 
        onStepClick={goToStep}
      />
      
      {/* ステップコンテンツ */}
      <div className="mt-8">
        {currentStep === 1 && (
          <StepStoreSupplier
            stores={stores}
            suppliers={suppliers}
            selectedStore={selectedStore}
            selectedSuppliers={selectedSuppliers}
            onStoreChange={(storeId) => setSelectedStore(storeId)}
            onSuppliersChange={setSelectedSuppliers}
            onNext={handleNext}
          />
        )}
        
        {currentStep === 2 && (
          <StepPeriodSetting
            orderDate={orderDate}
            forecastDays={forecastDays}
            lookbackPeriod={lookbackPeriod}
            customLookbackStart={customLookbackStart}
            customLookbackEnd={customLookbackEnd}
            daysUntilOrder={daysUntilOrder}
            onOrderDateChange={setOrderDate}
            onForecastDaysChange={setForecastDays}
            onLookbackPeriodChange={setLookbackPeriod}
            onCustomLookbackChange={handleCustomLookbackChange}
            onBack={handleBack}
            onNext={handleNext}
          />
        )}
        
        {currentStep === 3 && (
          <StepResult
            storeId={selectedStore || ''}
            storeName={selectedStoreName}
            selectedSuppliers={selectedSuppliers}
            orderDate={orderDate}
            forecastDays={forecastDays}
            lookbackDays={actualLookbackDays}
            daysUntilOrder={daysUntilOrder}
            supplierGroups={supplierGroups}
            totalProducts={totalProducts}
            totalOrderQuantity={totalOrderQuantity}
            totalOrderAmount={totalOrderAmount}
            pastSalesType={pastSalesType}
            pastSalesDates={pastSalesDates}
            pastSalesWeeks={pastSalesWeeks}
            isLoading={isLoading}
            onBack={handleBack}
            onDownloadCSV={handleDownloadCSV}
            activeProducts={activeProducts}
            discontinuedProducts={discontinuedProducts}
            productsWithOrder={productsWithOrder}
            activeProductsWithOrder={activeProductsWithOrder}
            showAllProducts={showAllProducts}
            onShowAllProductsChange={setShowAllProducts}
            abcSummary={abcSummary}
            anomalySummary={anomalySummary}
            stockoutCost={stockoutCost}
            monthEndInfo={monthEndInfo}
            nextMonthOrders={nextMonthOrders}
          />
        )}
      </div>
    </div>
  );
};

export default DemandForecast;
