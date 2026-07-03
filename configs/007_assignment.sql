-- =============================================================
-- MindCanvas Phase8 - AI作业评价中心数据表
-- 幂等执行：所有操作使用 IF NOT EXISTS
-- =============================================================

-- 作业任务主表
CREATE TABLE IF NOT EXISTS assignments (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id     UUID REFERENCES rooms(id) ON DELETE CASCADE,
    created_by  UUID NOT NULL REFERENCES users(id),
    title       VARCHAR(200) NOT NULL,
    description TEXT DEFAULT '',
    status      VARCHAR(20) NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft','collecting','reviewing','closed')),
    allow_resubmit  BOOLEAN DEFAULT TRUE,
    due_at      TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 作业材料表（任务说明/评分标准/参考资料/样例/学生提交）
CREATE TABLE IF NOT EXISTS assignment_materials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id   UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    uploader_id     VARCHAR(200) NOT NULL, -- user_id 或 student_uuid
    uploader_role   VARCHAR(20) NOT NULL DEFAULT 'teacher'
                    CHECK (uploader_role IN ('teacher','student')),
    material_role   VARCHAR(30) NOT NULL DEFAULT 'instruction'
                    CHECK (material_role IN (
                        'instruction',   -- 任务说明
                        'rubric_source', -- 评分标准原文
                        'reference',     -- 参考资料
                        'example',       -- 优秀样例
                        'submission'     -- 学生提交
                    )),
    original_name   VARCHAR(500) NOT NULL,
    file_path       TEXT,           -- 本地文件路径（上传文件）
    file_url        TEXT,           -- 访问 URL
    file_type       VARCHAR(50),    -- pdf/docx/pptx/image/text 等
    file_size       BIGINT DEFAULT 0,
    content_text    TEXT DEFAULT '', -- 直接提交的文字内容
    -- 解析结果
    parsed_markdown TEXT DEFAULT '',
    parse_status    VARCHAR(20) DEFAULT 'pending'
                    CHECK (parse_status IN ('pending','parsing','done','failed','skipped')),
    parse_error     TEXT DEFAULT '',
    word_count      INT DEFAULT 0,
    char_count      INT DEFAULT 0,
    parse_elapsed_ms INT DEFAULT 0,
    parsed_at       TIMESTAMPTZ,
    -- 元数据
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 评分标准版本表（支持版本化，避免同批作业混算）
CREATE TABLE IF NOT EXISTS assignment_rubrics (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id   UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    version         INT NOT NULL DEFAULT 1,
    source          VARCHAR(20) NOT NULL DEFAULT 'generated'
                    CHECK (source IN ('extracted','generated','manual')),
    criteria_json   JSONB NOT NULL DEFAULT '[]',
    -- criteria_json 结构：
    -- [{"name":"内容理解","weight":20,"levels":[
    --   {"score":5,"label":"优秀","desc":"..."},
    --   {"score":3,"label":"良好","desc":"..."},
    --   {"score":1,"label":"待改进","desc":"..."}
    -- ]}]
    total_score     INT NOT NULL DEFAULT 100,
    teacher_confirmed   BOOLEAN DEFAULT FALSE,
    confirmed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (assignment_id, version)
);

-- 学生提交表
CREATE TABLE IF NOT EXISTS assignment_submissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id   UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_uuid    VARCHAR(100) NOT NULL,
    student_name    VARCHAR(100) DEFAULT '',
    group_id        UUID,
    version         INT NOT NULL DEFAULT 1,
    content_type    VARCHAR(20) NOT NULL DEFAULT 'text'
                    CHECK (content_type IN ('text','file','link','mixed')),
    content_text    TEXT DEFAULT '',
    material_ids    UUID[],         -- 关联的 assignment_materials
    submitted_at    TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- AI初评与教师确认结果表
CREATE TABLE IF NOT EXISTS assignment_assessments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    submission_id   UUID NOT NULL REFERENCES assignment_submissions(id) ON DELETE CASCADE,
    rubric_id       UUID NOT NULL REFERENCES assignment_rubrics(id),
    -- AI评价结果
    ai_score        NUMERIC(5,2),
    ai_dimension_scores JSONB DEFAULT '{}',
    -- {"内容理解":4,"逻辑结构":3,...}
    ai_feedback     TEXT DEFAULT '',
    ai_highlights   TEXT DEFAULT '',   -- 亮点
    ai_issues       TEXT DEFAULT '',   -- 问题
    ai_suggestions  TEXT DEFAULT '',   -- 修改建议
    ai_assessed_at  TIMESTAMPTZ,
    -- 教师确认结果
    final_score     NUMERIC(5,2),
    final_dimension_scores JSONB DEFAULT '{}',
    final_feedback  TEXT DEFAULT '',
    review_status   VARCHAR(20) DEFAULT 'pending'
                    CHECK (review_status IN ('pending','ai_done','teacher_confirmed','published')),
    reviewed_by     UUID REFERENCES users(id),
    reviewed_at     TIMESTAMPTZ,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 反馈日志表（记录发布、重评、编辑等操作）
CREATE TABLE IF NOT EXISTS assignment_feedback_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id   UUID NOT NULL REFERENCES assignment_assessments(id) ON DELETE CASCADE,
    action_type     VARCHAR(30) NOT NULL,
    -- publish/unpublish/re_assess/edit_score/edit_feedback
    actor_id        VARCHAR(200) NOT NULL,
    action_data     JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================
-- 索引
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_assignments_room    ON assignments(room_id);
CREATE INDEX IF NOT EXISTS idx_assignments_creator ON assignments(created_by);
CREATE INDEX IF NOT EXISTS idx_assignments_status  ON assignments(status);

CREATE INDEX IF NOT EXISTS idx_am_assignment  ON assignment_materials(assignment_id);
CREATE INDEX IF NOT EXISTS idx_am_uploader   ON assignment_materials(uploader_id);
CREATE INDEX IF NOT EXISTS idx_am_role       ON assignment_materials(material_role);
CREATE INDEX IF NOT EXISTS idx_am_parse      ON assignment_materials(parse_status);

CREATE INDEX IF NOT EXISTS idx_rubrics_assignment ON assignment_rubrics(assignment_id);

CREATE INDEX IF NOT EXISTS idx_submissions_assignment ON assignment_submissions(assignment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_student    ON assignment_submissions(student_uuid);

CREATE INDEX IF NOT EXISTS idx_assessments_submission ON assignment_assessments(submission_id);
CREATE INDEX IF NOT EXISTS idx_assessments_status     ON assignment_assessments(review_status);

CREATE INDEX IF NOT EXISTS idx_fbl_assessment ON assignment_feedback_logs(assessment_id);

-- =============================================================
-- 注释
-- =============================================================
COMMENT ON TABLE assignments              IS '作业任务主表';
COMMENT ON TABLE assignment_materials     IS '作业相关材料（任务说明/评分标准/参考/样例/提交）';
COMMENT ON TABLE assignment_rubrics       IS '评分标准版本表';
COMMENT ON TABLE assignment_submissions   IS '学生提交表';
COMMENT ON TABLE assignment_assessments   IS 'AI初评与教师确认结果';
COMMENT ON TABLE assignment_feedback_logs IS '反馈操作日志';

SELECT 'Phase8 assignment tables created OK' AS result;
