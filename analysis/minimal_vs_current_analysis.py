#!/usr/bin/env python3
"""
最小限ロジック vs 現行ロジック 比較検証
新しい3つの期間（2025年6月、8月、12月）で検証
"""

import json
import pandas as pd
import numpy as np
from pathlib import Path

# データ読み込み
periods = {
    "2025年6月": "period_2025_06.json",
    "2025年8月": "period_2025_08.json",
    "2025年12月": "period_2025_12.json",
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
            
            # 日次売上データを取得
            daily_sales = [s.get("qty", 0) for s in past_sales]
            
            products.append({
                "product_id": product.get("productId"),
                "product_name": product.get("productName"),
                "supplier": product.get("supplierName"),
                "current_stock": product.get("currentStock", 0),
                "daily_sales": daily_sales,
                "avg_daily_sales": product.get("avgDailySales", 0),
                "rank": product.get("rank", "E"),
                "cv": product.get("coefficientOfVariation", 0),
                "cost": float(product.get("cost", 0)),
                "recommended_order": product.get("recommendedOrder", 0),
                "safety_stock": product.get("safetyStock", 0),
                "forecast_qty": product.get("forecastQuantity", 0),
                "lead_time": lead_time,
            })
    
    return pd.DataFrame(products)

# ============================================
# 発注ロジック
# ============================================

def calculate_current_logic(row, forecast_days=7):
    """
    現行ロジック（フル機能）
    発注数 = 予測売数 + 安全在庫 - 現在庫
    安全在庫 = 日販 × √日数 × CV係数
    """
    avg_daily = row["avg_daily_sales"]
    current_stock = row["current_stock"]
    cv = row["cv"]
    
    # 変動係数による安全在庫係数調整
    if cv >= 0.6:
        safety_factor = 1.0
    elif cv >= 0.3:
        safety_factor = 0.7
    else:
        safety_factor = 0.5
    
    # 予測売数
    forecast_qty = avg_daily * forecast_days
    
    # 安全在庫（√日数計算）
    safety_stock = avg_daily * np.sqrt(forecast_days) * safety_factor
    
    # 発注数
    order_qty = max(0, np.ceil(forecast_qty + safety_stock - current_stock))
    
    return order_qty, safety_stock, forecast_qty

def calculate_minimal_logic(row, forecast_days=7):
    """
    最小限ロジック
    発注数 = 予測売数 - 現在庫
    安全在庫なし
    """
    avg_daily = row["avg_daily_sales"]
    current_stock = row["current_stock"]
    
    # 予測売数
    forecast_qty = avg_daily * forecast_days
    
    # 安全在庫なし
    safety_stock = 0
    
    # 発注数
    order_qty = max(0, np.ceil(forecast_qty - current_stock))
    
    return order_qty, safety_stock, forecast_qty

# ============================================
# 評価関数
# ============================================

def evaluate_logic(df, calc_func, logic_name, forecast_days=7):
    """ロジックを評価"""
    results = df.copy()
    
    # 発注数と安全在庫を計算
    order_data = results.apply(lambda row: calc_func(row, forecast_days), axis=1)
    results["order_qty"] = [d[0] for d in order_data]
    results["safety_stock"] = [d[1] for d in order_data]
    results["forecast_qty"] = [d[2] for d in order_data]
    
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
    
    # 在庫金額
    results["stock_value"] = results["stock_after_order"] * results["cost"]
    
    # 欠品シミュレーション（現在庫が予測売数を下回る商品）
    results["potential_stockout"] = results["current_stock"] < results["forecast_qty"]
    
    return {
        "logic": logic_name,
        "total_order_qty": int(results["order_qty"].sum()),
        "total_order_amount": int(results["order_amount"].sum()),
        "total_stock_value": int(results["stock_value"].sum()),
        "avg_safety_stock": round(active["safety_stock"].mean(), 2) if len(active) > 0 else 0,
        "avg_days_covered": round(active["days_covered"].mean(), 1) if len(active) > 0 else 0,
        "stockout_risk_count": stockout_risk,
        "stockout_risk_rate": round(stockout_risk / len(active) * 100, 1) if len(active) > 0 else 0,
        "overstock_count": overstock_risk,
        "overstock_rate": round(overstock_risk / len(active) * 100, 1) if len(active) > 0 else 0,
        "optimal_count": optimal,
        "optimal_rate": round(optimal / len(active) * 100, 1) if len(active) > 0 else 0,
        "active_products": len(active),
        "total_products": len(results),
        "potential_stockout_count": results["potential_stockout"].sum(),
    }

# ============================================
# メイン分析
# ============================================

print("=" * 80)
print("最小限ロジック vs 現行ロジック 比較検証")
print("=" * 80)

print("""
【検証するロジック】

1. 現行ロジック
   発注数 = 予測売数 + 安全在庫 - 現在庫
   安全在庫 = 日販 × √7日 × CV係数（0.5〜1.0）

2. 最小限ロジック
   発注数 = 予測売数 - 現在庫
   安全在庫 = 0
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
    
    # 現行ロジック
    current_result = evaluate_logic(df, calculate_current_logic, "現行ロジック")
    current_result["period"] = period_name
    all_results.append(current_result)
    
    # 最小限ロジック
    minimal_result = evaluate_logic(df, calculate_minimal_logic, "最小限ロジック")
    minimal_result["period"] = period_name
    all_results.append(minimal_result)
    
    # 結果表示
    print(f"\n--- 比較結果 ---")
    comparison = pd.DataFrame([
        {
            "ロジック": current_result["logic"],
            "発注数": current_result["total_order_qty"],
            "発注金額": f"¥{current_result['total_order_amount']:,}",
            "在庫金額": f"¥{current_result['total_stock_value']:,}",
            "安全在庫": f"{current_result['avg_safety_stock']:.1f}",
            "カバー日数": f"{current_result['avg_days_covered']}日",
            "欠品リスク": f"{current_result['stockout_risk_rate']}%",
            "適正在庫率": f"{current_result['optimal_rate']}%",
        },
        {
            "ロジック": minimal_result["logic"],
            "発注数": minimal_result["total_order_qty"],
            "発注金額": f"¥{minimal_result['total_order_amount']:,}",
            "在庫金額": f"¥{minimal_result['total_stock_value']:,}",
            "安全在庫": f"{minimal_result['avg_safety_stock']:.1f}",
            "カバー日数": f"{minimal_result['avg_days_covered']}日",
            "欠品リスク": f"{minimal_result['stockout_risk_rate']}%",
            "適正在庫率": f"{minimal_result['optimal_rate']}%",
        }
    ])
    print("\n" + comparison.to_string(index=False))
    
    # 差分
    print(f"\n--- 差分（最小限 - 現行）---")
    print(f"発注数: {minimal_result['total_order_qty'] - current_result['total_order_qty']:+d}個")
    print(f"発注金額: ¥{minimal_result['total_order_amount'] - current_result['total_order_amount']:+,}")
    print(f"在庫金額: ¥{minimal_result['total_stock_value'] - current_result['total_stock_value']:+,}")
    print(f"欠品リスク: {minimal_result['stockout_risk_rate'] - current_result['stockout_risk_rate']:+.1f}%")
    print(f"適正在庫率: {minimal_result['optimal_rate'] - current_result['optimal_rate']:+.1f}%")

# ============================================
# 期間横断分析
# ============================================

print("\n\n" + "=" * 80)
print("★ 期間横断分析")
print("=" * 80)

results_df = pd.DataFrame(all_results)

# 各ロジックの平均値を計算
cross_period = []
for logic_name in ["現行ロジック", "最小限ロジック"]:
    logic_data = results_df[results_df["logic"] == logic_name]
    
    cross_period.append({
        "ロジック": logic_name,
        "平均発注数": f"{logic_data['total_order_qty'].mean():.0f}個",
        "平均発注金額": f"¥{logic_data['total_order_amount'].mean():,.0f}",
        "平均在庫金額": f"¥{logic_data['total_stock_value'].mean():,.0f}",
        "平均欠品リスク": f"{logic_data['stockout_risk_rate'].mean():.1f}%",
        "平均適正在庫率": f"{logic_data['optimal_rate'].mean():.1f}%",
        "安定性(SD)": f"{logic_data['optimal_rate'].std():.1f}%",
    })

cross_df = pd.DataFrame(cross_period)
print("\n" + cross_df.to_string(index=False))

# ============================================
# 詳細比較
# ============================================

print("\n\n" + "=" * 80)
print("★ 期間別詳細比較")
print("=" * 80)

for period_name in periods.keys():
    period_data = results_df[results_df["period"] == period_name]
    current = period_data[period_data["logic"] == "現行ロジック"].iloc[0]
    minimal = period_data[period_data["logic"] == "最小限ロジック"].iloc[0]
    
    print(f"\n【{period_name}】")
    print(f"  現行ロジック:")
    print(f"    発注数: {current['total_order_qty']}個, 発注金額: ¥{current['total_order_amount']:,}")
    print(f"    在庫金額: ¥{current['total_stock_value']:,}, 欠品リスク: {current['stockout_risk_rate']}%")
    print(f"    適正在庫率: {current['optimal_rate']}%, カバー日数: {current['avg_days_covered']}日")
    print(f"  最小限ロジック:")
    print(f"    発注数: {minimal['total_order_qty']}個, 発注金額: ¥{minimal['total_order_amount']:,}")
    print(f"    在庫金額: ¥{minimal['total_stock_value']:,}, 欠品リスク: {minimal['stockout_risk_rate']}%")
    print(f"    適正在庫率: {minimal['optimal_rate']}%, カバー日数: {minimal['avg_days_covered']}日")
    print(f"  差分（最小限 - 現行）:")
    print(f"    発注金額: ¥{minimal['total_order_amount'] - current['total_order_amount']:+,}")
    print(f"    在庫金額: ¥{minimal['total_stock_value'] - current['total_stock_value']:+,}")
    print(f"    欠品リスク: {minimal['stockout_risk_rate'] - current['stockout_risk_rate']:+.1f}%")

# ============================================
# 結論
# ============================================

print("\n\n" + "=" * 80)
print("★ 結論")
print("=" * 80)

# 平均値を計算
current_avg = results_df[results_df["logic"] == "現行ロジック"]
minimal_avg = results_df[results_df["logic"] == "最小限ロジック"]

avg_order_diff = minimal_avg["total_order_amount"].mean() - current_avg["total_order_amount"].mean()
avg_stock_diff = minimal_avg["total_stock_value"].mean() - current_avg["total_stock_value"].mean()
avg_stockout_diff = minimal_avg["stockout_risk_rate"].mean() - current_avg["stockout_risk_rate"].mean()
avg_optimal_diff = minimal_avg["optimal_rate"].mean() - current_avg["optimal_rate"].mean()

print(f"""
【3期間の平均比較】

                    現行ロジック    最小限ロジック    差分
発注金額:           ¥{current_avg['total_order_amount'].mean():,.0f}    ¥{minimal_avg['total_order_amount'].mean():,.0f}    ¥{avg_order_diff:+,.0f}
在庫金額:           ¥{current_avg['total_stock_value'].mean():,.0f}    ¥{minimal_avg['total_stock_value'].mean():,.0f}    ¥{avg_stock_diff:+,.0f}
欠品リスク:         {current_avg['stockout_risk_rate'].mean():.1f}%           {minimal_avg['stockout_risk_rate'].mean():.1f}%           {avg_stockout_diff:+.1f}%
適正在庫率:         {current_avg['optimal_rate'].mean():.1f}%          {minimal_avg['optimal_rate'].mean():.1f}%          {avg_optimal_diff:+.1f}%

【判定】
""")

if avg_stockout_diff > 5:
    print("⚠️ 最小限ロジックは欠品リスクが大幅に増加します。現行ロジックを推奨します。")
elif avg_stockout_diff > 0:
    print("⚠️ 最小限ロジックは欠品リスクがやや増加しますが、在庫金額を削減できます。")
else:
    print("✅ 最小限ロジックでも欠品リスクは増加しません。在庫金額を削減できます。")

if avg_stock_diff < -5000:
    print(f"✅ 最小限ロジックで在庫金額を平均¥{abs(avg_stock_diff):,.0f}削減できます。")

# CSVに保存
results_df.to_csv("/home/ubuntu/fc-demand-forecast/analysis/minimal_vs_current_results.csv", index=False)
print("\n結果ファイル: /home/ubuntu/fc-demand-forecast/analysis/minimal_vs_current_results.csv")
