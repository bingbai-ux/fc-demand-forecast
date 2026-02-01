#!/bin/bash

# 過去30日分を1日ずつ同期
for i in {30..1}; do
  DATE=$(date -d "$i days ago" +%Y-%m-%d)
  echo "📅 $DATE の売上を同期中..."
  
  RESULT=$(curl -s -X POST "http://localhost:3000/api/sync/sales" \
    -H "Content-Type: application/json" \
    -d "{\"from\":\"${DATE}\",\"to\":\"${DATE}\"}" \
    --max-time 120)
  
  if echo "$RESULT" | grep -q '"success":true'; then
    COUNT=$(echo "$RESULT" | jq -r '.count // 0')
    echo "✅ $DATE: $COUNT 件同期完了"
  else
    echo "❌ $DATE: 同期失敗"
    echo "$RESULT"
    # エラーが発生しても続行
  fi
  
  # API制限を避けるため少し待機
  sleep 2
done

echo "🎉 売上同期完了！"
