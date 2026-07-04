-- 014_chat_logs.sql
-- chat_logs 表：记录 AI 对话使用量
-- 幂等，可重复执行

DO $$
BEGIN

-- ── 1. 创建 chat_logs 表 ──────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'chat_logs') THEN

    CREATE TABLE chat_logs (
        id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id         UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        session_id      TEXT        NOT NULL,               -- 前端传的 session_id（非 DB 主键）
        model           TEXT        NOT NULL DEFAULT '',    -- 使用的模型，如 doubao-seed-2-1-turbo-260628
        role            TEXT        NOT NULL DEFAULT 'user',-- 触发本次记录的角色：user
        prompt_tokens   INT         NOT NULL DEFAULT 0,     -- 输入 token 数（Ark API 返回）
        completion_tokens INT       NOT NULL DEFAULT 0,     -- 输出 token 数
        total_tokens    INT         NOT NULL DEFAULT 0,     -- 合计 token 数
        latency_ms      INT         NOT NULL DEFAULT 0,     -- 接口耗时（毫秒）
        is_stream       BOOLEAN     NOT NULL DEFAULT false, -- 是否流式
        error           TEXT,                               -- 错误信息（NULL=成功）
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    COMMENT ON TABLE  chat_logs IS 'AI 对话使用量日志（每条 user 消息一行）';
    COMMENT ON COLUMN chat_logs.session_id       IS '前端会话 ID，与 chat_sessions 表关联';
    COMMENT ON COLUMN chat_logs.prompt_tokens    IS '本次请求的输入 token 数';
    COMMENT ON COLUMN chat_logs.completion_tokens IS '本次请求的输出 token 数';
    COMMENT ON COLUMN chat_logs.latency_ms       IS '从发请求到收完响应的毫秒数';
    COMMENT ON COLUMN chat_logs.error            IS 'NULL 表示成功；非 NULL 记录错误摘要';

    RAISE NOTICE 'TABLE chat_logs created';
ELSE
    RAISE NOTICE 'TABLE chat_logs already exists, skipping';
END IF;

-- ── 2. 索引 ──────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_cl_user_created') THEN
    CREATE INDEX idx_cl_user_created ON chat_logs(user_id, created_at DESC);
    RAISE NOTICE 'INDEX idx_cl_user_created created';
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_cl_session') THEN
    CREATE INDEX idx_cl_session ON chat_logs(session_id);
    RAISE NOTICE 'INDEX idx_cl_session created';
END IF;

IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_cl_created') THEN
    CREATE INDEX idx_cl_created ON chat_logs(created_at DESC);
    RAISE NOTICE 'INDEX idx_cl_created created';
END IF;

END $$;
