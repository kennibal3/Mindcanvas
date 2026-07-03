-- =============================================================
-- MindCanvas Migration 011 - 自定义头像上传
-- 需求3：学生和教师支持上传自定义头像
-- 兼容策略：保留原有 avatar_id 字段，新增 avatar_url
-- 优先级：avatar_url > avatar_id 对应的预设 emoji
-- =============================================================

-- 为 room_sessions 表新增 avatar_url 字段（学生自定义头像）
ALTER TABLE room_sessions
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 为 users 表新增 avatar_url 字段（教师自定义头像）
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- 创建头像文件存储目录索引（供运维参考，非 SQL 功能）
-- 实际路径：/opt/mindcanvas/uploads/avatars/{UUID}.jpg

COMMENT ON COLUMN room_sessions.avatar_url IS '学生自定义头像URL，优先级高于 avatar_id 对应的预设 emoji';
COMMENT ON COLUMN users.avatar_url IS '教师/管理员自定义头像URL，为空时前端显示默认 UserCircle 图标';

