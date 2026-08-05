-- =============================================================
-- 023_courseware.sql
-- REQ-059 一期：HTML 课件支持 zip 压缩包导入
--
-- 为什么要新表而不是扩 html_widget_contents：
--   html_widget_contents 是「一个 element_id 对应一段 HTML 源码」的单文件模型
--   （015 建表，html TEXT + 512KB 上限）。zip 课件是一整个目录树，
--   落磁盘、按 URL 前缀下发，与源码文本不是一回事。
--   且二期要做「课件库」——课件与房间解耦、一次上传到处使用，
--   届时同一个 package 会被多个 element 引用，故 package 必须是独立实体。
--
-- 为什么文件不落 /opt/mindcanvas/uploads/：
--   nginx 配置 `location /uploads/ { alias /opt/mindcanvas/uploads/; }` 是**直出且无鉴权**的
--   （autoindex off 只挡列目录，挡不住已知路径）。课件若放那里，
--   二期的密码保护与有效期会被「知道路径就能直接访问」整个绕过。
--   故落 /opt/mindcanvas/courseware/<package_id>/，该路径 nginx 够不着，
--   全部经 Go 后端下发（可校验归属/密码/过期）。
--
-- 幂等可重跑。
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$
BEGIN

-- ── 1. courseware_packages：一个 zip 包解压后的一份课件 ────────────────────
IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'courseware_packages') THEN

    CREATE TABLE courseware_packages (
        id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
        teacher_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        -- 一期课件依附房间；二期课件库会有 room_id 为空的「库存课件」，故可空
        room_id       UUID        REFERENCES rooms(id) ON DELETE CASCADE,
        title         TEXT        NOT NULL DEFAULT '',
        original_name TEXT        NOT NULL DEFAULT '',   -- 上传时的 zip 原文件名，仅供展示
        -- 磁盘目录名，等于本行 id；单列存出来是为了将来换布局时不必靠约定
        storage_dir   TEXT        NOT NULL,
        -- 入口文件相对路径（剥掉公共顶级目录之后），实测真实课件均为 index.html
        entry_file    TEXT        NOT NULL DEFAULT 'index.html',
        file_count    INT         NOT NULL DEFAULT 0,
        total_bytes   BIGINT      NOT NULL DEFAULT 0,    -- 解压后总字节
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    COMMENT ON TABLE  courseware_packages             IS 'zip 课件包（REQ-059），文件落 /opt/mindcanvas/courseware/<id>/，经 Go 下发不走 nginx';
    COMMENT ON COLUMN courseware_packages.storage_dir IS '磁盘目录名（= id）；不要拼 nginx 可达路径';
    COMMENT ON COLUMN courseware_packages.entry_file  IS '入口文件，剥掉 zip 公共顶级目录后的相对路径';

    RAISE NOTICE 'TABLE courseware_packages created';
ELSE
    RAISE NOTICE 'TABLE courseware_packages already exists, skipping';
END IF;

-- ── 2. html_widget_contents 挂接课件包 ────────────────────────────────────
-- 组件有两种来源：粘贴源码（courseware_id 为空，读 html 列，srcDoc 渲染）
--                zip 课件（courseware_id 非空，html 列留空，iframe src 渲染）
-- 二者互斥，由应用层保证；不加 CHECK 是为了给二期「课件库换绑」留余地。
IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'html_widget_contents' AND column_name = 'courseware_id'
) THEN
    ALTER TABLE html_widget_contents
      ADD COLUMN courseware_id UUID REFERENCES courseware_packages(id) ON DELETE SET NULL;
    RAISE NOTICE 'COLUMN html_widget_contents.courseware_id added';
ELSE
    RAISE NOTICE 'COLUMN html_widget_contents.courseware_id already exists, skipping';
END IF;

END $$;

-- ── 3. 索引 ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_cw_teacher ON courseware_packages(teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cw_room    ON courseware_packages(room_id) WHERE room_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_hwc_cw     ON html_widget_contents(courseware_id) WHERE courseware_id IS NOT NULL;

-- 015 建表时踩过 owner 坑，这里同样兜底
GRANT ALL ON courseware_packages TO mindcanvas;
GRANT ALL ON html_widget_contents TO mindcanvas;

SELECT 'Migration 023_courseware 执行完成' AS status;
