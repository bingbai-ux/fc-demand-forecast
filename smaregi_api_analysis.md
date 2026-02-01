# スマレジAPI発注登録の調査結果

## 問題
代官山店で発注したのに、スマレジ側で新宿店が紐づいていた

## API仕様の確認

スマレジの発注登録APIには以下の店舗関連パラメータがある：

1. **orderSourceStoreId** - 発注元店舗ID：発注元となる店舗ID
2. **stores[].storageStoreId** - 配送店舗ID：入荷する店舗
3. **products[].deliveryStore[].storeId** - 商品ごとの配送先店舗ID

## 現在のコード
```javascript
const storeId = String(order.store_id || '1');  // ← ここが問題！

const requestBody = {
  orderSourceStoreId: storeId,  // 発注元店舗
  products: products.map(item => ({
    deliveryStore: [{ storeId: storeId, quantity: ... }]  // 配送先店舗
  })),
  stores: [{
    storageStoreId: storeId,  // 入荷店舗
    ...
  }]
};
```

## 問題の原因
`order.store_id` が `null` または `undefined` の場合、デフォルトで `'1'` が使われている。
店舗ID `'1'` が新宿店に該当している可能性が高い。

## 解決策
1. `order.store_id` が正しく保存されているか確認
2. デフォルト値 `'1'` を使わず、必ず正しい店舗IDを使用する
3. 店舗IDがない場合はエラーを返す
