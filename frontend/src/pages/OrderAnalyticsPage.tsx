import { useState, useEffect } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface Store {
  storeId: string;
  storeName: string;
}

export default function OrderAnalyticsPage() {
  // 状態
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedStores, setSelectedStores] = useState<string[]>(['all']);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [supplierPage, setSupplierPage] = useState(1);
  const SUPPLIERS_PER_PAGE = 50;
  const [stores, setStores] = useState<Store[]>([]);
  
  // 店舗一覧を取得
  useEffect(() => {
    const fetchStores = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/stores`);
        const result = await response.json();
        if (result.success && result.data) {
          setStores(result.data);
        }
      } catch (error) {
        console.error('店舗一覧取得エラー:', error);
      }
    };
    fetchStores();
  }, []);
  
  // データ取得
  useEffect(() => {
    fetchAnalytics();
  }, [selectedMonth, selectedStores]);
  
  const fetchAnalytics = async () => {
    // 店舗が選択されていない場合はデータをクリア
    if (selectedStores.length === 0) {
      setData(null);
      return;
    }
    
    setLoading(true);
    try {
      const [year, month] = selectedMonth.split('-');
      const startDate = `${year}-${month}-01`;
      const endDate = new Date(Number(year), Number(month), 0).toISOString().split('T')[0];
      
      const storeParam = selectedStores.includes('all') 
        ? 'all' 
        : selectedStores.join(',');
      
      const response = await fetch(
        `${API_BASE_URL}/api/analytics/orders?startDate=${startDate}&endDate=${endDate}&storeIds=${storeParam}`
      );
      const result = await response.json();
      
      if (result.success) {
        setData(result.data);
      }
    } catch (error) {
      console.error('分析データ取得エラー:', error);
    } finally {
      setLoading(false);
    }
  };
  
  // 店舗選択
  const handleStoreToggle = (storeId: string) => {
    if (storeId === 'all') {
      // 全店舗チェックボックスはトグル動作（全選択↔全解除）
      if (selectedStores.includes('all')) {
        // 全店舗が選択されている場合は全解除（空配列）
        setSelectedStores([]);
      } else {
        // 全店舗を選択
        setSelectedStores(['all']);
      }
    } else {
      // 全店舗が選択されている場合、クリックした店舗以外を選択状態にする
      if (selectedStores.includes('all')) {
        // クリックした店舗以外の全店舗を選択
        const otherStores = stores.filter(s => s.storeId !== storeId).map(s => s.storeId);
        setSelectedStores(otherStores);
      } else {
        let newSelection = [...selectedStores];
        if (newSelection.includes(storeId)) {
          newSelection = newSelection.filter(id => id !== storeId);
        } else {
          newSelection.push(storeId);
        }
        // 全店舗が選択されたら'all'に切り替え
        if (newSelection.length === stores.length) {
          newSelection = ['all'];
        }
        // 空になってもそのまま（全解除を許容）
        setSelectedStores(newSelection);
      }
    }
  };
  
  // CSV出力
  const handleExportCSV = async (type: string) => {
    const [year, month] = selectedMonth.split('-');
    const startDate = `${year}-${month}-01`;
    const endDate = new Date(Number(year), Number(month), 0).toISOString().split('T')[0];
    const storeParam = selectedStores.includes('all') ? 'all' : selectedStores.join(',');
    
    window.open(
      `${API_BASE_URL}/api/analytics/orders/csv?startDate=${startDate}&endDate=${endDate}&storeIds=${storeParam}&type=${type}`,
      '_blank'
    );
  };
  
  // 金額フォーマット
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY' }).format(value);
  };
  
  // 変化率の表示
  const renderChange = (value: number, suffix = '%') => {
    if (value > 0) {
      return <span className="text-green-600">▲{value}{suffix}</span>;
    } else if (value < 0) {
      return <span className="text-red-600">▼{Math.abs(value)}{suffix}</span>;
    }
    return <span className="text-gray-500">±0{suffix}</span>;
  };
  
  // 月選択オプション生成
  const generateMonthOptions = () => {
    const options = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = `${d.getFullYear()}年${d.getMonth() + 1}月`;
      options.push({ value, label });
    }
    return options;
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* ヘッダー */}
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-bold">発注分析レポート</h1>
        <div className="flex gap-2">
          <button
            onClick={() => handleExportCSV('all')}
            className="btn-sakiyomi-primary"
          >
            CSV出力
          </button>
        </div>
      </div>
      
      {/* フィルター */}
      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex flex-wrap gap-4 items-center">
          <div>
            <label className="block text-sm font-medium mb-1">期間</label>
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="border rounded px-3 py-2"
            >
              {generateMonthOptions().map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">店舗</label>
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedStores.includes('all')}
                  onChange={() => handleStoreToggle('all')}
                  className="rounded"
                />
                <span className="text-sm">全店舗</span>
              </label>
              {stores.map(store => (
                <label key={store.storeId} className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedStores.includes(store.storeId) || selectedStores.includes('all')}
                    onChange={() => handleStoreToggle(store.storeId)}
                    className="rounded"
                  />
                  <span className="text-sm">{store.storeName}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {loading ? (
        <div className="text-center py-12">読み込み中...</div>
      ) : data ? (
        <>
          {/* サマリーKPI */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">総発注金額</div>
              <div className="text-2xl font-bold">{formatCurrency(data.summary.totalAmount)}</div>
              <div className="text-sm">{renderChange(data.summary.totalAmountChange)} 前月比</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">発注件数</div>
              <div className="text-2xl font-bold">{data.summary.orderCount}件</div>
              <div className="text-sm">{renderChange(data.summary.orderCountChange, '件')} 前月比</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">平均発注金額</div>
              <div className="text-2xl font-bold">{formatCurrency(data.summary.avgAmount)}</div>
              <div className="text-sm">{renderChange(data.summary.avgAmountChange)} 前月比</div>
            </div>
            <div className="bg-white rounded-lg shadow p-4">
              <div className="text-sm text-gray-500">仕入先数</div>
              <div className="text-2xl font-bold">{data.summary.suppliers}社</div>
              <div className="text-sm">{renderChange(data.summary.suppliersChange, '社')} 前月比</div>
            </div>
          </div>
          
          {/* 時系列グラフ */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">📈 発注金額推移</h2>
              <button
                onClick={() => handleExportCSV('timeseries')}
                className="text-sm text-sakiyomi-gradient font-medium hover:opacity-80 cursor-pointer"
              >
                CSV出力
              </button>
            </div>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.timeSeries}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tickFormatter={(value) => {
                    const d = new Date(value);
                    return `${d.getMonth() + 1}/${d.getDate()}`;
                  }}
                />
                <YAxis 
                  tickFormatter={(value) => `¥${(value / 1000).toFixed(0)}K`}
                />
                <Tooltip 
                  formatter={(value, name) => {
                    const numValue = Number(value) || 0;
                    if (name === 'amount') return [formatCurrency(numValue), '発注金額'];
                    if (name === 'count') return [numValue + '件', '発注件数'];
                    return [numValue, name];
                  }}
                  labelFormatter={(label) => {
                    const d = new Date(label);
                    return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
                  }}
                />
                <Line 
                  type="monotone" 
                  dataKey="amount" 
                  stroke="#2D9D9D" 
                  strokeWidth={2}
                  dot={{ fill: '#2D9D9D', strokeWidth: 2 }}
                  activeDot={{ r: 8 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          
          {/* 仕入先別分析 */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">🏭 仕入先別分析</h2>
              <button
                onClick={() => handleExportCSV('supplier')}
                className="text-sm text-sakiyomi-gradient font-medium hover:opacity-80 cursor-pointer"
              >
                CSV出力
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left">順位</th>
                    <th className="px-4 py-2 text-left">仕入先名</th>
                    <th className="px-4 py-2 text-right">発注金額</th>
                    <th className="px-4 py-2 text-right">構成比</th>
                    <th className="px-4 py-2 text-right">発注回数</th>
                    <th className="px-4 py-2 text-right">前月比</th>
                  </tr>
                </thead>
                <tbody>
                  {data.supplierAnalysis
                    .slice((supplierPage - 1) * SUPPLIERS_PER_PAGE, supplierPage * SUPPLIERS_PER_PAGE)
                    .map((supplier: any, index: number) => (
                      <tr key={supplier.supplierCode} className="border-t hover:bg-gray-50">
                        <td className="px-4 py-2">{(supplierPage - 1) * SUPPLIERS_PER_PAGE + index + 1}</td>
                        <td className="px-4 py-2">{supplier.supplierName}</td>
                        <td className="px-4 py-2 text-right">{formatCurrency(supplier.amount)}</td>
                        <td className="px-4 py-2 text-right">{supplier.ratio}%</td>
                        <td className="px-4 py-2 text-right">{supplier.count}回</td>
                        <td className="px-4 py-2 text-right">{renderChange(supplier.change)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {data.supplierAnalysis.length > SUPPLIERS_PER_PAGE && (
              <div className="flex justify-end gap-2 mt-4">
                <button
                  onClick={() => setSupplierPage(p => Math.max(1, p - 1))}
                  disabled={supplierPage === 1}
                  className="px-3 py-1 border rounded disabled:opacity-50"
                >
                  ← 前へ
                </button>
                <span className="px-3 py-1">
                  {supplierPage} / {Math.ceil(data.supplierAnalysis.length / SUPPLIERS_PER_PAGE)}
                </span>
                <button
                  onClick={() => setSupplierPage(p => Math.min(Math.ceil(data.supplierAnalysis.length / SUPPLIERS_PER_PAGE), p + 1))}
                  disabled={supplierPage >= Math.ceil(data.supplierAnalysis.length / SUPPLIERS_PER_PAGE)}
                  className="px-3 py-1 border rounded disabled:opacity-50"
                >
                  次へ →
                </button>
              </div>
            )}
          </div>
          
          {/* 商品別分析 */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">📦 商品別分析</h2>
              <button
                onClick={() => handleExportCSV('product')}
                className="text-sm text-sakiyomi-gradient font-medium hover:opacity-80 cursor-pointer"
              >
                CSV出力
              </button>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {/* 数量ランキング */}
              <div>
                <h3 className="font-medium mb-2">発注数量ランキング TOP10</h3>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">商品名</th>
                      <th className="px-2 py-1 text-right">数量</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.productAnalysis.byQuantity.slice(0, 10).map((p: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">{i + 1}</td>
                        <td className="px-2 py-1 truncate max-w-xs">{p.name}</td>
                        <td className="px-2 py-1 text-right">{p.quantity}個</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* 金額ランキング */}
              <div>
                <h3 className="font-medium mb-2">発注金額ランキング TOP10</h3>
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-1 text-left">#</th>
                      <th className="px-2 py-1 text-left">商品名</th>
                      <th className="px-2 py-1 text-right">金額</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.productAnalysis.byAmount.slice(0, 10).map((p: any, i: number) => (
                      <tr key={i} className="border-t">
                        <td className="px-2 py-1">{i + 1}</td>
                        <td className="px-2 py-1 truncate max-w-xs">{p.name}</td>
                        <td className="px-2 py-1 text-right">{formatCurrency(p.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            
            {/* カテゴリ別構成比 */}
            <div className="mt-4">
              <h3 className="font-medium mb-2">カテゴリ別構成比</h3>
              <div className="space-y-2">
                {data.productAnalysis.byCategory.slice(0, 8).map((cat: any) => (
                  <div key={cat.category} className="flex items-center gap-2">
                    <span className="w-24 text-sm truncate">{cat.category}</span>
                    <div className="flex-1 bg-gray-200 rounded-full h-4">
                      <div
                        className="bg-gradient-to-r from-[#2D9D9D] to-[#3B82F6] rounded-full h-4"
                        style={{ width: `${cat.ratio}%` }}
                      />
                    </div>
                    <span className="w-16 text-sm text-right">{cat.ratio}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* 店舗別分析 */}
          <div className="bg-white rounded-lg shadow p-4 mb-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">🏪 店舗別分析</h2>
              <button
                onClick={() => handleExportCSV('store')}
                className="text-sm text-sakiyomi-gradient font-medium hover:opacity-80 cursor-pointer"
              >
                CSV出力
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left">店舗名</th>
                    <th className="px-4 py-2 text-right">発注金額</th>
                    <th className="px-4 py-2 text-right">構成比</th>
                    <th className="px-4 py-2 text-right">発注回数</th>
                    <th className="px-4 py-2 text-right">平均発注金額</th>
                    <th className="px-4 py-2 text-right">前月比</th>
                  </tr>
                </thead>
                <tbody>
                  {data.storeAnalysis.map((store: any) => (
                    <tr key={store.storeId} className="border-t hover:bg-gray-50">
                      <td className="px-4 py-2">{store.storeName}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(store.amount)}</td>
                      <td className="px-4 py-2 text-right">{store.ratio}%</td>
                      <td className="px-4 py-2 text-right">{store.count}回</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(store.avgAmount)}</td>
                      <td className="px-4 py-2 text-right">{renderChange(store.change)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : (
        <div className="text-center py-12 text-gray-500">
          データがありません
        </div>
      )}
    </div>
  );
}
