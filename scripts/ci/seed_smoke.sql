-- =============================================================
-- REQ-054 方案 C：CI 冒烟环境的种子数据（仅 CI 使用，绝不进生产）
-- 在迁移 001 之后、012 之前执行（见 apply_migrations.sh）。
--
-- 2026-09-20 首次从空库按编号跑全部迁移，发现 012_chat.sql 会失败——它插入
-- 一个 tenant_id 为 NULL 的 teacher（Victoria），而 001 建的 chk_tenant_role
-- 约束要求 teacher 必须带租户。当时的绕法是这里手工插入一个「带租户的
-- Victoria」，让 012 的 WHERE NOT EXISTS 自然跳过。
--
-- 2026-09-26（BUG-052 修复）：012_chat.sql 本身已经改成自动取一个现存租户
-- 赋给 Victoria，不再需要在这里手工插入 Victoria 抢跑——只要 012 执行前
-- 库里已经有租户即可，而下面这条 tenants 插入本来就要留着（smoke_teacher
-- 也要用），所以顺势去掉了 Victoria 那条手工插入，让 012 自己的修复直接被
-- 验证到，而不是继续被这里的种子绕过。
-- =============================================================

INSERT INTO tenants (id, name)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'CI 冒烟租户');

-- 冒烟用教师账号。密码由 pgcrypto 生成 bcrypt（$2a$），Go 的 bcrypt.CompareHashAndPassword 可直接校验。
-- 这是 CI 里一次性数据库的临时口令，不对应任何真实账号。
INSERT INTO users (username, password, display_name, role, tenant_id)
VALUES ('smoke_teacher', crypt('smoke-pass-123', gen_salt('bf', 8)), '冒烟教师', 'teacher',
        '00000000-0000-4000-8000-0000000000a1');
