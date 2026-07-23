-- =============================================================
-- MindCanvas 迁移 019 - 班级实体 + 花名册成员 + 房间绑班级（REQ-045 P2 实名核心）
-- 说明：
--   classes         老师建一次的班级，开 roster 房间时选。
--   class_students  花名册成员＝学生的最小稳定实体，其 id ＝稳定 student_id；
--                   roster 房间入场时 room_sessions.student_uuid 装这个 id，
--                   作业侧（专属码/花名册/提交）零迁移自动继承（见 token_service
--                   排除教师用 NOT EXISTS users，稳定 id 不落 users 空间故被正确纳入）。
--   rooms.class_id  仅 roster 形态用；其它形态为空。与迁移 018 的 collab_mode 配套。
-- 约定：幂等（IF NOT EXISTS / DO$$）；结尾 GRANT ALL TO mindcanvas 兜底
--       （避免 postgres-owner 导致 App 无权限的老坑，见 DEV_INDEX 已知坑）。
--       下一迁移从 020 起。
-- =============================================================

BEGIN;

-- 1) 班级
CREATE TABLE IF NOT EXISTS classes (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
    tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name       VARCHAR(100) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classes_teacher ON classes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_classes_tenant  ON classes(tenant_id);
COMMENT ON TABLE classes IS 'REQ-045 班级实体，老师建一次，开 roster 房间时选';

-- 2) 花名册成员＝稳定学生实体（id ＝稳定 student_id）
CREATE TABLE IF NOT EXISTS class_students (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- 稳定 student_id
    class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    student_name VARCHAR(100) NOT NULL,
    disambig     VARCHAR(20)  NOT NULL DEFAULT '',           -- 重名消歧：学号后两位/老师备注
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (class_id, student_name, disambig)
);
CREATE INDEX IF NOT EXISTS idx_class_students_class ON class_students(class_id);
COMMENT ON TABLE class_students IS 'REQ-045 花名册成员＝最小稳定学生实体，id 即稳定 student_id';

-- 3) 房间绑班级（仅 roster 形态用；幂等加列）
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'rooms' AND column_name = 'class_id'
    ) THEN
        ALTER TABLE rooms ADD COLUMN class_id UUID REFERENCES classes(id);
        COMMENT ON COLUMN rooms.class_id IS
            'REQ-045 roster 形态绑定的班级(classes.id)；其它 collab_mode 为空';
    END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_rooms_class ON rooms(class_id);

-- 4) 权限兜底（表 owner 可能是 postgres）
GRANT ALL ON classes        TO mindcanvas;
GRANT ALL ON class_students TO mindcanvas;

COMMIT;
