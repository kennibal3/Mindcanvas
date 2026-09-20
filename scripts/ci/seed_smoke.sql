-- =============================================================
-- REQ-054 方案 C：CI 冒烟环境的种子数据（仅 CI 使用，绝不进生产）
-- 在迁移 001 之后、012 之前执行（见 apply_migrations.sh）。
--
-- 为什么必须先播种，而不是让迁移自己跑完：
--   2026-09-20 首次从空库按编号跑全部迁移，发现 012_chat.sql 会失败——
--   它插入一个 tenant_id 为 NULL 的 teacher（Victoria），而 001 建的
--   chk_tenant_role 约束要求 teacher 必须带租户。生产库上 Victoria 有租户
--   （核查过：tenant_null=false），说明生产里这行是后来被人补过、或当时约束尚未生效。
--   012 的 INSERT 带 WHERE NOT EXISTS (username='Victoria')，
--   所以这里预先插入一个「带租户的 Victoria」让它自然跳过，既不改已上线的迁移文件，
--   也不用为了 CI 去删约束。
--   这个「迁移不能从空库跑通」本身记为 REQ-054 的发现，见 DEV_LOG。
-- =============================================================

INSERT INTO tenants (id, name)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'CI 冒烟租户');

INSERT INTO users (username, password, display_name, role, tenant_id)
VALUES ('Victoria', '$placeholder$', 'Victoria', 'teacher',
        '00000000-0000-4000-8000-0000000000a1');

-- 冒烟用教师账号。密码由 pgcrypto 生成 bcrypt（$2a$），Go 的 bcrypt.CompareHashAndPassword 可直接校验。
-- 这是 CI 里一次性数据库的临时口令，不对应任何真实账号。
INSERT INTO users (username, password, display_name, role, tenant_id)
VALUES ('smoke_teacher', crypt('smoke-pass-123', gen_salt('bf', 8)), '冒烟教师', 'teacher',
        '00000000-0000-4000-8000-0000000000a1');
