import { smaregiClient } from './client';
import { Product, Category } from '../../types/smaregi';
import { getCategories } from './categories';

// 商品一覧を取得（ページネーション対応）
export const getProducts = async (): Promise<Product[]> => {
  console.log('📦 商品一覧を取得中...');
  
  let allProducts: Product[] = [];
  let page = 1;
  const limit = 1000;
  
  while (true) {
    const response = await smaregiClient.get('/products', {
      params: {
        limit,
        page,
      },
    });
    
    const products: Product[] = response.data.map((p: any) => ({
      productId: p.productId,
      productName: p.productName,
      productCode: p.productCode,
      categoryId: p.categoryId,
      tag: p.tag,               // ブランド名
      groupCode: p.groupCode,   // 仕入先
      price: p.price,
      cost: p.cost,
    }));
    
    allProducts = [...allProducts, ...products];
    
    console.log(`   取得中: ${allProducts.length}件...`);
    
    // 取得件数がlimit未満なら終了
    if (products.length < limit) {
      break;
    }
    
    page++;
  }
  
  console.log(`✅ 商品一覧取得完了: ${allProducts.length}件`);
  return allProducts;
};

// カテゴリ名付きの商品一覧を取得
export interface ProductWithCategory extends Product {
  categoryName: string;
}

export const getProductsWithCategory = async (): Promise<ProductWithCategory[]> => {
  console.log('📦 商品一覧（カテゴリ名付き）を取得中...');
  
  // 商品とカテゴリを並行取得
  const [products, categories] = await Promise.all([
    getProducts(),
    getCategories(),
  ]);
  
  // カテゴリIDをキーにしたMapを作成
  const categoryMap = new Map<string, string>();
  categories.forEach((c: Category) => {
    categoryMap.set(c.categoryId, c.categoryName);
  });
  
  // 商品にカテゴリ名を付与
  const productsWithCategory: ProductWithCategory[] = products.map((p) => ({
    ...p,
    categoryName: categoryMap.get(p.categoryId) || '不明',
  }));
  
  console.log(`✅ カテゴリ名付与完了: ${productsWithCategory.length}件`);
  return productsWithCategory;
};
