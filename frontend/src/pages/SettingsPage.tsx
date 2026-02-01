import React, { useState, useEffect } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

type TabType = 'suppliers' | 'email' | 'orderGroups';

interface SupplierSetting {
  id?: number;
  supplier_code: string;
  supplier_name: string;
  company_name: string;
  contact_person: string;
  phone: string;
  email: string;
  lead_time_days: number;
  min_order_amount: number;
  free_shipping_amount: number | null;
  shipping_fee: number;
  order_method: 'manual' | 'email';
  is_modified?: boolean;
}

interface ProductWithLot {
  product_id: string;
  product_name: string;
  category_name: string | null;
  brand_name: string | null;
  price: number;
  cost: number;
  order_lot: number | null;
  is_modified?: boolean;
}

interface EmailSettings {
  smtp_host: string;
  smtp_port: string;
  smtp_user: string;
  smtp_pass: string;
  smtp_from: string;
  smtp_from_name: string;
}

interface EmailTemplates {
  subject: string;
  body: string;
}

interface StoreInfo {
  store_id: string;
  store_name: string;
  postal_code: string;
  address: string;
  phone: string;
  contact_person: string;
  is_modified?: boolean;
}

// 商品別発注ロット設定コンポーネント（簡素化版）
const ProductLotSettings: React.FC<{ supplierName: string; onClose: () => void }> = ({ supplierName, onClose }) => {
  const [products, setProducts] = useState<ProductWithLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    fetchProducts();
  }, [supplierName]);

  const fetchProducts = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/suppliers/products-by-supplier/${encodeURIComponent(supplierName)}`);
      const data = await res.json();
      if (data.success) {
        setProducts(data.products.map((p: ProductWithLot) => ({ ...p, is_modified: false })));
      }
    } catch (error) {
      console.error('商品取得エラー:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (productId: string, value: number | null) => {
    setProducts(prev => {
      const updated = prev.map(p => 
        p.product_id === productId 
          ? { ...p, order_lot: value, is_modified: true }
          : p
      );
      return updated;
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const modifiedProducts = products.filter(p => p.is_modified);
      const lots = modifiedProducts.map(p => ({
        product_id: p.product_id,
        order_lot: p.order_lot,
        min_order_quantity: p.order_lot, // 発注ロット = 最小発注数
        notes: null,
      }));

      const res = await fetch(`${API_BASE_URL}/api/suppliers/product-order-lots/bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lots }),
      });

      const data = await res.json();
      if (data.success) {
        await fetchProducts();
        setHasChanges(false);
        alert(`${modifiedProducts.length}件の発注ロット設定を保存しました`);
      } else {
        throw new Error(data.error);
      }
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500">
        商品データを読み込み中...
      </div>
    );
  }

  return (
    <div className="bg-gray-50 border-t border-gray-200">
      {/* ヘッダー */}
      <div className="p-4 bg-white border-b flex justify-between items-center">
        <span className="text-sm text-gray-600">
          「{supplierName}」の商品別発注ロット設定　{products.length}件の商品
        </span>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={!hasChanges || saving}
            className={`px-4 py-1.5 rounded text-sm font-medium ${
              hasChanges
                ? 'text-white hover:opacity-90'
                : 'bg-gray-300 text-gray-500 cursor-not-allowed'
            }`}
          >
            {saving ? '保存中...' : '保存'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded text-sm border hover:bg-gray-100"
          >
            閉じる
          </button>
        </div>
      </div>

      {/* 変更通知 */}
      {hasChanges && (
        <div className="mx-4 mt-4 p-2 bg-yellow-50 border border-yellow-200 rounded text-yellow-800 text-sm">
          {products.filter(p => p.is_modified).length}件の変更があります
        </div>
      )}

      {/* 商品テーブル - シンプル化 */}
      <div className="p-4">
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-[#0D4F4F] to-[#1A365D] text-white">
                <th className="px-4 py-3 text-left font-semibold">商品名</th>
                <th className="px-4 py-3 text-left font-semibold">ブランド</th>
                <th className="px-4 py-3 text-left font-semibold">カテゴリ</th>
                <th className="px-4 py-3 text-right font-semibold">売価</th>
                <th className="px-4 py-3 text-right font-semibold">原価</th>
                <th className="px-4 py-3 text-center font-semibold">発注ロット</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product, index) => (
                <tr
                  key={product.product_id}
                  className={`border-t ${
                    product.is_modified
                      ? 'bg-yellow-50'
                      : index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                  } hover:bg-[#0D4F4F]/5`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium">{product.product_name}</div>
                    <div className="text-xs text-gray-400">{product.product_id}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{product.brand_name || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{product.category_name || '-'}</td>
                  <td className="px-4 py-3 text-right">¥{product.price?.toLocaleString() || '-'}</td>
                  <td className="px-4 py-3 text-right">¥{product.cost?.toLocaleString() || '-'}</td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      min="1"
                      value={product.order_lot || ''}
                      onChange={(e) => handleChange(product.product_id, e.target.value ? parseInt(e.target.value) : null)}
                      className="w-20 border border-gray-300 rounded px-3 py-1.5 text-center focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                      placeholder="1"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-sm text-gray-500">
          {products.length} 件の商品
        </div>
      </div>
    </div>
  );
};

const SupplierSettingsTable: React.FC = () => {
  const [suppliers, setSuppliers] = useState<SupplierSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showUnconfiguredOnly, setShowUnconfiguredOnly] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [expandedSupplier, setExpandedSupplier] = useState<string | null>(null);

  useEffect(() => {
    fetchSuppliers();
  }, []);

  const fetchSuppliers = async () => {
    try {
      const smaregiRes = await fetch(`${API_BASE_URL}/api/suppliers/smaregi-suppliers/list`);
      const smaregiData = await smaregiRes.json();
      
      const settingsRes = await fetch(`${API_BASE_URL}/api/suppliers/settings`);
      const settingsData = await settingsRes.json();
      
      const settingsMap = new Map(
        settingsData.suppliers?.map((s: any) => [s.supplier_code, s]) || []
      );
      
      const merged = smaregiData.smaregiSuppliers?.map((name: string) => {
        const existing = settingsMap.get(name) as SupplierSetting | undefined;
        return {
          id: existing?.id,
          supplier_code: name,
          supplier_name: name,
          company_name: existing?.company_name || '',
          contact_person: existing?.contact_person || '',
          phone: existing?.phone || '',
          email: existing?.email || '',
          lead_time_days: existing?.lead_time_days ?? 3,
          min_order_amount: existing?.min_order_amount ?? 0,
          free_shipping_amount: existing?.free_shipping_amount ?? null,
          shipping_fee: existing?.shipping_fee ?? 0,
          order_method: existing?.order_method || 'manual',
          is_modified: false,
        };
      }) || [];
      
      setSuppliers(merged);
    } catch (error) {
      console.error('取得エラー:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (supplierCode: string, field: keyof SupplierSetting, value: any) => {
    setSuppliers(prev => {
      return prev.map(supplier => {
        if (supplier.supplier_code === supplierCode) {
          return { ...supplier, [field]: value, is_modified: true };
        }
        return supplier;
      });
    });
    setHasChanges(true);
  };

  const handleSaveAll = async () => {
    setSaving(true);
    try {
      const modifiedSuppliers = suppliers.filter(s => s.is_modified);
      
      for (const supplier of modifiedSuppliers) {
        const url = supplier.id 
          ? `${API_BASE_URL}/api/suppliers/settings/${supplier.id}`
          : `${API_BASE_URL}/api/suppliers/settings`;
        
        await fetch(url, {
          method: supplier.id ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            supplier_code: supplier.supplier_code,
            supplier_name: supplier.supplier_name,
            company_name: supplier.company_name,
            contact_person: supplier.contact_person,
            phone: supplier.phone,
            email: supplier.email,
            lead_time_days: supplier.lead_time_days,
            min_order_amount: supplier.min_order_amount,
            free_shipping_amount: supplier.free_shipping_amount,
            shipping_fee: supplier.shipping_fee,
            order_method: supplier.order_method,
          }),
        });
      }
      
      await fetchSuppliers();
      setHasChanges(false);
      alert(`${modifiedSuppliers.length}件の仕入先設定を保存しました`);
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const filteredSuppliers = suppliers.filter(s => {
    const matchesSearch = s.supplier_name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = !showUnconfiguredOnly || !s.id;
    return matchesSearch && matchesFilter;
  });

  if (loading) {
    return <div className="p-4">読み込み中...</div>;
  }

  return (
    <div>
      {/* フィルター */}
      <div className="mb-4 flex items-center gap-4">
        <input
          type="text"
          placeholder="仕入先名で検索..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-2 w-64"
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showUnconfiguredOnly}
            onChange={(e) => setShowUnconfiguredOnly(e.target.checked)}
            className="rounded"
          />
          未設定のみ表示
        </label>
        <div className="flex-1" />
        <button
          onClick={handleSaveAll}
          disabled={!hasChanges || saving}
          className={`px-6 py-2 rounded-lg font-medium ${
            hasChanges 
              ? 'text-white hover:opacity-90' 
              : 'bg-gray-200 text-gray-500 cursor-not-allowed'
          }`}
        >
          {saving ? '保存中...' : '一括保存'}
        </button>
      </div>

      {/* 変更通知 */}
      {hasChanges && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
          {suppliers.filter(s => s.is_modified).length}件の変更があります。保存ボタンをクリックして変更を保存してください。
        </div>
      )}

      {/* テーブル */}
      <div className="border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gradient-to-r from-[#0D4F4F] to-[#1A365D] text-white text-sm">
              <th className="px-2 py-2 text-left font-semibold w-8"></th>
              <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">仕入先名</th>
              <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">会社名</th>
              <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">担当者</th>
              <th className="px-2 py-2 text-left font-semibold whitespace-nowrap">メール</th>
              <th className="px-2 py-2 text-center font-semibold whitespace-nowrap">リードタイム</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">最低発注金額</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">送料無料金額</th>
              <th className="px-2 py-2 text-right font-semibold whitespace-nowrap">送料</th>
              <th className="px-2 py-2 text-center font-semibold whitespace-nowrap">発注方法</th>
            </tr>
          </thead>
          <tbody>
            {filteredSuppliers.map((supplier, index) => (
              <React.Fragment key={supplier.supplier_code}>
                <tr
                  className={`border-t ${
                    supplier.is_modified
                      ? 'bg-yellow-50'
                      : index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                  } hover:bg-[#0D4F4F]/5`}
                >
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setExpandedSupplier(
                        expandedSupplier === supplier.supplier_code ? null : supplier.supplier_code
                      )}
                      className="text-gray-400 hover:text-gray-600"
                      title="商品別発注ロット設定"
                    >
                      {expandedSupplier === supplier.supplier_code ? '▼' : '▶'}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium">{supplier.supplier_name}</div>
                    {!supplier.id && (
                      <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">未設定</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={supplier.company_name}
                      onChange={(e) => handleChange(supplier.supplier_code, 'company_name', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      placeholder="発注書の宛名"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={supplier.contact_person}
                      onChange={(e) => handleChange(supplier.supplier_code, 'contact_person', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      placeholder="-"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="email"
                      value={supplier.email}
                      onChange={(e) => handleChange(supplier.supplier_code, 'email', e.target.value)}
                      className="w-full border border-gray-300 rounded px-2 py-1 text-sm"
                      placeholder="-"
                    />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <input
                        type="number"
                        min="0"
                        value={supplier.lead_time_days}
                        onChange={(e) => handleChange(supplier.supplier_code, 'lead_time_days', parseInt(e.target.value) || 0)}
                        className="w-12 border border-gray-300 rounded px-2 py-1 text-sm text-center"
                      />
                      <span className="text-gray-500">日</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-gray-500">¥</span>
                      <input
                        type="number"
                        min="0"
                        value={supplier.min_order_amount}
                        onChange={(e) => handleChange(supplier.supplier_code, 'min_order_amount', parseInt(e.target.value) || 0)}
                        className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-gray-500">¥</span>
                      <input
                        type="number"
                        min="0"
                        value={supplier.free_shipping_amount || ''}
                        onChange={(e) => handleChange(supplier.supplier_code, 'free_shipping_amount', e.target.value ? parseInt(e.target.value) : null)}
                        className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                        placeholder="-"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <span className="text-gray-500">¥</span>
                      <input
                        type="number"
                        min="0"
                        value={supplier.shipping_fee}
                        onChange={(e) => handleChange(supplier.supplier_code, 'shipping_fee', parseInt(e.target.value) || 0)}
                        className="w-16 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <select
                      value={supplier.order_method}
                      onChange={(e) => handleChange(supplier.supplier_code, 'order_method', e.target.value)}
                      className="border border-gray-300 rounded px-2 py-1 text-sm"
                    >
                      <option value="manual">手動</option>
                      <option value="email">メール</option>
                    </select>
                  </td>
                </tr>
                {/* 商品別発注ロット設定（展開時） */}
                {expandedSupplier === supplier.supplier_code && (
                  <tr>
                    <td colSpan={10} className="p-0">
                      <ProductLotSettings
                        supplierName={supplier.supplier_name}
                        onClose={() => setExpandedSupplier(null)}
                      />
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-sm text-gray-500">
        {filteredSuppliers.length} / {suppliers.length} 件表示　
        ※ 仕入先名の左にある▶をクリックすると、商品別の発注ロット設定ができます
      </div>
    </div>
  );
};

// メール設定コンポーネント
const EmailSettingsForm: React.FC = () => {
  const [settings, setSettings] = useState<EmailSettings>({
    smtp_host: '',
    smtp_port: '587',
    smtp_user: '',
    smtp_pass: '',
    smtp_from: '',
    smtp_from_name: 'FOOD&COMPANY',
  });
  const [templates, setTemplates] = useState<EmailTemplates>({
    subject: '',
    body: '',
  });
  const [defaultTemplates, setDefaultTemplates] = useState<EmailTemplates>({
    subject: '',
    body: '',
  });
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [savingStores, setSavingStores] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [hasTemplateChanges, setHasTemplateChanges] = useState(false);
  const [hasStoreChanges, setHasStoreChanges] = useState(false);
  const [activeSection, setActiveSection] = useState<'smtp' | 'template' | 'stores' | 'pdf-preview'>('smtp');

  useEffect(() => {
    fetchSettings();
    fetchTemplates();
    fetchStores();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/email`);
      const data = await res.json();
      if (data.success) {
        setSettings({
          smtp_host: data.settings.smtp_host || '',
          smtp_port: data.settings.smtp_port || '587',
          smtp_user: data.settings.smtp_user || '',
          smtp_pass: data.settings.smtp_pass || '',
          smtp_from: data.settings.smtp_from || '',
          smtp_from_name: data.settings.smtp_from_name || 'FOOD&COMPANY',
        });
        setIsConfigured(data.isConfigured);
      }
    } catch (error) {
      console.error('メール設定取得エラー:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchTemplates = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/email/template`);
      const data = await res.json();
      if (data.success) {
        setTemplates({
          subject: data.templates.subject || '',
          body: data.templates.body || '',
        });
        setDefaultTemplates({
          subject: data.defaultTemplates.subject || '',
          body: data.defaultTemplates.body || '',
        });
      }
    } catch (error) {
      console.error('メールテンプレート取得エラー:', error);
    }
  };

  const fetchStores = async () => {
    try {
      // スマレジから店舗一覧を取得
      const storesRes = await fetch(`${API_BASE_URL}/api/stores`);
      const storesData = await storesRes.json();
      
      // 店舗設定を取得
      const settingsRes = await fetch(`${API_BASE_URL}/api/settings/stores`);
      const settingsData = await settingsRes.json();
      
      // 設定をマップ化（store_nameで検索）
      const settingsMap = new Map(
        (settingsData.stores || []).map((s: StoreInfo) => [s.store_name, s])
      );
      
      // スマレジの店舗データと設定をマージ
      const smaregiStores = storesData.data || storesData.stores || [];
      const mergedStores = smaregiStores.map((store: any) => {
        const settings = settingsMap.get(store.storeName) || {};
        return {
          store_id: store.storeId,
          store_name: store.storeName,
          postal_code: (settings as any).postal_code || '',
          address: (settings as any).address || '',
          phone: (settings as any).phone || '',
          contact_person: (settings as any).contact_person || '',
          is_modified: false,
        };
      });
      
      setStores(mergedStores);
    } catch (error) {
      console.error('店舗情報取得エラー:', error);
    }
  };

  const handleChange = (field: keyof EmailSettings, value: string) => {
    setSettings(prev => ({ ...prev, [field]: value }));
    setHasChanges(true);
  };

  const handleTemplateChange = (field: keyof EmailTemplates, value: string) => {
    setTemplates(prev => ({ ...prev, [field]: value }));
    setHasTemplateChanges(true);
  };

  const handleStoreChange = (index: number, field: keyof StoreInfo, value: string) => {
    setStores(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value, is_modified: true };
      return updated;
    });
    setHasStoreChanges(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      const data = await res.json();
      if (data.success) {
        alert('メール設定を保存しました');
        setHasChanges(false);
        await fetchSettings();
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error('保存エラー:', error);
      alert(`保存に失敗しました: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTemplate = async () => {
    setSavingTemplate(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/email/template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(templates),
      });
      const data = await res.json();
      if (data.success) {
        alert('メールテンプレートを保存しました');
        setHasTemplateChanges(false);
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error('テンプレート保存エラー:', error);
      alert(`保存に失敗しました: ${error.message}`);
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSaveStores = async () => {
    setSavingStores(true);
    try {
      const modifiedStores = stores.filter(s => s.is_modified);
      const res = await fetch(`${API_BASE_URL}/api/settings/stores`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stores: modifiedStores }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`${modifiedStores.length}件の店舗情報を保存しました`);
        setHasStoreChanges(false);
        await fetchStores();
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error('店舗情報保存エラー:', error);
      alert(`保存に失敗しました: ${error.message}`);
    } finally {
      setSavingStores(false);
    }
  };

  const handleResetTemplate = () => {
    if (confirm('テンプレートをデフォルトに戻しますか？')) {
      setTemplates(defaultTemplates);
      setHasTemplateChanges(true);
    }
  };

  const handleTestEmail = async () => {
    if (!testEmail) {
      alert('テスト送信先のメールアドレスを入力してください');
      return;
    }
    
    setTesting(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/settings/email/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: testEmail }),
      });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
      } else {
        throw new Error(data.error);
      }
    } catch (error: any) {
      console.error('テストメール送信エラー:', error);
      alert(`テストメール送信に失敗しました: ${error.message}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <div className="p-4">読み込み中...</div>;
  }

  return (
    <div className="max-w-4xl">
      {/* ステータス表示 */}
      <div className={`mb-6 p-4 rounded-lg ${isConfigured ? 'bg-green-50 border border-green-200' : 'bg-yellow-50 border border-yellow-200'}`}>
        <div className="flex items-center gap-2">
          {isConfigured ? (
            <>
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-green-800 font-medium">メール設定済み</span>
            </>
          ) : (
            <>
              <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-yellow-800 font-medium">メール設定が必要です</span>
            </>
          )}
        </div>
        <p className="mt-1 text-sm text-gray-600">
          {isConfigured 
            ? '発注書をメールで送信できます。'
            : 'メールで発注書を送信するには、SMTP設定を行ってください。'}
        </p>
      </div>

      {/* セクション切り替えタブ */}
      <div className="flex gap-1 mb-4 border-b">
        <button
          onClick={() => setActiveSection('smtp')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeSection === 'smtp'
              ? 'border-[#0D4F4F] text-[#0D4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          SMTP設定
        </button>
        <button
          onClick={() => setActiveSection('template')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeSection === 'template'
              ? 'border-[#0D4F4F] text-[#0D4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          メールテンプレート
        </button>
        <button
          onClick={() => setActiveSection('stores')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeSection === 'stores'
              ? 'border-[#0D4F4F] text-[#0D4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          店舗情報
        </button>
        <button
          onClick={() => setActiveSection('pdf-preview')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeSection === 'pdf-preview'
              ? 'border-[#0D4F4F] text-[#0D4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          発注書プレビュー
        </button>
      </div>

      {/* SMTP設定セクション */}
      {activeSection === 'smtp' && (
        <>
          {/* 設定フォーム */}
          <div className="bg-white rounded-lg shadow border p-6">
            <h3 className="text-lg font-semibold mb-4">SMTP設定</h3>
            
            <div className="space-y-4">
              {/* SMTPホスト */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  SMTPホスト <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={settings.smtp_host}
                  onChange={(e) => handleChange('smtp_host', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                  placeholder="例: smtp.gmail.com"
                />
                <p className="mt-1 text-xs text-gray-500">
                  Gmail: smtp.gmail.com / Outlook: smtp.office365.com / Yahoo: smtp.mail.yahoo.co.jp
                </p>
              </div>

              {/* SMTPポート */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  SMTPポート <span className="text-red-500">*</span>
                </label>
                <select
                  value={settings.smtp_port}
                  onChange={(e) => handleChange('smtp_port', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                >
                  <option value="587">587 (TLS/STARTTLS - 推奨)</option>
                  <option value="465">465 (SSL)</option>
                  <option value="25">25 (非暗号化 - 非推奨)</option>
                </select>
              </div>

              {/* SMTPユーザー */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  SMTPユーザー名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  value={settings.smtp_user}
                  onChange={(e) => handleChange('smtp_user', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                  placeholder="例: your-email@gmail.com"
                />
                <p className="mt-1 text-xs text-gray-500">
                  通常はメールアドレスを入力します
                </p>
              </div>

              {/* SMTPパスワード */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  SMTPパスワード <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={settings.smtp_pass}
                  onChange={(e) => handleChange('smtp_pass', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                  placeholder={settings.smtp_pass === '********' ? '変更する場合のみ入力' : 'パスワードを入力'}
                />
                <p className="mt-1 text-xs text-gray-500">
                  Gmailの場合は「アプリパスワード」を使用してください
                </p>
              </div>

              <hr className="my-4" />

              <h3 className="text-lg font-semibold mb-4">送信元設定</h3>

              {/* 送信元メールアドレス */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  送信元メールアドレス
                </label>
                <input
                  type="email"
                  value={settings.smtp_from}
                  onChange={(e) => handleChange('smtp_from', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                  placeholder="空欄の場合はSMTPユーザー名を使用"
                />
              </div>

              {/* 送信元表示名 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  送信元の表示名
                </label>
                <input
                  type="text"
                  value={settings.smtp_from_name}
                  onChange={(e) => handleChange('smtp_from_name', e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                  placeholder="FOOD&COMPANY"
                />
              </div>
            </div>

            {/* 保存ボタン */}
            <div className="mt-6 flex justify-end">
              <button
                onClick={handleSave}
                disabled={!hasChanges || saving}
                className={`px-6 py-2 rounded-lg font-medium ${
                  hasChanges 
                    ? 'text-white hover:opacity-90' 
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              >
                {saving ? '保存中...' : '設定を保存'}
              </button>
            </div>
          </div>

          {/* テストメール送信 */}
          <div className="mt-6 bg-white rounded-lg shadow border p-6">
            <h3 className="text-lg font-semibold mb-4">テストメール送信</h3>
            <p className="text-sm text-gray-600 mb-4">
              設定が正しいか確認するために、テストメールを送信できます。
            </p>
            
            <div className="flex gap-3">
              <input
                type="email"
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                placeholder="テスト送信先メールアドレス"
              />
              <button
                onClick={handleTestEmail}
                disabled={testing || !isConfigured}
                className={`px-6 py-2 rounded-lg font-medium ${
                  isConfigured
                    ? 'bg-green-500 text-white hover:bg-green-600'
                    : 'bg-gray-200 text-gray-500 cursor-not-allowed'
                }`}
              >
                {testing ? '送信中...' : 'テスト送信'}
              </button>
            </div>
            {!isConfigured && (
              <p className="mt-2 text-sm text-yellow-600">
                テストメールを送信するには、まずSMTP設定を保存してください。
              </p>
            )}
          </div>

          {/* ヘルプ */}
          <div className="mt-6 bg-gray-50 rounded-lg p-4">
            <h4 className="font-medium text-gray-700 mb-2">Gmailを使用する場合</h4>
            <ol className="text-sm text-gray-600 space-y-1 list-decimal list-inside">
              <li>Googleアカウントで2段階認証を有効にする</li>
              <li>Googleアカウント設定 → セキュリティ → アプリパスワードを生成</li>
              <li>生成された16桁のパスワードをSMTPパスワードに入力</li>
            </ol>
          </div>
        </>
      )}

      {/* メールテンプレートセクション */}
      {activeSection === 'template' && (
        <div className="bg-white rounded-lg shadow border p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">メールテンプレート</h3>
            <button
              onClick={handleResetTemplate}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              デフォルトに戻す
            </button>
          </div>
          
          <p className="text-sm text-gray-600 mb-4">
            発注メールの件名と本文をカスタマイズできます。以下の変数が使用できます：
          </p>
          
          {/* 変数一覧 */}
          <div className="mb-6 p-4 bg-gray-50 rounded-lg">
            <h4 className="text-sm font-medium text-gray-700 mb-2">使用可能な変数</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><code className="bg-gray-200 px-1 rounded">{'{{store_name}}'}</code> - 店舗名</div>
              <div><code className="bg-gray-200 px-1 rounded">{'{{supplier_name}}'}</code> - 仕入先名</div>
              <div><code className="bg-gray-200 px-1 rounded">{'{{company_name}}'}</code> - 会社名（発注書の宛名）</div>
              <div><code className="bg-gray-200 px-1 rounded">{'{{order_number}}'}</code> - 発注番号</div>
              <div><code className="bg-gray-200 px-1 rounded">{'{{order_date}}'}</code> - 発注日</div>
              <div><code className="bg-gray-200 px-1 rounded">{'{{expected_arrival}}'}</code> - 届け予定日</div>
              <div><code className="bg-gray-200 px-1 rounded">{'{{item_count}}'}</code> - 商品数</div>
              <div><code className="bg-gray-200 px-1 rounded">{'{{total_amount}}'}</code> - 合計金額</div>
              <div><code className="bg-gray-200 px-1 rounded">{'{{store_postal_code}}'}</code> - 郵便番号</div>
              <div><code className="bg-gray-200 px-1 rounded">{'{{store_address}}'}</code> - 配送先住所</div>
              <div><code className="bg-gray-200 px-1 rounded">{'{{store_phone}}'}</code> - 店舗電話番号</div>
              <div><code className="bg-gray-200 px-1 rounded">{'{{store_contact}}'}</code> - 店舗担当者</div>
            </div>
          </div>

          <div className="space-y-4">
            {/* 件名 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                件名
              </label>
              <input
                type="text"
                value={templates.subject}
                onChange={(e) => handleTemplateChange('subject', e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                placeholder="【発注書】{{store_name}} → {{supplier_name}}（{{order_number}}）"
              />
            </div>

            {/* 本文 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                本文
              </label>
              <textarea
                value={templates.body}
                onChange={(e) => handleTemplateChange('body', e.target.value)}
                rows={18}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F] font-mono text-sm"
                placeholder="メール本文を入力..."
              />
            </div>
          </div>

          {/* 保存ボタン */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSaveTemplate}
              disabled={!hasTemplateChanges || savingTemplate}
              className={`px-6 py-2 rounded-lg font-medium ${
                hasTemplateChanges 
                  ? 'text-white hover:opacity-90 bg-gradient-to-r from-[#0D4F4F] to-[#1A365D]' 
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              }`}
            >
              {savingTemplate ? '保存中...' : 'テンプレートを保存'}
            </button>
          </div>
        </div>
      )}

      {/* 店舗情報セクション */}
      {activeSection === 'stores' && (
        <div className="bg-white rounded-lg shadow border p-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-semibold">店舗情報（配送先）</h3>
            <button
              onClick={handleSaveStores}
              disabled={!hasStoreChanges || savingStores}
              className={`px-6 py-2 rounded-lg font-medium ${
                hasStoreChanges 
                  ? 'text-white hover:opacity-90' 
                  : 'bg-gray-200 text-gray-500 cursor-not-allowed'
              }`}
            >
              {savingStores ? '保存中...' : '店舗情報を保存'}
            </button>
          </div>
          
          <p className="text-sm text-gray-600 mb-4">
            各店舗の配送先情報を設定します。この情報は発注メールと発注書PDFに記載されます。
          </p>

          {/* 変更通知 */}
          {hasStoreChanges && (
            <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 text-sm">
              {stores.filter(s => s.is_modified).length}件の変更があります。保存ボタンをクリックして変更を保存してください。
            </div>
          )}

          {stores.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              店舗情報がありません。スマレジから店舗データを同期してください。
            </div>
          ) : (
            <div className="space-y-6">
              {stores.map((store, index) => (
                <div 
                  key={store.store_id} 
                  className={`border rounded-lg p-4 ${store.is_modified ? 'bg-yellow-50 border-yellow-300' : 'bg-gray-50'}`}
                >
                  <div className="flex items-center gap-2 mb-4">
                    <span className="text-lg font-semibold">{store.store_name}</span>
                    <span className="text-sm text-gray-500">（ID: {store.store_id}）</span>
                    {store.is_modified && (
                      <span className="text-xs bg-yellow-200 text-yellow-800 px-2 py-0.5 rounded">変更あり</span>
                    )}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    {/* 郵便番号 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        郵便番号
                      </label>
                      <input
                        type="text"
                        value={store.postal_code || ''}
                        onChange={(e) => handleStoreChange(index, 'postal_code', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                        placeholder="例: 150-0001"
                      />
                    </div>

                    {/* 電話番号 */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        電話番号
                      </label>
                      <input
                        type="text"
                        value={store.phone || ''}
                        onChange={(e) => handleStoreChange(index, 'phone', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                        placeholder="例: 03-1234-5678"
                      />
                    </div>

                    {/* 住所 */}
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        配送先住所
                      </label>
                      <input
                        type="text"
                        value={store.address || ''}
                        onChange={(e) => handleStoreChange(index, 'address', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                        placeholder="例: 東京都渋谷区神宮前1-2-3 ○○ビル1F"
                      />
                    </div>

                    {/* 担当者 */}
                    <div className="col-span-2">
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        担当者名
                      </label>
                      <input
                        type="text"
                        value={store.contact_person || ''}
                        onChange={(e) => handleStoreChange(index, 'contact_person', e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                        placeholder="例: 山田太郎"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 発注書プレビューセクション */}
      {activeSection === 'pdf-preview' && (
        <div className="bg-white rounded-lg shadow border p-6">
          <h3 className="text-lg font-semibold mb-4">発注書プレビュー</h3>
          <p className="text-sm text-gray-600 mb-4">
            現在の発注書PDFのフォーマットをサンプルデータで確認できます。
          </p>
          <div className="border rounded-lg overflow-hidden" style={{ height: '800px' }}>
            <iframe
              src={`${import.meta.env.VITE_API_URL || 'https://fc-demand-forecast-production.up.railway.app'}/api/orders/pdf-preview`}
              className="w-full h-full"
              title="発注書プレビュー"
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            ※ これはサンプルデータを使用したプレビューです。実際の発注書は、発注時のデータで生成されます。
          </p>
        </div>
      )}
    </div>
  );
};

// 発注グループ設定コンポーネント
interface OrderGroup {
  id: number;
  name: string;
  description: string | null;
  order_group_suppliers: { id: number; supplier_name: string }[];
}

const OrderGroupSettings: React.FC = () => {
  const [groups, setGroups] = useState<OrderGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<OrderGroup | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '', suppliers: [] as string[] });
  const [availableSuppliers, setAvailableSuppliers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');

  // 検索フィルター
  const filteredSuppliers = availableSuppliers.filter(s =>
    s.toLowerCase().includes(supplierSearch.toLowerCase())
  );

  // 3列に分割
  const columns = 3;
  const itemsPerColumn = Math.ceil(filteredSuppliers.length / columns);
  const supplierColumns = Array.from({ length: columns }, (_, i) =>
    filteredSuppliers.slice(i * itemsPerColumn, (i + 1) * itemsPerColumn)
  );

  useEffect(() => {
    fetchGroups();
    fetchSuppliers();
  }, []);

  const fetchGroups = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/order-groups`);
      const data = await res.json();
      setGroups(data);
    } catch (error) {
      console.error('発注グループ取得エラー:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSuppliers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/suppliers/smaregi-suppliers/list`);
      const data = await res.json();
      setAvailableSuppliers(data.smaregiSuppliers || []);
    } catch (error) {
      console.error('仕入先取得エラー:', error);
    }
  };

  const openCreateModal = () => {
    setEditingGroup(null);
    setFormData({ name: '', description: '', suppliers: [] });
    setSupplierSearch('');
    setShowModal(true);
  };

  const openEditModal = (group: OrderGroup) => {
    setEditingGroup(group);
    setFormData({
      name: group.name,
      description: group.description || '',
      suppliers: group.order_group_suppliers.map(s => s.supplier_name),
    });
    setSupplierSearch('');
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert('グループ名を入力してください');
      return;
    }
    if (formData.suppliers.length === 0) {
      alert('少なくとも1つの仕入先を選択してください');
      return;
    }

    setSaving(true);
    try {
      const url = editingGroup
        ? `${API_BASE_URL}/api/order-groups/${editingGroup.id}`
        : `${API_BASE_URL}/api/order-groups`;
      const method = editingGroup ? 'PUT' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (!res.ok) throw new Error('保存に失敗しました');

      await fetchGroups();
      setShowModal(false);
    } catch (error) {
      console.error('保存エラー:', error);
      alert('保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('この発注グループを削除しますか？')) return;

    try {
      const res = await fetch(`${API_BASE_URL}/api/order-groups/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('削除に失敗しました');
      await fetchGroups();
    } catch (error) {
      console.error('削除エラー:', error);
      alert('削除に失敗しました');
    }
  };

  const toggleSupplier = (supplierName: string) => {
    setFormData(prev => ({
      ...prev,
      suppliers: prev.suppliers.includes(supplierName)
        ? prev.suppliers.filter(s => s !== supplierName)
        : [...prev.suppliers, supplierName],
    }));
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-6">
        <p className="text-gray-500">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-lg font-semibold">発注グループ設定</h2>
          <p className="text-sm text-gray-500 mt-1">
            複数の仕入先をグループ化して、需要予測時にまとめて選択できます。
          </p>
        </div>
        <button
          onClick={openCreateModal}
          className="text-white px-4 py-2 rounded-lg hover:opacity-90 flex items-center gap-2"
          style={{ background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' }}
        >
          <span>+</span> 新規グループ作成
        </button>
      </div>

      {groups.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          <p>発注グループがまだありません。</p>
          <p className="text-sm mt-2">「新規グループ作成」から作成してください。</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map(group => (
            <div key={group.id} className="border rounded-lg p-4 hover:bg-gray-50">
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="font-semibold text-lg">{group.name}</h3>
                  {group.description && (
                    <p className="text-sm text-gray-500 mt-1">{group.description}</p>
                  )}
                  <div className="flex flex-wrap gap-2 mt-3">
                    {group.order_group_suppliers.map(s => (
                      <span
                        key={s.id}
                        className="bg-[#0D4F4F]/10 text-[#0D4F4F] text-xs px-2 py-1 rounded"
                      >
                        {s.supplier_name}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEditModal(group)}
                    className="text-[#0D4F4F] hover:text-[#0A3D3D] text-sm"
                  >
                    編集
                  </button>
                  <button
                    onClick={() => handleDelete(group.id)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    削除
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* モーダル */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold">
                {editingGroup ? '発注グループを編集' : '新規発注グループ作成'}
              </h3>
            </div>

            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  グループ名 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                  placeholder="例: 毎日発注グループ"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  説明
                </label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:border-[#0D4F4F] focus:ring-1 focus:ring-[#0D4F4F]"
                  rows={2}
                  placeholder="例: 毎日発注する仕入先のグループ"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-medium text-gray-700">
                    仕入先を選択 <span className="text-red-500">*</span>
                    <span className="text-gray-400 font-normal ml-2">
                      ({formData.suppliers.length}件選択中)
                    </span>
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, suppliers: [...availableSuppliers] }))}
                      className="px-3 py-1 text-sm text-[#0D4F4F] hover:bg-gray-100 rounded"
                    >
                      全て選択
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData(prev => ({ ...prev, suppliers: [] }))}
                      className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
                    >
                      クリア
                    </button>
                  </div>
                </div>
                
                {/* 検索 */}
                <div className="mb-3">
                  <input
                    type="text"
                    placeholder="🔍 仕入先を検索..."
                    value={supplierSearch}
                    onChange={(e) => setSupplierSearch(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0D4F4F]"
                  />
                </div>
                
                {/* 3列表示 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-h-60 overflow-y-auto border-2 border-gray-300 rounded-lg p-4 bg-white">
                  {supplierColumns.map((column, colIndex) => (
                    <div key={colIndex} className="space-y-1">
                      {column.map((supplier) => (
                        <label
                          key={supplier}
                          className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={formData.suppliers.includes(supplier)}
                            onChange={() => toggleSupplier(supplier)}
                            className="w-4 h-4 rounded focus:ring-[#0D4F4F] accent-[#2D9D9D]"
                          />
                          <span className="text-sm truncate">{supplier}</span>
                        </label>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="p-6 border-t flex justify-end gap-3">
              <button
                onClick={() => setShowModal(false)}
                className="px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                キャンセル
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-2 text-white rounded-lg hover:opacity-90 disabled:opacity-50"
                style={{ background: 'linear-gradient(90deg, #0D4F4F 0%, #1A365D 100%)' }}
              >
                {saving ? '保存中...' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const SettingsPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('suppliers');

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">設定</h1>

      {/* タブ */}
      <div className="flex gap-1 mb-6 border-b">
        <button
          onClick={() => setActiveTab('suppliers')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'suppliers'
              ? 'border-[#0D4F4F] text-[#0D4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          仕入先設定
        </button>
        <button
          onClick={() => setActiveTab('email')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'email'
              ? 'border-[#0D4F4F] text-[#0D4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          メール設定
        </button>
        <button
          onClick={() => setActiveTab('orderGroups')}
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            activeTab === 'orderGroups'
              ? 'border-[#0D4F4F] text-[#0D4F4F]'
              : 'border-transparent text-gray-500 hover:text-gray-700'
          }`}
        >
          発注グループ
        </button>

      </div>

      {/* コンテンツ */}
      {activeTab === 'suppliers' && <SupplierSettingsTable />}

      {activeTab === 'email' && <EmailSettingsForm />}

      {activeTab === 'orderGroups' && <OrderGroupSettings />}


    </div>
  );
};

export default SettingsPage;
