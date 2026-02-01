import { Router } from 'express';
import { getTokenStatus, refreshAccessToken } from '../services/smaregi/auth';

const router = Router();

// 現在のトークン状態を確認
router.get('/token-status', async (req, res) => {
  try {
    const status = await getTokenStatus();
    
    res.json({
      success: true,
      ...status,
    });
  } catch (error: any) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// トークンを手動で更新
router.post('/refresh-token', async (req, res) => {
  try {
    await refreshAccessToken();
    const status = await getTokenStatus();
    
    res.json({ 
      success: true, 
      message: 'トークンを更新しました',
      ...status,
    });
  } catch (error: any) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

export default router;
