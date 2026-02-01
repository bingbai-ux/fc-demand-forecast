import React, { useState, useEffect } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

interface Store {
  storeId: string;
  storeName: string;
}

interface OrderGroup {
  id: number;
  name: string;
  description: string | null;
  order_group_suppliers: { id: number; supplier_name: string }[];
}

interface StepStoreSupplierProps {
  stores: Store[];
  suppliers: string[];
  selectedStore: string | null;
  selectedSuppliers: string[];
  onStoreChange: (storeId: string) => void;
  onSuppliersChange: (suppliers: string[]) => void;
  onNext: () => void;
}

type SelectionMode = 'group' | 'individual';

const StepStoreSupplier: React.FC<StepStoreSupplierProps> = ({
  stores,
  suppliers,
  selectedStore,
  selectedSuppliers,
  onStoreChange,
  onSuppliersChange,
  onNext,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectionMode, setSelectionMode] = useState<SelectionMode>('group');
  const [orderGroups, setOrderGroups] = useState<OrderGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [loadingGroups, setLoadingGroups] = useState(true);
  
  // 発注グループを取得
  useEffect(() => {
    const fetchGroups = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/order-groups`);
        const data = await res.json();
        setOrderGroups(data);
      } catch (error) {
        console.error('発注グループ取得エラー:', error);
      } finally {
        setLoadingGroups(false);
      }
    };
    fetchGroups();
  }, []);
  
  // 検索フィルター
  const filteredSuppliers = suppliers.filter(s =>
    s.toLowerCase().includes(searchTerm.toLowerCase())
  );
  
  // 3列に分割
  const columns = 3;
  const itemsPerColumn = Math.ceil(filteredSuppliers.length / columns);
  const supplierColumns = Array.from({ length: columns }, (_, i) =>
    filteredSuppliers.slice(i * itemsPerColumn, (i + 1) * itemsPerColumn)
  );
  
  const handleSelectAll = () => {
    if (selectedSuppliers.length === suppliers.length) {
      onSuppliersChange([]);
    } else {
      onSuppliersChange([...suppliers]);
    }
  };
  
  const handleSupplierToggle = (supplier: string) => {
    if (selectedSuppliers.includes(supplier)) {
      onSuppliersChange(selectedSuppliers.filter(s => s !== supplier));
    } else {
      onSuppliersChange([...selectedSuppliers, supplier]);
    }
  };
  
  const handleGroupSelect = (group: OrderGroup) => {
    setSelectedGroupId(group.id);
    const groupSuppliers = group.order_group_suppliers.map(s => s.supplier_name);
    onSuppliersChange(groupSuppliers);
  };
  
  const handleModeChange = (mode: SelectionMode) => {
    setSelectionMode(mode);
    setSelectedGroupId(null);
    onSuppliersChange([]);
  };
  
  const canProceed = selectedStore && selectedSuppliers.length > 0;
  
  // グラデーションスタイル
  const gradientStyle = { background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' };
  
  return (
    <div className="space-y-6">
      {/* 店舗選択 */}
      <div>
        <h3 className="text-lg font-semibold text-gray-700 mb-3">発注する店舗</h3>
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          {stores.map((store) => (
            <button
              key={store.storeId}
              onClick={() => onStoreChange(store.storeId)}
              className={`p-4 rounded-lg border-2 text-center transition-all bg-white ${
                selectedStore === store.storeId
                  ? 'border-[#0D4F4F] text-[#0D4F4F]'
                  : 'border-gray-200 hover:border-gray-300 text-gray-600'
              }`}
            >
              <div className="font-medium">{store.storeName}</div>
            </button>
          ))}
        </div>
      </div>
      
      {/* 仕入先選択モード切り替え */}
      <div>
        <h3 className="text-lg font-semibold text-gray-700 mb-3">発注する仕入先</h3>
        
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => handleModeChange('group')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              selectionMode === 'group'
                ? 'text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            style={selectionMode === 'group' ? gradientStyle : {}}
          >
            📁 グループから選択
          </button>
          <button
            onClick={() => handleModeChange('individual')}
            className={`px-4 py-2 rounded-lg font-medium transition-all ${
              selectionMode === 'individual'
                ? 'text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            style={selectionMode === 'individual' ? gradientStyle : {}}
          >
            ✓ 個別に選択
          </button>
        </div>
        
        {/* グループ選択モード */}
        {selectionMode === 'group' && (
          <div>
            {loadingGroups ? (
              <div className="text-center py-8 text-gray-500">読み込み中...</div>
            ) : orderGroups.length === 0 ? (
              <div className="text-center py-8 bg-gray-50 rounded-lg">
                <p className="text-gray-500">発注グループがまだありません。</p>
                <p className="text-sm text-gray-400 mt-2">
                  設定 → 発注グループ から作成できます。
                </p>
                <button
                  onClick={() => handleModeChange('individual')}
                  className="mt-4 text-[#0D4F4F] hover:underline"
                >
                  個別選択に切り替える →
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {orderGroups.map((group) => (
                  <button
                    key={group.id}
                    onClick={() => handleGroupSelect(group)}
                    className={`p-4 rounded-lg border-2 text-left transition-all bg-white ${
                      selectedGroupId === group.id
                        ? 'border-[#0D4F4F]'
                        : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <div className="font-semibold text-gray-800">{group.name}</div>
                    {group.description && (
                      <div className="text-sm text-gray-500 mt-1">{group.description}</div>
                    )}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {group.order_group_suppliers.slice(0, 3).map(s => (
                        <span
                          key={s.id}
                          className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded"
                        >
                          {s.supplier_name}
                        </span>
                      ))}
                      {group.order_group_suppliers.length > 3 && (
                        <span className="text-xs text-gray-400">
                          +{group.order_group_suppliers.length - 3}件
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
            
            {selectedGroupId && (
              <div className="mt-4 p-3 bg-[#0D4F4F]/5 rounded-lg">
                <span className="text-[#0D4F4F] font-medium">
                  選択中: {orderGroups.find(g => g.id === selectedGroupId)?.name}
                </span>
                <span className="text-[#0D4F4F] ml-2">
                  ({selectedSuppliers.length}件の仕入先)
                </span>
              </div>
            )}
          </div>
        )}
        
        {/* 個別選択モード */}
        {selectionMode === 'individual' && (
          <div>
            <div className="flex justify-between items-center mb-3">
              <span className="text-sm text-gray-500">
                {selectedSuppliers.length}件選択中
              </span>
              <div className="flex gap-2">
                <button
                  onClick={handleSelectAll}
                  className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                >
                  {selectedSuppliers.length === suppliers.length ? '全て解除' : '全て選択'}
                </button>
                <button
                  onClick={() => onSuppliersChange([])}
                  className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                >
                  クリア
                </button>
              </div>
            </div>
            
            {/* 検索 */}
            <div className="mb-4">
              <input
                type="text"
                placeholder="🔍 仕入先を検索..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0D4F4F]"
              />
            </div>
            
            {/* 3列表示 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-h-80 overflow-y-auto border-2 border-gray-300 rounded-lg p-4 bg-white">
              {supplierColumns.map((column, colIndex) => (
                <div key={colIndex} className="space-y-1">
                  {column.map((supplier) => (
                    <label
                      key={supplier}
                      className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedSuppliers.includes(supplier)}
                        onChange={() => handleSupplierToggle(supplier)}
                        className="rounded accent-[#0D4F4F]"
                      />
                      <span className="text-sm truncate">{supplier}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      
      {/* 次へボタン */}
      <div className="flex justify-end pt-4">
        <button
          onClick={onNext}
          disabled={!canProceed}
          className={`px-6 py-3 rounded-lg font-medium transition-all ${
            canProceed
              ? 'text-white hover:opacity-90'
              : 'bg-gray-300 text-gray-500 cursor-not-allowed'
          }`}
          style={canProceed ? gradientStyle : {}}
        >
          次へ →
        </button>
      </div>
    </div>
  );
};

export default StepStoreSupplier;
