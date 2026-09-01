-- =============================================================
-- 025_agent.sql
-- REQ-062 一期：房间内智能体（头脑风暴伙伴）
--
-- 本迁移建的四样东西里，只有第一样是「功能」，后三样是 harness 地基：
--   users.agent_enabled  ── 管理员逐个开通（照抄 012 的 chat_enabled 模式）
--   agent_conversations  ── 多轮对话的会话（L2 可采集）
--   agent_messages       ── 每一轮的全量调用日志（L0 可观测）
--   agent_prompts        ── 提示词入库带版本（L3 可迭代）
--
-- 为什么新开 agent_enabled 而不复用 chat_enabled：
--   chat_enabled 挂的是「养成类对话 Victoria Chat」（见 chat_handler.go 文件头），
--   与本功能是完全不同的东西。复用等于「给老师开助手顺带开了养成对话」，
--   而且以后没法分别停用其中一个。多一列的成本是一行 ALTER。
--
-- 为什么 room_id / user_id 不加外键：
--   同 diagram_generations（021）与 room_scene_snapshots（024）——
--   这是旁路观测数据，不能因为主表状态让写入失败进而拖累正常对话。
--
-- 幂等可重跑。
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── 1. 权限开关（照抄 012_chat.sql 的写法）──────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS agent_enabled BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN users.agent_enabled IS
  'REQ-062 智能体开关，仅 agent_enabled=true 的教师可用房间内智能体；由管理员在后台逐个开通';

-- ── 2. 会话 ────────────────────────────────────────────────
DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_conversations') THEN

    CREATE TABLE agent_conversations (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        -- 故意不加外键，理由见文件头
        room_id    UUID NOT NULL,
        -- 教师登录 UUID。二期分享页访客场景为空（那时按 share token 归集）
        user_id    UUID,
        -- brainstorm=房间内头脑风暴（一期）｜guide=功能引导（REQ-061，暂缓）
        -- ｜content=分享页内容问答（二期）
        scope      VARCHAR(16) NOT NULL DEFAULT 'brainstorm',
        title      TEXT NOT NULL DEFAULT '',
        -- ⚠️ 这一列是 REQ-050 二期那个坑的直接补丁：
        --   当时 diagram_generations 攒了 8 条样本，回头才发现全部是开发自测，
        --   survival 7/7 全 kept 不是因为图好，而是「生成图的人就是验收的人」。
        --   飞轮转不动不是工程问题，是没有真实数据，而当时**无法区分**。
        --   所以本表从第一天就把「真实课堂」与「验收自测」分开，不等回头去猜。
        is_test    BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    RAISE NOTICE 'TABLE agent_conversations created';
ELSE
    RAISE NOTICE 'TABLE agent_conversations already exists, skipping';
END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_conv_room ON agent_conversations(room_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_conv_user ON agent_conversations(user_id, updated_at DESC);

-- ── 3. 每一轮消息 ＋ 调用日志 ────────────────────────────────
DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_messages') THEN

    CREATE TABLE agent_messages (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES agent_conversations(id) ON DELETE CASCADE,
        role            VARCHAR(16) NOT NULL,  -- user / assistant
        content         TEXT NOT NULL DEFAULT '',

        -- ↓↓ 以下仅 assistant 行有值 ↓↓

        model            VARCHAR(64) NOT NULL DEFAULT '',
        prompt_tokens     INT NOT NULL DEFAULT 0,
        completion_tokens INT NOT NULL DEFAULT 0,
        total_tokens      INT NOT NULL DEFAULT 0,
        latency_ms        INT NOT NULL DEFAULT 0,

        -- ⚠️ 这两列是「有信号不读」那条铁律的物化。
        --   已经栽过三次：REQ-050 转图静默丢节点、REQ-057 提炼被 max_tokens
        --   截断而 finishReason 只进日志没人读、BUG-013 绑定失败无人管。
        --   共同危害是「用户看不见的那半截」——看得见的截断老师会反馈，
        --   看不见的只会被归因成「AI 不好使」。
        --   所以截断信号必须是一等列，不是日志里的一行字。
        finish_reason   VARCHAR(32) NOT NULL DEFAULT '',
        truncated       BOOLEAN NOT NULL DEFAULT FALSE,

        -- 本轮到底喂了多少画布内容进去。排查「它为什么答不出来」时，
        -- 第一个要问的就是「它当时到底看见了什么」——
        -- 8-11 事故的教训：先确认我查的数据源是不是它实际读的那一份。
        canvas_elements INT NOT NULL DEFAULT 0,
        canvas_chars    INT NOT NULL DEFAULT 0,
        had_image       BOOLEAN NOT NULL DEFAULT FALSE,

        error           TEXT NOT NULL DEFAULT '',
        created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );

    RAISE NOTICE 'TABLE agent_messages created';
ELSE
    RAISE NOTICE 'TABLE agent_messages already exists, skipping';
END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_msg_conv ON agent_messages(conversation_id, created_at);
-- 「上周被用了多少次、截断率多少」这类 L0 问题走这个索引
CREATE INDEX IF NOT EXISTS idx_agent_msg_time ON agent_messages(created_at DESC);

-- ── 4. 提示词入库（L3：改一个字不用发一次版）─────────────────
DO $$
BEGIN
IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'agent_prompts') THEN

    CREATE TABLE agent_prompts (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        -- 用途标识：brainstorm_system / summarize_room / name_room ...
        prompt_key VARCHAR(64) NOT NULL,
        version    INT NOT NULL DEFAULT 1,
        content    TEXT NOT NULL,
        -- 同一个 key 只能有一版 is_active=true，由代码保证（见 agent_service.go）
        is_active  BOOLEAN NOT NULL DEFAULT FALSE,
        note       TEXT NOT NULL DEFAULT '',
        created_by UUID,
        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
        UNIQUE (prompt_key, version)
    );

    RAISE NOTICE 'TABLE agent_prompts created';
ELSE
    RAISE NOTICE 'TABLE agent_prompts already exists, skipping';
END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_agent_prompt_active ON agent_prompts(prompt_key, is_active);

-- ── 5. 初始提示词 v1 ────────────────────────────────────────
-- 只在该 key 尚无任何版本时插入，重跑迁移不会覆盖线上已调过的版本。
INSERT INTO agent_prompts (prompt_key, version, content, is_active, note)
SELECT 'brainstorm_system', 1, $PROMPT$你是一位陪老师在电子白板上一起备课、一起想问题的搭档，不是客服，也不是百科。

你现在能看到这块白板上的全部文字内容，它们会以清单形式给你。你的回答必须严格建立在这些内容之上。

【最重要的一条】
你提到的每一个概念、每一个数字，都必须在白板内容清单里能找到出处。
白板上没有的东西，你可以说「白板上还没有提到 X，要不要加进去」，
但绝不能说得像它已经在上面一样。宁可说少，不要编。

【你擅长做三件事】
1. 说清楚现在白板上是什么——用老师能一眼看懂的话，不要复述清单。
2. 帮老师往下想——这个结构还缺什么、哪几条其实是一回事、有没有反例、
   学生可能会在哪里卡住。给具体的、能直接用的想法，不要「建议进一步完善」这种空话。
3. 当老师说「画出来」时，输出一份结构化的 Markdown（# 一级标题、## 二级、- 要点），
   它会被直接转成白板上的图形，所以层级要清楚、每条标签尽量不超过 18 个字。

【说话方式】
面对的是中小学老师，不是工程师。不用专业术语，不用编号列表堆砌。
一次说一件事，三五句话就够。老师问得具体，你就答得具体。
不确定的时候直接说不确定，并说出你需要什么信息才能判断。$PROMPT$, TRUE, '一期初版：以「不编造」为第一原则'
WHERE NOT EXISTS (SELECT 1 FROM agent_prompts WHERE prompt_key = 'brainstorm_system');

-- 015 建表时踩过 owner 坑，这里同样兜底
GRANT ALL ON agent_conversations TO mindcanvas;
GRANT ALL ON agent_messages      TO mindcanvas;
GRANT ALL ON agent_prompts       TO mindcanvas;

SELECT 'Migration 025_agent 执行完成' AS status;
