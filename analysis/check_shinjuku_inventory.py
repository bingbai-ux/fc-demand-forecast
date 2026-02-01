#!/usr/bin/env python3
"""
新宿店（storeId=1）の全在庫を集計し、スマレジの実際の値と比較
"""

import requests
import json

API_BASE = "https://fc-demand-forecast-production.up.railway.app/api"

# 仕入先一覧を取得
print("仕入先一覧を取得中...")
response = requests.get(f"{API_BASE}/forecast/suppliers?storeId=1", timeout=60)
suppliers = response.json().get("data", [])
print(f"仕入先数: {len(suppliers)}")

# 全仕入先の在庫を集計
total_stock_qty = 0
total_stock_cost = 0
total_stock_retail = 0
total_products = 0
products_with_stock = 0

# 仕入先を10件ずつ処理
batch_size = 10
for i in range(0, len(suppliers), batch_size):
    batch = suppliers[i:i+batch_size]
    
    response = requests.post(
        f"{API_BASE}/forecast/calculate",
        json={
            "storeId": "1",
            "supplierNames": batch,
            "forecastDays": 10
        },
        timeout=300
    )
    
    if response.status_code == 200:
        data = response.json()
        for sg in data.get("supplierGroups", []):
            for p in sg.get("products", []):
                total_products += 1
                stock = p.get("currentStock", 0)
                if stock > 0:
                    products_with_stock += 1
                    cost = p.get("cost", 0)
                    retail = p.get("retailPrice", 0)
                    total_stock_qty += stock
                    total_stock_cost += stock * cost
                    total_stock_retail += stock * retail
    
    print(f"  処理中: {min(i+batch_size, len(suppliers))}/{len(suppliers)} 仕入先")

print()
print("=" * 60)
print("新宿店（storeId=1）在庫サマリー")
print("=" * 60)
print(f"商品数: {total_products}")
print(f"在庫あり商品数: {products_with_stock}")
print(f"総在庫数量: {total_stock_qty:,}個")
print(f"総在庫金額（原価）: ¥{total_stock_cost:,.0f}")
print(f"総在庫金額（販売価格）: ¥{total_stock_retail:,.0f}")
print()
print("【スマレジ実際の値】")
print("在庫数量: 6,478個")
print("在庫金額（原価）: ¥2,237,509")
print("在庫金額（販売価格）: ¥3,437,318")
print()
print("【差異】")
print(f"数量差: {total_stock_qty - 6478:,}個 ({(total_stock_qty / 6478 - 1) * 100:.1f}%)")
print(f"原価差: ¥{total_stock_cost - 2237509:,.0f} ({(total_stock_cost / 2237509 - 1) * 100:.1f}%)")
print(f"販売価格差: ¥{total_stock_retail - 3437318:,.0f} ({(total_stock_retail / 3437318 - 1) * 100:.1f}%)")
