-- =============================================================
-- 026_agent_prime.sql
-- REQ-062 二期 Slice-3：房间智能体「冷启动摘要+建议问题」+ 会话自动命名
--
-- 不建新表——025 建 agent_prompts 时文件头注释已经预留了这两个 key
-- （"用途标识：brainstorm_system / summarize_room / name_room ..."），
-- agent_conversations.title 列也是那时候就建好、一直没被写过的。
-- 本迁移只做一件事：把这两个 key 的初版提示词插进去。
--
-- summarize_room：老师第一次展开「问一问」且这个房间还没有任何对话历史时，
--                 用当前画布内容生成一段摘要 + 3 个建议问题（JSON 结构化输出）。
-- name_room     ：一轮问答完成后，如果会话还没有标题，后台异步生成一个
--                 ≤16 字的短标题写回 title 列（本期只落库，前端暂不展示）。
--
-- 幂等可重跑：仅在该 key 尚无任何版本时插入，不覆盖线上已调过的版本。
-- =============================================================

INSERT INTO agent_prompts (prompt_key, version, content, is_active, note)
SELECT 'summarize_room', 1, $PROMPT$你是一位陪老师在电子白板上一起备课的搭档。下面会给你这块白板此刻的全部文字内容。

请只输出一个 JSON 对象，不要有任何 JSON 之外的文字、不要用 Markdown 代码块包裹，格式严格如下：
{"summary": "一到两句话，说清楚白板上现在有什么，不要复述清单，要像跟人描述一样", "questions": ["建议问题1", "建议问题2", "建议问题3"]}

【关于 summary】
必须严格建立在白板实际内容之上，不能提到清单里没有的概念或数字。

【关于 questions】
- 站在老师的角度想「接下来最值得问的三个问题」，每条不超过 20 个字，要能直接点击发送、不需要老师再改写
- 必须具体、扣着这块白板的实际内容，不能是「这里有什么内容」这种放之四海皆准的空泛问题
- 三条尽量覆盖不同方向（比如：查缺补漏、找关联、想学生可能卡在哪），不要三条都问同一类问题$PROMPT$, TRUE, 'Slice-3 初版：冷启动摘要卡片，JSON 结构化输出'
WHERE NOT EXISTS (SELECT 1 FROM agent_prompts WHERE prompt_key = 'summarize_room');

INSERT INTO agent_prompts (prompt_key, version, content, is_active, note)
SELECT 'name_room', 1, $PROMPT$根据下面这一轮师生对话，给这次对话起一个标题。

只输出标题本身，不要引号、不要标点结尾、不要任何解释文字。
标题必须不超过 16 个字，要说清楚「这轮在聊什么」，不要用「关于XX的讨论」这种套话。$PROMPT$, TRUE, 'Slice-3 初版：会话自动命名，本期仅落库不展示'
WHERE NOT EXISTS (SELECT 1 FROM agent_prompts WHERE prompt_key = 'name_room');

SELECT 'Migration 026_agent_prime 执行完成' AS status;
