import { Router } from 'express';
import { supabase } from '../config/supabase';

const router = Router();

// GET /api/suppliers - 仕入先一覧を取得（売上・在庫管理用）
// products_cacheからユニークなsupplier_nameを取得
router.get('/', async (req, res) => {
  try {
    console.log('📦 仕入先一覧を取得中...');
    const startTime = Date.now();
    
    // products_cacheからユニークなsupplier_nameを取得（ページネーションで全件取得）
    const PAGE_SIZE = 1000;
    let allData: { supplier_name: string | null }[] = [];
    let from = 0;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('products_cache')
        .select('supplier_name')
        .not('supplier_name', 'is', null)
        .range(from, from + PAGE_SIZE - 1);
      
      if (error) {
        throw new Error(`仕入先取得エラー: ${error.message}`);
      }
      
      if (data && data.length > 0) {
        allData = allData.concat(data);
        from += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }
    
    // ユニークな仕入先リストを生成
    const supplierNames = allData
      .map((d: { supplier_name: string | null }) => d.supplier_name)
      .filter((name: string | null): name is string => !!name && name.trim() !== '');
    
    const uniqueSuppliers = [...new Set(supplierNames)].sort((a: string, b: string) => a.localeCompare(b, 'ja'));
    
    const duration = Date.now() - startTime;
    console.log(`✅ 仕入先一覧取得完了: ${uniqueSuppliers.length}件, ${duration}ms`);
    
    res.json({
      success: true,
      count: uniqueSuppliers.length,
      data: uniqueSuppliers,
    });
  } catch (error: any) {
    console.error('仕入先取得エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/suppliers/settings - 仕入先設定一覧を取得
router.get('/settings', async (req, res) => {
  try {
    const { is_active } = req.query;
    
    let query = supabase
      .from('suppliers')
      .select('*')
      .order('supplier_name');
    
    if (is_active !== undefined) {
      query = query.eq('is_active', is_active === 'true');
    }
    
    const { data, error } = await query;
    
    if (error) throw error;
    
    res.json({ success: true, suppliers: data || [] });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/suppliers/smaregi-suppliers/list - スマレジの仕入先名一覧を取得
router.get('/smaregi-suppliers/list', async (req, res) => {
  try {
    console.log('📦 スマレジ仕入先一覧を取得中...');
    const startTime = Date.now();
    
    // products_cacheからユニークなsupplier_nameを取得（ページネーションで全件取得）
    const PAGE_SIZE = 1000;
    let allData: { supplier_name: string | null }[] = [];
    let from = 0;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('products_cache')
        .select('supplier_name')
        .not('supplier_name', 'is', null)
        .range(from, from + PAGE_SIZE - 1);
      
      if (error) {
        throw new Error(`仕入先取得エラー: ${error.message}`);
      }
      
      if (data && data.length > 0) {
        allData = allData.concat(data);
        from += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }
    
    // ユニークな仕入先リストを生成
    const supplierNames = allData
      .map((d: { supplier_name: string | null }) => d.supplier_name)
      .filter((name: string | null): name is string => !!name && name.trim() !== '');
    
    const uniqueSuppliers = [...new Set(supplierNames)].sort((a: string, b: string) => a.localeCompare(b, 'ja'));
    
    const duration = Date.now() - startTime;
    console.log(`✅ スマレジ仕入先一覧取得完了: ${uniqueSuppliers.length}件, ${duration}ms`);
    
    res.json({
      success: true,
      smaregiSuppliers: uniqueSuppliers,
    });
  } catch (error: any) {
    console.error('スマレジ仕入先取得エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// GET /api/suppliers/settings/:id - 仕入先設定を1件取得
router.get('/settings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('suppliers')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, supplier: data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/suppliers/settings - 仕入先設定を作成
router.post('/settings', async (req, res) => {
  try {
    const {
      supplier_code,
      supplier_name,
      contact_person,
      phone,
      email,
      address,
      lead_time_days,
      min_order_amount,
      free_shipping_amount,
      shipping_fee,
      order_method,
      email_template,
      notes,
    } = req.body;
    
    const { data, error } = await supabase
      .from('suppliers')
      .insert({
        supplier_code,
        supplier_name,
        contact_person,
        phone,
        email,
        address,
        lead_time_days: lead_time_days || 3,
        min_order_amount: min_order_amount || 0,
        free_shipping_amount,
        shipping_fee: shipping_fee || 0,
        order_method: order_method || 'manual',
        email_template,
        notes,
      })
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, supplier: data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/suppliers/settings/:id - 仕入先設定を更新
router.put('/settings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body, updated_at: new Date().toISOString() };
    
    const { data, error } = await supabase
      .from('suppliers')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, supplier: data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/suppliers/settings/:id - 仕入先設定を削除（論理削除）
router.delete('/settings/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { data, error } = await supabase
      .from('suppliers')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    
    if (error) throw error;
    
    res.json({ success: true, supplier: data });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/suppliers/settings/bulk - 仕入先設定を一括保存
router.post('/settings/bulk', async (req, res) => {
  try {
    const { suppliers } = req.body;
    
    if (!Array.isArray(suppliers) || suppliers.length === 0) {
      return res.status(400).json({ success: false, error: '保存するデータがありません' });
    }
    
    const results = [];
    
    for (const supplier of suppliers) {
      const { id, ...updateData } = supplier;
      updateData.updated_at = new Date().toISOString();
      
      if (id) {
        // 更新
        const { data, error } = await supabase
          .from('suppliers')
          .update(updateData)
          .eq('id', id)
          .select()
          .single();
        
        if (error) throw error;
        results.push(data);
      } else {
        // 新規作成
        const { data, error } = await supabase
          .from('suppliers')
          .insert(updateData)
          .select()
          .single();
        
        if (error) throw error;
        results.push(data);
      }
    }
    
    res.json({ success: true, suppliers: results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/suppliers/products-by-supplier/:supplierName - 仕入先に紐づく商品一覧を取得
router.get('/products-by-supplier/:supplierName', async (req, res) => {
  try {
    const { supplierName } = req.params;
    const decodedSupplierName = decodeURIComponent(supplierName);
    
    console.log(`📦 仕入先「${decodedSupplierName}」の商品一覧を取得中...`);
    const startTime = Date.now();
    
    // products_cacheから該当仕入先の商品を取得
    const PAGE_SIZE = 1000;
    let allProducts: any[] = [];
    let from = 0;
    let hasMore = true;
    
    while (hasMore) {
      const { data, error } = await supabase
        .from('products_cache')
        .select('product_id, product_name, category_name, brand_name, price, cost')
        .eq('supplier_name', decodedSupplierName)
        .range(from, from + PAGE_SIZE - 1);
      
      if (error) {
        throw new Error(`商品取得エラー: ${error.message}`);
      }
      
      if (data && data.length > 0) {
        allProducts = allProducts.concat(data);
        from += PAGE_SIZE;
        hasMore = data.length === PAGE_SIZE;
      } else {
        hasMore = false;
      }
    }
    
    // product_order_lotsから発注ロット設定を取得
    const productIds = allProducts.map(p => p.product_id);
    const { data: lotSettings, error: lotError } = await supabase
      .from('product_order_lots')
      .select('*')
      .in('product_id', productIds);
    
    if (lotError) {
      console.error('発注ロット設定取得エラー:', lotError.message);
    }
    
    // 商品データとロット設定をマージ
    const lotSettingsMap = new Map((lotSettings || []).map(l => [l.product_id, l]));
    const productsWithLots = allProducts.map(product => ({
      ...product,
      order_lot: lotSettingsMap.get(product.product_id)?.lot_size || null,
      min_order_quantity: lotSettingsMap.get(product.product_id)?.min_quantity || null,
      lot_setting_id: lotSettingsMap.get(product.product_id)?.id || null,
    }));
    
    const duration = Date.now() - startTime;
    console.log(`✅ 商品一覧取得完了: ${productsWithLots.length}件, ${duration}ms`);
    
    res.json({
      success: true,
      supplierName: decodedSupplierName,
      count: productsWithLots.length,
      products: productsWithLots,
    });
  } catch (error: any) {
    console.error('商品取得エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// POST /api/suppliers/product-order-lots/bulk - 商品別発注ロット設定を一括保存
router.post('/product-order-lots/bulk', async (req, res) => {
  try {
    const { lots } = req.body;
    
    if (!Array.isArray(lots) || lots.length === 0) {
      return res.status(400).json({ success: false, error: '保存するデータがありません' });
    }
    
    console.log(`📦 発注ロット設定を一括保存中: ${lots.length}件`);
    const startTime = Date.now();
    
    const results = [];
    
    for (const lot of lots) {
      const { product_id, order_lot, min_order_quantity, notes } = lot;
      
      // upsert: product_idが存在すれば更新、なければ挿入
      const { data, error } = await supabase
        .from('product_order_lots')
        .upsert(
          {
            product_id,
            lot_size: order_lot || null,
            min_quantity: min_order_quantity || null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'product_id' }
        )
        .select()
        .single();
      
      if (error) {
        console.error(`発注ロット保存エラー (product_id: ${product_id}):`, error.message);
        // エラーがあっても続行
      } else {
        results.push(data);
      }
    }
    
    const duration = Date.now() - startTime;
    console.log(`✅ 発注ロット設定保存完了: ${results.length}件, ${duration}ms`);
    
    res.json({
      success: true,
      count: results.length,
      lots: results,
    });
  } catch (error: any) {
    console.error('発注ロット保存エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
