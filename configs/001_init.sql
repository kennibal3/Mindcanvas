-- ============================================================
-- MindCanvas v3.0 数据库初始化脚本
-- 6张核心表：tenants, users, rooms, room_elements,
--            widget_interactions, room_sessions
-- PostgreSQL 16 + pgcrypto 扩展
-- ============================================================

-- 确保扩展存在
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. tenants 租户表
-- 说明：学校/机构主体，superadmin 管理
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         VARCHAR(200) NOT NULL,
    max_teachers INT NOT NULL DEFAULT 50,
    max_rooms    INT NOT NULL DEFAULT 100,
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 租户名称索引（管理后台搜索）
CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants(name);
-- 租户状态索引（过滤活跃租户）
CREATE INDEX IF NOT EXISTS idx_tenants_active ON tenants(is_active);

COMMENT ON TABLE tenants IS '租户表：学校/机构主体';
COMMENT ON COLUMN tenants.max_teachers IS '该租户最大教师数量限制';
COMMENT ON COLUMN tenants.max_rooms IS '该租户最大房间数量限制';

-- ============================================================
-- 2. users 统一用户表（替代原 teachers 表，四级角色）
-- 说明：superadmin/admin/teacher 三种有账号角色
--       学生无账号，不在此表
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    UUID REFERENCES tenants(id) ON DELETE SET NULL,
    username     VARCHAR(50) NOT NULL,
    password     VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL DEFAULT '',
    role         VARCHAR(20) NOT NULL
                 CHECK (role IN ('superadmin', 'admin', 'teacher')),
    is_active    BOOLEAN NOT NULL DEFAULT TRUE,
    created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    -- superadmin 的 tenant_id 为 NULL，admin/teacher 必须有 tenant_id
    CONSTRAINT chk_tenant_role CHECK (
        (role = 'superadmin' AND tenant_id IS NULL) OR
        (role IN ('admin', 'teacher') AND tenant_id IS NOT NULL)
    )
);

-- 用户名全局唯一
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username ON users(username);
-- 按租户查询用户
CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id);
-- 按角色查询
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
-- 按状态过滤
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

COMMENT ON TABLE users IS '统一用户表：superadmin/admin/teacher 三级有账号用户';
COMMENT ON COLUMN users.tenant_id IS 'superadmin 时为 NULL，其他角色必须关联租户';
COMMENT ON COLUMN users.password IS 'bcrypt 加密存储，禁止明文';
COMMENT ON COLUMN users.role IS '角色：superadmin(超管) / admin(管理员) / teacher(教师)';
COMMENT ON COLUMN users.created_by IS '创建者 ID，用于审计追踪';

-- ============================================================
-- 3. rooms 房间表
-- 说明：教师创建的课堂房间，学生扫码加入
-- ============================================================
CREATE TABLE IF NOT EXISTS rooms (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title        VARCHAR(200) NOT NULL,
    invite_code  VARCHAR(20) NOT NULL,
    is_locked    BOOLEAN NOT NULL DEFAULT FALSE,
    is_readonly  BOOLEAN NOT NULL DEFAULT FALSE,
    max_capacity INT NOT NULL DEFAULT 50,
    status       VARCHAR(20) NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active', 'finished', 'archived')),
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    finished_at  TIMESTAMP WITH TIME ZONE
);

-- 邀请码全局唯一（扫码入场查询）
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_invite_code ON rooms(invite_code);
-- 按教师查询房间列表
CREATE INDEX IF NOT EXISTS idx_rooms_teacher ON rooms(teacher_id);
-- 按租户查询（管理员查看本校房间）
CREATE INDEX IF NOT EXISTS idx_rooms_tenant ON rooms(tenant_id);
-- 按状态过滤活跃房间
CREATE INDEX IF NOT EXISTS idx_rooms_status ON rooms(status);

COMMENT ON TABLE rooms IS '课堂房间表：教师创建，学生扫码加入';
COMMENT ON COLUMN rooms.invite_code IS '房间邀请码，6位字母数字，全局唯一';
COMMENT ON COLUMN rooms.is_locked IS '画布锁定状态，锁定后学生无法操作';
COMMENT ON COLUMN rooms.is_readonly IS '课后只读模式，结课后仅可浏览';
COMMENT ON COLUMN rooms.status IS '房间状态：active(活跃) / finished(已结束) / archived(已归档)';

-- ============================================================
-- 4. room_elements 房间元素表（核心表）
-- 说明：存储画布上所有元素，payload 为 JSONB 灵活存储
-- ============================================================
CREATE TABLE IF NOT EXISTS room_elements (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id      UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    creator_uuid VARCHAR(100) NOT NULL,
    creator_name VARCHAR(100) NOT NULL DEFAULT '',
    type         VARCHAR(50) NOT NULL,
    payload      JSONB NOT NULL DEFAULT '{}',
    is_deleted   BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 按房间查询所有元素（最高频查询）
CREATE INDEX IF NOT EXISTS idx_elem_room ON room_elements(room_id);
-- 按类型过滤（导出特定类型数据）
CREATE INDEX IF NOT EXISTS idx_elem_type ON room_elements(type);
-- 按创建者查询（元素溯源）
CREATE INDEX IF NOT EXISTS idx_elem_creator ON room_elements(creator_uuid);
-- JSONB GIN 索引（支持 payload 内字段查询）
CREATE INDEX IF NOT EXISTS idx_elem_payload ON room_elements USING GIN(payload);
-- 条件索引：只索引未删除的元素（room_sync 查询优化）
CREATE INDEX IF NOT EXISTS idx_elem_active ON room_elements(room_id) WHERE is_deleted = FALSE;

COMMENT ON TABLE room_elements IS '房间元素表：画布上所有卡片/组件/画笔轨迹';
COMMENT ON COLUMN room_elements.creator_uuid IS '创建者 UUID（教师JWT的user_id 或学生的 guest-xxx）';
COMMENT ON COLUMN room_elements.type IS '元素类型：text_card/image_card/video_card/file_card/polling_widget/wordcloud_widget/qa_widget/excalidraw_stroke/dropzone';
COMMENT ON COLUMN room_elements.payload IS 'JSONB 灵活存储，不同类型有不同字段结构';
COMMENT ON COLUMN room_elements.is_deleted IS '软删除标记，不物理删除以支持撤销';

-- ============================================================
-- 5. widget_interactions 互动记录表
-- 说明：投票/词云/问答的学生提交记录，仅追加
-- ============================================================
CREATE TABLE IF NOT EXISTS widget_interactions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    element_id   UUID NOT NULL REFERENCES room_elements(id) ON DELETE CASCADE,
    room_id      UUID NOT NULL,
    student_uuid VARCHAR(100) NOT NULL,
    student_name VARCHAR(100) NOT NULL DEFAULT '',
    action_type  VARCHAR(50) NOT NULL,
    action_data  JSONB NOT NULL DEFAULT '{}',
    is_correct   BOOLEAN,
    created_at   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 防重复投票：唯一约束（数据库原子性保障，替代应用层 SELECT COUNT 竞态方案）
-- 仅对 vote 类型生效，词云/问答允许多次提交
CREATE UNIQUE INDEX IF NOT EXISTS idx_wi_no_duplicate_vote
    ON widget_interactions(element_id, student_uuid, action_type)
    WHERE action_type = 'vote';

-- 按组件查询所有互动（统计图表）
CREATE INDEX IF NOT EXISTS idx_wi_element ON widget_interactions(element_id);
-- 按房间查询（导出报表）
CREATE INDEX IF NOT EXISTS idx_wi_room ON widget_interactions(room_id);
-- 按学生查询（学生个人数据）
CREATE INDEX IF NOT EXISTS idx_wi_student ON widget_interactions(student_uuid);

COMMENT ON TABLE widget_interactions IS '互动记录表：投票/词云/问答的学生提交，仅追加不修改';
COMMENT ON COLUMN widget_interactions.action_type IS '操作类型：vote(投票) / add_word(词云) / answer(问答)';
COMMENT ON COLUMN widget_interactions.action_data IS 'JSONB 存储具体操作数据，如 {option:"赞同"} 或 {word:"创新"}';
COMMENT ON COLUMN widget_interactions.is_correct IS '问答正确性：true/false/NULL(投票和词云无此字段)';

-- ============================================================
-- 6. room_sessions 房间会话表
-- 说明：学生入场记录，含昵称/头像/IP/封禁状态
-- ============================================================
CREATE TABLE IF NOT EXISTS room_sessions (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id      UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    student_uuid VARCHAR(100) NOT NULL,
    nickname     VARCHAR(100) NOT NULL,
    suffix       VARCHAR(10) NOT NULL,
    avatar_id    INT NOT NULL DEFAULT 1,
    ip_address   INET,
    is_banned    BOOLEAN NOT NULL DEFAULT FALSE,
    joined_at    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    left_at      TIMESTAMP WITH TIME ZONE
);

-- 按房间查询在线成员
CREATE INDEX IF NOT EXISTS idx_sess_room ON room_sessions(room_id);
-- 按学生 UUID 查询（跨设备认领/重连）
CREATE INDEX IF NOT EXISTS idx_sess_student ON room_sessions(student_uuid);
-- 按房间+学生联合查询（入场去重检查）
CREATE INDEX IF NOT EXISTS idx_sess_room_student ON room_sessions(room_id, student_uuid);

COMMENT ON TABLE room_sessions IS '房间会话表：学生入场/离场记录';
COMMENT ON COLUMN room_sessions.suffix IS '4位随机数字后缀，防冒充（如 张三#1024）';
COMMENT ON COLUMN room_sessions.ip_address IS '入场IP，用于IP封禁';
COMMENT ON COLUMN room_sessions.is_banned IS '是否被踢出/封禁';

-- ============================================================
-- 完成提示
-- ============================================================
