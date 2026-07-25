-- =============================================================
-- 022_diagram_survival.sql
-- REQ-050 一期 B 修正：把「图好不好」的判据从「老师点了什么」改成「这组图在画布上活下来了吗」
--
-- 为什么要改（2026-07-25 用户指出的真实工作流）：
--   老师生成完根本无法判断图好不好，**默认动作就是插进画布看一眼**，
--   看完不好就删掉、或在此基础上改。所以：
--     - `outcome='inserted'` 是默认动作，不是质量信号（几乎每条都会是它，零区分度）；
--     - 原先埋的 `deleted` 抓的是「删工作台历史条目」，而老师不满意时的真实操作是
--       **在画布上删掉那组元素**或直接 Ctrl+Z，根本不回工作台 → 正负标签双双失真。
--   带偏差的标签驱动二期飞轮，会把「只是插进去看看、看完就删」的图当成优质范例喂模型，
--   比没有飞轮更糟。故新增服务端观测的存活判定。
--
--   注意：`switched_type` / `regenerated_same_input` 两个信号**是准的**（换图型或同文本重来
--   说明上一张不行，与「插入是默认动作」无关），故 outcome 列保留、语义降级为「老师动作」，
--   与新的 survival 列**分列并存不互相覆盖**（否则老师「插了又重来」时两个信号会打架）。
--
-- 幂等可重跑。本迁移只加列与索引，无数据回填。
-- =============================================================

ALTER TABLE diagram_generations
  ADD COLUMN IF NOT EXISTS element_ids        JSONB,        -- 插入画布时那批 excalidraw 元素 id
  ADD COLUMN IF NOT EXISTS element_count      INT,          -- 插入时元素总数（分母）
  ADD COLUMN IF NOT EXISTS inserted_at        TIMESTAMPTZ,  -- 插入画布的时刻
  ADD COLUMN IF NOT EXISTS survived_count     INT,          -- 观测时仍在画布上的数量（分子）
  ADD COLUMN IF NOT EXISTS survival           VARCHAR(20),  -- kept / partially_kept / discarded / unknown
  ADD COLUMN IF NOT EXISTS survive_checked_at TIMESTAMPTZ;  -- 观测完成时刻（防重复扫）

-- 后台 checker 每轮就靠这个部分索引取待观测记录，扫描量与全表无关
CREATE INDEX IF NOT EXISTS idx_dg_pending_survive
  ON diagram_generations (inserted_at)
  WHERE inserted_at IS NOT NULL AND survive_checked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_dg_survival
  ON diagram_generations (diagram_type, survival) WHERE survival IS NOT NULL;

GRANT ALL ON diagram_generations TO mindcanvas;
