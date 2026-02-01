# 変更履歴

## 2026-01-30

### 修正: 需要予測ページの週次売上表示問題

**問題:**
- 需要予測ページで過去売上列（1/23, 1/24, 1/25...）がすべて「-」と表示されていた

**原因:**
1. バックエンドが `pastSales` を配列として直接返していた
2. フロントエンドは `pastSales.data` を参照していたため、データが取得できなかった
3. `pastSalesHeaders` の生成で日付文字列を `new Date()` で解析しようとしていた

**修正内容:**

1. **バックエンド (backend/src/routes/forecast.ts)**
   - `pastSales` のレスポンス形式を修正
   - 変更前: `pastSales: pastSalesData` (配列)
   - 変更後: `pastSales: { type: pastSalesType, data: pastSalesData }` (オブジェクト)

2. **フロントエンド (frontend/src/components/forecast/StepResult.tsx)**
   - `pastSalesHeaders` の生成ロジックを修正
   - `pastSalesDates` はすでに "1/22" 形式なので、そのまま使用するように変更

**確認:**
- 需要予測ページで日付ヘッダーと売上データが正しく表示されることを確認
- 複数の仕入先（渋谷CHEESE STAND、結わえる、山田製油など）でデータが表示されることを確認

---

## 環境設定

### Supabase接続情報
- URL: https://dwcezludkyvzyarifgbc.supabase.co
- 認証: service_role キーを使用

### バックエンドサーバー
- ポート: 3001
- 起動コマンド: `cd /home/ubuntu/fc-demand-forecast/backend && PORT=3001 node dist/index.js`

### フロントエンドサーバー
- ポート: 5173
- 起動コマンド: `cd /home/ubuntu/fc-demand-forecast/frontend && npm run preview -- --host 0.0.0.0 --port 5173`
