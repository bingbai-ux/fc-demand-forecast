import React, { useState, useEffect } from 'react';
import { format, subDays } from 'date-fns';
import { DateRangePicker } from '../components/DateRangePicker';

interface OrderItem {
  id: number;
  product_id: string;
  product_code: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  amount: number;
  lot_size: number;
}

interface Order {
  id: number;
  order_number: string;
  store_id: string;
  store_name: string;
  supplier_code: string;
  supplier_name: string;
  order_date: string;
  expected_arrival: string;
  order_method: string;
  total_quantity: number;
  total_amount: number;
  shipping_fee: number;
  status: string;
  notes: string;
  created_at: string;
  items?: OrderItem[];
  // スマレジ連携用
  smaregi_synced?: boolean;
  smaregi_synced_at?: string;
  smaregi_purchase_order_id?: string;
}

interface OrderHistoryProps {
  onBack?: () => void;
}

const OrderHistory: React.FC<OrderHistoryProps> = ({ onBack }) => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [filterSupplier, setFilterSupplier] = useState('');
  const [filterStore, setFilterStore] = useState('');
  const [syncingOrderId, setSyncingOrderId] = useState<number | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<number[]>([]);
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);
  const [deletingOrderId, setDeletingOrderId] = useState<number | null>(null);
  const [deleteConfirmOrder, setDeleteConfirmOrder] = useState<Order | null>(null);
  
  // 日付範囲（デフォルト: 過去30日）
  const [dateFrom, setDateFrom] = useState(format(subDays(new Date(), 29), 'yyyy-MM-dd'));
  const [dateTo, setDateTo] = useState(format(new Date(), 'yyyy-MM-dd'));

  // 発注履歴を取得
  useEffect(() => {
    fetchOrders();
  }, [filterSupplier, filterStore, dateFrom, dateTo]);

  const fetchOrders = async () => {
    setIsLoading(true);
    setError(null);
    
    try {
      const params = new URLSearchParams();
      if (filterSupplier) params.append('supplierCode', filterSupplier);
      if (filterStore) params.append('storeId', filterStore);
      if (dateFrom) params.append('startDate', dateFrom);
      if (dateTo) params.append('endDate', dateTo);
      
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/orders?${params.toString()}`
      );
      const result = await response.json();
      
      if (result.success) {
        setOrders(result.orders);
      } else {
        throw new Error(result.error || '発注履歴の取得に失敗しました');
      }
    } catch (err) {
      console.error('Fetch orders error:', err);
      setError(err instanceof Error ? err.message : '不明なエラー');
    } finally {
      setIsLoading(false);
    }
  };

  // 発注詳細を取得
  const fetchOrderDetail = async (orderId: number) => {
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_URL || ''}/api/orders/${orderId}`
      );
      const result = await response.json();
      
      if (result.success) {
        setSelectedOrder(result.order);
      } else {
        throw new Error(result.error || '発注詳細の取得に失敗しました');
      }
    } catch (err) {
      console.error('Fetch order detail error:', err);
      alert(err instanceof Error ? err.message : '不明なエラー');
    }
  };

  // スマレジに連携
  const syncToSmaregi = async (orderId: number) => {
    if (!confirm('この発注をスマレジの入荷予定に登録しますか？')) {
      return;
    }
    
    setSyncingOrderId(orderId);
    
    try {
      // APIのURLを確認
      const apiUrl = `${import.meta.env.VITE_API_URL || ''}/api/orders/${orderId}/sync-smaregi`;
      console.log('スマレジ連携API呼び出し:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      // レスポンスがJSONかどうか確認
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        const text = await response.text();
        console.error('JSONではないレスポンス:', text.substring(0, 200));
        throw new Error('APIからJSONが返されませんでした。エンドポイントを確認してください。');
      }
      
      const result = await response.json();
      
      if (result.success) {
        alert('スマレジに入荷予定を登録しました！');
        // 発注リストを更新
        fetchOrders();
        // 詳細モーダルが開いている場合は更新
        if (selectedOrder?.id === orderId) {
          fetchOrderDetail(orderId);
        }
      } else {
        alert(`連携エラー: ${result.error}`);
      }
    } catch (err: any) {
      console.error('連携エラー:', err);
      alert(`エラー: ${err.message}`);
    } finally {
      setSyncingOrderId(null);
    }
  };

  // 日付範囲変更ハンドラー
  const handleDateChange = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
  };

  // チェックボックス操作
  const handleSelectOrder = (orderId: number, checked: boolean) => {
    if (checked) {
      setSelectedOrderIds(prev => [...prev, orderId]);
    } else {
      setSelectedOrderIds(prev => prev.filter(id => id !== orderId));
    }
  };

  // 未連携の発注を全選択/全解除
  const handleSelectAllUnsyncedOrders = (checked: boolean) => {
    if (checked) {
      const unsyncedIds = orders.filter(o => !o.smaregi_synced).map(o => o.id);
      setSelectedOrderIds(unsyncedIds);
    } else {
      setSelectedOrderIds([]);
    }
  };

  // 一括スマレジ連携
  const bulkSyncToSmaregi = async () => {
    if (selectedOrderIds.length === 0) {
      alert('連携する発注を選択してください');
      return;
    }
    
    if (!confirm(`選択した${selectedOrderIds.length}件の発注をスマレジに連携しますか？`)) {
      return;
    }
    
    setIsBulkSyncing(true);
    
    try {
      const apiUrl = `${import.meta.env.VITE_API_URL || ''}/api/orders/bulk-sync-smaregi`;
      console.log('一括スマレジ連携API呼び出し:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderIds: selectedOrderIds }),
      });
      
      const result = await response.json();
      
      if (result.success) {
        const successCount = result.summary?.success || 0;
        const failCount = result.summary?.failed || 0;
        
        if (failCount > 0) {
          const failedMessages = result.results
            ?.filter((r: any) => !r.success)
            .map((r: any) => `ID:${r.orderId} - ${r.message}`)
            .join('\n');
          alert(`連携完了\n成功: ${successCount}件\n失敗: ${failCount}件\n\n失敗詳細:\n${failedMessages}`);
        } else {
          alert(`${successCount}件の発注をスマレジに連携しました！`);
        }
        
        // 選択をクリアしてリストを更新
        setSelectedOrderIds([]);
        fetchOrders();
      } else {
        alert(`連携エラー: ${result.error}`);
      }
    } catch (err: any) {
      console.error('一括連携エラー:', err);
      alert(`エラー: ${err.message}`);
    } finally {
      setIsBulkSyncing(false);
    }
  };

  // 発注を削除
  const deleteOrder = async (orderId: number) => {
    setDeletingOrderId(orderId);
    
    try {
      const apiUrl = `${import.meta.env.VITE_API_URL || ''}/api/orders/${orderId}`;
      console.log('発注削除API呼び出し:', apiUrl);
      
      const response = await fetch(apiUrl, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
      });
      
      const result = await response.json();
      
      if (result.success) {
        alert('発注を削除しました');
        // リストを更新
        fetchOrders();
        // 確認ダイアログを閉じる
        setDeleteConfirmOrder(null);
      } else {
        alert(`削除エラー: ${result.error}`);
      }
    } catch (err: any) {
      console.error('削除エラー:', err);
      alert(`エラー: ${err.message}`);
    } finally {
      setDeletingOrderId(null);
    }
  };

  // 発注方法の表示
  const getOrderMethodLabel = (method: string) => {
    switch (method) {
      case 'email': return '📧 メール';
      case 'manual': return '📝 手動';
      case 'fax': return '📠 FAX';
      case 'phone': return '📞 電話';
      default: return method || '📝 手動';
    }
  };

  // 発注方法のバッジカラー
  const getOrderMethodColor = (method: string) => {
    switch (method) {
      case 'email': return 'bg-[#0D4F4F]/10 text-[#0D4F4F]';
      case 'manual': return 'bg-gray-100 text-gray-800';
      case 'fax': return 'bg-purple-100 text-purple-800';
      case 'phone': return 'bg-green-100 text-green-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  // 日付フォーマット
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  // 日時フォーマット
  const formatDateTime = (dateStr: string) => {
    if (!dateStr) return '-';
    const date = new Date(dateStr);
    return date.toLocaleString('ja-JP', { 
      year: 'numeric', 
      month: '2-digit', 
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // ユニークな仕入先リストを取得
  const uniqueSuppliers = Array.from(new Set(orders.map(o => o.supplier_name))).filter(Boolean);
  
  // ユニークな店舗リストを取得
  const uniqueStores = Array.from(new Set(orders.map(o => o.store_name))).filter(Boolean);

  return (
    <div className="p-6 space-y-6">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">発注履歴</h1>
        {onBack && (
          <button
            onClick={onBack}
            className="px-4 py-2 border rounded-lg hover:bg-gray-100"
          >
            ← 戻る
          </button>
        )}
      </div>

      {/* フィルター */}
      <div className="bg-white border rounded-lg p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* 日付範囲ピッカー */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">期間</label>
            <DateRangePicker
              fromDate={dateFrom}
              toDate={dateTo}
              onDateChange={handleDateChange}
            />
          </div>
          
          {/* 店舗フィルター */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">店舗</label>
            <select
              value={filterStore}
              onChange={(e) => setFilterStore(e.target.value)}
              className="border rounded-lg px-3 py-2 min-w-[150px]"
            >
              <option value="">すべて</option>
              {uniqueStores.map(store => (
                <option key={store} value={store}>{store}</option>
              ))}
            </select>
          </div>
          
          {/* 仕入先フィルター */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">仕入先</label>
            <select
              value={filterSupplier}
              onChange={(e) => setFilterSupplier(e.target.value)}
              className="border rounded-lg px-3 py-2 min-w-[180px]"
            >
              <option value="">すべて</option>
              {uniqueSuppliers.map(supplier => (
                <option key={supplier} value={supplier}>{supplier}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg">
          {error}
        </div>
      )}

      {/* ローディング */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#0D4F4F]"></div>
          <span className="ml-3 text-gray-600">読み込み中...</span>
        </div>
      ) : orders.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          発注履歴がありません
        </div>
      ) : (
        <>
          {/* 一括連携ボタン */}
          {orders.some(o => !o.smaregi_synced) && (
            <div className="flex items-center justify-between bg-white border rounded-lg p-4 mb-4">
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedOrderIds.length > 0 && selectedOrderIds.length === orders.filter(o => !o.smaregi_synced).length}
                    onChange={(e) => handleSelectAllUnsyncedOrders(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 focus:ring-[#0D4F4F] accent-[#0D4F4F]"
                  />
                  <span className="text-sm text-gray-700">未連携を全選択</span>
                </label>
                {selectedOrderIds.length > 0 && (
                  <span className="text-sm text-gray-500">
                    {selectedOrderIds.length}件選択中
                  </span>
                )}
              </div>
              <button
                onClick={bulkSyncToSmaregi}
                disabled={selectedOrderIds.length === 0 || isBulkSyncing}
                className="px-4 py-2 text-white rounded-lg hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                style={{ background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' }}
              >
                {isBulkSyncing ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    連携中...
                  </>
                ) : (
                  <>
                    選択した発注をスマレジに連携 ({selectedOrderIds.length}件)
                  </>
                )}
              </button>
            </div>
          )}
          
          <div className="bg-white border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-3 text-center font-medium text-gray-700 w-10">
                    <span className="sr-only">選択</span>
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">発注番号</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">発注日</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">店舗</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-700">仕入先</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-700">商品数</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-700">合計金額</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">発注方法</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">スマレジ</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-700">操作</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order, idx) => (
                  <tr 
                    key={order.id} 
                    className={`border-t hover:bg-gray-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${selectedOrderIds.includes(order.id) ? 'bg-[#0D4F4F]/5' : ''}`}
                  >
                    <td className="px-3 py-3 text-center">
                      {!order.smaregi_synced && (
                        <input
                          type="checkbox"
                          checked={selectedOrderIds.includes(order.id)}
                          onChange={(e) => handleSelectOrder(order.id, e.target.checked)}
                          className="w-4 h-4 rounded border-gray-300 focus:ring-[#0D4F4F] accent-[#0D4F4F]"
                        />
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-[#0D4F4F]">{order.order_number}</td>
                    <td className="px-4 py-3">{formatDate(order.order_date)}</td>
                    <td className="px-4 py-3">{order.store_name || '-'}</td>
                    <td className="px-4 py-3">{order.supplier_name}</td>
                    <td className="px-4 py-3 text-right">{order.total_quantity}個</td>
                    <td className="px-4 py-3 text-right font-medium">¥{order.total_amount.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getOrderMethodColor(order.order_method)}`}>
                        {getOrderMethodLabel(order.order_method)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {order.smaregi_synced ? (
                        <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          ✓ 連携済
                        </span>
                      ) : (
                        <button
                          onClick={() => syncToSmaregi(order.id)}
                          disabled={syncingOrderId === order.id}
                          className="px-2 py-1 rounded text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                          style={{ background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' }}
                        >
                          {syncingOrderId === order.id ? '連携中...' : '連携する'}
                        </button>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => fetchOrderDetail(order.id)}
                          className="text-[#0D4F4F] hover:text-[#0A1628] text-sm"
                        >
                          詳細
                        </button>
                        {!order.smaregi_synced && (
                          <button
                            onClick={() => setDeleteConfirmOrder(order)}
                            className="text-red-500 hover:text-red-700 text-sm"
                          >
                            削除
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* 詳細モーダル */}
      {selectedOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-3xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">発注詳細</h2>
              <button
                onClick={() => setSelectedOrder(null)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            {/* 発注情報 */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <p className="text-sm text-gray-500">発注番号</p>
                <p className="font-mono font-bold">{selectedOrder.order_number}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">発注方法</p>
                <span className={`px-3 py-1 rounded-full text-sm font-medium ${getOrderMethodColor(selectedOrder.order_method)}`}>
                  {getOrderMethodLabel(selectedOrder.order_method)}
                </span>
              </div>
              <div>
                <p className="text-sm text-gray-500">発注日</p>
                <p>{formatDate(selectedOrder.order_date)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">届け予定日</p>
                <p>{formatDate(selectedOrder.expected_arrival)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">仕入先</p>
                <p className="font-medium">{selectedOrder.supplier_name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">届け先（店舗）</p>
                <p className="font-medium">{selectedOrder.store_name}</p>
              </div>
            </div>

            {/* スマレジ連携ステータス */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg">
              <h3 className="font-bold mb-2">スマレジ連携</h3>
              {selectedOrder.smaregi_synced ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                      ✓ 連携済
                    </span>
                  </div>
                  <p className="text-sm text-gray-600">
                    連携日時: {formatDateTime(selectedOrder.smaregi_synced_at || '')}
                  </p>
                  {selectedOrder.smaregi_purchase_order_id && (
                    <p className="text-sm text-gray-600">
                      スマレジ発注ID: {selectedOrder.smaregi_purchase_order_id}
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-4">
                  <span className="text-sm text-gray-500">未連携</span>
                  <button
                    onClick={() => syncToSmaregi(selectedOrder.id)}
                    disabled={syncingOrderId === selectedOrder.id}
                    className="px-4 py-2 rounded text-white hover:opacity-90 disabled:opacity-50 text-sm"
                    style={{ background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' }}
                  >
                    {syncingOrderId === selectedOrder.id ? '連携中...' : 'スマレジに連携する'}
                  </button>
                </div>
              )}
            </div>

            {/* 商品明細 */}
            <h3 className="font-bold mb-2">商品明細</h3>
            <div className="border rounded-lg overflow-hidden mb-4">
              <table className="w-full text-sm">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left">商品名</th>
                    <th className="px-3 py-2 text-right">数量</th>
                    <th className="px-3 py-2 text-right">単価</th>
                    <th className="px-3 py-2 text-right">金額</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedOrder.items?.map((item, idx) => (
                    <tr key={idx} className="border-t">
                      <td className="px-3 py-2">{item.product_name}</td>
                      <td className="px-3 py-2 text-right">{item.quantity}個</td>
                      <td className="px-3 py-2 text-right">¥{item.unit_price.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right">¥{item.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* 合計 */}
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="flex justify-between mb-2">
                <span>商品合計</span>
                <span>¥{selectedOrder.total_amount.toLocaleString()}</span>
              </div>
              {selectedOrder.shipping_fee > 0 && (
                <div className="flex justify-between mb-2">
                  <span>送料</span>
                  <span>¥{selectedOrder.shipping_fee.toLocaleString()}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-lg border-t pt-2">
                <span>総合計</span>
                <span>¥{(selectedOrder.total_amount + selectedOrder.shipping_fee).toLocaleString()}</span>
              </div>
            </div>

            {/* 閉じるボタン */}
            <div className="mt-4 flex justify-end">
              <button
                onClick={() => setSelectedOrder(null)}
                className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 削除確認モーダル */}
      {deleteConfirmOrder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
            <h2 className="text-xl font-bold mb-4 text-red-600">発注を削除</h2>
            <p className="text-gray-700 mb-4">
              以下の発注を削除しますか？この操作は取り消せません。
            </p>
            <div className="bg-gray-50 rounded-lg p-4 mb-4">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">発注番号:</span>
                  <span className="ml-2 font-mono font-bold">{deleteConfirmOrder.order_number}</span>
                </div>
                <div>
                  <span className="text-gray-500">発注日:</span>
                  <span className="ml-2">{formatDate(deleteConfirmOrder.order_date)}</span>
                </div>
                <div>
                  <span className="text-gray-500">店舗:</span>
                  <span className="ml-2">{deleteConfirmOrder.store_name || '-'}</span>
                </div>
                <div>
                  <span className="text-gray-500">仕入先:</span>
                  <span className="ml-2">{deleteConfirmOrder.supplier_name}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-gray-500">合計金額:</span>
                  <span className="ml-2 font-bold">¥{deleteConfirmOrder.total_amount.toLocaleString()}</span>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirmOrder(null)}
                className="px-4 py-2 bg-gray-200 rounded-lg hover:bg-gray-300"
                disabled={deletingOrderId !== null}
              >
                キャンセル
              </button>
              <button
                onClick={() => deleteOrder(deleteConfirmOrder.id)}
                disabled={deletingOrderId !== null}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {deletingOrderId === deleteConfirmOrder.id ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                    削除中...
                  </>
                ) : (
                  '削除する'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default OrderHistory;
