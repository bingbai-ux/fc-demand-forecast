import { smaregiClient } from './client';
import { Category } from '../../types/smaregi';

export const getCategories = async (): Promise<Category[]> => {
  console.log('📁 カテゴリ一覧を取得中...');
  
  // ページネーション対応（最大1000件ずつ取得）
  let allCategories: Category[] = [];
  let page = 1;
  const limit = 1000;
  
  while (true) {
    const response = await smaregiClient.get('/categories', {
      params: {
        limit,
        page,
      },
    });
    
    const categories: Category[] = response.data.map((c: any) => ({
      categoryId: c.categoryId,
      categoryName: c.categoryName,
      categoryCode: c.categoryCode,
      level: c.level,
      parentCategoryId: c.parentCategoryId,
    }));
    
    allCategories = [...allCategories, ...categories];
    
    // 取得件数がlimit未満なら終了
    if (categories.length < limit) {
      break;
    }
    
    page++;
  }
  
  console.log(`✅ カテゴリ一覧取得完了: ${allCategories.length}件`);
  return allCategories;
};
