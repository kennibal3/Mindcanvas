-- =============================================================
-- 021_diagram_samples.sql
-- REQ-050 一期 B：AI 图形生成信号采集
-- 目的：为二期「动态少样本飞轮」攒真实样本，并让验收指标
--       「不用手改就能用的图形比例」有数据可算。
-- 幂等可重跑；新表 owner=postgres，故建表后 GRANT ALL TO mindcanvas
--       （同迁移 019/020 惯例，避免 owner 坑）
--
-- 设计说明：
--   1. room_id 故意不加外键。采集是旁路，绝不能因为房间被删/id 对不上
--      让 INSERT 失败进而影响图形生成主流程。
--   2. input_text 后端截断到 4000 字符再入库（原始长度另存 input_chars）。
--   3. result 存最终 {nodes,edges}，二期检索相似样本注入提示词时用。
--   4. outcome 是「老师拿到图之后干了什么」——本期最重要的质量信号：
--        inserted                = 直接插进画布用了（≈ 不用手改就能用）
--        regenerated_same_input  = 同一段文本重来（≈ 这张不行）
--        switched_type           = 换个图型重来（≈ 选型不对）
--        deleted                 = 删掉不要了
-- =============================================================

CREATE TABLE IF NOT EXISTS diagram_generations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id      UUID,                                  -- 见上：故意不加外键
  diagram_type VARCHAR(20)  NOT NULL,
  input_text   TEXT         NOT NULL DEFAULT '',      -- 截断后的输入
  input_chars  INT          NOT NULL DEFAULT 0,       -- 截断前的真实字符数
  node_count   INT          NOT NULL DEFAULT 0,
  edge_count   INT          NOT NULL DEFAULT 0,
  repairs      JSONB        NOT NULL DEFAULT '[]'::jsonb,
  issues       JSONB        NOT NULL DEFAULT '[]'::jsonb,
  repair_count INT          NOT NULL DEFAULT 0,       -- 冗余计数，聚合时免展开 jsonb
  issue_count  INT          NOT NULL DEFAULT 0,
  regenerated  BOOLEAN      NOT NULL DEFAULT FALSE,   -- 后端因 fatal 自动重生成过一次
  result       JSONB,                                 -- 最终 {nodes,edges}
  elapsed_ms   INT          NOT NULL DEFAULT 0,
  outcome      VARCHAR(32),                           -- 老师后续动作，见上
  outcome_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dg_teacher_created ON diagram_generations(teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dg_type_created    ON diagram_generations(diagram_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dg_outcome         ON diagram_generations(outcome) WHERE outcome IS NOT NULL;

GRANT ALL ON diagram_generations TO mindcanvas;
