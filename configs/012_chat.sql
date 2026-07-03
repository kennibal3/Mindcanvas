-- =============================================================
-- MindCanvas Migration 012 - 养成类对话系统 (Victoria Chat)
-- 功能：独立Chat账号、角色设定、对话记录、记忆压缩、文件记忆库
-- =============================================================

-- 1. Chat账号权限标记（在users表新增chat_enabled字段）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS chat_enabled BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN users.chat_enabled IS 'Chat功能开关，仅chat_enabled=true的用户可访问/chat路由';

-- 2. Chat角色人设配置表
CREATE TABLE IF NOT EXISTS chat_personas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL DEFAULT 'AI助手',
  description TEXT NOT NULL DEFAULT '你是一个友好的AI助手',
  avatar_emoji TEXT DEFAULT '🤖',
  -- 记忆压缩配置
  compress_every  INT  DEFAULT 20,   -- 每N轮压缩一次（玩家可自定义）
  -- 当前使用的API Key（加密存储，前端也可覆盖）
  api_key_hint    TEXT,              -- 仅存末4位提示，完整key不入库
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)                    -- 每个用户一个人设
);

COMMENT ON TABLE chat_personas IS '养成类对话角色人设配置，每用户一条';

-- 3. 对话会话表（每次开启新话题为一个session）
CREATE TABLE IF NOT EXISTS chat_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       TEXT DEFAULT '新对话',
  is_active   BOOLEAN DEFAULT TRUE,
  -- 当前轮次（用于触发压缩）
  turn_count  INT DEFAULT 0,
  -- 最新记忆摘要（压缩后存这里，下次对话带入）
  memory_summary TEXT DEFAULT '',
  -- 压缩版本号
  compress_version INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id);
COMMENT ON TABLE chat_sessions IS '对话会话，每个话题一条记录，保存记忆摘要';

-- 4. 对话消息表（存储完整对话历史）
CREATE TABLE IF NOT EXISTS chat_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user','assistant','system')),
  content     TEXT NOT NULL,
  -- 是否已被压缩进摘要（压缩后标记，不再作为上下文发送）
  is_compressed BOOLEAN DEFAULT FALSE,
  -- 该消息所属轮次
  turn_number INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_compressed ON chat_messages(session_id, is_compressed);
COMMENT ON TABLE chat_messages IS '对话消息明细，is_compressed=true的消息已被压缩进摘要';

-- 5. 文件记忆库（永久存储上传的MD/Word文件内容）
CREATE TABLE IF NOT EXISTS chat_memory_files (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  file_type    TEXT NOT NULL CHECK (file_type IN ('markdown','word','text')),
  file_path    TEXT,                -- 原始文件路径
  content_text TEXT NOT NULL,       -- 解析后的纯文本内容
  -- 是否在对话中激活（可按需开关某个文件的记忆）
  is_active    BOOLEAN DEFAULT TRUE,
  file_size    INT DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_memory_files_user ON chat_memory_files(user_id);
COMMENT ON TABLE chat_memory_files IS '永久文件记忆库，上传的MD/Word文件解析后存入，对话时作为背景知识';

-- 6. 为Victoria账号创建初始用户（如果不存在）
-- 密码: 930922 的 bcrypt hash
-- 注意：bcrypt hash在Go中生成，这里用INSERT OR IGNORE方式
-- 实际密码hash需要在应用启动后通过初始化脚本设置
-- 先插入占位，启动时检测并更新密码

INSERT INTO users (
  id, username, password, display_name, role,
  is_active, chat_enabled, created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'Victoria',
  '$placeholder$',  -- 启动时由Go代码替换为真实bcrypt hash
  'Victoria',
  'teacher',
  true,
  true,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM users WHERE username = 'Victoria'
);

COMMENT ON TABLE chat_memory_files IS '永久文件记忆库，支持Markdown和Word文件';

