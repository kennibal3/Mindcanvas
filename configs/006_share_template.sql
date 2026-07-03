-- =============================================================
-- MindCanvas v4.1 Phase7 - 公开分享页 + 模板中心 数据库迁移
-- 新增表：room_shares（分享配置）、room_templates（模板库）
-- 幂等执行：使用 IF NOT EXISTS 防止重复执行报错
-- =============================================================

-- 启用 pgcrypto（gen_random_uuid 依赖）
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================
-- room_shares：公开分享页配置表
-- 每次发布生成唯一 share_token，支持密码、过期、隐藏姓名
-- =============================================================
CREATE TABLE IF NOT EXISTS room_shares (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id      UUID        NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    share_token  TEXT        UNIQUE NOT NULL,       -- 随机短 token，用于 /share/:token URL
    title        TEXT,                               -- 分享标题（默认取房间标题）
    description  TEXT,                               -- 分享描述/备注
    visibility   TEXT        NOT NULL DEFAULT 'public'
                             CHECK (visibility IN ('public', 'password')),
    password_hash TEXT,                              -- bcrypt 散列，visibility=password 时必填
    hide_names   BOOLEAN     NOT NULL DEFAULT FALSE, -- 是否隐藏学生姓名
    show_stats   BOOLEAN     NOT NULL DEFAULT TRUE,  -- 是否展示统计数据（投票/词云/问答）
    show_canvas  BOOLEAN     NOT NULL DEFAULT TRUE,  -- 是否展示画布快照
    show_dropzone BOOLEAN    NOT NULL DEFAULT TRUE,  -- 是否展示作品墙
    expires_at   TIMESTAMPTZ,                        -- NULL 表示永不过期
    view_count   INT         NOT NULL DEFAULT 0,     -- 累计访问次数
    created_by   UUID        REFERENCES users(id),   -- 发布教师 ID
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_room_shares_room_id     ON room_shares(room_id);
CREATE INDEX IF NOT EXISTS idx_room_shares_token       ON room_shares(share_token);
CREATE INDEX IF NOT EXISTS idx_room_shares_created_by  ON room_shares(created_by);
CREATE INDEX IF NOT EXISTS idx_room_shares_expires_at  ON room_shares(expires_at)
    WHERE expires_at IS NOT NULL;

COMMENT ON TABLE  room_shares                  IS '公开分享页配置，每次发布生成唯一 token';
COMMENT ON COLUMN room_shares.share_token      IS '短 token，用于 /share/:token 访问';
COMMENT ON COLUMN room_shares.visibility       IS 'public=公开访问，password=密码保护';
COMMENT ON COLUMN room_shares.hide_names       IS 'TRUE 时展示作品和名单时隐藏学生姓名';
COMMENT ON COLUMN room_shares.show_stats       IS 'TRUE 时展示投票/词云/问答统计图表';
COMMENT ON COLUMN room_shares.show_canvas      IS 'TRUE 时展示画布快照区域';
COMMENT ON COLUMN room_shares.show_dropzone    IS 'TRUE 时展示作品墙提交内容';

-- =============================================================
-- room_templates：课堂模板库
-- 教师从当前房间保存模板，复用创建新房间
-- =============================================================
CREATE TABLE IF NOT EXISTS room_templates (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT        NOT NULL,              -- 模板名称
    description   TEXT,                              -- 模板描述
    category      TEXT,                              -- 分类标签（如：语文/数学/讨论课）
    tags          TEXT[]      DEFAULT '{}',          -- 自定义标签数组
    thumbnail     TEXT,                              -- 缩略图 URL（可选）
    source_room   UUID        REFERENCES rooms(id) ON DELETE SET NULL,
    steps_json    JSONB       DEFAULT '[]',          -- 课堂流程节点快照
    elements_json JSONB       DEFAULT '[]',          -- 画布元素快照（Widget 配置）
    is_public     BOOLEAN     NOT NULL DEFAULT FALSE, -- TRUE 表示所有教师可见
    author_id     UUID        REFERENCES users(id) ON DELETE SET NULL,
    use_count     INT         NOT NULL DEFAULT 0,    -- 被使用次数
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_room_templates_author   ON room_templates(author_id);
CREATE INDEX IF NOT EXISTS idx_room_templates_public   ON room_templates(is_public) WHERE is_public = TRUE;
CREATE INDEX IF NOT EXISTS idx_room_templates_category ON room_templates(category);
CREATE INDEX IF NOT EXISTS idx_room_templates_source   ON room_templates(source_room);

COMMENT ON TABLE  room_templates               IS '课堂模板库，支持保存和复用课堂配置';
COMMENT ON COLUMN room_templates.steps_json    IS '课堂流程节点数组快照（JSON）';
COMMENT ON COLUMN room_templates.elements_json IS '画布 Widget 元素配置快照（JSON）';
COMMENT ON COLUMN room_templates.is_public     IS 'TRUE 时所有教师可见，FALSE 仅作者可见';

-- 执行完成提示
DO $$
BEGIN
    RAISE NOTICE 'Phase7 Migration 006 执行完成：room_shares 表 + room_templates 表已就绪';
END $$;
