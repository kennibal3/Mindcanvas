-- =============================================================
-- MindCanvas V4.3 P2-C - 持久化异步任务队列
-- 统一承接：文件解析、AI初评、报告生成等异步任务
--
-- 设计原则：
--   1. 服务重启后任务可恢复（不依赖内存信号量）
--   2. 任务可重试（retry_count < max_retries）
--   3. 任务可审计（全生命周期状态保留）
--   4. 多类型任务复用同一张表（task_type 区分）
--   5. 幂等执行（DO NOTHING 保护）
-- =============================================================

-- 主任务队列表
CREATE TABLE IF NOT EXISTS job_queue (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- 任务分类
    -- parse_material : 文件解析（调用 MarkItDown）
    -- generate_rubric: Rubric 自动生成
    -- ai_assess      : AI 初评（预留）
    -- export_report  : 报告生成（预留）
    task_type     VARCHAR(50) NOT NULL,

    -- 任务关联实体（灵活设计，不强制 FK，避免级联删除阻断）
    -- 例如 parse_material 时填 assignment_material 的 id
    entity_type   VARCHAR(50),   -- 实体类型描述，如 'assignment_material'
    entity_id     UUID,          -- 关联实体 ID

    -- 任务输入参数（JSONB，不同 task_type 有不同结构）
    payload       JSONB         NOT NULL DEFAULT '{}',

    -- 任务状态机
    -- queued   : 已入队，等待 worker 处理
    -- running  : worker 已领取，正在执行
    -- done     : 执行成功
    -- failed   : 执行失败（retry_count 已达上限）
    -- cancelled: 已取消（手动或超时）
    status        VARCHAR(20)   NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','done','failed','cancelled')),

    -- 重试控制
    retry_count   INT           NOT NULL DEFAULT 0,
    max_retries   INT           NOT NULL DEFAULT 3,

    -- 错误信息（最后一次失败的原因）
    last_error    TEXT,

    -- 执行时间记录
    scheduled_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),  -- 期望最早执行时间
    started_at    TIMESTAMPTZ,                           -- 实际开始执行时间
    finished_at   TIMESTAMPTZ,                           -- 完成/失败时间

    -- worker 标识（预留多实例扩展，当前单机填 'default'）
    worker_id     VARCHAR(100),

    -- 任务优先级（数字越小优先级越高，默认 10）
    priority      INT           NOT NULL DEFAULT 10,

    -- 审计字段
    created_by    VARCHAR(100),  -- 触发任务的用户 ID 或 'system'
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ---- 索引 ----

-- 核心查询：worker 拉取待执行任务（status=queued，按优先级和时间排序）
CREATE INDEX IF NOT EXISTS idx_jq_status_priority
    ON job_queue(status, priority, scheduled_at)
    WHERE status = 'queued';

-- 按实体查询任务状态（例如查某个材料的解析任务）
CREATE INDEX IF NOT EXISTS idx_jq_entity
    ON job_queue(entity_type, entity_id)
    WHERE entity_id IS NOT NULL;

-- 按任务类型查询（例如统计 parse_material 队列积压）
CREATE INDEX IF NOT EXISTS idx_jq_task_type_status
    ON job_queue(task_type, status);

-- 超时任务扫描（running 状态超时检测）
CREATE INDEX IF NOT EXISTS idx_jq_running_started
    ON job_queue(started_at)
    WHERE status = 'running';

-- ---- 注释 ----
COMMENT ON TABLE  job_queue              IS '持久化异步任务队列，承接文件解析、AI初评、报告生成等';
COMMENT ON COLUMN job_queue.task_type    IS '任务类型：parse_material/generate_rubric/ai_assess/export_report';
COMMENT ON COLUMN job_queue.entity_type  IS '关联实体类型描述，如 assignment_material';
COMMENT ON COLUMN job_queue.entity_id    IS '关联实体 UUID';
COMMENT ON COLUMN job_queue.payload      IS '任务输入参数 JSONB，结构由 task_type 决定';
COMMENT ON COLUMN job_queue.status       IS '任务状态：queued/running/done/failed/cancelled';
COMMENT ON COLUMN job_queue.retry_count  IS '已重试次数';
COMMENT ON COLUMN job_queue.max_retries  IS '最大重试次数，超过后标记 failed';
COMMENT ON COLUMN job_queue.last_error   IS '最后一次失败的错误信息';
COMMENT ON COLUMN job_queue.scheduled_at IS '期望最早执行时间，支持延迟任务';
COMMENT ON COLUMN job_queue.worker_id    IS 'worker 标识，预留多实例场景';
COMMENT ON COLUMN job_queue.priority     IS '优先级，数字越小越优先（默认10）';

-- ---- 幂等执行确认 ----
SELECT 'V4.3 migration 010 job_queue OK' AS result;
