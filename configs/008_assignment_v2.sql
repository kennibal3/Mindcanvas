-- =============================================================
-- MindCanvas Phase8-v2 - 作业码与花名册数据表
-- 幂等执行：所有操作使用 IF NOT EXISTS
-- =============================================================

-- 作业码表（学生身份续接核心）
CREATE TABLE IF NOT EXISTS assignment_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id   UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    -- 专属码：绑定课堂学生uuid；通用码：null（提交时填姓名）
    student_uuid    VARCHAR(100),
    student_name    VARCHAR(100) DEFAULT '',
    token           VARCHAR(20) NOT NULL UNIQUE,
    token_type      VARCHAR(20) NOT NULL DEFAULT 'universal'
                    CHECK (token_type IN ('dedicated','universal')),
    -- dedicated: 绑定具体学生uuid（课堂续接，强身份）
    -- universal: 任何人可用，提交时填姓名（独立创建，弱身份）
    expires_at      TIMESTAMPTZ NOT NULL,
    used_at         TIMESTAMPTZ,               -- 首次使用时间
    submission_id   UUID REFERENCES assignment_submissions(id),  -- 关联的提交
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 花名册表（期望提交名单）
CREATE TABLE IF NOT EXISTS assignment_rosters (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id   UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    student_name    VARCHAR(100) NOT NULL,
    student_uuid    VARCHAR(100) DEFAULT '', -- 课堂续接后关联，初始可为空
    token_id        UUID REFERENCES assignment_tokens(id),
    source          VARCHAR(20) NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('classroom','manual','import')),
    -- classroom: 从课堂在线人数同步
    -- manual: 老师手动添加
    -- import: CSV导入
    expected        BOOLEAN DEFAULT TRUE,     -- 是否在应交名单
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    -- 同一作业不重复同名学生
    UNIQUE (assignment_id, student_name)
);

-- assignments表补充字段
ALTER TABLE assignments
    ADD COLUMN IF NOT EXISTS expected_count   INT DEFAULT 0,
    ADD COLUMN IF NOT EXISTS roster_source    VARCHAR(20) DEFAULT 'manual'
                             CHECK (roster_source IN ('classroom','manual','import')),
    ADD COLUMN IF NOT EXISTS token_type       VARCHAR(20) DEFAULT 'universal'
                             CHECK (token_type IN ('dedicated','universal'));

-- =============================================================
-- 索引
-- =============================================================
CREATE INDEX IF NOT EXISTS idx_tokens_assignment  ON assignment_tokens(assignment_id);
CREATE INDEX IF NOT EXISTS idx_tokens_token       ON assignment_tokens(token);
CREATE INDEX IF NOT EXISTS idx_tokens_student     ON assignment_tokens(student_uuid);
CREATE INDEX IF NOT EXISTS idx_tokens_submission  ON assignment_tokens(submission_id);

CREATE INDEX IF NOT EXISTS idx_roster_assignment  ON assignment_rosters(assignment_id);
CREATE INDEX IF NOT EXISTS idx_roster_student     ON assignment_rosters(student_uuid);
CREATE INDEX IF NOT EXISTS idx_roster_token       ON assignment_rosters(token_id);

-- =============================================================
-- 注释
-- =============================================================
COMMENT ON TABLE assignment_tokens  IS '作业码表：学生课后提交身份续接机制';
COMMENT ON TABLE assignment_rosters IS '花名册表：期望提交名单，支持课堂同步/手动/CSV导入';

SELECT 'Phase8-v2 token & roster tables created OK' AS result;
