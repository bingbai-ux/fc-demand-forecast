# FC Demand Forecast

FOOD&COMPANY 需要予測システム

## プロジェクト構成

```
fc-demand-forecast/
├── backend/           # バックエンドAPI（Express + TypeScript）
│   ├── src/
│   │   ├── config/    # 環境変数管理
│   │   ├── services/  # スマレジAPI連携
│   │   └── routes/    # APIルート
│   └── package.json
└── README.md
```

## セットアップ

### バックエンド

```bash
cd backend
cp .env.example .env
# .envにスマレジAPI認証情報を設定
npm install
npm run dev
```

## API エンドポイント

- `GET /api/health` - ヘルスチェック
- `GET /api/health/smaregi` - スマレジAPI接続テスト

## 技術スタック

- **バックエンド**: Express.js + TypeScript
- **外部API**: スマレジ POS API
