-- =============================================================
-- MindCanvas REQ-039 第三期 3c - 学生补救数据表
-- 幂等执行：CREATE TABLE IF NOT EXISTS / 约束先 DROP 后 ADD
-- 迁移编号：017（016 为讲评报告六表；012 有历史冲突，015 被 REQ-041 占）
--
-- 本期读写：assignment_student_remediations（新建）
--           assignment_recommended_questions（016 已建，本期写 target_type='student'）
-- 另：放宽 teacher_preference_events 的两处 CHECK，容纳补救相关事件
-- 结尾 GRANT 给 mindcanvas，防 postgres-owner 坑
-- =============================================================

-- ── 1. 学生补救主表 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS assignment_student_remediations (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id     UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
    report_id         UUID REFERENCES assignment_lecture_reports(id) ON DELETE SET NULL,
    submission_id     UUID REFERENCES assignment_submissions(id) ON DELETE SET NULL,
    -- student_uuid：专属码=课堂学生 uuid；通用码=token-<作业码>-<姓名>（故留 200 位）
    student_uuid      VARCHAR(200) NOT NULL,
    student_name      VARCHAR(200) DEFAULT '',
    generation_status VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (generation_status IN ('pending','generating','done','failed')),
    -- diagnosis：教师版诊断（薄弱维度/错因/证据原文），仅教师可见，不下发学生
    diagnosis         JSONB NOT NULL DEFAULT '{}',
    -- teacher_summary：AI 给教师的一句话小结；teacher_note：教师自己补的备注
    teacher_summary   TEXT DEFAULT '',
    teacher_note      TEXT DEFAULT '',
    -- gentle_feedback：温和版反馈，教师可编辑，发送后学生在提交页可见
    gentle_feedback   TEXT DEFAULT '',
    sent_at           TIMESTAMPTZ,
    last_error        TEXT DEFAULT '',
    created_at        TIMESTAMPTZ DEFAULT NOW(),
    updated_at        TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uniq_remediation_assignment_student UNIQUE (assignment_id, student_uuid)
);

CREATE INDEX IF NOT EXISTS idx_remediation_assignment ON assignment_student_remediations(assignment_id);
CREATE INDEX IF NOT EXISTS idx_remediation_student    ON assignment_student_remediations(assignment_id, student_uuid);
CREATE INDEX IF NOT EXISTS idx_remediation_sent       ON assignment_student_remediations(assignment_id, sent_at);

COMMENT ON TABLE assignment_student_remediations IS 'REQ-039 3c 学生补救（教师版诊断 + 温和版反馈 + 发送标记）';

-- ── 2. 学生补救题按 student 维度存 016 的推荐题表，补一个查询索引 ──
CREATE INDEX IF NOT EXISTS idx_recq_target
    ON assignment_recommended_questions(assignment_id, target_type, target_ref);

-- ── 3. 放宽偏好事件表的 CHECK（新增 student_remediation 对象与 send 动作）──
ALTER TABLE teacher_preference_events
    DROP CONSTRAINT IF EXISTS teacher_preference_events_object_type_check;
ALTER TABLE teacher_preference_events
    ADD  CONSTRAINT teacher_preference_events_object_type_check
    CHECK (object_type IN ('report_block','recommended_question','error_tag',
                           'export_template','student_remediation'));

ALTER TABLE teacher_preference_events
    DROP CONSTRAINT IF EXISTS teacher_preference_events_action_type_check;
ALTER TABLE teacher_preference_events
    ADD  CONSTRAINT teacher_preference_events_action_type_check
    CHECK (action_type IN ('accept','edit','reject','regenerate','save','publish','export','send'));

-- ── 4. 授权（幂等）──────────────────────────────────────────────
GRANT ALL PRIVILEGES ON assignment_student_remediations TO mindcanvas;

SELECT 'REQ-039 3c migration 017 student_remediation OK' AS result;
