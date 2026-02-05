-- ══════════════════════════════════════════════════════════════
-- 納品頻度カラムの追加と初期設定
--
-- 実行方法: Supabase SQL Editorで実行
-- ══════════════════════════════════════════════════════════════

-- 1. suppliersテーブルに納品頻度カラムを追加（存在しない場合）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'suppliers' AND column_name = 'delivery_frequency_days'
  ) THEN
    ALTER TABLE suppliers ADD COLUMN delivery_frequency_days INTEGER DEFAULT 7;
    RAISE NOTICE 'delivery_frequency_days カラムを追加しました';
  ELSE
    RAISE NOTICE 'delivery_frequency_days カラムは既に存在します';
  END IF;
END $$;

-- 2. 納品頻度の設定
-- デフォルト: 7日（週1回）

-- C.ゆうき八百屋（冷蔵）: 週4回 = 約2日
UPDATE suppliers SET delivery_frequency_days = 2
WHERE supplier_name = 'C.ゆうき八百屋';

-- ムソー冷蔵: 週1回 = 7日
UPDATE suppliers SET delivery_frequency_days = 7
WHERE supplier_name = 'ムソー冷蔵';

-- 創健社冷蔵: 週1回 = 7日
UPDATE suppliers SET delivery_frequency_days = 7
WHERE supplier_name = '創健社冷蔵';

-- ノースプレインファーム: 週1回 = 7日
UPDATE suppliers SET delivery_frequency_days = 7
WHERE supplier_name LIKE '%ノースプレインファーム%';

-- 薫の牧場: 週1回 = 7日
UPDATE suppliers SET delivery_frequency_days = 7
WHERE supplier_name LIKE '%薫の牧場%';

-- 渋谷CHEESE STAND: 週1回 = 7日
UPDATE suppliers SET delivery_frequency_days = 7
WHERE supplier_name LIKE '%CHEESE STAND%' OR supplier_name LIKE '%チーズスタンド%';

-- latteria bebe: 週1回 = 7日
UPDATE suppliers SET delivery_frequency_days = 7
WHERE supplier_name LIKE '%bebe%' OR supplier_name LIKE '%ベベ%';

-- ココノ: 2週間に1回 = 14日
UPDATE suppliers SET delivery_frequency_days = 14
WHERE supplier_name LIKE '%cocono%' OR supplier_name LIKE '%ココノ%';

-- 3. 設定確認
SELECT
  supplier_name,
  delivery_frequency_days,
  lead_time_days
FROM suppliers
WHERE delivery_frequency_days IS NOT NULL
ORDER BY delivery_frequency_days, supplier_name;
