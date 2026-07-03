-- =============================================================
-- MindCanvas v4.1 - Phase6 Migration
-- 新增：peer_reviews 同伴互评表
-- 幂等执行：使用 IF NOT EXISTS
-- =============================================================

-- 同伴互评表
-- submission_id 对应 widget_interactions.id（作品墙的一条提交记录）
-- reviewer_uuid 评价者UUID
-- 唯一约束：每人对每件作品只能评价一次
CREATE TABLE IF NOT EXISTS peer_reviews (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- 关联的作品墙元素（dropzone_widget）
    dropzone_id     UUID NOT NULL REFERENCES room_elements(id) ON DELETE CASCADE,
    -- 被评价的提交记录ID（widget_interactions.id）
    submission_id   UUID NOT NULL,
    -- 评价者UUID（学生或教师）
    reviewer_uuid   TEXT NOT NULL,
    -- 评分维度 JSONB，如 {"quality": 4, "creativity": 5, "expression": 3}
    scores          JSONB DEFAULT '{}',
    -- 文字评论（可选）
    comment         TEXT DEFAULT '',
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    -- 每人对每件作品只评价一次
    UNIQUE(submission_id, reviewer_uuid)
);

-- 索引：按作品墙元素查询所有互评
CREATE INDEX IF NOT EXISTS idx_pr_dropzone_id
    ON peer_reviews(dropzone_id);

-- 索引：按提交记录查询互评
CREATE INDEX IF NOT EXISTS idx_pr_submission_id
    ON peer_reviews(submission_id);

-- 索引：按评价者查询
CREATE INDEX IF NOT EXISTS idx_pr_reviewer_uuid
    ON peer_reviews(reviewer_uuid);

-- 索引：时间排序
CREATE INDEX IF NOT EXISTS idx_pr_created_at
    ON peer_reviews(created_at DESC);

COMMENT ON TABLE peer_reviews IS '同伴互评记录表，每人对每件作品只能评价一次';
COMMENT ON COLUMN peer_reviews.dropzone_id IS '关联的作品墙Widget元素ID';
COMMENT ON COLUMN peer_reviews.submission_id IS '被评价的提交记录ID（对应widget_interactions.id）';
COMMENT ON COLUMN peer_reviews.reviewer_uuid IS '评价者UUID';
COMMENT ON COLUMN peer_reviews.scores IS '评分维度JSON，如{"quality":4,"creativity":5}';
