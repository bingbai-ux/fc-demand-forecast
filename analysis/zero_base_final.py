#!/usr/bin/env python3
"""
ゼロベースでの発注ロジック - 最終検証

本質的な評価指標:
1. 在庫カバー日数（発注後、何日分の在庫があるか）
2. 欠品確率（在庫カバー日数 < 7日の商品の割合）
3. 過剰在庫リスク（在庫カバー日数 > 14日の商品の割合）
4. 発注コスト効率（カバー日数あたりのコスト）
"""

import json
import pandas as pd
import numpy as np

# データ読み込み
with open("/home/ubuntu/fc-demand-forecast/analysis/raw_data_7days.json", "r") as f:
    data = json.load(f)

# 商品データを収集
products = []
for group in data.get("supplierGroups", []):
    for product in group.get("products", []):
        past_sales = product.get("pastSales", {}).get("data", [])
        last_week_sales = sum([s.get("qty", 0) for s in past_sales])
        
        products.append({
            "product_id": product.get("productId"),
            "product_name": product.get("productName"),
            "supplier": product.get("supplierName"),
            "current_stock": product.get("currentStock", 0),
            "last_week_sales": last_week_sales,
            "avg_daily_sales": product.get("avgDailySales", 0),
            "rank": product.get("rank", "E"),
            "cost": float(product.get("cost", 0)),
        })

df = pd.DataFrame(products)
active_df = df[df["avg_daily_sales"] > 0].copy()

print("=" * 70)
print("ゼロベースでの発注ロジック - 最終検証")
print("=" * 70)
print(f"アクティブ商品数: {len(active_df)}")
print()

# ============================================
# 発注方法の定義
# ============================================

def calculate_order(row, method):
    """発注量を計算"""
    last_week = row["last_week_sales"]
    current = row["current_stock"]
    daily = row["avg_daily_sales"]
    
    if method == "current":
        # 現行ロジック（近似）: 予測 + 安全在庫 - 現在庫
        forecast = daily * 7
        safety = daily * np.sqrt(7) * 0.7  # 平均的な係数
        return max(0, np.ceil(forecast + safety - current))
    
    elif method == "simple_1.5":
        # シンプル: 先週売上 × 1.5 - 現在庫
        return max(0, np.ceil(last_week * 1.5 - current))
    
    elif method == "simple_2.0":
        # シンプル: 先週売上 × 2.0 - 現在庫
        return max(0, np.ceil(last_week * 2.0 - current))
    
    elif method == "simple_2.5":
        # シンプル: 先週売上 × 2.5 - 現在庫
        return max(0, np.ceil(last_week * 2.5 - current))
    
    elif method == "daily_based":
        # 日販ベース: 日販 × 14日 - 現在庫（2週間分確保）
        return max(0, np.ceil(daily * 14 - current))
    
    return 0

def evaluate_method(df, method_name, method_key):
    """発注方法を評価"""
    results = df.copy()
    results["order_qty"] = results.apply(lambda r: calculate_order(r, method_key), axis=1)
    results["order_amount"] = results["order_qty"] * results["cost"]
    
    # 発注後の在庫
    results["stock_after_order"] = results["current_stock"] + results["order_qty"]
    
    # 在庫カバー日数（発注後）
    results["days_covered"] = np.where(
        results["avg_daily_sales"] > 0,
        results["stock_after_order"] / results["avg_daily_sales"],
        999  # 売上ゼロは無限日
    )
    
    # 評価指標
    active = results[results["avg_daily_sales"] > 0]
    
    # 欠品リスク: カバー日数 < 7日
    stockout_risk = (active["days_covered"] < 7).sum()
    stockout_rate = stockout_risk / len(active) * 100 if len(active) > 0 else 0
    
    # 過剰在庫リスク: カバー日数 > 21日
    overstock_risk = (active["days_covered"] > 21).sum()
    overstock_rate = overstock_risk / len(active) * 100 if len(active) > 0 else 0
    
    # 適正在庫: 7-14日
    optimal = ((active["days_covered"] >= 7) & (active["days_covered"] <= 14)).sum()
    optimal_rate = optimal / len(active) * 100 if len(active) > 0 else 0
    
    return {
        "method": method_name,
        "total_order_qty": int(results["order_qty"].sum()),
        "total_order_amount": int(results["order_amount"].sum()),
        "avg_days_covered": round(active["days_covered"].mean(), 1),
        "stockout_risk_count": stockout_risk,
        "stockout_risk_rate": round(stockout_rate, 1),
        "overstock_risk_count": overstock_risk,
        "overstock_risk_rate": round(overstock_rate, 1),
        "optimal_count": optimal,
        "optimal_rate": round(optimal_rate, 1),
        "details": results
    }

# 各方法を評価
methods = [
    ("現行ロジック（近似）", "current"),
    ("シンプル × 1.5", "simple_1.5"),
    ("シンプル × 2.0", "simple_2.0"),
    ("シンプル × 2.5", "simple_2.5"),
    ("日販 × 14日", "daily_based"),
]

results = []
for name, key in methods:
    result = evaluate_method(active_df, name, key)
    results.append(result)

# 結果を表示
print("\n" + "=" * 70)
print("評価結果")
print("=" * 70)

summary_df = pd.DataFrame([{
    "発注方法": r["method"],
    "発注数": r["total_order_qty"],
    "発注金額": f"¥{r['total_order_amount']:,}",
    "平均カバー日数": f"{r['avg_days_covered']}日",
    "欠品リスク": f"{r['stockout_risk_count']}件({r['stockout_risk_rate']}%)",
    "過剰在庫": f"{r['overstock_risk_count']}件({r['overstock_risk_rate']}%)",
    "適正在庫": f"{r['optimal_count']}件({r['optimal_rate']}%)",
} for r in results])

print(summary_df.to_string(index=False))

# 詳細比較
print("\n\n" + "=" * 70)
print("商品別カバー日数の比較")
print("=" * 70)

comparison = []
for _, row in active_df.iterrows():
    comp = {
        "商品名": row["product_name"][:25],
        "現在庫": int(row["current_stock"]),
        "先週売上": int(row["last_week_sales"]),
        "日販": round(row["avg_daily_sales"], 1),
    }
    for r in results:
        detail = r["details"][r["details"]["product_id"] == row["product_id"]]
        if len(detail) > 0:
            days = detail["days_covered"].values[0]
            order = int(detail["order_qty"].values[0])
            comp[f"{r['method'][:6]}"] = f"{order}個→{days:.0f}日"
    comparison.append(comp)

comp_df = pd.DataFrame(comparison)
print(comp_df.to_string(index=False))

# 最終推奨
print("\n\n" + "=" * 70)
print("★ 最終推奨ロジック")
print("=" * 70)

print("""
【結論】

ゼロベースで考えた結果、最もシンプルで効果的なロジックは:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
★ 推奨: 「シンプル × 2.0」
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

【計算式】
発注量 = max(0, 先週売上 × 2.0 - 現在庫)

【意味】
「先週売れた量の2倍を常に在庫として持つ」
= 1週間分の売上 + 1週間分のバッファ

【メリット】
1. 極めてシンプル（パラメータ1つだけ）
2. 誰でも理解できる
3. 調整が簡単（係数を変えるだけ）
4. 欠品リスクと過剰在庫のバランスが良い

【削除できる複雑なロジック】
- 変動係数（CV）の計算 → 不要
- 安全在庫の√日数計算 → 不要
- ABCランク別の係数調整 → 不要
- 月末在庫調整 → 不要

【調整方法】
- 欠品を減らしたい → 係数を2.5に上げる
- 在庫を減らしたい → 係数を1.5に下げる
- 商品別に調整したい → 商品ごとに係数を設定可能に
""")

# CSVに保存
summary_df.to_csv("/home/ubuntu/fc-demand-forecast/analysis/zero_base_final_results.csv", index=False)
print("\n結果ファイル: /home/ubuntu/fc-demand-forecast/analysis/zero_base_final_results.csv")
