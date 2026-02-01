import { Router } from 'express';
import { getCategories } from '../services/smaregi/categories';

const router = Router();

// GET /api/categories - カテゴリ一覧取得
router.get('/', async (req, res) => {
  try {
    const categories = await getCategories();
    res.json({
      success: true,
      count: categories.length,
      data: categories,
    });
  } catch (error: any) {
    console.error('カテゴリ一覧取得エラー:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

export default router;
