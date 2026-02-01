import { Router } from 'express';
import { smaregiClient } from '../services/smaregi/client';
import { testSupabaseConnection } from '../config/supabase';

const router = Router();

// ヘルスチェック
router.get('/', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// スマレジAPI接続テスト
router.get('/smaregi', async (req, res) => {
  try {
    const response = await smaregiClient.get('/stores');
    res.json({
      status: 'ok',
      message: 'スマレジAPI接続成功',
      storeCount: response.data.length,
      stores: response.data.map((s: any) => ({
        storeId: s.storeId,
        storeName: s.storeName,
      })),
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: 'スマレジAPI接続失敗',
      error: error.message,
    });
  }
});

// Supabase接続テスト
router.get('/supabase', async (req, res) => {
  const isConnected = await testSupabaseConnection();
  
  if (isConnected) {
    res.json({
      status: 'ok',
      message: 'Supabase接続成功',
    });
  } else {
    res.status(500).json({
      status: 'error',
      message: 'Supabase接続失敗',
    });
  }
});

export default router;
