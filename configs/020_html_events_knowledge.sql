-- =============================================================
-- 020_html_events_knowledge.sql
-- REQ-043 Slice-1：HTML 课件互动数据收集 + 最小知识点表
-- 幂等可重跑；新表 owner=postgres，故建表后 GRANT ALL TO mindcanvas（同迁移 019 惯例）
-- =============================================================

-- 1. 最小知识点表（画像 roll-up 脊椎的最小形态；一期只做班级/教师级）
CREATE TABLE IF NOT EXISTS knowledge_points (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject    VARCHAR(50),
  name       VARCHAR(100) NOT NULL,
  code       VARCHAR(50),
  parent_id  UUID REFERENCES knowledge_points(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, name)
);
CREATE INDEX IF NOT EXISTS idx_kp_teacher ON knowledge_points(teacher_id);

-- 2. widget_interactions 挂知识点（对所有 widget 类型通用，native QA 将来也可挂）
ALTER TABLE widget_interactions
  ADD COLUMN IF NOT EXISTS knowledge_point_id UUID REFERENCES knowledge_points(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_wi_kp ON widget_interactions(knowledge_point_id) WHERE knowledge_point_id IS NOT NULL;

-- 3. 授权（app 连接用 mindcanvas 角色）
GRANT ALL ON knowledge_points TO mindcanvas;
