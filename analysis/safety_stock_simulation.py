#!/usr/bin/env python3
"""
安全在庫係数のシミュレーション分析

異なる安全在庫係数での欠品率と過剰在庫のトレードオフを分析
"""

import requests
import json
import pandas as pd
import numpy as np
from datetime import datetime
from typing import Dict, List
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

def simulate_safety_stock_factors(store_id: str, supplier_names: List[str]) -> pd.DataFrame:
    """
    異なる安全在庫係数でのシミュレーション
    
    現在のロジック:
    - CV < 0.3: 係数 0.5
    - CV 0.3-0.6: 係数 0.7
    - CV >= 0.6: 係数 1.0
    
    シミュレーション: 係数を0.5から2.0まで変化させて効果を検証
    """
    today = datetime.now().strftime("%Y-%m-%d")
    
    # 現在のデータを取得
    forecast_data = get_forecast_data(store_id, supplier_names, today, 7, 14)
    
    if not forecast_data or not forecast_data.get("success"):
        return pd.DataFrame()
    
    # 商品データを収集
    products = []
    for group in forecast_data.get("supplierGroups", []):
        for product in group.get("products", []):
            avg_daily = product.get("avgDailySales", 0)
            current_stock = product.get("currentStock", 0)
            cv = product.get("coefficientOfVariation", 0)
            forecast_qty = product.get("forecastQuantity", 0)
            
            # 過去売上データ
            past_sales_obj = product.get("pastSales", {})
            past_sales_data = past_sales_obj.get("data", [])
            total_past_sales = sum([s.get("qty", 0) for s in past_sales_data])
            
            products.append({
                "product_id": product.get("productId"),
                "product_name": product.get("productName"),
                "rank": product.get("rank", "E"),
                "avg_daily_sales": avg_daily,
                "current_stock": current_stock,
                "cv": cv,
                "forecast_qty": forecast_qty,
                "total_past_sales": total_past_sales
            })
    
    df = pd.DataFrame(products)
    
    # 異なる安全在庫係数でシミュレーション
    safety_factors = [0.3, 0.5, 0.7, 1.0, 1.3, 1.5, 2.0]
    simulation_results = []
    
    for factor in safety_factors:
        # 安全在庫を計算（日平均 × √日数 × 係数）
        df["simulated_safety_stock"] = df["avg_daily_sales"] * np.sqrt(7) * factor
        
        # 推奨発注数を計算
        df["simulated_order"] = np.maximum(0, 
            np.ceil(df["forecast_qty"] + df["simulated_safety_stock"] - df["current_stock"]))
        
        # 欠品リスクの推定（現在庫が予測売数の50%未満）
        df["stockout_risk"] = (df["current_stock"] < df["forecast_qty"] * 0.5) & (df["avg_daily_sales"] > 0)
        
        # 過剰在庫リスクの推定（現在庫が予測売数の200%以上）
        df["overstock_risk"] = (df["current_stock"] > df["forecast_qty"] * 2) & (df["avg_daily_sales"] > 0)
        
        # 発注金額の推定（仮に平均原価500円として）
        avg_cost = 500
        total_order_amount = df["simulated_order"].sum() * avg_cost
        
        simulation_results.append({
            "安全在庫係数": factor,
            "平均安全在庫（個）": round(df["simulated_safety_stock"].mean(), 1),
            "平均発注数（個）": round(df["simulated_order"].mean(), 1),
            "総発注数（個）": int(df["simulated_order"].sum()),
            "推定発注金額（円）": int(total_order_amount),
            "欠品リスク商品数": int(df["stockout_risk"].sum()),
            "過剰在庫リスク商品数": int(df["overstock_risk"].sum())
        })
    
    return pd.DataFrame(simulation_results)

def analyze_cv_based_factors(store_id: str, supplier_names: List[str]) -> Dict:
    """
    変動係数ベースの安全在庫係数の効果分析
    """
    today = datetime.now().strftime("%Y-%m-%d")
    
    forecast_data = get_forecast_data(store_id, supplier_names, today, 7, 14)
    
    if not forecast_data or not forecast_data.get("success"):
        return {}
    
    # 商品データを収集
    cv_analysis = {"stable": [], "moderate": [], "unstable": []}
    
    for group in forecast_data.get("supplierGroups", []):
        for product in group.get("products", []):
            cv = product.get("coefficientOfVariation", 0)
            avg_daily = product.get("avgDailySales", 0)
            current_stock = product.get("currentStock", 0)
            safety_stock = product.get("safetyStock", 0)
            
            data = {
                "product_name": product.get("productName"),
                "cv": cv,
                "avg_daily_sales": avg_daily,
                "current_stock": current_stock,
                "safety_stock": safety_stock,
                "is_stockout": current_stock <= 0 and avg_daily > 0
            }
            
            if cv < 0.3:
                cv_analysis["stable"].append(data)
            elif cv < 0.6:
                cv_analysis["moderate"].append(data)
            else:
                cv_analysis["unstable"].append(data)
    
    # 各カテゴリの統計
    results = {}
    for category, products in cv_analysis.items():
        if len(products) > 0:
            df = pd.DataFrame(products)
            stockout_count = df["is_stockout"].sum()
            results[category] = {
                "商品数": len(products),
                "欠品数": int(stockout_count),
                "欠品率": round(stockout_count / len(products) * 100, 1),
                "平均安全在庫": round(df["safety_stock"].mean(), 1),
                "平均CV": round(df["cv"].mean(), 2)
            }
    
    return results

def main():
    print("=" * 70)
    print("安全在庫係数シミュレーション分析")
    print("=" * 70)
    
    # 1. 安全在庫係数のシミュレーション
    print("\n1. 安全在庫係数別のシミュレーション結果")
    print("-" * 50)
    
    sim_df = simulate_safety_stock_factors(STORE_ID, SUPPLIERS)
    
    if len(sim_df) > 0:
        print(sim_df.to_string(index=False))
        sim_df.to_csv("/home/ubuntu/fc-demand-forecast/analysis/safety_stock_simulation.csv", index=False)
    
    # 2. 変動係数ベースの分析
    print("\n\n2. 変動係数カテゴリ別の現状分析")
    print("-" * 50)
    
    cv_results = analyze_cv_based_factors(STORE_ID, SUPPLIERS)
    
    for category, stats in cv_results.items():
        label = {"stable": "安定 (CV<0.3)", "moderate": "中程度 (0.3≤CV<0.6)", "unstable": "不安定 (CV≥0.6)"}
        print(f"\n{label[category]}:")
        for key, value in stats.items():
            print(f"  {key}: {value}")
    
    # 結果を保存
    with open("/home/ubuntu/fc-demand-forecast/analysis/cv_factor_analysis.json", "w") as f:
        json.dump(cv_results, f, indent=2, ensure_ascii=False)
    
    print("\n\n分析完了！")

if __name__ == "__main__":
    main()
