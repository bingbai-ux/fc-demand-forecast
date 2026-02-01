import { smaregiClient } from './client';
import { Store } from '../../types/smaregi';

export const getStores = async (): Promise<Store[]> => {
  console.log('📍 店舗一覧を取得中...');
  
  const response = await smaregiClient.get('/stores');
  
  const stores: Store[] = response.data.map((s: any) => ({
    storeId: s.storeId,
    storeName: s.storeName,
    storeCode: s.storeCode,
  }));
  
  console.log(`✅ 店舗一覧取得完了: ${stores.length}件`);
  return stores;
};
