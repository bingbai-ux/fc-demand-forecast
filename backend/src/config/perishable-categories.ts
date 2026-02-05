/**
 * ペリシャブル（生鮮・日配）カテゴリー設定
 *
 * 賞味期限が短い商品カテゴリーに対して、
 * 在庫過多による廃棄を防ぐための発注上限を設定する。
 *
 * ── 発注上限の計算式 ──
 *   maxOrder = maxStockDays × avgDailySales - currentStock
 *
 * ── 設定の根拠 ──
 *   maxStockDays = 賞味期限 × safetyFactor
 *   safetyFactor: 0.5 = 賞味期限の半分まで在庫OK
 *                 0.3 = 賞味期限の1/3まで（より厳しい）
 */

export interface PerishableConfig {
  categoryId: number;
  categoryName: string;
  /** 一般的な賞味期限（日） */
  typicalShelfLifeDays: number;
  /** 最大在庫日数（これを超える発注は抑制） */
  maxStockDays: number;
  /** 備考 */
  notes?: string;
}

/**
 * カテゴリーID → 設定のマップ
 * カテゴリーIDはスマレジのカテゴリーIDに対応
 */
export const PERISHABLE_CATEGORIES: Record<number, PerishableConfig> = {
  // ══════════════════════════════════════════════════════════════
  // 超短期（賞味期限 3-7日）
  // ══════════════════════════════════════════════════════════════
  32: {
    categoryId: 32,
    categoryName: '(2)豆腐・油揚げ・がんもどき',
    typicalShelfLifeDays: 7,
    maxStockDays: 3,
    notes: '豆腐は特に短い、油揚げは冷凍可',
  },
  41: {
    categoryId: 41,
    categoryName: '(2)魚類・肉類',
    typicalShelfLifeDays: 5,
    maxStockDays: 2,
    notes: '生鮮品、要冷蔵',
  },
  36: {
    categoryId: 36,
    categoryName: '精肉・畜産加工物',
    typicalShelfLifeDays: 5,
    maxStockDays: 2,
    notes: '生鮮品、要冷蔵',
  },
  37: {
    categoryId: 37,
    categoryName: '魚類・魚介加工物',
    typicalShelfLifeDays: 3,
    maxStockDays: 1,
    notes: '生鮮品、最も短い',
  },

  // ══════════════════════════════════════════════════════════════
  // 短期（賞味期限 7-14日）
  // ══════════════════════════════════════════════════════════════
  23: {
    categoryId: 23,
    categoryName: '(1)日配',
    typicalShelfLifeDays: 7,
    maxStockDays: 3,
    notes: '日配全般',
  },
  29: {
    categoryId: 29,
    categoryName: '(2)牛乳・乳飲料',
    typicalShelfLifeDays: 10,
    maxStockDays: 4,
    notes: '牛乳は短め、乳飲料は長め',
  },
  33: {
    categoryId: 33,
    categoryName: '(2)納豆・テンペ・大豆発酵食品',
    typicalShelfLifeDays: 10,
    maxStockDays: 5,
    notes: '納豆は比較的長持ち',
  },
  34: {
    categoryId: 34,
    categoryName: '(2)生皮・生麺・その他',
    typicalShelfLifeDays: 7,
    maxStockDays: 3,
    notes: '生麺は短い',
  },
  40: {
    categoryId: 40,
    categoryName: '(2)卵・乳製品',
    typicalShelfLifeDays: 14,
    maxStockDays: 5,
    notes: '卵は比較的長持ち',
  },
  39: {
    categoryId: 39,
    categoryName: '卵・卵加工物',
    typicalShelfLifeDays: 14,
    maxStockDays: 5,
    notes: '卵は比較的長持ち',
  },

  // ══════════════════════════════════════════════════════════════
  // 中期（賞味期限 14-30日）
  // ══════════════════════════════════════════════════════════════
  30: {
    categoryId: 30,
    categoryName: '(2)ヨーグルト・チーズ',
    typicalShelfLifeDays: 14,
    maxStockDays: 7,
    notes: 'ヨーグルトは短め、チーズは長め',
  },
  31: {
    categoryId: 31,
    categoryName: '(2)バター・マーガリン',
    typicalShelfLifeDays: 30,
    maxStockDays: 14,
    notes: 'バターは比較的長持ち',
  },
  67: {
    categoryId: 67,
    categoryName: '(2)こんにゃく・しらたき',
    typicalShelfLifeDays: 30,
    maxStockDays: 14,
    notes: '比較的長持ち',
  },

  // ══════════════════════════════════════════════════════════════
  // 漬物・佃煮系（賞味期限は長いが鮮度重視）
  // ══════════════════════════════════════════════════════════════
  6: {
    categoryId: 6,
    categoryName: '(2)梅干・漬物・佃煮',
    typicalShelfLifeDays: 60,
    maxStockDays: 21,
    notes: '賞味期限は長いが回転を意識',
  },
  69: {
    categoryId: 69,
    categoryName: '漬物・ぬか・漬物の素',
    typicalShelfLifeDays: 30,
    maxStockDays: 14,
    notes: '浅漬けは短い',
  },
  70: {
    categoryId: 70,
    categoryName: '梅干し・梅加工品',
    typicalShelfLifeDays: 90,
    maxStockDays: 30,
    notes: '梅干しは長持ち',
  },
  118: {
    categoryId: 118,
    categoryName: '佃煮・煮物',
    typicalShelfLifeDays: 30,
    maxStockDays: 14,
    notes: '真空パックは長め',
  },
};

/**
 * カテゴリー名からペリシャブル設定を取得
 * @param categoryName カテゴリー名（部分一致で検索）
 * @returns ペリシャブル設定、見つからない場合はundefined
 */
export function getPerishableConfigByName(categoryName: string): PerishableConfig | undefined {
  // 完全一致を優先
  for (const config of Object.values(PERISHABLE_CATEGORIES)) {
    if (config.categoryName === categoryName) {
      return config;
    }
  }
  // 部分一致
  for (const config of Object.values(PERISHABLE_CATEGORIES)) {
    if (categoryName.includes(config.categoryName) || config.categoryName.includes(categoryName)) {
      return config;
    }
  }
  return undefined;
}

/**
 * カテゴリーIDからペリシャブル設定を取得
 */
export function getPerishableConfig(categoryId: number): PerishableConfig | undefined {
  return PERISHABLE_CATEGORIES[categoryId];
}

/**
 * ペリシャブルカテゴリーかどうかを判定
 */
export function isPerishableCategory(categoryId: number): boolean {
  return categoryId in PERISHABLE_CATEGORIES;
}

/**
 * 最大発注数を計算（ペリシャブル制約）
 * @param categoryId カテゴリーID
 * @param avgDailySales 平均日販
 * @param currentStock 現在在庫
 * @param deliveryFrequencyDays 納品頻度（日）
 * @returns 最大発注数、ペリシャブルでない場合はInfinity
 */
export function calcMaxOrderByShelfLife(
  categoryId: number,
  avgDailySales: number,
  currentStock: number,
  deliveryFrequencyDays: number = 7,
): number {
  const config = PERISHABLE_CATEGORIES[categoryId];
  if (!config) return Infinity;

  // 最大在庫 = min(設定の最大在庫日数, 納品頻度 × 1.5) × 日販
  // 納品頻度が短ければ、それに合わせて在庫を減らせる
  const effectiveMaxDays = Math.min(config.maxStockDays, deliveryFrequencyDays * 1.5);
  const maxStock = effectiveMaxDays * avgDailySales;

  // 現在庫を引いた発注可能数
  return Math.max(0, maxStock - currentStock);
}
