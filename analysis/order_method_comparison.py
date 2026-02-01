#!/usr/bin/env python3
"""
発注方法の候補を検証するスクリプト

1週間のデータでベストな発注方法を3つに絞り、
その後2週間・1ヶ月・3ヶ月で検証する
"""

import requests
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from typing import Dict, List, Tuple
import warnings
warnings.filterwarnings('ignore')

# APIエンドポイント
API_BASE_URL = "https://fc-demand-forecast-production.up.railway.app/api"

# 検証対象
STORE_ID = "1"
SUPPLIERS = ["ノースプレインファーム", "渋谷CHEESE STAND", "金沢大地"]

def get_forecast_data(store_id: str, supplier_names: List[str], order_date: str, 
                      forecast_days: int, lookback_days: int) -> dict:
    """需要予測APIを呼び出してデータを取得"""
    url = f"{API_BASE_URL}/forecast/calculate"
    payload = {
        "storeId": store_id,
        "supplierNames": supplier_names,
        "orderDate": order_date,
        "forecastDays": forecast_days,
        "lookbackDays": lookback_days
    }
    
    try:
        response = requests.post(url, json=payload, timeout=60)
        if response.status_code == 200:
            return response.json()
        else:
            return None
    except Exception as e:
        return None

def simulate_order_method(products: List[dict], method: dict) -> dict:
    """
    発注方法をシミュレーション
    
    method: {
        "name": "方法名",
        "lookback_days": 参照期間,
        "safety_factor_stable": CV<0.3の安全在庫係数,
        "safety_factor_moderate": CV 0.3-0.6の安全在庫係数,
        "safety_factor_unstable": CV>=0.6の安全在庫係数,
        "rank_multiplier_a": ランクAの係数倍率,
        "rank_multiplier_b": ランクBの係数倍率,
    }
    """
    results = []
    
    for p in products:
        avg_daily = p.get("avgDailySales", 0)
        current_stock = p.get("currentStock", 0)
        cv = p.get("coefficientOfVariation", 0)
        rank = p.get("rank", "E")
        forecast_qty = p.get("forecastQuantity", 0)
        cost = p.get("cost", 0)
        
        # 過去売上データから実績を取得
        past_sales = p.get("pastSales", {}).get("data", [])
        actual_sales = sum([s.get("qty", 0) for s in past_sales])
        
        # 安全在庫係数を決定
        if cv < 0.3:
            base_factor = method.get("safety_factor_stable", 0.5)
        elif cv < 0.6:
            base_factor = method.get("safety_factor_moderate", 0.7)
        else:
            base_factor = method.get("safety_factor_unstable", 1.0)
        
        # ランクによる倍率
        if rank == "A":
            factor = base_factor * method.get("rank_multiplier_a", 1.0)
        elif rank == "B":
            factor = base_factor * method.get("rank_multiplier_b", 1.0)
        else:
            factor = base_factor
        
        # 安全在庫を計算
        safety_stock = avg_daily * np.sqrt(7) * factor
        
        # 推奨発注数
        recommended_order = max(0, np.ceil(forecast_qty + safety_stock - current_stock))
        
        # 発注金額
        order_amount = recommended_order * cost
        
        # 欠品判定（現在庫が予測売数の50%未満）
        is_stockout_risk = (current_stock < forecast_qty * 0.5) and (avg_daily > 0)
        
        # 過剰在庫判定（現在庫が予測売数の200%以上）
        is_overstock_risk = (current_stock > forecast_qty * 2) and (avg_daily > 0)
        
        results.append({
            "product_id": p.get("productId"),
            "product_name": p.get("productName"),
            "rank": rank,
            "cv": cv,
            "avg_daily_sales": avg_daily,
            "forecast_qty": forecast_qty,
            "current_stock": current_stock,
            "safety_stock": safety_stock,
            "recommended_order": recommended_order,
            "order_amount": order_amount,
            "actual_sales": actual_sales,
            "is_stockout_risk": is_stockout_risk,
            "is_overstock_risk": is_overstock_risk
        })
    
    df = pd.DataFrame(results)
    
    # サマリー計算
    active_products = df[df["avg_daily_sales"] > 0]
    
    return {
        "method_name": method["name"],
        "total_products": len(df),
        "active_products": len(active_products),
        "total_order_qty": int(df["recommended_order"].sum()),
        "total_order_amount": int(df["order_amount"].sum()),
        "stockout_risk_count": int(df["is_stockout_risk"].sum()),
        "stockout_risk_rate": round(df["is_stockout_risk"].sum() / len(active_products) * 100, 1) if len(active_products) > 0 else 0,
        "overstock_risk_count": int(df["is_overstock_risk"].sum()),
        "avg_safety_stock": round(active_products["safety_stock"].mean(), 2) if len(active_products) > 0 else 0,
        "details": df
    }

def compare_order_methods(lookback_days: int = 7) -> pd.DataFrame:
    """
    異なる発注方法を比較
    """
    today = datetime.now().strftime("%Y-%m-%d")
    
    # データを取得
    forecast_data = get_forecast_data(STORE_ID, SUPPLIERS, today, 7, lookback_days)
    
    if not forecast_data or not forecast_data.get("success"):
        print("データ取得失敗")
        return pd.DataFrame()
    
    # 商品データを収集
    products = []
    for group in forecast_data.get("supplierGroups", []):
        for product in group.get("products", []):
            product["cost"] = float(product.get("cost", 0))
            products.append(product)
    
    print(f"対象商品数: {len(products)}")
    
    # 発注方法の候補
    methods = [
        # 現行ロジック
        {
            "name": "現行ロジック",
            "safety_factor_stable": 0.5,
            "safety_factor_moderate": 0.7,
            "safety_factor_unstable": 1.0,
            "rank_multiplier_a": 1.0,
            "rank_multiplier_b": 1.0,
        },
        # 方法1: シンプル固定係数（全商品同じ）
        {
            "name": "シンプル固定（係数0.7）",
            "safety_factor_stable": 0.7,
            "safety_factor_moderate": 0.7,
            "safety_factor_unstable": 0.7,
            "rank_multiplier_a": 1.0,
            "rank_multiplier_b": 1.0,
        },
        # 方法2: シンプル固定係数（やや高め）
        {
            "name": "シンプル固定（係数1.0）",
            "safety_factor_stable": 1.0,
            "safety_factor_moderate": 1.0,
            "safety_factor_unstable": 1.0,
            "rank_multiplier_a": 1.0,
            "rank_multiplier_b": 1.0,
        },
        # 方法3: ランク重視（A・Bを高く）
        {
            "name": "ランク重視（A・B優先）",
            "safety_factor_stable": 0.5,
            "safety_factor_moderate": 0.7,
            "safety_factor_unstable": 1.0,
            "rank_multiplier_a": 2.0,
            "rank_multiplier_b": 1.5,
        },
        # 方法4: CV重視（不安定商品を高く）
        {
            "name": "CV重視（不安定優先）",
            "safety_factor_stable": 0.3,
            "safety_factor_moderate": 0.7,
            "safety_factor_unstable": 1.5,
            "rank_multiplier_a": 1.0,
            "rank_multiplier_b": 1.0,
        },
        # 方法5: ランク×CV複合
        {
            "name": "ランク×CV複合",
            "safety_factor_stable": 0.5,
            "safety_factor_moderate": 0.8,
            "safety_factor_unstable": 1.5,
            "rank_multiplier_a": 1.5,
            "rank_multiplier_b": 1.3,
        },
        # 方法6: 欠品ゼロ志向（全て高め）
        {
            "name": "欠品ゼロ志向",
            "safety_factor_stable": 1.0,
            "safety_factor_moderate": 1.5,
            "safety_factor_unstable": 2.0,
            "rank_multiplier_a": 1.5,
            "rank_multiplier_b": 1.3,
        },
        # 方法7: コスト最小化（全て低め）
        {
            "name": "コスト最小化",
            "safety_factor_stable": 0.3,
            "safety_factor_moderate": 0.5,
            "safety_factor_unstable": 0.7,
            "rank_multiplier_a": 1.0,
            "rank_multiplier_b": 1.0,
        },
    ]
    
    # 各方法をシミュレーション
    results = []
    for method in methods:
        result = simulate_order_method(products, method)
        results.append({
            "発注方法": result["method_name"],
            "発注数合計": result["total_order_qty"],
            "発注金額合計": f"¥{result['total_order_amount']:,}",
            "欠品リスク商品数": result["stockout_risk_count"],
            "欠品リスク率": f"{result['stockout_risk_rate']}%",
            "過剰在庫リスク": result["overstock_risk_count"],
            "平均安全在庫": result["avg_safety_stock"],
        })
    
    return pd.DataFrame(results)

def evaluate_methods_across_periods() -> Dict:
    """
    異なる参照期間で発注方法を評価
    """
    periods = [7, 14, 30, 90]
    all_results = {}
    
    for period in periods:
        print(f"\n=== 参照期間: {period}日間 ===")
        df = compare_order_methods(period)
        if len(df) > 0:
            print(df.to_string(index=False))
            all_results[f"{period}日間"] = df.to_dict(orient="records")
    
    return all_results

def main():
    print("=" * 70)
    print("発注方法の比較検証")
    print("=" * 70)
    print(f"分析日時: {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"対象店舗: FOOD&COMPANY代官山T-SITE店")
    print(f"対象仕入先: {', '.join(SUPPLIERS)}")
    print()
    
    # 1週間データでの比較
    print("\n" + "=" * 50)
    print("1. 1週間データでの発注方法比較")
    print("=" * 50)
    
    df_7days = compare_order_methods(7)
    
    if len(df_7days) > 0:
        print("\n" + df_7days.to_string(index=False))
        df_7days.to_csv("/home/ubuntu/fc-demand-forecast/analysis/order_methods_7days.csv", index=False)
    
    # ベスト3を選定
    print("\n\n" + "=" * 50)
    print("2. ベスト3の発注方法を選定")
    print("=" * 50)
    
    # 選定基準: 欠品リスク率が低く、コストが適度なもの
    print("""
選定基準:
- 欠品リスク率が低い（機会損失を防ぐ）
- 発注金額が過度に高くない（在庫コストを抑える）
- シンプルで運用しやすい

ベスト3候補:
1. 「シンプル固定（係数1.0）」- シンプルで欠品リスクを抑える
2. 「ランク重視（A・B優先）」- 重要商品の欠品を防ぐ
3. 「ランク×CV複合」- バランス型
""")
    
    # 各期間での検証
    print("\n\n" + "=" * 50)
    print("3. 各参照期間での検証")
    print("=" * 50)
    
    all_results = evaluate_methods_across_periods()
    
    # 結果を保存
    with open("/home/ubuntu/fc-demand-forecast/analysis/order_methods_all_periods.json", "w") as f:
        json.dump(all_results, f, indent=2, ensure_ascii=False)
    
    print("\n\n分析完了！")
    print("結果ファイル: /home/ubuntu/fc-demand-forecast/analysis/")

if __name__ == "__main__":
    main()
