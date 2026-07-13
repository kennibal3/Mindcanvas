-- =============================================================
-- MindCanvas REQ-039 第二期 - 讲评报告与个性化推荐 数据表
-- 幂等执行：所有操作使用 IF NOT EXISTS
-- 迁移编号：从 016 起（012 有历史冲突 chat/groups_v2；015 已被 REQ-041 占）
--
-- 本期真正读写：assignment_lecture_reports / assignment_report_blocks
-- 本期只建骨架待后续期：error_tags / error_evidence / recommended_questions / teacher_preference_events
-- 结尾 GRANT 给 mindcanvas，防 postgres-owner 坑（若用 sudo -u postgres 跑迁移，
--   表 owner 会是 postgres，App 以 mindcanvas 连库将无权限）。建议直接 psql -U mindcanvas 跑。
-- =============================================================

-- ── 1. 讲评报告主表（本期读写）──────────────────────────────
CREATE TABLE IF NOT EXISTS assignment_lecture_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id     UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    teacher_id        UUID REFERENCES users(id),
    status            VARCHAR(20) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','confirmed','exported','archived')),
    title             VARCHAR(300) DEFAULT '',
    summary           TEXT DEFAULT '',
    source_snapshot   JSONB NOT NULL DEFAULT '{}',
    -- source_snapshot：生成时快照（花名册数/已交数/rubric 版本/分析范围），保证报告可追溯
    generation_status VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (generation_status IN ('pending','analyzing','done','failed')),
    last_error        TEXT DEFAULT '',
    confirmed_at      TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── 2. 报告内容块表（本期读写）──────────────────────────────
CREATE TABLE IF NOT EXISTS assignment_report_blocks (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id         UUID NOT NULL REFERENCES assignment_lecture_reports(id) ON DELETE CASCADE,
    block_type        VARCHAR(30) NOT NULL DEFAULT 'custom'
                      CHECK (block_type IN (
                          'overview',            -- 班级总体概览
                          'dimension_analysis',  -- 维度分析
                          'evidence',            -- 证据/样例
                          'recommendation',      -- 推荐练习
                          'student_summary',     -- 学生补救摘要
                          'custom'               -- 自定义
                      )),
    sort_order        INT NOT NULL DEFAULT 0,
    title             VARCHAR(300) DEFAULT '',
    content           JSONB NOT NULL DEFAULT '{}',
    ai_generated      BOOLEAN DEFAULT TRUE,
    teacher_confirmed BOOLEAN DEFAULT FALSE,
    source_refs       JSONB NOT NULL DEFAULT '[]',
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── 3. 错因标签表（本期只建，预置 8 类系统标签）──────────────
CREATE TABLE IF NOT EXISTS assignment_error_tags (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         VARCHAR(100) DEFAULT '',
    subject           VARCHAR(50) DEFAULT '',
    name              VARCHAR(100) NOT NULL,
    description       TEXT DEFAULT '',
    parent_id         UUID REFERENCES assignment_error_tags(id) ON DELETE SET NULL,
    is_system         BOOLEAN DEFAULT FALSE,
    created_by        VARCHAR(200) DEFAULT 'system',
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── 4. 错误证据表（本期只建）────────────────────────────────
CREATE TABLE IF NOT EXISTS assignment_error_evidence (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id     UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    submission_id     UUID REFERENCES assignment_submissions(id) ON DELETE CASCADE,
    assessment_id     UUID,
    student_uuid      VARCHAR(100) DEFAULT '',
    criterion_key     VARCHAR(200) DEFAULT '',
    error_tag_id      UUID REFERENCES assignment_error_tags(id) ON DELETE SET NULL,
    evidence_type     VARCHAR(20) NOT NULL DEFAULT 'text'
                      CHECK (evidence_type IN ('text','image_crop','file_ref','teacher_note')),
    evidence_content  JSONB NOT NULL DEFAULT '{}',
    confidence        NUMERIC(4,3) DEFAULT 0,
    teacher_confirmed BOOLEAN DEFAULT FALSE,
    anonymized        BOOLEAN DEFAULT FALSE,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ── 5. 推荐题表（本期只建）──────────────────────────────────
CREATE TABLE IF NOT EXISTS assignment_recommended_questions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id       UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    report_id           UUID REFERENCES assignment_lecture_reports(id) ON DELETE SET NULL,
    source_type         VARCHAR(20) NOT NULL DEFAULT 'ai_generated'
                        CHECK (source_type IN ('ai_generated','question_bank','teacher_created')),
    target_type         VARCHAR(20) NOT NULL DEFAULT 'class'
                        CHECK (target_type IN ('class','group','student')),
    target_ref          VARCHAR(200) DEFAULT '',
    knowledge_points    JSONB NOT NULL DEFAULT '[]',
    error_tag_ids       JSONB NOT NULL DEFAULT '[]',
    difficulty          VARCHAR(20) DEFAULT '',
    question_type       VARCHAR(30) DEFAULT '',
    content             JSONB NOT NULL DEFAULT '{}',
    answer              JSONB NOT NULL DEFAULT '{}',
    explanation         TEXT DEFAULT '',
    recommendation_reason TEXT DEFAULT '',
    teacher_action      VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (teacher_action IN ('pending','accepted','edited','rejected','saved','published')),
    final_content       JSONB NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

-- ── 6. 教师偏好事件表（本期只建）────────────────────────────
CREATE TABLE IF NOT EXISTS teacher_preference_events (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id        UUID REFERENCES users(id),
    tenant_id         VARCHAR(100) DEFAULT '',
    subject           VARCHAR(50) DEFAULT '',
    assignment_id     UUID REFERENCES assignments(id) ON DELETE CASCADE,
    object_type       VARCHAR(30) NOT NULL
                      CHECK (object_type IN ('report_block','recommended_question','error_tag','export_template')),
    object_id         UUID,
    action_type       VARCHAR(20) NOT NULL
                      CHECK (action_type IN ('accept','edit','reject','regenerate','save','publish','export')),
    before_value      JSONB NOT NULL DEFAULT '{}',
    after_value       JSONB NOT NULL DEFAULT '{}',
    metadata          JSONB NOT NULL DEFAULT '{}',
    created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- 索引
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_lecture_reports_assignment ON assignment_lecture_reports(assignment_id);
CREATE INDEX IF NOT EXISTS idx_lecture_reports_genstatus  ON assignment_lecture_reports(generation_status);
CREATE INDEX IF NOT EXISTS idx_report_blocks_report       ON assignment_report_blocks(report_id);
CREATE INDEX IF NOT EXISTS idx_report_blocks_sort         ON assignment_report_blocks(report_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_error_tags_subject         ON assignment_error_tags(subject);
CREATE INDEX IF NOT EXISTS idx_error_evidence_assignment  ON assignment_error_evidence(assignment_id);
CREATE INDEX IF NOT EXISTS idx_recq_assignment            ON assignment_recommended_questions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_recq_report                ON assignment_recommended_questions(report_id);
CREATE INDEX IF NOT EXISTS idx_pref_events_teacher        ON teacher_preference_events(teacher_id);
CREATE INDEX IF NOT EXISTS idx_pref_events_assignment     ON teacher_preference_events(assignment_id);

-- =============================================================
-- 预置 8 类系统错因标签（幂等：按 name 去重插入）
-- =============================================================
INSERT INTO assignment_error_tags (name, description, is_system, created_by)
SELECT v.name, v.description, TRUE, 'system'
FROM (VALUES
    ('概念混淆',   '对核心概念的理解出现偏差或混淆'),
    ('审题遗漏',   '未完整读题、遗漏题目关键条件或要求'),
    ('方法选择不当', '解题思路或方法不适用于本题'),
    ('表达不规范', '语言/符号/格式表达不规范或不清晰'),
    ('过程缺失',   '缺少必要的推理、计算或论证过程'),
    ('证据不足',   '论点缺乏充分的证据或例证支撑'),
    ('计算错误',   '运算或数值处理出现错误'),
    ('作图不完整', '图形/图表绘制缺失要素或不完整')
) AS v(name, description)
WHERE NOT EXISTS (
    SELECT 1 FROM assignment_error_tags t WHERE t.name = v.name AND t.is_system = TRUE
);

-- =============================================================
-- 注释
-- =============================================================
COMMENT ON TABLE assignment_lecture_reports        IS '讲评报告主表（一份作业一份讲评报告）';
COMMENT ON TABLE assignment_report_blocks          IS '讲评报告内容块';
COMMENT ON TABLE assignment_error_tags             IS '错因标签库（系统预置+教师自定义）';
COMMENT ON TABLE assignment_error_evidence         IS '学生错误证据';
COMMENT ON TABLE assignment_recommended_questions  IS '推荐练习题';
COMMENT ON TABLE teacher_preference_events         IS '教师偏好学习事件日志';

-- =============================================================
-- 授权：确保 App 用户 mindcanvas 具备全部 DML 权限
--   （幂等；若迁移已用 mindcanvas 身份执行则为自授权、无副作用）
-- =============================================================
GRANT ALL PRIVILEGES ON
    assignment_lecture_reports,
    assignment_report_blocks,
    assignment_error_tags,
    assignment_error_evidence,
    assignment_recommended_questions,
    teacher_preference_events
TO mindcanvas;

SELECT 'REQ-039 P2 migration 016 lecture_report OK' AS result;
