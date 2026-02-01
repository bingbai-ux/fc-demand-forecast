#!/usr/bin/env python3
"""
Order-up-to方式の発注ロジック検証

【発注計算】Order-up-to方式
  発注数 = 目標在庫 − (現在庫 + 発注残)
  目標在庫 = 予測日販 × (リードタイム + 発注間隔) + 安全在庫

【安全在庫】ABC分析で自動設定
  Aランク: 予測日販 × 3日分（欠品厳禁）
  Bランク: 予測日販 × 2日分
  Cランク: 予測日販 × 1日分
  Dランク: 予測日販 × 0.5日分
  Eランク: 0（在庫なくなったら発注）

【商品分類の自動化】変動係数で調整
  - 変動係数 < 0.3 → 定番商品（安定）→ 調整なし
  - 変動係数 0.3〜0.7 → 標準商品 → 調整なし
  - 変動係数 > 0.7 → 不安定商品 → 安全在庫 × 1.5
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path

# データ読み込み
periods = {
    "2025年5月": "period_2025_05.json",
    "2025年10月": "period_2025_10.json",
    "2026年1月": "period_2026_01.json",
}

def load_period_data(filename):
    """期間データを読み込み"""
    with open(f"/home/ubuntu/fc-demand-forecast/analysis/{filename}", "r") as f:
        data = json.load(f)
    
    products = []
    for group in data.get("supplierGroups", []):
        supplier_settings = group.get("supplierSettings", {})
        lead_time = supplier_settings.get("leadTimeDays", 3)
        
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
                "cv": product.get("coefficientOfVariation", 0),
                "cost": float(product.get("cost", 0)),
                "recommended_order": product.get("recommendedOrder", 0),
                "lead_time": lead_time,
                "order_interval": 7,  # 発注間隔（デフォルト7日）
            })
    
    return pd.DataFrame(products)

# ============================================
# 発注ロジックの定義
# ============================================

def logic_current(row):
    """現行ロジック"""
    return max(0, row["recommended_order"])

def logic_order_up_to(row, order_interval=7):
    """
    Order-up-to方式
    
    発注数 = 目標在庫 − (現在庫 + 発注残)
    目標在庫 = 予測日販 × (リードタイム + 発注間隔) + 安全在庫
    
    安全在庫はABCランクで決定:
    - A: 予測日販 × 3日分
    - B: 予測日販 × 2日分
    - C: 予測日販 × 1日分
    - D: 予測日販 × 0.5日分
    - E: 0
    
    変動係数 > 0.7 の場合、安全在庫を1.5倍
    """
    avg_daily = row["avg_daily_sales"]
    current_stock = row["current_stock"]
    lead_time = row["lead_time"]
    rank = row["rank"]
    cv = row["cv"]
    
    # ABCランク別の安全在庫日数
    safety_days = {
        "A": 3.0,
        "B": 2.0,
        "C": 1.0,
        "D": 0.5,
        "E": 0.0,
    }
    
    # 安全在庫計算
    safety_stock = avg_daily * safety_days.get(rank, 1.0)
    
    # 変動係数 > 0.7 の場合、安全在庫を1.5倍
    if cv > 0.7:
        safety_stock *= 1.5
    
    # 目標在庫 = 予測日販 × (リードタイム + 発注間隔) + 安全在庫
    target_stock = avg_daily * (lead_time + order_interval) + safety_stock
    
    # 発注数 = 目標在庫 − 現在庫（発注残は0と仮定）
    order_qty = max(0, np.ceil(target_stock - current_stock))
    
    return order_qty

def logic_order_up_to_conservative(row, order_interval=7):
    """
    Order-up-to方式（保守的）
    
    安全在庫を控えめに設定:
    - A: 予測日販 × 2日分
    - B: 予測日販 × 1.5日分
    - C: 予測日販 × 1日分
    - D: 予測日販 × 0.5日分
    - E: 0
    """
    avg_daily = row["avg_daily_sales"]
    current_stock = row["current_stock"]
    lead_time = row["lead_time"]
    rank = row["rank"]
    cv = row["cv"]
    
    safety_days = {
        "A": 2.0,
        "B": 1.5,
        "C": 1.0,
        "D": 0.5,
        "E": 0.0,
    }
    
    safety_stock = avg_daily * safety_days.get(rank, 1.0)
    
    if cv > 0.7:
        safety_stock *= 1.3  # 控えめに1.3倍
    
    target_stock = avg_daily * (lead_time + order_interval) + safety_stock
    order_qty = max(0, np.ceil(target_stock - current_stock))
    
    return order_qty

def logic_order_up_to_aggressive(row, order_interval=7):
    """
    Order-up-to方式（積極的）
    
    安全在庫を多めに設定:
    - A: 予測日販 × 4日分
    - B: 予測日販 × 3日分
    - C: 予測日販 × 2日分
    - D: 予測日販 × 1日分
    - E: 0
    """
    avg_daily = row["avg_daily_sales"]
    current_stock = row["current_stock"]
    lead_time = row["lead_time"]
    rank = row["rank"]
    cv = row["cv"]
    
    safety_days = {
        "A": 4.0,
        "B": 3.0,
        "C": 2.0,
        "D": 1.0,
        "E": 0.0,
    }
    
    safety_stock = avg_daily * safety_days.get(rank, 1.0)
    
    if cv > 0.7:
        safety_stock *= 1.5
    
    target_stock = avg_daily * (lead_time + order_interval) + safety_stock
    order_qty = max(0, np.ceil(target_stock - current_stock))
    
    return order_qty

# ============================================
# 評価関数
# ============================================

def evaluate_logic(df, logic_func, logic_name):
    """発注ロジックを評価"""
    results = df.copy()
    results["order_qty"] = results.apply(logic_func, axis=1)
    results["order_amount"] = results["order_qty"] * results["cost"]
    results["stock_after_order"] = results["current_stock"] + results["order_qty"]
    
    # 在庫カバー日数
    results["days_covered"] = np.where(
        results["avg_daily_sales"] > 0,
        results["stock_after_order"] / results["avg_daily_sales"],
        999
    )
    
    active = results[results["avg_daily_sales"] > 0]
    
    # 評価指標
    stockout_risk = (active["days_covered"] < 7).sum()
    overstock_risk = (active["days_covered"] > 21).sum()
    optimal = ((active["days_covered"] >= 7) & (active["days_covered"] <= 14)).sum()
    
    # 在庫金額（発注後）
    results["stock_value"] = results["stock_after_order"] * results["cost"]
    
    return {
        "logic": logic_name,
        "total_order_qty": int(results["order_qty"].sum()),
        "total_order_amount": int(results["order_amount"].sum()),
        "total_stock_value": int(results["stock_value"].sum()),
        "avg_days_covered": round(active["days_covered"].mean(), 1) if len(active) > 0 else 0,
        "stockout_risk": stockout_risk,
        "stockout_rate": round(stockout_risk / len(active) * 100, 1) if len(active) > 0 else 0,
        "overstock_risk": overstock_risk,
        "overstock_rate": round(overstock_risk / len(active) * 100, 1) if len(active) > 0 else 0,
        "optimal_count": optimal,
        "optimal_rate": round(optimal / len(active) * 100, 1) if len(active) > 0 else 0,
        "active_products": len(active),
    }

# ============================================
# メイン分析
# ============================================

print("=" * 80)
print("Order-up-to方式 発注ロジック検証")
print("=" * 80)

print("""
【検証するロジック】

1. 現行ロジック
   - 予測売数 + 安全在庫(CV調整) - 現在庫

2. Order-up-to方式（標準）
   - 目標在庫 = 日販 × (リードタイム + 発注間隔) + 安全在庫
   - 安全在庫 = 日販 × ランク別日数（A:3日, B:2日, C:1日, D:0.5日, E:0日）
   - CV > 0.7 の場合、安全在庫 × 1.5

3. Order-up-to方式（保守的）
   - 安全在庫日数を控えめに（A:2日, B:1.5日, C:1日, D:0.5日, E:0日）

4. Order-up-to方式（積極的）
   - 安全在庫日数を多めに（A:4日, B:3日, C:2日, D:1日, E:0日）
""")

# 各期間のデータを分析
all_results = []

for period_name, filename in periods.items():
    print(f"\n{'='*60}")
    print(f"期間: {period_name}")
    print(f"{'='*60}")
    
    df = load_period_data(filename)
    active_count = len(df[df["avg_daily_sales"] > 0])
    print(f"商品数: {len(df)} (アクティブ: {active_count})")
    
    # ランク分布
    rank_dist = df[df["avg_daily_sales"] > 0]["rank"].value_counts().sort_index()
    print(f"ランク分布: {dict(rank_dist)}")
    
    # CV分布
    active_df = df[df["avg_daily_sales"] > 0]
    cv_stable = (active_df["cv"] < 0.3).sum()
    cv_normal = ((active_df["cv"] >= 0.3) & (active_df["cv"] <= 0.7)).sum()
    cv_unstable = (active_df["cv"] > 0.7).sum()
    print(f"CV分布: 安定({cv_stable}) / 標準({cv_normal}) / 不安定({cv_unstable})")
    
    # 各ロジックを評価
    logics = [
        ("現行ロジック", logic_current),
        ("Order-up-to（標準）", logic_order_up_to),
        ("Order-up-to（保守的）", logic_order_up_to_conservative),
        ("Order-up-to（積極的）", logic_order_up_to_aggressive),
    ]
    
    period_results = []
    for name, func in logics:
        result = evaluate_logic(df, func, name)
        result["period"] = period_name
        period_results.append(result)
        all_results.append(result)
    
    # 結果表示
    summary = pd.DataFrame([{
        "ロジック": r["logic"],
        "発注数": r["total_order_qty"],
        "発注金額": f"¥{r['total_order_amount']:,}",
        "在庫金額": f"¥{r['total_stock_value']:,}",
        "カバー日数": f"{r['avg_days_covered']}日",
        "欠品リスク": f"{r['stockout_risk']}件({r['stockout_rate']}%)",
        "適正在庫": f"{r['optimal_count']}件({r['optimal_rate']}%)",
    } for r in period_results])
    
    print("\n" + summary.to_string(index=False))

# ============================================
# 期間横断分析
# ============================================

print("\n\n" + "=" * 80)
print("期間横断分析: 各ロジックの安定性")
print("=" * 80)

results_df = pd.DataFrame(all_results)

comparison_data = []
for logic_name in results_df["logic"].unique():
    logic_data = results_df[results_df["logic"] == logic_name]
    comparison_data.append({
        "ロジック": logic_name,
        "平均適正在庫率": f"{logic_data['optimal_rate'].mean():.1f}%",
        "適正在庫率SD": f"{logic_data['optimal_rate'].std():.1f}%",
        "平均欠品リスク率": f"{logic_data['stockout_rate'].mean():.1f}%",
        "欠品リスク率SD": f"{logic_data['stockout_rate'].std():.1f}%",
        "平均在庫金額": f"¥{int(logic_data['total_stock_value'].mean()):,}",
        "平均発注金額": f"¥{int(logic_data['total_order_amount'].mean()):,}",
    })

comparison_df = pd.DataFrame(comparison_data)
print("\n" + comparison_df.to_string(index=False))

# ============================================
# 商品別の発注量比較
# ============================================

print("\n\n" + "=" * 80)
print("商品別の発注量比較（2026年1月）")
print("=" * 80)

df_jan = load_period_data("period_2026_01.json")
active_jan = df_jan[df_jan["avg_daily_sales"] > 0]

comparison = []
for _, row in active_jan.iterrows():
    comp = {
        "商品名": row["product_name"][:15],
        "ランク": row["rank"],
        "CV": f"{row['cv']:.2f}",
        "日販": f"{row['avg_daily_sales']:.1f}",
        "現在庫": int(row["current_stock"]),
        "現行": int(logic_current(row)),
        "標準": int(logic_order_up_to(row)),
        "保守的": int(logic_order_up_to_conservative(row)),
        "積極的": int(logic_order_up_to_aggressive(row)),
    }
    comparison.append(comp)

comp_df = pd.DataFrame(comparison)
print("\n" + comp_df.to_string(index=False))

# ============================================
# 最終推奨
# ============================================

print("\n\n" + "=" * 80)
print("★ 分析結果と推奨")
print("=" * 80)

# CSVに保存
results_df.to_csv("/home/ubuntu/fc-demand-forecast/analysis/order_up_to_results.csv", index=False)
print("\n結果ファイル: /home/ubuntu/fc-demand-forecast/analysis/order_up_to_results.csv")
