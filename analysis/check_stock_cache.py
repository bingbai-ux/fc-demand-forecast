#!/usr/bin/env python3
"""
stock_cacheテーブルの店舗別サマリーを確認
"""

import requests
import json

API_BASE = "https://fc-demand-forecast-production.up.railway.app/api"

# 需要予測APIを使って新宿店のデータを取得
response = requests.post(
    f"{API_BASE}/forecast",
    json={
        "storeId": "1",  # 新宿店
        "supplierNames": ["all"],
        "forecastDays": 10
    },
    timeout=300
)

if response.status_code == 200:
    data = response.json()
    
    # 商品データを集計
    products = data.get("products", [])
    
    total_stock = 0
    total_stock_value = 0
    stock_positive = 0
    stock_negative = 0
    stock_zero = 0
    
    for p in products:
        stock = p.get("currentStock", 0)
        price = p.get("price", 0)
        
        total_stock += stock
        total_stock_value += stock * price
        
        if stock > 0:
            stock_positive += 1
        elif stock < 0:
            stock_negative += 1
        else:
            stock_zero += 1
    
    print("=" * 60)
    print("新宿店（storeId=1）の在庫サマリー")
    print("=" * 60)
    print(f"商品数: {len(products)}")
    print(f"  - 在庫あり: {stock_positive}")
    print(f"  - 在庫ゼロ: {stock_zero}")
    print(f"  - 在庫マイナス: {stock_negative}")
    print(f"総在庫数量: {total_stock:,}")
    print(f"総在庫金額（販売価格）: ¥{total_stock_value:,.0f}")
    print()
    print("【スマレジ実際の値】")
    print("在庫数量: 6,478個")
    print("在庫金額（販売価格）: ¥3,454,028")
    print()
    print("【差異】")
    print(f"数量差: {total_stock - 6478:,}個")
    print(f"金額差: ¥{total_stock_value - 3454028:,.0f}")
    
    # サンプルデータを表示
    print()
    print("=" * 60)
    print("サンプルデータ（最初の10件）")
    print("=" * 60)
    for p in products[:10]:
        print(f"  {p.get('productName', 'N/A')[:30]}: 在庫={p.get('currentStock', 0)}, 価格=¥{p.get('price', 0)}")
    
else:
    print(f"エラー: {response.status_code}")
    print(response.text[:500])
