import { Router, Request, Response } from 'express';
import { supabase } from '../config/supabase';

const router = Router();

// 発注グループ一覧を取得
router.get('/', async (req: Request, res: Response) => {
  try {
    const { data: groups, error } = await supabase
      .from('order_groups')
      .select(`
        *,
        order_group_suppliers (
          id,
          supplier_name
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

    res.json(groups || []);
  } catch (error) {
    console.error('Error fetching order groups:', error);
    res.status(500).json({ error: 'Failed to fetch order groups' });
  }
});

// 発注グループを作成
router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, suppliers } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'グループ名は必須です' });
    }

    // グループを作成
    const { data: group, error: groupError } = await supabase
      .from('order_groups')
      .insert({ name, description })
      .select()
      .single();

    if (groupError) throw groupError;

    // 仕入先を追加
    if (suppliers && suppliers.length > 0) {
      const supplierRecords = suppliers.map((supplierName: string) => ({
        group_id: group.id,
        supplier_name: supplierName,
      }));

      const { error: suppliersError } = await supabase
        .from('order_group_suppliers')
        .insert(supplierRecords);

      if (suppliersError) throw suppliersError;
    }

    // 作成したグループを再取得（仕入先情報含む）
    const { data: createdGroup, error: fetchError } = await supabase
      .from('order_groups')
      .select(`
        *,
        order_group_suppliers (
          id,
          supplier_name
        )
      `)
      .eq('id', group.id)
      .single();

    if (fetchError) throw fetchError;

    res.status(201).json(createdGroup);
  } catch (error) {
    console.error('Error creating order group:', error);
    res.status(500).json({ error: 'Failed to create order group' });
  }
});

// 発注グループを更新
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, suppliers } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'グループ名は必須です' });
    }

    // グループを更新
    const { error: groupError } = await supabase
      .from('order_groups')
      .update({ name, description, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (groupError) throw groupError;

    // 既存の仕入先を削除
    const { error: deleteError } = await supabase
      .from('order_group_suppliers')
      .delete()
      .eq('group_id', id);

    if (deleteError) throw deleteError;

    // 新しい仕入先を追加
    if (suppliers && suppliers.length > 0) {
      const supplierRecords = suppliers.map((supplierName: string) => ({
        group_id: parseInt(id),
        supplier_name: supplierName,
      }));

      const { error: suppliersError } = await supabase
        .from('order_group_suppliers')
        .insert(supplierRecords);

      if (suppliersError) throw suppliersError;
    }

    // 更新したグループを再取得
    const { data: updatedGroup, error: fetchError } = await supabase
      .from('order_groups')
      .select(`
        *,
        order_group_suppliers (
          id,
          supplier_name
        )
      `)
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;

    res.json(updatedGroup);
  } catch (error) {
    console.error('Error updating order group:', error);
    res.status(500).json({ error: 'Failed to update order group' });
  }
});

// 発注グループを削除
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // 関連する仕入先も自動的に削除される（ON DELETE CASCADE）
    const { error } = await supabase
      .from('order_groups')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting order group:', error);
    res.status(500).json({ error: 'Failed to delete order group' });
  }
});

export default router;
