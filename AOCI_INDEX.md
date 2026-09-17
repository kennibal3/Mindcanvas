====MindCanvas Platform 完整索引====
===头部索引===
【部署】裸机模式: Go二进制(15MB)+React SPA(Vite构建,Excalidraw v0.18集成) + Nginx(80→301重定向+443 HTTPS,静态no-cache+反代Go:8080+WS升级timeout=86400s+/uploads/静态7天缓存含avatars/submissions子目录+client_max_body_size=100M+proxy_read_timeout=300s+proxy_request_buffering=off) + PostgreSQL16 + Redis7 + Python3.12 MarkItDown微服务(gunicorn/2workers/127.0.0.1:8081) | systemd管理(mindcanvas.service+mindcanvas-parser.service) | Ubuntu24.04阿里云2核1.6G+2Gswap | 部署命令：cd /opt/mindcanvas && bash deploy.sh(set -Eeuo pipefail+5步骤任意失败即止)
【系统】MindCanvas V4.3 已封板 — 教育协同白板+课堂互动平台 | Excalidraw v0.18无限画布+四级用户体系+实时协同+互动数据沉淀+课堂流程+AI作业评价+稳定性封板 | React18+TS+Zustand+Vite5+TailwindCSS3+Lucide | Go1.21+Gin1.9+gorilla/websocket+lib/pq+redis/go-redis/v9 | 免注册扫码入场+Widget+TeachingModule双层扩展+widget_interactions事实表+先结构化后AI
【整体规范】
目录示例：===配置索引 /opt/mindcanvas/=== 描述+目录绝对路径 单独一行
注释：#为分区标题行（如#后端Go代码索引），用于结构分隔，不被索引工具提取但需理解上下文
本索引包含两套代码标签体系：后端Go代码索引、前端React代码索引，各自独立定义；数据库索引采用独立表标签格式，详见各自规范区块

【当前能力清单】
画布场景: scene_update增量diff+mergeSceneElements增量合并(删除状态保护:existingDeleted&&!incomingDeleted时保留删除+version比较)+Redis热缓存7天+PG永久备份+30秒节流写(SetNX)+Redis丢失自动PG兜底恢复回写+V4.3场景大小保护(>2MB告警/>5MB拒绝)+元素归属追踪(customData.creatorId)+删除权限双重校验(教师删任何/学生只删自己/isApplyingRemote跳过校验)+主题风格(暗/亮+8背景色实时updateScene)+跟随模式+只读双向切换+图片REST上传(multipart→磁盘→base64广播)+远程更新统一captureUpdate:CaptureUpdateAction.NEVER(防止被本地undo栈吞并,BUG-023)
互动组件: 投票(单/多选/状态机draft→open→paused→closed/柱饼条形图/匿名/截止/CSV导出/option传选项文字非索引)+词云(词频/敏感词过滤/maxWordsPerStudent)+问答(单选/正确答案/is_correct/统计图/公布结果/公布解析/防重唯一约束)+作品墙DropZone(文字/图片/文件/链接/教师like+pin+tag+hide+delete/ZIP打包/分组/deadline/每人上限/隐藏姓名+同伴互评Tab星级3维度)+HTML课件Widget(REQ-041/059,HtmlWidget.tsx/HtmlCreateModal.tsx,WidgetMeta.insertable:false/true区分旧房间保留渲染与新建入口隐藏,替代原REQ-032 dropzone_widget作为主要内容展示widget)
教学模块: Phase5课堂流程(FlowEditor备课+FlowController执行/节点lecture/discussion/interaction/break/review/Widget绑定/画布模式联动free/readonly/follow/进度条/大纲解析)+Phase6学情雷达(InsightPanel/10秒轮询/7维聚合/无数据空状态)+Phase6同伴互评(peer_reviews/唯一约束)+总结中心(聚合API+Markdown导出+全组件统计)
分享模板: Phase7公开分享页(room_shares/share_token/public|password/bcrypt/hideNames脱敏/show控制/过期/view_count/Redis缓存10min+5min/只读)+Phase7模板中心(room_templates/快照/is_public/use_count)
作业评价: Phase8 MVP(MarkItDown解析PDF/Word/PPT/Excel/图片/文本→Markdown/6表/CRUD+异步解析+Rubric6维度生成确认版本化+提交+查看)+Phase8-v2作业码花名册(专属码/通用码+花名册课堂同步/手动/CSV导入+SubmitPage独立提交页+跨设备续接+过期拒绝+三类型提交)+REQ-039讲评报告/推荐练习/学生补救三段式(LectureReportEditor/RecommendationPanel/RemediationPanel均在AssignmentDetailPage.tsx,后端3个service扩展AssignmentService+4个handler文件扩展AssignmentHandler,reportConfirmed=true后推荐/补救面板才激活)
头像: 需求3(011_avatar/POST /api/upload/avatar公开2MB JPG/PNG/WebP/OptionalAuth携JWT自动更新/Canvas裁剪200x200/MemberList优先圆形图)
管理统计: 需求5房间统计(AdminPage room-stats Tab/按机构筛选+排序+CSV导出+展开列表)
V4.3封板: pprof(6060内网)+health后台缓存(10秒零DB)+UploadRateLimit(10次/min)+持久化任务队列(job_queue/SKIP LOCKED/retry3次/jobWorker2秒轮询/recoverOnStartup)+场景大小保护+DB连接池(25/5/300s)+前端5页面懒加载+WS三轮k6压测封板
AI能力: 图形生成(REQ-050,diagram_prompt.go提示词模板→AI调用→diagram_validate.go结构修复校验(纯函数)→diagram_sample_service.go异步存活率观测,main.go startDiagramSurvivalChecker 5分钟ticker,评分标准非"是否插入"而是"10分钟内是否仍留在画布上")+房间智能体(REQ-062,agent_service.go/agent_handler.go/AgentChatPanel.tsx,独立AI Key:AGENT_ARK_API_KEY/AGENT_ARK_MODEL,与其余4个AI功能共用的Key分开以避免单一账号能力上限拖垮所有AI功能)+文本提炼(REQ-028/057,refine_service.go/refineApi.ts)+文件解析(REQ-038,parse_file_handler.go/parseFileApi.ts,MarkItDown之外面向AI的解析路径)
花名册与协作形态: 班级花名册(REQ-045,class_service.go/CS模块,CS班级花名册管理)+房间collab_mode(roster实名/anonymous匿名/team分组,REQ-046)与room_mode(whiteboard/cards/interactive)为rooms表/Room模型两个正交维度,互不影响

【服务器】公网IP:47.83.246.106 内网IP:172.17.52.90 | 域名:mindcanvas.com.cn(Let's Encrypt SSL,90天自动续期) | 端口:Nginx80/443→Go8080 | MarkItDown:localhost:8081(不对外) | pprof:localhost:6060(仅内网) | 数据库用户:mindcanvas | 超管:superadmin | DB密码:MC@2026secure!
【账号密码】teacher01~teacher05/Test@2026 | admin01/Test@2026 | superadmin/Test@2026（2026-06-13统一重置）
【代码量】后端Go:81文件24660行(不含_test.go) | 前端TS/TSX/CSS:84文件27415行 | i18n:3文件(index.ts+zh.json+en.json) | 数据库:41表 | SQL迁移:001~027共28个(含重复编号012:012_chat.sql+012_groups_v2.sql,均为已存在文件非笔误) | 2026-09-10按代码实际统计更新(此前该行长期未随开发同步,见文末索引维护记录)
【自动化测试】/opt/mindcanvas/test_phase8_full.sh | 122/123通过率99% | 17个Section覆盖认证/房间/学生入场/Widget4种/场控/导出/总结/学情/流程/分享/模板/作业评价/作业码/花名册/学生提交/专属码/边界安全 | 旧脚本test_phase7_final.sh(88/91)+test_phase7.sh(更早废弃)
【压测基线-V4.3封板】HTTP/200并发:16923req/s延迟15ms | WS并发建连:200VU成功率100%/PingPong-P95=51ms/连接建立P95=1.18s/内存+47Mi/Swap零增长/Goroutine无泄漏(11→12) | WS投票:100VU/成功率100%/唯一约束零重复(100票100学生)/三选项均匀33-34 | WS场景洪泛:50VU×10min/58942次scene_update/version单调递增(9→30)/Redis与DB一致/98次/秒 | DB连接池MaxOpenConns=25压测高峰db_wait最高445后归零 | 容量上限:200并发WS安全线/大场景(1.8MB)room_sync广播61MB需控元素量
【已知坑】入场字段room_code(非invite_code)+响应data.uuid嵌套 | 分组响应顶层group_id | flow advance需direction字段 | 投票action_data字段名为option(选项文字字符串非option_idx索引) | ParseToken参数顺序(tokenString,secret) | redis包路径用github.com/redis/go-redis/v9 | AssignmentDetailPage白屏根因roster.roster后端返回null需Array.isArray防护 | rubric.criteria_json需safeRubric防护 | room_handler.go广播全改BroadcastRaw(原BroadcastToRoom嵌套已替换) | ws_handler.go readElementPayload供widget提交后读最新payload | room.go Register分支移除重复member_join(ws_handler.go统一负责) | pgq函数需head-1避免INSERT行拼接 | room_steps表PRD规划但从未建表实际不存在(课堂流程用teaching_flows实现) | room_images与peer_reviews两表owner=postgres(非mindcanvas)但已GRANT全部DML权限给mindcanvas,room_images仍被upload_handler.go引用功能正常但迁移时需注意 | 远程更新未用captureUpdate:CaptureUpdateAction.NEVER会被并入本地undo栈,单次Ctrl+Z可清空整个同步画布并把清空广播为真实删除(2026-08-11生产事故,BUG-023) | 画布元素删除权限校验已从CanvasEngine.tsx客户端预检查移除,现由ws_handler.go的isTeamRoom+validateDeletePermissions服务端唯一判定(BUG-012曾有教师UUID误判问题),客户端只管发送变更并响应scene_restore回滚 | ai_service.go/GroupPanel.tsx/ShelfCreateModal.tsx/ShelfWidget.tsx四个文件被现有索引条目引用但自身从未建立索引条目,此缺口早于2026-07-03基线已存在,非本次维护遗漏,如需索引需专项处理
【索引维护记录】2026-07-03基线提交eb014d0877384d98211a85df6fd064b8cd0423ec冻结后142个commit(127文件:62新增/4删除/约72修改)长期未同步,2026-09-10逐文件核实补齐:新增26个后端+17个前端索引条目/更新约30个既有条目描述/移除1个已删除文件(Toolbar.tsx,5ab7f83)条目并核实3个其余删除文件无需索引调整/按实际代码重新核算头部统计行数

===后端索引规范===
【格式】文件名[标签]: F:功能 | R:关联 | A:API | S:简述
【标签ABCDE】
A层级: B后端Go H-Handler S-Service W-Middleware C-Config M-Model D-Database U-Utils WS-WebSocket
B模块: C核心 A认证 T租户 U用户 RM房间 EL元素 GS学生 WG互动组件 EX导出 PF敏感词 SE会话 CT流程 SY系统 SC场景同步 DZ作品墙 GRP分组 IR学情雷达 PR同伴互评 SH分享 TM模板 AV作业评价 TK作业码 JQ任务队列 AD管理统计 AV2头像 CS班级花名册 HW HTML课件 KP知识点 DG AI图形生成 SN场景快照 AG智能体 LR讲评报告与补救 RF AI文本提炼 FP AI文件解析
C重要度: 9核心 8高频 7业务 5常规 3辅助 1边缘
D特征: J-JWT P-RBAC V校验 B-bcrypt R限速 G-JSONB W-WebSocket A异步 L锁 U唯一约束 D软删 Z广播 N防重 C-Cookie X-Redis持久化 F文件IO O-OCR/多模态
E规模: L大>400 M中200-400 S小100-200 T微<100
===后端索引规范完毕===

===前端代码索引规范===
【格式】文件名[标签]: F:功能 | R:关联 | A:API | S:简述
【标签ABCDE】
A层级: F页面 C组件 H-Hook S-Store U工具 X配置/入口 T类型 R注册中心 L布局
B模块: C核心 AU认证 CV画布 AD管理后台 ST学生端 TC教师控制 WG互动组件 DZ作品墙 IR学情雷达 PR同伴互评 SH分享 TM模板 AV作业评价 TK作业码 AV2头像 CT流程 CS班级花名册 HW HTML课件 DG AI图形生成 AG智能体 LR讲评报告与补救 RF AI文本提炼 FP AI文件解析
C重要度: 9核心 8高频 7业务 5常规 3辅助 1边缘
#C重要度编码前后端共享，含义一致
D特征: Z-Zustand W-WebSocket F表单 T表格 P权限渲染 M弹窗 G图表 R响应式 A动画 E-Excalidraw协同 L懒加载 N树形
#D特征码前后端各自独立定义，同一字母在不同端含义不同（如后端Z=广播，前端Z=Zustand）
E规模: L大>300 M中150-300 S小80-150 T微<80
===前端代码索引规范完毕===

===头部索引完毕===

#MindCanvas V4.3代码部分索引

===配置索引 /opt/mindcanvas/===
go.mod[CC9T]: F:Go模块定义 | R:全后端 | A:- | S:module mindcanvas-server,Go1.21,8直接依赖(gin1.9.1/jwt-v5.2.0/uuid1.6.0/gorilla-ws1.5.1/godotenv1.5.1/lib-pq1.10.9/go-redis-v9.4.0/crypto0.18.0)
deploy.sh[CC9T]: F:一键部署脚本 | R:全栈 | A:- | S:set -Eeuo pipefail,5步骤(后端go build→tsc检查→npm build→cp dist→systemctl restart)任意失败即止
.gitignore[CC1T]: F:Git忽略规则 | R:- | A:- | S:排除二进制/node_modules/dist/.env/backup
test_phase8_full.sh[CC9M]: F:全功能自动化测试(Phase8-v2完整版) | A:https://localhost | S:122/123通过率99%,17个Section
test_phase7_final.sh[CC8M]: F:Phase7测试脚本(已被取代) | A:- | S:88/91通过率98%,14Section
test_phase7.sh[CC5M]: F:更早期Phase7测试脚本 | A:- | S:历史废弃

===CI配置 /opt/mindcanvas/.github/workflows/===
ci.yml[CC7T]: F:GitHub Actions CI | R:server/go.mod,web/package-lock.json | A:- | S:push main+PR触发/backend job(go build+vet+test)/frontend job(npm ci+build);REQ-054补go test此前只编译不跑测试,3测试文件~26用例写完后长期只在本地手工跑

===压测脚本 /opt/mindcanvas/loadtest/===
ws_baseline.js[CC8M]: F:WS并发建连压测 | R:k6 | A:- | S:50/100/200VU阶梯/PingPong延迟/room_sync时间/成功率三阈值
ws_vote.js[CC8M]: F:WS投票并发写入压测 | R:k6 | A:- | S:100VU固定UUID/option传文字/唯一约束验证
ws_scene.js[CC8M]: F:WS场景同步洪泛压测 | R:k6 | A:- | S:50VU×10min/500ms频率/version单调递增验证

===运维脚本 /opt/mindcanvas/scripts/===
backup.sh[CC8M]: F:数据备份脚本(REQ-053) | R:pg_dump,openssl | A:- | S:pg_dump+gzip数据库/tar.gz上传文件/本地留7天+每周日归档留90天/异地副本(2026-09-09二次修订:服务器只加密openssl aes-256-cbc暂存待取件目录,不主动往外连,由异地机器mac_pull_offsite_backup.sh主动拉取)/失败trap记录出错行号
mac_pull_offsite_backup.sh[CC7S]: F:异地副本拉取脚本(REQ-053) | R:backup.sh的待取件目录 | A:- | S:运行在Mac正常终端非Cowork隔离VM/rsync --ignore-existing从服务器staging目录拉到~/MindCanvas备份/异地/配合launchd定时/BatchMode=yes免密登录未配好直接失败不卡等密码
com.mindcanvas.offsitepull.plist.example[CC5T]: F:launchd定时任务模板(REQ-053) | R:mac_pull_offsite_backup.sh | A:- | S:默认每天7点跑;⚠️2026-09-09真机验证踩坑:脚本路径若在~/Desktop|Documents|Downloads下会被macOS TCC拦截报Operation not permitted,须复制到~/mindcanvas-scripts/等不受保护目录再填路径

===环境与SQL迁移 /opt/mindcanvas/configs/===
.env[CC9T]: F:环境变量 | R:config/config.go | A:- | S:PORT8080/DB(localhost:5432/mindcanvas)/Redis(localhost:6379)/JWT(密钥+168h+mc_token+CookieSecure=true+CookieDomain=mindcanvas.com.cn)/CORS白名单/敏感词路径/GIN_MODE=debug/PARSER_URL=http://localhost:8081/PPROF_ENABLED可选
profanity_words.txt[SPF5T]: F:敏感词词库 | R:services/profanity.go | A:- | S:UTF-8,支持热加载
001_init.sql[DC9L]: F:数据库DDL初始化 | R:核心models | A:- | S:pgcrypto+核心表+索引+CHECK约束+COMMENT+room_mode+widget_interactions扩展列
002_dropzone.sql[DC8M]: F:Phase3B-1作品墙Migration | R:room_files/room_groups | A:- | S:room_files表+room_groups表+widget_interactions补充字段+唯一约束+幂等
003_teaching_flow.sql[DC8S]: F:Phase5流程Migration | R:teaching_flows/rooms | A:- | S:teaching_flows表+room_mode幂等补充+3索引
004_scene_persistence.sql[DC8S]: F:Phase5场景持久化Migration | R:room_scenes | A:- | S:room_scenes表+5房间占位+2索引
005_peer_review.sql[DC8S]: F:Phase6同伴互评Migration | R:peer_reviews | A:- | S:peer_reviews表+UNIQUE(submission_id,reviewer_uuid)+4索引+幂等
006_share_template.sql[DC8M]: F:Phase7分享模板Migration | R:room_shares/room_templates | A:- | S:room_shares16列+room_templates14列+11索引+幂等
007_assignment.sql[DC8M]: F:Phase8作业评价Migration | R:assignments系列6表 | A:- | S:6表+13索引+6COMMENT+幂等
008_assignment_v2.sql[DC8S]: F:Phase8-v2作业码花名册Migration | R:assignment_tokens/assignment_rosters | A:- | S:2表+assignments补充3字段+7索引+幂等
009_materials_updated_at.sql[DC8T]: F:V4.3补充updated_at | R:assignment_materials | A:- | S:幂等ADD COLUMN updated_at初始化为created_at+idx_am_parse_updated条件索引WHERE parse_status=parsing
010_job_queue.sql[DC8M]: F:V4.3-P2C持久化任务队列Migration | R:job_queue | A:- | S:job_queue表17列+状态机queued→running→done→failed→cancelled+CHECK+retry+priority+4索引+幂等
011_avatar.sql[DC8T]: F:需求3头像Migration | R:room_sessions/users | A:- | S:room_sessions+users各新增avatar_url TEXT+COMMENT+幂等
014_chat_logs.sql[DC7S]: F:AI对话用量日志Migration | R:chat_logs/users | A:- | S:chat_logs表(session_id/model/prompt+completion+total_tokens/latency_ms/is_stream/error)+3索引(user+created/session/created)+幂等DO块;编号从014起(012有历史冲突)
015_html_widget.sql[DC8S]: F:REQ-041一期HTML展示组件Migration | R:html_widget_contents/room_elements | A:- | S:html_widget_contents表(element_id PK引用room_elements/html源码TEXT/byte_size应用层上限512KB)+源码不进payload(防2MB场景撑爆教训)+补充element类型常量含html_widget;迁移号从015起编(012冲突)
016_lecture_report.sql[DC8L]: F:REQ-039 P2讲评报告Migration | R:assignments/assignment_submissions | A:- | S:6表(讲评报告主表assignment_lecture_reports+内容块assignment_report_blocks本期读写/错因标签+错误证据+推荐题+教师偏好事件四表本期只建骨架待后续期)+预置8类系统错因标签(概念混淆/审题遗漏等)+结尾GRANT兜底postgres-owner坑
017_student_remediation.sql[DC8M]: F:REQ-039 3c学生补救Migration | R:assignment_lecture_reports/assignment_recommended_questions | A:- | S:assignment_student_remediations表(diagnosis教师版诊断仅教师可见/gentle_feedback温和版反馈发送后学生可见/UNIQUE(assignment_id,student_uuid))+放宽teacher_preference_events两处CHECK容纳student_remediation对象与send动作
018_room_collab_mode.sql[DC8T]: F:REQ-046 P1房间协作形态Migration | R:rooms | A:- | S:新增rooms.collab_mode(roster实名上课/anonymous匿名培训默认/team团队可删他人元素)+与既有room_mode画布形态正交切勿混用+默认anonymous零回填零影响存量房间
019_classes_roster.sql[DC8M]: F:REQ-045 P2班级花名册Migration | R:classes/class_students/rooms | A:- | S:classes班级表+class_students花名册成员表(id即稳定student_id,UNIQUE(class_id,student_name,disambig)消歧重名)+rooms.class_id仅roster形态用+结尾GRANT兜底owner坑
020_html_events_knowledge.sql[DC7S]: F:REQ-043 Slice-1课件互动知识点Migration | R:widget_interactions | A:- | S:knowledge_points最小知识点表(UNIQUE(teacher_id,name)/parent_id自关联)+widget_interactions新增knowledge_point_id外键(对所有widget类型通用);一期仅班级/教师级roll-up
021_diagram_samples.sql[DC7M]: F:REQ-050一期B AI图形生成信号采集Migration | R:diagram_generations | A:- | S:diagram_generations表(input_text截断4000字/repairs+issues JSONB/outcome老师后续动作inserted|regenerated_same_input|switched_type|deleted)+room_id故意不加外键(旁路采集不能拖累主流程)+为二期少样本飞轮攒真实样本
022_diagram_survival.sql[DC7S]: F:REQ-050一期B修正-图形存活判定Migration | R:diagram_generations | A:- | S:加element_ids/element_count/survived_count/survival(kept|partially_kept|discarded|unknown)列+outcome语义降级为"老师动作"与survival分列并存不互覆盖;起因2026-07-25发现inserted是默认动作(看一眼就插)非质量信号,带偏差标签喂二期飞轮比没有更糟
023_courseware.sql[DC8M]: F:REQ-059一期zip课件导入Migration | R:html_widget_contents | A:- | S:courseware_packages表(storage_dir=id磁盘目录名/entry_file默认index.html/room_id可空为二期课件库留余地)+html_widget_contents加courseware_id关联(与html源码粘贴二选一互斥)+文件落/opt/mindcanvas/courseware/不经nginx直出(防二期密码保护被已知路径绕过)
024_room_scene_snapshots.sql[DC8M]: F:BUG-020一期画布删除前自动留档Migration | R:room_scenes | A:- | S:room_scene_snapshots表(scene_data删除前完整快照/element_count+deleted_count/reason默认bulk_delete/trigger_role单列存不靠UUID前缀猜身份)+起因2026-08-11生产事故675元素误删,纯靠30秒节流残留才救回+room_id不加外键+每房间限20份由pruneSnapshots兜底防无限增长
025_agent.sql[DC9L]: F:REQ-062一期房间内智能体Migration | R:users/agent_conversations/agent_messages/agent_prompts | A:- | S:users.agent_enabled开关(仿012 chat_enabled模式,与养成对话chat_enabled分列互不影响,管理员逐个开通)+agent_conversations会话(is_test区分真实课堂与验收自测,防REQ-050二期"生成者即验收者"覆辙)+agent_messages全量调用日志(finish_reason+truncated设为一等列不藏进日志,吸取REQ-050/REQ-057/BUG-013"有信号不读"教训)+agent_prompts提示词入库带版本(同key仅一个is_active)+初始插入brainstorm_system v1(不编造原则)
026_agent_prime.sql[DC7T]: F:REQ-062二期Slice-3冷启动摘要Migration | R:agent_prompts | A:- | S:不建新表,复用025预留的prompt_key;插入summarize_room(JSON结构化摘要+3条建议问题,老师首次展开问一问时用)与name_room(≤16字会话自动命名,本期仅落库前端暂不展示)两版初始提示词
027_agent_prompt_v2.sql[DC7T]: F:REQ-062二期brainstorm_system v2提示词Migration | R:agent_prompts | A:- | S:补「看不到内容的部分」披露指引(图片/无文字图形此前被BuildCanvasContext静默跳过,智能体连"有东西读不到"都不说,是真实盲区)+新版本插入后关闭v1的is_active+同key仅留一个active版本约定显式维护

===MarkItDown微服务 /opt/mindcanvas/markitdown-service/===
app.py[SAV9M]: F:MarkItDown文件解析微服务 | R:assignment_service.go | A:GET /health,POST /parse/file,POST /parse/path,POST /parse/text | S:Flask+gunicorn2workers/127.0.0.1:8081/markitdown==0.1.6全局实例复用/50MB限制/临时文件自动清理/路径安全校验(只允许/opt/mindcanvas/uploads/)/结构化响应(markdown+word_count+char_count+elapsed_ms)

===systemd服务 /etc/systemd/system/===
mindcanvas.service[CC5T]: F:主服务 | R:mindcanvas-server | A:- | S:After=postgresql+redis,Restart=always,ExecStart=/opt/mindcanvas/server/mindcanvas-server
mindcanvas-parser.service[SAV5S]: F:MarkItDown解析微服务 | R:app.py | A:- | S:After=mindcanvas/gunicorn2workers/bind127.0.0.1:8081/timeout=120/日志→/var/log/mindcanvas-parser*.log/Restart=always

===Nginx配置 /etc/nginx/sites-available/===
mindcanvas[CC5M]: F:站点配置 | R:- | A:- | S:listen80(→301)+443(ssl)/client_max_body_size=100M/api反代(proxy_read_timeout=300s+proxy_request_buffering=off)/ws升级(timeout=86400s)/uploads静态7天缓存含assignments/submissions/avatars/SPA no-cache/assets缓存30d/gzip

===前端构建配置 /opt/mindcanvas/web/===
package.json[XC3T]: F:前端依赖与脚本 | R:- | A:- | S:react18+react-dom+react-router+zustand+vite5+tailwindcss3+lucide-react+@excalidraw/excalidraw v0.18;build脚本NODE_OPTIONS=--max-old-space-size=4096防OOM
tsconfig.json[XC1T]: F:TS配置 | R:- | A:- | S:strict+paths别名+jsx react-jsx
vite.config.ts[XC3M]: F:Vite构建配置 | R:package.json | A:- | S:V4.3-P2B仅拆Excalidraw单独chunk(3.7MB长缓存)+assignment-utils业务chunk/其余统一vendor/chunkSizeWarningLimit=4000/零循环警告/代理api→8080
tailwind.config.cjs[XC3T]: F:Tailwind主题 | R:index.css | A:- | S:主题色+响应式断点
postcss.config.cjs[XC1T]: F:PostCSS配置 | R:- | A:- | S:tailwindcss+autoprefixer
index.html[XC5T]: F:HTML入口 | R:src/main.tsx | A:- | S:根div#root+viewport移动端适配

===配置索引完毕===

#后端Go代码索引(49文件13621行)

===入口 /opt/mindcanvas/server/===
main.go[BC9L]: F:服务启动入口装配并启动HTTP | R:全部模块 | A::8080 | S:Load配置→InitPostgres→InitRedis→hub先初始化→服务装配(含assignmentSvc.StopWorker优雅关闭)→Handler装配→SetupMessageHandler→V4.3:healthCache后台缓存(startHealthCacheUpdater每10秒刷新parser+parseStats含job_queue子字段+dbStats)→startDiagramSurvivalChecker(REQ-050一期B修正,5分钟ticker巡检diagramSampleService.CheckPendingSurvival,不用job_queue因只需到点扫一遍无重试语义)→pprof:6060内网调试端口(GIN_MODE!=release自动启动)→Gin路由(公开:login/logout/guest/ws/upload(image/file现改OptionalAuth)/rooms/:id/flow/progress/share/:token三接口/rooms/:id/elements/:eid/html+courseware两条OptionalAuth(学生访客可读,课件文件经Go下发不走nginx避免密码有效期被路径绕过)/assignments/:aid/submit学生公开/submit五接口(新增:aid/remediation学生查看补救反馈)含upload各带UploadRateLimit或APIRateLimit/POST /api/upload/avatar用OptionalAuth();认证:me/profile/admin(新增PATCH users/:id/agent)/classes全套7路由(REQ-045教师私有)/rooms全套(新增html-widget创建+替换源码2路由/courseware导入1路由)/templates/assignments组(新增中间件AssignmentOwnership防越权/BUG-015,新增room关联/lecture6路由/recommendations5路由/remediations6路由共31路由)/tokens9路由+roster5路由+admin/room-stats3路由/api/ai组(AuthRequired,diagram生成+outcome回报/refine提炼/parse-file解析/agent聊天+历史+prime三接口,agent另有agent_enabled+房间归属两道权限在handler guard()里);健康:/health只读缓存零DB查询含parse_queue.job_queue+db_pool+cache_age)→优雅关闭/REQ-062智能体独立配置:AGENT_ARK_API_KEY/AGENT_ARK_MODEL(默认doubao-seed-2-0-lite-260215)不填则回落全局key,理由是新key所在方舟账号未开通其余四功能共用的doubao-seed-2-1-turbo-260628模型,若设成全局会同时拖垮四个已验证功能

===配置加载 /opt/mindcanvas/server/config/===
config.go[CC9S]: F:配置加载 | R:configs/.env | A:- | S:7子结构体,Load(envPath),godotenv+环境变量覆盖,DBConfig含MaxOpenConns=25/MaxIdleConns=5/ConnMaxLifetime=300s,校验JWT_SECRET+DB_PASSWORD必填

===数据库 /opt/mindcanvas/server/database/===
postgres.go[DC9T]: F:PG连接池初始化 | R:config | A:- | S:SetMaxOpenConns/SetMaxIdleConns/SetConnMaxLifetime显式配置+Ping健康检查
redis.go[DC5T]: F:Redis客户端初始化 | R:config | A:- | S:go-redis/v9连接+Ping健康检查

===中间件 /opt/mindcanvas/server/middleware/===
auth.go[WA9JCS]: F:JWT认证(HttpOnly Cookie) | R:utils/jwt | A:- | S:AuthRequired强制鉴权/OptionalAuth()可选鉴权(有JWT解析注入user_id/无JWT放行/解析失败放行/专为头像上传等公开接口/ParseToken参数顺序tokenStr+secret)
role.go[WA7PT]: F:角色权限中间件 | R:- | A:- | S:RequireRole+RequireTenantAccess
cors.go[WC5T]: F:CORS中间件 | R:config | A:- | S:白名单Origin+credentials
ratelimit.go[WSY5RT]: F:Redis限速中间件 | R:database/redis | A:- | S:RateLimit通用+LoginRateLimit(10次/min)+APIRateLimit(200次/min)+UploadRateLimit(10次/min/upload前缀/公开上传专用防批量滥用)
assignment_ownership.go[WAV9PVS]: F:作业归属校验中间件(BUG-015修复) | R:models/assignment(assignments表),main.go assignments路由组 | A:挂载于/api/assignments/:aid全部子路由(非路由本身) | S:修复此前46条路由中43条可被任意登录教师凭UUID越权读写删的漏洞/superadmin全放行/isUUIDLike粗校验非法:aid直接404避免PG类型错误("invalid input syntax for type uuid")泄露给前端/查created_by比对userID/越权与不存在返回同一措辞不泄露作业是否存在/通过写Context(ContextKeyAssignmentOwner)供handler复用避免重复查库/挂路由组而非逐service补SQL使新增路由默认受保护

===模型 /opt/mindcanvas/server/models/===
tenant.go[MT9T]: F:租户模型 | R:- | A:- | S:Tenant结构体
user.go[MU9T]: F:用户模型 | R:- | A:- | S:User结构体含avatar_url(需求3)
room.go[MRM9T]: F:房间模型 | R:- | A:- | S:Room+RoomMode(画布形态:whiteboard/cards/interactive)+CollabMode(REQ-045协作形态,与RoomMode正交:roster实名上课/anonymous匿名培训默认/team团队协作人人可删)+ClassID(*string,roster形态绑定班级)+CreateRoomRequest(含CollabMode/ClassID)+UpdateRoomRequest
element.go[MEL9T]: F:画布元素模型 | R:- | A:- | S:Element+11个Type常量(新增ElementTypeHtmlWidget,REQ-041 HTML展示组件)
interaction.go[MWG9T]: F:互动行为模型 | R:- | A:- | S:WidgetInteraction结构体
session.go[MSE8T]: F:学生会话模型 | R:- | A:- | S:Session含student_uuid(非guest_uuid)+avatar_url+入场响应{"data":{"uuid":...}}嵌套+REQ-045花名册重名消歧:JoinRoomRequest加StudentID(第二次提交时带上选定的稳定学生id)+RosterCandidate(StudentID/StudentName/Disambig)+JoinRoomResponse加NeedDisambig(true时不入场)+Candidates(供前端二选一后带student_id重提交)
flow.go[MCT8S]: F:课堂流程模型 | R:- | A:- | S:FlowNode+FlowNodeType(5种lecture/discussion/interaction/break/review)+AdvanceFlowRequest(direction必填)
share.go[MSH8T]: F:分享与模板模型 | R:- | A:- | S:RoomShare+RoomTemplate+CreateShareRequest+ShareMetaResponse+VerifyPasswordRequest+CreateTemplateRequest
assignment.go[MAV8M]: F:作业评价模型 | R:- | A:- | S:AssignmentStatus/MaterialRole/ParseStatus/ReviewStatus常量+Assignment+AssignmentMaterial+RubricCriterion+RubricLevel+AssignmentRubric+AssignmentSubmission+AssignmentAssessment+AssignmentDetail+请求响应结构体+ParseResult+UpdateAssignmentRoomRequest(REQ-048作业关联/解绑课堂房间,RoomID为null或空串表示解绑)
assignment_token.go[MTK8S]: F:作业码与花名册模型 | R:- | A:- | S:TokenTypeDedicated/Universal+RosterSource常量+AssignmentToken+AssignmentRoster+RosterWithStatus(含提交状态)+TokenVerifyResult+GenerateTokensRequest+SubmitByTokenRequest(含FileURL/FileName/LinkURL)+RosterSummary+SubmitFileResponse
class.go[MCS8T]: F:班级与花名册模型(REQ-045 P2) | R:services/class_service.go | A:- | S:Class(教师私有,StudentCount列表时聚合)+ClassStudent(id=稳定student_id,Disambig重名消歧字段)+CreateClassRequest+ImportStudentsRequest(粘贴一列名字批量导入,支持"名字|消歧"/"名字,消歧"含中文逗号与制表符)+AddStudentRequest

===服务层 /opt/mindcanvas/server/services/===
profanity.go[SPF8S]: F:敏感词过滤服务 | R:configs/profanity_words.txt | A:- | S:词库热加载+昵称/文本/词云/问答/作品提交过滤
session_service.go[SSE8M]: F:学生会话服务 | R:models/session,database/redis,classes/class_students表 | A:- | S:guest入场+昵称防冒充后缀+UUID生成+跨设备认领(4位码reclaim)+JoinRoom重构按collab_mode分流(REQ-045/046):roster形态查classes/class_students真名匹配花名册(未绑班级/不在花名册直接拒绝)+重名时不入场返回NeedDisambig+Candidates供二选一+带StudentID二次提交时直接查该id绑定稳定student_uuid/anonymous与team形态保持原逻辑(profanity过滤+GenerateSuffix+GenerateGuestUUID)+BUG-019建会话前查封禁名单命中直接拒绝下发会话(逻辑位置不变)
room_service.go[SRM8M]: F:房间业务服务 | R:models/room | A:- | S:房间CRUD+创建房间默认room_mode=interactive+DB()暴露db供其他服务复用+CreateRoom新增collabMode校验(非法值默认anonymous)+REQ-045仅roster形态绑定班级且班级须归当前教师所有+BUG-025 GetRoomDeletionImpact只读查删除该房间会波及的关联作业数+课件包数与总字节(不改任何东西,handler用它决定要不要返409)+RoomDeletionImpact.NeedsConfirm()默认安全判定放服务端(吸取BUG-015)+DeleteRoom改为先取课件包id列表(删库后磁盘目录名就失联)→事务内解绑作业(room_id置NULL,刻意不提供连作业一起删的选项/BUG-023同源教训)+删房间原子提交→提交成功后才删磁盘失败只记WARN(最坏情况库删盘还在可事后对账,绝不会盘删库没删/与BUG-020"先留档再删"同源)
widget_service.go[SWG9LN]: F:互动组件服务 | R:models/interaction,html_widget_contents/knowledge_points表 | A:- | S:HandleVote(option字段为选项文字字符串非索引)+HandleWordCloud+HandleAnswer+状态机控制+widget_interactions写入+防重唯一约束+GetStudentSubmittedElements(BUG-008断线重连后widgetStore无持久化丢失"是否已提交"状态,room_sync时把已提交组件ID列表带给前端补齐)+GetStudentWordCloudSubmissions(BUG-009按element_id分组恢复词云具体提交过的词供WordCloudWidget初始化myWords)+GetElementType(BUG-012 element_update缺type时兜底反查)+SaveHtmlContent/GetHtmlContent(html_widget_contents表ON CONFLICT UPSERT,REQ-041)+HandleHtmlEvent(REQ-043课件iframe经postMessage→onSubmit('html_event')→WS widget_submit落库,身份由ws_handler传入不信课件自报id;isCorrect二元/score+maxScore部分得分/都不给=无对错行为事件三档;knowledgePoint按teacher_id resolve-or-create knowledge_points失败不阻断落库;action_data只留白名单字段;8KB单条体积上限;html_event无去重约束可多次触发)
review_service.go[SPR8S]: F:同伴互评服务 | R:peer_reviews | A:- | S:CreateReview ON CONFLICT DO UPDATE+ListReviewsByDropzone按submission分组+平均分计算+CheckAlreadyReviewed
insight_service.go[SIR8MX]: F:学情雷达服务 | R:ws/hub(HubInterface注入),database/redis,html_widget_events/knowledge_points表 | A:- | S:HubInterface接口注入+8维聚合(在线人数含教师/组件参与率/未提交名单排除teacher/问答正确率/高频词Top10/小组活跃/Top5学生/HTML课件互动REQ-043 Slice-3新增)+Redis10秒缓存+buildHtmlStats聚合三视角:HtmlKnowledgeStat按知识点班级掌握度(latest-wins去重)+HtmlWidgetStat单课件参与情况+HtmlStudentStat学生作答明细
flow_service.go[SCT8L]: F:课堂流程服务 | R:teaching_flows | A:- | S:流程CRUD+状态机draft→active→finished+节点推进+学生进度查询
export_service.go[SEX7L]: F:导出与总结服务 | R:widget_interactions,teaching_flows,room_sessions | A:- | S:CSV导出(UTF-8 BOM)+Markdown总结+QASummary+DropZoneSummary结构体+buildQASummaries+buildDropZoneSummaries+进度条文本+truncateString+参与概览
share_service.go[SSH8LX]: F:分享与模板服务 | R:room_shares/room_templates,database/redis | A:- | S:PublishShare一房间一分享UPSERT+GetShareMetaByToken(Redis缓存10min)+GetShareData(Redis缓存5min)+VerifySharePassword bcrypt+异步view_count递增+anonymizeName脱敏+SaveTemplate快照Widget+ListTemplates(自己+公开)+UseTemplate递增use_count
token_service.go[STK8L]: F:作业码核心服务 | R:assignment_tokens/assignment_rosters,room_sessions | A:- | S:GenerateTokens批量生成专属/通用码+generateTokenString8位大写字母数字+VerifyToken验证过期/状态/已提交+BindTokenToSubmission+GetRosterWithStatus联合查询+AddRosterEntry幂等UPSERT+ImportRosterFromCSV(姓名/姓名,UUID)+SyncFromClassroom从room_sessions同步排除教师(rs.student_uuid字段)+ExportTokensCSV含UTF-8 BOM+SubmitByToken支持文字/文件/链接三类型(文件存"文件名|URL")+GetStudentAssessment仅published可见+findLatestSubmission(BUG-013自愈:VerifyToken时submission_id未绑定(BindTokenToSubmission是best-effort曾失败或历史数据缺失)则按assignment_id+student_uuid反查最新提交并顺手回填token,不修则该生每次凭码进来都被当"没交过"永远看不到反馈;仅对专属码生效)
assignment_service.go[SAV9LAFQ]: F:作业评价业务服务(V4.3-P2C升级) | R:assignments系列表,job_queue,MarkItDown微服务,lecture_analyze.go/lecture_edit.go/recommendation.go/remediation.go(均扩展本struct) | A:- | S:parseSem信号量2并发+workerStop优雅关闭/enqueueParseJob写job_queue/claimNextJob FOR UPDATE SKIP LOCKED原子领取/markJobDone+markJobFailed(重试<max则30秒后重新入队超限标记failed)/jobWorker每2秒ticker轮询/executeJob信号量控制+switch task_type/StopWorker关闭通道/ParseMaterialAsync改为enqueueParseJob+降级兜底goroutine/parseMaterial同步执行更新updated_at/recoverOnStartup(3秒延迟修复parsing超10分钟+running超15分钟)/JobQueueStats+ParseStats含job_queue子字段/CheckSceneSize(ok|warn|reject)/GenerateDefaultRubric6维度100分/ConfirmRubric版本化/CreateSubmission版本追踪/作业CRUD+材料管理+提交管理全套+UpdateAssignmentRoom(REQ-048关联/解绑课堂房间,createdBy校验归属)
agent_service.go[SAG9XL]: F:房间内智能体服务层(REQ-062头脑风暴伙伴) | R:services/ai_service.go(StreamChatEx/Chat复用既有路径,不碰doChat/Analyze任何一条既有路径),database/redis(读画布场景缓存),agent_prompts/agent_conversations/agent_messages表 | A:- | S:BuildCanvasContext读Redis房间场景构建画布摘要上下文(agentMaxCanvasChars截断)+WrapUntrustedCanvasText给不可信画布文本加边界标记(防提示词注入)+buildWidgetLines互动组件文本化+ActivePrompt从agent_prompts表取激活提示词(默认brainstorm_system)+EnsureConversation会话幂等创建+History/MessagesFor历史消息查询+SaveUserMessage/SaveAssistantMessage(含latencyMs/CanvasContext/hadImage/errMsg落库)+Prime冷启动摘要+建议问题(Slice-3,复用既有AIService.Chat非流式结构化输出)+MaybeNameConversation首轮对话后自动命名会话
class_service.go[SCS8VM]: F:班级/花名册业务服务(REQ-045 P2) | R:models/class,handlers/class_handler.go | A:- | S:checkClassOwned归属校验一律走SQL WHERE(避免BUG-015老坑,superadmin放行/班级为教师私有资源admin不越权看他人班级)+CreateClass/ListClasses/DeleteClass班级CRUD+ListStudents+ImportStudents批量粘贴按行解析返回inserted/skipped计数+AddStudent+DeleteStudent
courseware_service.go[SHW8FL]: F:HTML课件zip包解压与元数据服务(REQ-041/REQ-059) | R:handlers/courseware_handler.go,html_widget_contents/courseware_packages表(023迁移) | A:- | S:三层zip防御(Zip Slip路径穿越拒绝+解压炸弹总大小限制+缺失入口文件校验)+commonTopDir识别包内公共顶层目录自动剥离+isJunkEntry过滤__MACOSX/.DS_Store等垃圾条目+已用4个真实课件包做解压兼容性验证+ExtractResult/CoursewarePackage结构体+NewCoursewareService(db)构造
diagram_prompt.go[SDG7S]: F:AI图形生成提示词模板(REQ-050) | R:handlers/diagram_handler.go(Generate调用) | A:- | S:DiagramType常量(mindmap/orgchart/flowchart/timeline/fishbone五种)+diagramCommonConstraints十条数字编号结构化通用约束(防止AI输出缺parent/成环/level误用等结构性错误)+GetDiagramPrompt按类型拼装最终提示词
diagram_sample_service.go[SDG5VM]: F:AI图形生成信号采集服务(REQ-050一期B) | R:handlers/diagram_handler.go(Record/SetOutcome/MarkInserted调用),diagram_generations表(021迁移) | A:- | S:采集旁路设计任何一步失败只记日志绝不影响生成主流程(老师正在上课)+Record落库生成样本+SetOutcome的UPDATE带teacher_id条件防越权改他人记录(BUG-015教训)+MarkInserted记录插入画布的元素ID与数量+CheckPendingSurvival/writeSurvival定时检查元素存活率并分类判定(classifySurvival)
lecture_analyze.go[SLR8AM]: F:讲评报告AI生成服务(REQ-039第一期,扩展AssignmentService) | R:services/assignment_service.go(job_queue异步任务体系复用),services/lecture_prompt.go(提示词) | A:- | S:EnqueueLectureAnalyze入队讲评生成任务(复用assignment_service既有job_queue模板)+executeLectureAnalyze实际执行AI生成解析JSON分块落库+lectureAnalyzeResult结构体
lecture_edit.go[SLR8AL]: F:讲评报告块编辑/单块重新生成/报告确认服务(REQ-039第三期3a,新文件承载不覆盖既有lecture_*.go) | R:services/lecture_analyze.go,services/assignment_service.go(job_queue模板) | A:- | S:UpdateLectureBlock编辑单块内容+logLecturePrefEvent记录教师编辑偏好前后对比(供后续学习)+DeleteLectureBlock+ConfirmLectureReport确认报告(供recommendation.go/remediation.go的confirmedLectureReport前置校验复用)+EnqueueLectureBlockRegen/executeLectureBlockRegen单块重新生成走异步job+GetLectureJobStatus+loadLectureInputs+AIPromptLectureBlockRegen单块重生提示词(与整报告生成同源约束)
lecture_prompt.go[SLR5T]: F:讲评报告AI生成提示词模板 | R:services/lecture_analyze.go(EnqueueLectureAnalyze/executeLectureAnalyze调用) | A:- | S:AIPromptLectureAnalyze单一常量(讲评分析提示词全文)
lecture_read.go[SLR7T]: F:讲评报告查询服务 | R:handlers/lecture_handler.go(GetLectureReport调用) | A:- | S:GetLectureReport聚合查询已生成的讲评报告+LectureBlockView/LectureReportView响应结构体
recommendation.go[SLR8AL]: F:推荐练习AI生成服务(REQ-039第三期3b,教师审核后一键发布为新作业) | R:services/lecture_edit.go(confirmedLectureReport前置校验:讲评报告须已确认),services/assignment_service.go(job_queue模板),assignment_recommended_questions表(016迁移已建无新迁移) | A:- | S:EnqueueRecommendationGenerate/executeRecommendationGenerate基于已确认讲评报告块生成3-5道推荐练习题(难度梯度至少1基础1进阶)+ListRecommendations/UpdateRecommendation教师审核编辑+PublishRecommendations一键发布为新作业+recQuestionText/recRawOr/recNonNilStrings辅助解析JSON字段+AIPromptRecommendQuestions生成提示词
refine_service.go[SRF7M]: F:AI文本提炼服务(REQ-028/REQ-057,扩展AIService) | R:services/ai_service.go(refineComplete独立调用路径,不与doChat/Chat/Analyze共用),handlers/refine_handler.go | A:- | S:参考"markdown-mindmap"项目移植的三段截断策略(refineLongTextThreshold=2500/refineChunkSize=2000/refineMaxSourceLength=20000)+refineComplete独立路径固定temperature=0.2(与主对话区分保证结构化输出稳定)+normalizeRefinedMarkdown规范化输出+extractUpstreamErrorMsg解析上游错误+RefineError/RefineResult结构体(REQ-057修复:超长截断需明确告知前端而非静默丢失)
remediation.go[SLR8AL]: F:学生个体补救方案AI生成服务(REQ-039第三期3c,新文件承载) | R:services/lecture_edit.go(confirmedLectureReport确认后置前提),services/recommendation.go(共用assignment_recommended_questions表target_type='student'区分),assignment_student_remediations表(017迁移) | A:- | S:EnqueueStudentRemediation/executeStudentRemediation逐个学生生成(教师版诊断+150-250字温和版反馈+3-5道个人薄弱点练习,禁止排名比较分数)+GetStudentRemediation/UpdateStudentRemediation教师审阅改温和版+SendStudentRemediation发送给学生+GetStudentRemediationPublic学生端公开只读接口(token鉴权)+ListRemediations列表+listStudentQuestions/remediationSubmission辅助查询+AIPromptStudentRemediation生成提示词

===处理器 /opt/mindcanvas/server/handlers/===
auth_handler.go[HA9M]: F:登录鉴权处理器 | R:services,utils/jwt | A:POST /login,POST /logout,GET /me,PUT /profile | S:Login查询含avatar_url返回/GetCurrentUser从DB读COALESCE(avatar_url,'')不依赖JWT/UpdateProfile支持avatar_url(CASE WHEN $!=''THEN $ ELSE avatar_url END)/display_name+password+avatar_url三字段独立可选更新/REQ-062补chat_enabled+agent_enabled到Login与GetCurrentUser响应(此前只在登录响应里返回,刷新页面后/me拿不到导致前端功能入口刷新后消失)
admin_handler.go[HAD8ML]: F:管理后台处理器 | R:services | A:租户CRUD+用户CRUD+GET /admin/room-stats+GET /admin/room-stats/:teacher_id/rooms+GET /admin/room-stats/export+PATCH /api/admin/users/:id/agent(REQ-062) | S:superadmin看全部/admin看本租户/TeacherRoomStat含total_rooms+active_rooms+last_active_str/UpdateUserAgent开关用户智能体权限(REQ-062,刻意与UpdateUserChat分开——chat_enabled是养成类对话Victoria Chat与智能体是两件事,合成一个开关就没法分别停用)/ListUsers新增agent_enabled字段随行返回
room_handler.go[HRM8LZ]: F:房间管理处理器 | R:room_service,ws | A:rooms全套CRUD+lock+gather+export+分组+作品墙+ZIP下载+POST /:id/html-widget+GET/PUT /:id/elements/:eid/html(REQ-041) | S:缺陷修复V1:LockRoom+SetReadOnly+GatherMembers+分组CRUD全改BroadcastRaw扁平JSON(原BroadcastToRoom嵌套已全部替换/REQ-005)+BUG-025:DeleteRoom先调GetRoomDeletionImpact查关联作业(含其下10张CASCADE表)与课件包,未带confirm=true一律409把影响面交给前端说人话(判定放服务端而非前端,吸取BUG-015教训)+CreateHtmlWidget/GetHtmlWidgetContent(OptionalAuth)/UpdateHtmlWidgetContent(HTML展示组件源码管理)
guest_handler.go[HGS8S]: F:学生免注册入场处理器 | R:session_service | A:POST /guest/join | S:room_code字段(非invite_code)+data.uuid嵌套响应
upload_handler.go[BUP8MLF]: F:文件上传处理器 | R:room_images,services | A:POST /upload/image,POST /upload/file,GET /upload/file/:id,POST /upload/avatar | S:UploadAvatar(公开接口/字段名avatar/2MB/JPG+PNG+WebP/MIME嗅探+扩展名二次判断/携JWT时UPDATE users.avatar_url)/allowedAvatarMIMEs白名单/maxAvatarSize=2MB/引用room_images表(owner=postgres已GRANT)
ws_handler.go[WSC9LWXZ]: F:WebSocket处理器 | R:ws/hub,widget_service,scene持久化,models(CollabMode) | A:/ws | S:resolveTeacherFromCookie(直接解析Cookie JWT解决教师WS401)+mergeSceneElements增量合并+room_sync延迟800ms+场景大小保护(2MB告警/5MB拒绝)+缺陷修复V1:readElementPayload(从DB读最新payload供widget提交后广播/REQ-003)/HandleWebSocket广播member_join携avatar_url从Redis+DB两级读取(REQ-004)/handleWidgetSubmit提交成功后调readElementPayload确保payload非nil才广播/onRoomEmpty(BUG-021②配合hub.SetEmptyHandler,房间清空时强制落库一次不等30秒节流)/isTeamRoom查collab_mode=team(REQ-046)/validateDeletePermissions重构:身份判定改用连接时确定的真实角色senderIsStudent(client.Role=="student"),不再用isGuestUUID猜——教师UUID是裸36位标准UUID曾被isGuestUUID向后兼容分支误判为guest导致教师删学生元素被当越权恢复/team协作形态人人可删他人元素放行不恢复,非team房间仍拦截并回弹scene_restore给删除者本人
flow_handler.go[HCT8M]: F:课堂流程处理器 | R:flow_service | A:flow全套10个含公开学生进度接口 | S:AdvanceFlow需direction字段
insight_handler.go[HIR8T]: F:学情雷达处理器 | R:insight_service | A:GET /insight,POST /insight/refresh | S:GetInsight+刷新清缓存
review_handler.go[HPR8T]: F:同伴互评处理器 | R:review_service | A:POST /elements/:eid/reviews,GET /elements/:eid/reviews | S:resolveReviewerUUID三级身份解析
share_handler.go[HSH8M]: F:分享与模板处理器 | R:share_service | A:PublishShare+GetShareMeta+VerifySharePassword+GetShareData+SaveTemplate+DeleteTemplate+UseTemplate | S:PublishShare默认值JSON raw解析defaultTrue处理show_字段/GetShareMeta公开无认证/GetShareData密码鉴权(Query pwd|Header X-Share-Password)
assignment_handler.go[HAV8M]: F:作业评价处理器 | R:assignment_service,room_service | A:assignments全套16端点(新增PATCH /api/assignments/:aid/room) | S:UploadMaterialFile(50MB/UUID文件名/异步解析)+StudentSubmit(UUID双鉴权)+ParserHealth代理检查+UpdateRoom(REQ-048作业关联/解绑课堂房间)+checkRoomOwned归属校验(NewAssignmentHandler新增roomSvc依赖)
token_handler.go[HTK8L]: F:作业码与花名册处理器 | R:token_service | A:tokens9个+roster5个+submit4个(含UploadSubmitFile公开上传) | S:全套CRUD+UploadSubmitFile(submitFileExtensions白名单/50MB/UUID文件名/存assignments/submissions/)
agent_handler.go[HAG8PM]: F:房间内智能体HTTP处理器(REQ-062) | R:services/agent_service.go,services/room_service.go,services/ai_service.go | A:POST /api/ai/agent/chat,GET /api/ai/agent/history,GET /api/ai/agent/prime | S:guard三层校验(登录→agent_enabled开关→房间归属)避免越权调用+Chat主对话(StreamChatEx流式)+Prime冷启动摘要与建议问题(Slice-3)+History历史消息查询+NewAgentHandler(agentSvc,roomSvc,aiSvc)构造
class_handler.go[HCS7S]: F:班级/花名册REST处理器(REQ-045) | R:services/class_service.go | A:GET/POST /api/classes,DELETE /api/classes/:cid,GET /api/classes/:cid/students,POST /api/classes/:cid/students,POST /api/classes/:cid/students/import,DELETE /api/classes/:cid/students/:sid | S:ListClasses/CreateClass/DeleteClass班级CRUD+ListStudents/AddStudent/ImportStudents/DeleteStudent花名册成员管理
courseware_handler.go[HHW8FM]: F:HTML课件上传/元数据/静态文件服务处理器(REQ-041/REQ-059) | R:services/courseware_service.go | A:POST /api/rooms/:id/courseware,GET /api/rooms/:id/elements/:eid/courseware,GET /api/rooms/:id/elements/:eid/courseware/files/*filepath | S:UploadCourseware接收zip解压落盘+GetCoursewareMeta读元数据+ServeCoursewareFile直接从Go进程提供课件内静态文件(刻意不走nginx,理由见文件内注释)+elementBelongsToRoom归属校验+parseFormFloat表单辅助解析+NewCoursewareHandler构造
diagram_handler.go[HDG8M]: F:AI图形生成处理器(REQ-050,统一mindmap/orgchart/flowchart/timeline/fishbone五类图API) | R:services/diagram_prompt.go(提示词),services/diagram_sample_service.go(采集),handlers/diagram_validate.go(结构校验修复) | A:POST /api/ai/diagram,POST /api/ai/diagram/:gid/outcome | S:Generate统一入口(按DiagramType取Prompt→AI生成→validateAndRepairDiagram校验修复→旁路recordSample采集)+generateOnce单次生成封装+extractJSONObject从AI输出中提取JSON对象(容错未严格JSON)+truncateRunes按rune截断防止中文截断乱码+RecordOutcome记录老师后续动作(REQ-050B)+DiagramNode/DiagramEdge/DiagramResponse前端契约结构体
diagram_validate.go[HDG7L]: F:AI图形结构体检与自动修复(REQ-050一期A防护网,纯函数可独立单测) | R:handlers/diagram_handler.go(Generate调用validateAndRepairDiagram) | A:- | S:五类图各自失败模式不同(mindmap/orgchart丢弃多余根节点及整棵子树/flowchart孤儿节点叠加在开始节点+幽灵箭头从原点甩出/timeline挂错层静默丢/fishbone level3以下静默丢)+"要么修好要么说出来"原则:DiagramRepair(自动修复记录透明告知老师)与DiagramIssue(不敢自动修只提示)两级日志+sanitizeEdges清理指向不存在节点的边+depthMap计算层级深度+flattenToTwoLevels/fillTimelineSequence/repairFlowchart各图类型专属修复算法+明确不校验side/level等死字段(读码确认diagramBuilder.ts前端从未真正使用)
lecture_handler.go[HLR8T]: F:讲评报告生成/查询REST处理器(REQ-039第一期) | R:services/lecture_analyze.go,services/lecture_read.go | A:POST /api/assignments/:aid/lecture/analyze,GET /api/assignments/:aid/lecture/report | S:LectureAnalyze触发AI讲评分析(入队异步任务)+GetLectureReport查询已生成报告
lecture_edit_handler.go[HLR8T]: F:讲评报告块编辑REST处理器(REQ-039第三期3a) | R:services/lecture_edit.go | A:PATCH /api/assignments/:aid/lecture/blocks/:bid,DELETE /api/assignments/:aid/lecture/blocks/:bid,POST /api/assignments/:aid/lecture/blocks/:bid/regenerate,GET /api/assignments/:aid/lecture/jobs/:jid,POST /api/assignments/:aid/lecture/confirm | S:UpdateLectureBlock+DeleteLectureBlock+RegenerateLectureBlock(异步job)+GetLectureJob轮询状态+ConfirmLectureReport确认报告(解锁recommendation/remediation后续生成)
recommendation_handler.go[HLR8T]: F:推荐练习REST处理器(REQ-039第三期3b) | R:services/recommendation.go | A:POST /api/assignments/:aid/recommendations/generate,GET /api/assignments/:aid/recommendations/jobs/:jid,GET /api/assignments/:aid/recommendations,PATCH /api/assignments/:aid/recommendations/:rid,POST /api/assignments/:aid/recommendations/publish | S:GenerateRecommendations入队生成+GetRecommendationJob轮询+ListRecommendations列表+UpdateRecommendation教师编辑+PublishRecommendations一键发布为新作业
remediation_handler.go[HLR8S]: F:学生补救方案REST处理器(REQ-039第三期3c,含1个学生端公开接口) | R:services/remediation.go | A:GET /api/assignments/:aid/remediations,POST /api/assignments/:aid/students/:sid/remediation/generate,GET /api/assignments/:aid/remediation/jobs/:jid,GET /api/assignments/:aid/students/:sid/remediation,PATCH /api/assignments/:aid/students/:sid/remediation,POST /api/assignments/:aid/students/:sid/remediation/send,GET /api/submit/:aid/remediation(学生端公开) | S:ListRemediations+GenerateStudentRemediation逐个学生生成+GetRemediationJob轮询+GetStudentRemediation/UpdateStudentRemediation教师审阅改温和版+SendStudentRemediation发送+GetStudentRemediationPublic学生免登录查看(挂在/api/submit公开路由组,非/api/assignments)
refine_handler.go[HRF7S]: F:AI文本提炼REST处理器(REQ-028/REQ-057) | R:services/refine_service.go(refineComplete) | A:POST /api/ai/refine | S:Refine单一端点+错误分类映射(区分上游超时/截断/解析失败等返回不同提示)+REQ-057修复:超长文本截断需在响应中明确告知前端而非静默丢失内容
parse_file_handler.go[HFP8OM]: F:AI工作台文件解析入口处理器(REQ-038文件转Markdown/REQ-040图片OCR) | R:services/assignment_service.go(CallParseFile复用Phase8同款MarkItDown调用),services/ai_service.go(AnalyzeWithImage多模态) | A:POST /api/ai/parse-file | S:ParseFile统一入口(PDF/Word/PPT/Excel/图片/文本)转发MarkItDown微服务解析为Markdown/不落库不留盘临时文件用完即删+parsePDFByOCR/renderPDFPages(PDF转图片走多模态OCR分支)+parseImageByOCR图片base64直发豆包多模态模型(REQ-040,因MarkItDown无OCR能力)+maxParseFileSize=20MB(低于Phase8材料上传50MB)+maxOCRImageSize=10MB+ocrSystemPrompt识别提示词+结果接入既有智能提炼(/api/ai/refine)→生成图形(/api/ai/diagram)链路
scene_snapshot.go[WSSN8XS]: F:画布删除安全网快照处理器(BUG-020,挂载于WSHandler同struct而非独立handler) | R:server/ws/*(WSHandler方法扩展),room_scene_snapshots表(024迁移) | A:无独立路由,由ws_handler.go内WebSocket删除事件触发调用(readElementPayload/handleWidgetSubmit附近) | S:shouldSnapshot按删除数量与在线元素数比例判定是否触发快照(countDeletedElements/countLiveElements统计)+snapshotScene删除前落库场景快照(2026-08-11数据丢失事故后新增的安全网)+pruneSnapshots定期清理旧快照防止无限增长+BUG-021约束:上线前不得触碰既有30秒节流写逻辑(文件内注释明确排序约束)
pg_array.go[BDZ3T]: F:PG数组工具 | R:- | A:- | S:JSONB/数组类型扫描辅助

===WebSocket /opt/mindcanvas/server/ws/===
message.go[WSC8S]: F:消息类型定义 | R:- | A:- | S:35个消息常量含MsgCtrlFlowUpdate+MsgCtrlFlowWidgetHint+dropzone系列+group_update+MsgSceneSizeUpdate(REQ-029场景容量告警/拒绝阈值提示)+MsgHtmlWidgetUpdate(REQ-041教师替换HTML源码后广播通知各端重新拉取)
client.go[WSRM8MW]: F:WS客户端 | R:hub,room | A:- | S:WritePump每条消息独立WriteMessage(原批量合并+\n致前端只解析首条已修复)+ReadPump
hub.go[WSC8SZ]: F:WS中心 | R:client,room | A:- | S:GetRoomClientCount+GetRoomClientList(含role字段供InsightService使用)+onEmpty/SetEmptyHandler房间清空回调(BUG-021②,GetOrCreateRoom时注入到Room.OnEmpty)
room.go[WSRM8LZ]: F:WS房间广播 | R:client,hub | A:- | S:BroadcastRaw/BroadcastRawToOthers并发安全(先收集待移除client出读锁再加写锁清理)+缺陷修复V1:Register分支移除重复member_join广播(REQ-004)/member_leave改BroadcastRaw扁平格式+OnEmpty回调(BUG-021②最后一个客户端离开时clientCount==0强制go OnEmpty(r.ID)落库一次,不等30秒节流窗口,解决"最后一次编辑可能永不落库")

===工具 /opt/mindcanvas/server/utils/===
jwt.go[UA8JS]: F:JWT工具 | R:- | A:- | S:ParseToken(tokenString,secret)参数顺序+签发+校验
random.go[UC3T]: F:随机串工具 | R:- | A:- | S:invite_code+token+4位认领码生成
validator.go[UC5S]: F:校验工具 | R:- | A:- | S:输入校验+格式验证

#后端Go代码索引完毕

#前端React代码索引(84文件27415行)

===入口 /opt/mindcanvas/web/src/===
main.tsx[XC9T]: F:React应用入口 | R:App.tsx,i18n/index.ts,index.css | A:- | S:ReactDOM.createRoot+StrictMode+BrowserRouter+QueryClientProvider
App.tsx[XC9ML]: F:路由与全局布局 | R:所有pages | A:- | S:V4.3-P2B懒加载升级/React.lazy(AdminPage+SharePage+SubmitPage+AssignmentPage+AssignmentDetailPage五页面)/Suspense统一LoadingFallback/RoomPage+LoginPage+JoinPage+DashboardPage同步加载保首屏/路由:/share/:token完全公开+/assignments+/assignments/:id受保护+/submit完全公开+/classes受保护(REQ-045 P2班级管理,同步加载)
index.css[XC5S]: F:全局样式 | R:tailwind.config.cjs | A:- | S:暗/亮色主题变量+移动端适配+防iOS缩放

===i18n /opt/mindcanvas/web/src/i18n/===
index.ts[XC5T]: F:i18n入口 | R:zh.json,en.json | A:- | S:语言切换+翻译函数
zh.json[XC5T]: F:中文翻译 | R:- | A:- | S:全量中文字符串
en.json[XC5T]: F:英文翻译 | R:- | A:- | S:全量英文字符串

===类型 /opt/mindcanvas/web/src/types/===
user.ts[TAU9T]: F:用户类型 | R:- | A:- | S:AuthUser含avatar_url?:string(需求3)+agent_enabled?:boolean(REQ-062,管理员逐个开通)
room.ts[TRM9T]: F:房间类型 | R:- | A:- | S:Room+RoomMember含avatar_url?:string(需求3)+ROOM_MODE_LABELS只读展示(已移除ROOM_MODES数组)+CollabMode类型'roster'|'anonymous'|'team'(REQ-046,与room_mode正交)+COLLAB_MODE_OPTIONS创建弹窗可选形态(图标+文案+说明)+Room.collab_mode+Room.class_id?(REQ-045)+CreateRoomRequest.collab_mode?/class_id?(roster时必填)
card.ts[TCV7M]: F:卡片类型 | R:- | A:- | S:TextCard+ImageCard+卡片payload类型定义
widget.ts[TWG8M]: F:Widget类型 | R:- | A:- | S:PollPayload+WordCloudPayload+QAPayload+DropzonePayload+状态机类型+WidgetMeta.insertable?(REQ-041,false=仍注册可渲染供存量元素兼容但不再可新建,dropzone_widget被HTML展示组件替代后设为false)
message.ts[TC9T]: F:WS消息类型 | R:- | A:- | S:WebSocket消息结构体类型定义
canvas.ts[TCV8S]: F:画布类型 | R:- | A:- | S:CanvasElement+画布状态类型
flow.ts[TCT8S]: F:课堂流程类型 | R:- | A:- | S:FlowNode+FlowNodeType+FlowState类型定义
assignment.ts[TAV8M]: F:作业评价类型 | R:- | A:- | S:AssignmentStatus/MaterialRole/ParseStatus/ReviewStatus+Assignment+AssignmentMaterial+RubricCriterion+RubricLevel+AssignmentRubric+AssignmentSubmission+各常量映射
token.ts[TTK8S]: F:作业码与花名册类型 | R:- | A:- | S:AssignmentToken+AssignmentRoster+RosterWithStatus+RosterSummary+TokenVerifyResult+GenerateTokensRequest+SubmitByTokenRequest(含file_url/file_name/link_url)+StudentAssessmentResult+SubmitPageStep状态机类型(9种状态,新增my_work已提交过状态REQ-039 3c)+StudentPracticeQuestion+StudentRemediationPublic(学生侧可见内容,只含温和版反馈与题面,教师版诊断与参考答案不下发)

===状态 /opt/mindcanvas/web/src/store/===
authStore.ts[SAU9ZT]: F:认证状态 | R:- | A:- | S:Zustand/setUser存整个AuthUser含avatar_url/hydrate+checkAuth
roomStore.ts[SRM9ZM]: F:房间状态 | R:- | A:- | S:Zustand/房间成员列表+在线状态+消息队列
canvasStore.ts[SCV8ZS]: F:画布状态 | R:- | A:- | S:Zustand/ThemeMode类型+BACKGROUND_COLORS预设+theme/backgroundColor字段+setTheme/setBackgroundColor(供CanvasEngine监听和ControlPanel写入)
widgetStore.ts[SWG5ZT]: F:Widget状态 | R:- | A:- | S:Zustand/当前活跃Widget状态管理+myWordSubmissions(BUG-009,{element_id:[word,...]}恢复词云本人已提交过的具体词语内容而非布尔标记,存进全局store而非CustomEvent为避免"事件先于组件挂载导致监听器错过"的时序问题)+setMyWordSubmissions合并而非覆盖(避免多次room_sync时丢旧数据)

===Hooks /opt/mindcanvas/web/src/hooks/===
useAuth.ts[HAU8S]: F:认证Hook | R:authStore | A:GET /api/auth/me | S:checkAuth调用/api/auth/me返回data.user含avatar_url自动存入store
useWebSocket.ts[HCV9WLE]: F:WebSocket连接Hook | R:roomStore,canvasStore,widgetStore | A:/ws | S:全面对齐后端扁平消息格式(room_sync读顶层字段/scene_update读msg.data/member_join读顶层uuid+name)/缺陷修复V1:member_join处理新增avatar_url写入RoomMember(REQ-004)/ctrl_follow_mode处理兼容enabled字段(REQ-009)/room_sync新增:msg.my_submissions数组调markSubmitted补齐已提交状态(BUG-008)+msg.my_word_submissions写入widgetStore.setMyWordSubmissions(BUG-009,用store而非CustomEvent避免"WordCloudWidget未挂载监听器错过事件"时序问题)+msg.scene_size入场即显示场景容量(REQ-029)/新增scene_size_update case每次scene_update落地后广播场景容量(REQ-029)/BUG-004修复:widget_submit广播的widgetPayload已是完整两层结构{x,y,width,height,payload:{业务字段}},store.updateElement不再多包一层payload(否则三层嵌套导致extractInner()读错层级业务字段全丢)
useCanvasTransform.ts[HCV7S]: F:画布变换Hook | R:canvasStore | A:- | S:scrollX/scrollY/zoom同步+DOM Overlay坐标转换
useImageUpload.ts[HCV8HS]: F:图片上传Hook | R:- | A:POST /upload/image | S:multipart上传+进度+错误处理

===注册中心 /opt/mindcanvas/web/src/registry/===
WidgetRegistry.ts[RWG7S]: F:Widget注册中心 | R:- | A:- | S:Widget类型注册+渲染组件映射+创建Modal映射
ModuleRegistry.ts[RTC7S]: F:Module注册中心 | R:- | A:- | S:TeachingModule注册+侧边栏挂载点
widgetRegister.ts[RWG7S]: F:Widget注册执行 | R:WidgetRegistry | A:- | S:投票/词云/问答/DropZone/HTML展示五种Widget注册+dropzone_widget加insertable:false(REQ-041被HTML展示组件替代,仍注册以渲染存量房间里的旧组件但不再出现在教师插入工具栏)+html_widget注册insertable:true(源码不进payload走REST落库引用,payload仅存标题)

===工具 /opt/mindcanvas/web/src/utils/===
constants.ts[UC5M]: F:全局常量 | R:- | A:- | S:API基础路径+Widget类型常量+状态常量+ELEMENT_TYPES.HTML_WIDGET(REQ-041)
flowApi.ts[UCT7S]: F:课堂流程API | R:- | A:flow全套10个端点 | S:flow CRUD+推进+学生进度查询
assignmentApi.ts[UAV9L]: F:作业评价API | R:handlers/lecture_handler.go,handlers/lecture_edit_handler.go,handlers/recommendation_handler.go,handlers/remediation_handler.go | A:assignments全套31端点(REQ-039三期新增lecture6+recommendations5+remediations6+REQ-048的room1) | S:36个函数覆盖全部assignment端点(从13个大幅扩容)+updateAssignmentRoom(REQ-048关联/解绑课堂)+讲评报告:LectureReportBlock/LectureReport类型+startLectureAnalyze/getLectureReport/updateLectureBlock/deleteLectureBlock/regenerateLectureBlock/getLectureJob/confirmLectureReport+推荐练习:RecommendedQuestion/PublishRecommendationsResult类型+generateRecommendations/getRecommendationJob/listRecommendations/updateRecommendation/publishRecommendations+学生补救:RemediationListItem/RemediationWeakDimension/StudentRemediation类型+listRemediations/generateStudentRemediation/getRemediationJob/getStudentRemediation(教师视角,与tokenApi.ts的学生公开版getStudentRemediation同名不同用途)/updateStudentRemediation/sendStudentRemediation
tokenApi.ts[UTK8S]: F:作业码与花名册API | R:- | A:/api/assignments/:aid/tokens全套+/api/submit五接口含upload(新增remediation) | S:13个函数+通用req<T>封装credentials:include+getStudentRemediation(REQ-039 3c,凭作业码+自己的uuid双证查看老师反馈,老师未发送时404由调用方按"暂无"处理)
agentApi.ts[UAG8M]: F:房间内智能体前端调用层(REQ-062) | R:handlers/agent_handler.go | A:POST /api/ai/agent/chat(SSE流式),GET /api/ai/agent/history,GET /api/ai/agent/prime | S:streamAgentChat是项目里第一次真正消费流式接口(此前ChatStream是死代码见REQ-056 DEV_LOG)/fetch的POST不能用浏览器原生EventSource(只支持GET)改用fetch+ReadableStream手动切SSE帧(按空行分帧,每帧内解析event:/data:两行)/不throw所有失败路径走onError回调方便调用方统一在聊天气泡里显示错误/fetchAgentPrime冷启动欢迎卡片失败静默返回null(锦上添花不能拦住老师提问)/fetchAgentHistory恢复对话失败静默返回空
canvasHandoff.ts[UCV5T]: F:讲评报告插入画布跨页面交接(REQ-039第三期3d) | R:pages/AssignmentDetailPage.tsx,pages/RoomPage.tsx | A:- | S:作业详情页点插入画布→暂存待插内容→跳转房间→房间页画布就绪后取出并插入(复用REQ-027前端插入链路,不碰服务端room_scenes持久化,插入后走既有场景同步自然落库)/用sessionStorage而非URL参数(内容可能较长含换行引号,同标签页内有效跳转后即用即删)/stashCanvasInsert+takeCanvasInsert取出后立即清除只消费一次避免刷新房间页重复插入+5分钟MAX_AGE_MS防陈旧内容意外插入+校验roomId匹配
classApi.ts[UCS7S]: F:班级/花名册API工具函数(REQ-045 P2 Slice-3) | R:handlers/class_handler.go(归属由后端SQL WHERE保证前端无需再筛) | A:POST/GET /api/classes,DELETE /api/classes/:cid,GET/POST /api/classes/:cid/students,POST /api/classes/:cid/students/import,DELETE /api/classes/:cid/students/:sid | S:Class(含student_count)+ClassStudent(disambig重名消歧)接口定义+通用req<T>封装credentials:include+listClasses/createClass/deleteClass/listStudents/addStudent/importStudents(粘一列名字支持"名字|消歧"单行带消歧)/deleteStudent
diagramApi.ts[UDG8T]: F:AI图形生成API调用 | R:handlers/diagram_handler.go,utils/diagramBuilder.ts(DiagramData类型) | A:POST /api/ai/diagram,POST /api/ai/diagram/:gid/outcome | S:DiagramType五种(mindmap/flowchart/timeline/orgchart/fishbone)/DiagramOutcome四态(inserted中性动作/regenerated_same_input同文本重来≈不行/switched_type换型重来≈选型不对/deleted_history弱信号)——2026-07-25语义订正:这些是动作不是评价,真质量判据是后端十分钟后观测的存活率而非这些埋点/generateDiagram失败throw Error(message来自后端error字段)/reportDiagramOutcome纯旁路不await不抛错失败静默(绝不能因埋点失败打断老师上课)
diagramBuilder.ts[UDG9EL]: F:AI图形生成统一布局引擎 | R:@excalidraw/excalidraw(convertToExcalidrawElements),handlers/diagram_handler.go(DiagramResponse对齐) | A:- | S:将后端{nodes,edges}转换为合法Excalidraw elements,支持5种图形类型(mindmap左→右放射式/flowchart上→下含菱形决策节点/timeline水平主轴+交错上下事件/orgchart上→下组织架构/fishbone鱼骨因果图)/DiagramNode+DiagramEdge+DiagramRepair/DiagramIssue回执类型/DiagramData含generation_id(采集记录id供reportDiagramOutcome)+source字段区分"direct"确定性直转(无generation_id自动跳过埋点)与"ai"生成/buildDiagramElements主构建函数+DIAGRAM_THEMES主题表+getDiagramThemeKey/setDiagramThemeKey+buildLectureCards(讲评报告卡片渲染,与本文件核心图形引擎共用坐标系逻辑)
diagramExport.ts[UDG5S]: F:AI图形单条历史记录独立导出(REQ-028导出中心) | R:@excalidraw/excalidraw(exportToBlob/exportToSvg),jspdf,utils/diagramBuilder.ts | A:- | S:支持4种格式对齐markdown-mindmap原版能力(md导出原始/提炼后Markdown纯文本Blob零依赖/png+svg复用Excalidraw自带导出零新增依赖/pdf导出高分辨率PNG后用jsPDF嵌入A4横向单页,唯一新增依赖)/导出elements由buildDiagramElements(data,0,0)从原点重新生成,与画布上实际位置无关不受用户后续拖动编辑影响/safeFilename去除路径分隔符等特殊字符防下载被拒
lectureExport.ts[ULR5M]: F:讲评报告导出(Markdown+打印PDF,REQ-039第三期3d) | R:utils/assignmentApi.ts(LectureReport/LectureReportBlock类型) | A:- | S:纯前端实现零后端依赖(拆分方案决策B:MVP走前端打印)/reportToMarkdown已确认报告转Markdown文本+downloadMarkdown触发浏览器下载+printReport新开独立窗口渲染打印样式调window.print(不污染主应用CSS/打印内容与屏幕布局解耦/用户点击触发不被弹窗拦截,可存为PDF)/内容块结构与lecture_prompt.go/lecture_edit.go的AI输出格式对齐(overview/dimension_analysis等,其他块类型走通用兜底不因新增块类型漏内容)/arr()安全取数组延续BUG-011"防空不防null"教训
markdownToDiagram.ts[UDG8N]: F:结构化Markdown→图形结构确定性直转通道(REQ-058) | R:utils/diagramApi.ts(DiagramType),utils/diagramBuilder.ts(DiagramNode) | A:- | S:2026-07-30读码坐实的问题:diagram_prompt.go给思维导图定了节点总数8-30/最多level3/label≤18字三个硬上限,当输入本身已是精炼过层级完整的Markdown时这三条从"防止AI啰嗦"变成"强制二次摘要"(实测41节点/深度4会议纪要出图仅29节点,相邻要点被静默揉成一句改变事实,关键数字整条消失)/关键判断:输入已有层级时这一步应是无损转换不是摘要,Markdown的#/##/-缩进本身就是一棵树解析不需要语言模型/仅对纯树形图开放(mindmap/orgchart,DIRECT_CONVERTIBLE_TYPES)/extractOutline解析大纲+outlineToNodes转节点+assessFlatness评估扁平度(FLAT_MIN_SIBLINGS=12/FLAT_MIN_RATIO=0.4判断是否该建议换用非树形图)
parseFileApi.ts[UFP5T]: F:AI工作台文件解析API调用(REQ-038) | R:handlers/parse_file_handler.go | A:POST /api/ai/parse-file | S:parseFile上传文件转Markdown/PARSE_FILE_MAX_BYTES=20MB与后端maxParseFileSize一致/PARSE_FILE_ACCEPT接受类型白名单/ParseFileResult含source区分markitdown|doubao_ocr|doubao_ocr_pdf(REQ-040)+page_count/ocr_pages(扫描PDF OCR实际识别页数,REQ-040二期)
refineApi.ts[URF5T]: F:AI文本提炼API调用(REQ-028第一步) | R:handlers/refine_handler.go | A:POST /api/ai/refine | S:refineText普通文本转Markdown供生成图形前可选预处理/RefineTextResult含truncated+warning(REQ-057修复:输出被上游max_tokens截断时仍返回200且内容通顺,不显式提示老师无从察觉少了东西只会归因成"AI不好使")
roomApi.ts[UAV5T]: F:房间(课堂)列表API(REQ-048作业关联课堂下拉数据源) | R:handlers/room_handler.go,types/room.ts | A:GET /api/rooms | S:listRooms列出当前教师可见课堂房间/后端对teacher角色已按teacher_id过滤前端无需再筛

===页面 /opt/mindcanvas/web/src/pages/===
LoginPage.tsx[FAU9FMS]: F:登录页 | R:authStore | A:POST /login | S:教师/管理员登录+JWT Cookie+错误提示+响应式
DashboardPage.tsx[FTC9FMPL]: F:教师主页 | R:authStore,roomStore,utils/classApi.ts | A:rooms全套+templates+DELETE /rooms/:id(?confirm=true) | S:我的房间|模板中心双Tab+顶部导航含作业评价按钮+班级管理入口(REQ-045)+创建/删除房间+需求3个人设置弹窗(头像预览/更换/Canvas裁剪200x200+POST /api/upload/avatar credentials:include/保存时PUT /api/auth/profile携带avatar_url)+手机端底部弹出弹窗+建房弹窗新增房间形态COLLAB_MODE_OPTIONS三选一(REQ-046)+roster形态必须先选班级(懒加载listClasses,无班级时引导去班级管理建班,disabled校验newClassId)+handleDelete改两段式(BUG-025):首次不带confirm如遇409解析body.impact翻译成老师看得懂的话(作业会保留/课件包会一并删除且不可恢复)再次确认后带confirm=true重试,成功后Toast显示保留了几份作业+copyJoinLink复制学生入场链接(REQ-050,任意房间通用,`${origin}/join/${code}`)
JoinPage.tsx[FST9FRSL]: F:学生入场页 | R:roomStore | A:POST /guest/join | S:手机端全面优化(键盘弹出检测/autoCapitalize/loading动画)+需求3头像上传(头像格子末尾📷上传格子/handleAvatarFileChange+cropImageToSquare Canvas裁剪200x200取中心正方形/POST /api/upload/avatar公开接口/上传成功setAvatarURL清除预设选中/提交携带avatar_url/LocalStorage保存mc_avatar_url)+REQ-045 roster重名二选一:submitJoin抽出可选student_id参数/后端need_disambig=true时展示candidates弹窗(花名册同名多位供学生选择disambig消歧标识)/硬拒(不在册)展示后端message并退出候选态/"都不是返回改名"兜底按钮+昵称输入框提示"实名课堂请填写你的真实姓名"
RoomPage.tsx[FCV9EML]: F:课堂主页 | R:canvasStore,roomStore,useWebSocket,components/canvas/AIWorkbench.tsx,utils/canvasHandoff.ts,utils/diagramBuilder.ts,qrcode | A:- | S:Excalidraw画布+ControlPanel+CanvasOverlay+FloatingWidgets+WS连接管理+connectionStatus/onReadOnlyChange/onFollowModeChange+REQ-027左侧新增AIWorkbench(仅教师,fixed定位悬浮画布上方,pointer-events-none+flex居中收起时只有小胶囊按钮拦截鼠标不遮挡画布左侧缩放控件)+监听ctrl_panel_collapsed事件动态让出画布宽度(panelCollapsed控制header/main的paddingRight)+REQ-039 3d消费讲评报告插入画布:轮询等待excalidrawAPI就绪(最多~10秒)后takeCanvasInsert取出待插内容→buildLectureCards生成卡片元素→updateScene插入+scrollToContent定位+REQ-051二期房间内分享弹层(qrcode库生成二维码,弹层打开时才现算避免每次渲染都跑图像生成)+复制入场链接
AdminPage.tsx[FAD9TFMPL]: F:管理后台页(懒加载) | R:authStore | A:admin全套+PATCH /admin/users/:id/agent(REQ-062) | S:三Tab(租户管理/用户管理/房间统计)+fetchRoomStats/toggleTeacherRooms/exportRoomStatsCSV/按机构筛选(超管)+按total_rooms|active_rooms排序+展开教师房间列表+CSV导出+toggleUserAgent智能体权限开关(REQ-062,刻意与Chat权限分开见后端UpdateUserAgent注释)+用户表新增"智能体"列(绿色toggle开关+已开通/未开通文案)
SharePage.tsx[FSH9FML]: F:公开分享页(懒加载) | R:- | A:GET /api/share/:token | S:状态机loading→need_password|loaded|error|expired+密码保护弹窗+PollCard投票柱状图+QACard问答正确率+WordCloudCard词云气泡+DropzoneCard作品墙+StatCard参与概览+访问计数
AssignmentPage.tsx[FAV8ML]: F:作业列表页(懒加载) | R:utils/roomApi.ts | A:assignments CRUD | S:作业列表+创建弹窗+删除+状态徽章+统计卡片+手机端底部弹出+REQ-048创建弹窗新增"关联课堂"可选下拉(打开弹窗时才拉listRooms避免进页面多打一个请求,拉不到退化成不关联不阻断创建;关联后可从课堂同步花名册/讲评报告一键插入画布,之后详情页随时可改)
AssignmentDetailPage.tsx[FAV9XL]: F:作业详情页(懒加载) | R:utils/assignmentApi.ts,utils/tokenApi.ts,utils/roomApi.ts,utils/lectureExport.ts,utils/canvasHandoff.ts | A:assignment全套31端点(含REQ-039三期lecture/recommendations/remediations+REQ-048的room) | S:五Tab(材料管理/评分标准/学生提交/作业码/讲评REQ-039新增)+ErrorBoundary(WrappedAssignmentDetailPage包裹)+safeRubric防criteria_json为null+roster.null防护Array.isArray+REQ-048顶部"关联课堂"下拉(打开时listRooms,updateAssignmentRoom关联/解绑,关联后才能"从课堂同步花名册"和把讲评要点插入课堂画布,未关联时相关按钮disabled并提示)+讲评Tab四子Tab(analysis讲评分析/report报告编辑/recommend推荐练习/remediation学生补救,recommend与remediation均以reportConfirmed门控须先确认讲评报告)/子组件:LectureReportEditor(REQ-039 3a块编辑,标题+每行要点/上下移动/删除/单块重新生成轮询job/逐块确认/整报告确认;REQ-039 3d导出reportToMarkdown+downloadMarkdown+printReport新窗口打印,+onInsertToCanvas经stashCanvasInsert暂存待插内容再跳转房间由RoomPage消费)/LectureList(strengths/common_issues等列表小组件)/RecommendationPanel(REQ-039 3b生成→教师审核编辑→一键发布为新作业)/RemediationPanel(REQ-039 3c逐学生生成→教师审阅改温和版→发送,含学生列表+详情双栏)/ParseBadge+TokenBadge(既有徽章组件延续)
SubmitPage.tsx[FTK9ML]: F:学生作业独立提交页(懒加载) | R:utils/tokenApi.ts(getStudentRemediation) | A:/api/submit五接口(含remediation) | S:完全公开/状态机9步(input_token→verifying→fill_name→my_work→write_content→submitting→success→view_result→error)/文字|文件|链接三Tab/LocalStorage跨会话UUID保存/手机端友好大按钮/URL参数?token=预填+REQ-039 3c(2026-07-19)重做:新增my_work步骤(已提交过的学生再次凭码进来先看"我的作业+老师的反馈",原实现隔天回来没有入口看反馈)/AssessmentCard替换为FeedbackCard(原"查看评价结果"查的是assignment_assessments历史死表零行必然报错,改接3c补救反馈接口token+uuid双证只返温和版反馈+题面不含答案)/fetchFeedback统一拉取函数未发送时静默置空不当错误弹窗
ClassesPage.tsx[FCS7FL]: F:班级管理页(REQ-045 P2 Slice-3) | R:utils/classApi.ts | A:classes全套7端点 | S:教师建一次的班级+花名册(稳定学生实体),开roster(实名上课)房间时选/左列班级列表(建班/删班)+右列选中班级的花名册(粘名导入/单个添加/删除)
CanvasEngine.tsx[CCV9EMLE]: F:画布引擎 | R:canvasStore,useWebSocket,components/canvas/DeleteConfirmModal.tsx | A:- | S:Excalidraw核心封装+isApplyingRemote防远程删除被权限校验误拦截+applyRemote支持数组和{elements:[]}两种格式+handleAPI就绪后100ms延迟处理pending队列+需求1主题修复:新增useEffect监听canvasStore.theme→api.updateScene({appState:{theme}})+监听backgroundColor→api.updateScene({appState:{viewBackgroundColor}})+handleAPI就绪后立即同步store当前值+删除权限判定改交服务端单一权威(ws_handler validateDeletePermissions+isTeamRoom,客户端不再本地预判owner,一律把改动发出去被恢复时服务端回发scene_restore即时回弹)+REQ-032图片广播优化:粘贴/拖拽图片先上传拿URL再广播{url}几十字节(不再把base64塞回scene_update撑爆REQ-029场景容量额度),hydrateRemoteImages接收端按URL现拉字节转dataURL喂给addFiles,兼容旧格式完整dataURL两种都认不需迁移脚本+BUG-020二期批量删除二次确认(BULK_DELETE_THRESHOLD=20/BULK_DELETE_RATIO=0.5口径与后端scene_snapshot.go一致,检测到达阈值时就地恢复未删除渲染DeleteConfirmModal,确认后bypassDeleteConfirmIdsRef跳过弹窗判定重放删除/取消则保持已恢复状态关闭弹窗)+BUG-023修复(2026-08-11两次画布被清空真凶):所有remote update的updateScene必须显式传captureUpdate:CaptureUpdateAction.NEVER(默认EVENTUALLY会被下一次IMMEDIATELY操作打包进同一条撤销记录,一次Ctrl+Z就把整个远程同步来的画布撤掉再广播成真实删除落库)+scene_restore监听改用getSceneElementsIncludingDeleted(刚删的元素isDeleted=true,getSceneElements()不含已删元素找不到就恢复不了,是"删了不回弹要刷新才复原"的根因)
#Toolbar.tsx已删除(commit 5ab7f83,原文本卡片/图片上传/.excalidraw导入功能,代码库中未找到替代实现,如有需要向用户核实是否有意下线)
CanvasOverlay.tsx[CCV7M]: F:画布覆盖层 | R:canvasStore,WidgetRegistry | A:- | S:DOM Overlay跟随画布缩放平移+Widget渲染+卡片渲染
FloatingWidgets.tsx[CCV8L]: F:浮动Widget层 | R:widgetStore,WidgetRegistry | A:- | S:Widget创建Modal管理+浮动工具栏+OVERLAY_TYPES渲染白名单加shelf_widget(BUG-007修复,2026-07-10 commit fe2aaf8,漏了会导致协作墙元素能建库广播却进不了浮层渲染循环——REQ-035-a曾用旧版本文件覆盖踩回此坑)+ELEMENT_TYPES.HTML_WIDGET加入白名单(REQ-041,自动继承035-c缩放)+REQ-035-c右下角缩放把手:handleResizeStart拖动中只更新本地store不广播/抬起时才广播最终尺寸(标准两层结构同移动把手)/RESIZE_MIN_DEFAULT=260x260/RESIZE_MIN_SHELF=480x360(协作墙内容密度高下限单独放宽)/RESIZE_MAX=1600x1200/快照zoom避免缩放过程中画布zoom变化导致尺寸跳变+element_update广播必须带type(BUG-012,服务端按type展平嵌套后新坐标才会写进外层渲染读取层)+拖拽/缩放时铺透明护罩防止html_widget的iframe吞掉mousemove导致卡顿(iframe会截获鼠标事件父页面document监听收不到)+ShelfWidget改用独立onDelete而非复用onUpdate({__delete:true})(REQ-035-a,避免__delete标记被包进payload对不上顶层检查)
AIWorkbench.tsx[CDG9L]: F:左侧AI图形生成工作台(仅教师可见) | R:utils/diagramApi.ts,utils/diagramBuilder.ts,utils/markdownToDiagram.ts,components/canvas/AgentChatPanel.tsx(问一问Tab) | A:调diagramApi全套 | S:可折叠侧边栏(展开300px/收起40px)+内联生成流程(选类型→输入文本→生成→存历史)+历史记录持久化(localStorage按roomId隔离,最多保存20条超出自动删最旧)+每条历史可插入画布/重新生成/删除+草稿DRAFT_KEY按roomId隔离
AgentChatPanel.tsx[CAG8L]: F:房间内智能体对话区(REQ-062 Slice-2) | R:utils/agentApi.ts(streamAgentChat/fetchAgentHistory/fetchAgentPrime),utils/markdownToDiagram.ts(analyzeMarkdown) | A:- | S:挂在AIWorkbench.tsx的"问一问"Tab下,与"生成图形"Tab完全独立一套UI/本期范围纯问答:能问+能流式看回答+能看到"它读到了多少画布内容"+刷新页面对话不丢/"聊着聊着直接生成图形插入画布"联动留到Slice-3本组件不做/onInsertFromMarkdown可选回调转图插入画布
DeleteConfirmModal.tsx[CCV7M]: F:批量删除画布元素二次确认弹窗(BUG-020二期) | R:components/teacher/ControlPanel.tsx(REQ-006方案同源但不复用) | A:- | S:8-11事故(房间5f160f5d 286个元素一次清空)后一期在服务端补了快照+熔断+审计日志兜底(scene_snapshot.go)但触发条件没变(老师仍可一键清空整块画布前端零提示),本组件补前端提示/沿用ControlPanel.tsx REQ-006方案用React内联Modal而非window.confirm(后者同步阻塞冻结整页,协作画布场景代价太大)/未直接复用ControlPanel私有ConfirmModal(带一堆本场景用不到的可选项且CanvasEngine不在同一子目录),单独建更小版本保持改动面小/zIndex=2147483647盖过Excalidraw图层

===组件-卡片 /opt/mindcanvas/web/src/components/cards/===
CardRenderer.tsx[CCV7S]: F:卡片渲染器 | R:WidgetRegistry | A:- | S:根据type分发渲染TextCard/ImageCard
TextCard.tsx[CCV7M]: F:文本卡片组件 | R:roomStore | A:- | S:双击编辑+点赞+反应+敏感词过滤
ImageCard.tsx[CCV7M]: F:图片卡片组件 | R:- | A:- | S:图片展示+标题+缩略图+懒加载

===组件-教师 /opt/mindcanvas/web/src/components/teacher/===
ControlPanel.tsx[CTC9PMLF]: F:教师控制面板 | R:canvasStore,roomStore,useWebSocket | A:rooms控制全套 | S:缺陷修复V1:新增React内联ConfirmModal(白色圆角卡片/AlertTriangle图标/z-index=2147483647/不冻结页面替代window.confirm/REQ-006)+handleSetReadOnly+handleKick均通过confirmModal状态触发+handleGather成功Toast(REQ-010)+isFollowMode开启时sendMessage ctrl_follow_mode{enabled:true}(REQ-009)+主题修复(亮/暗按钮onClick同步写useCanvasStore.getState().setTheme())+双Tab(场控/课堂流程)+数据导出区+分享与模板区+SaveTemplateModal+REQ-029场景容量指示条SceneCapacityBar(<40%绿/40-70%黄/>70%红,参考Claude Code上下文用量条交互,reject状态提示"已达上限新改动暂不会保存建议导出存档后清理画布或拆分新房间")监听window ws_scene_size事件(room_sync初始值+scene_size_update增量广播共用同一事件)+折叠/展开按钮新增dispatchEvent('ctrl_panel_collapsed')广播折叠状态
MemberList.tsx[CTC8PS]: F:在线成员列表 | R:roomStore | A:- | S:需求3头像展示优先级(member.avatar_url存在→圆形img w-7 h-7 rounded-full object-cover/否则→预设emoji span)+getAvatar返回{type:'url'|'emoji',value:string}+isMemberTeacher判断角色+踢人按钮仅对学生显示+isMemberTeacher重写(BUG-017前端孪生:REQ-045起roster实名学生拿的是裸稳定UUID无guest-前缀,旧的"!startsWith('guest-')即教师"启发式会把他们误标成教师,改为只认服务端下发的连接角色role==='teacher')
WidgetToolbar.tsx[CTC8M]: F:Widget工具栏 | R:WidgetRegistry,widgetStore,components/widgets/HtmlCreateModal.tsx | A:POST /api/rooms/:id/html-widget,POST /api/rooms/:id/courseware | S:教师创建Widget入口+按钮列表改WidgetRegistry.getAllMetas().filter(insertable!==false)只显示可插入组件(REQ-041,dropzone_widget已设false被HTML展示组件替代)+handleCreateHtml不走element_create(源码不能进payload)改POST /html-widget后端建元素+存源码+广播element_create+handleCreateHtmlZip(REQ-059 zip课件导入,multipart到/courseware,刻意不在这里catch让错误抛回弹窗就地显示后端具体原因如"没有index.html/含越界条目/超限")+handleCreateShelf(REQ-036协作墙改"主题+回复"模式,创建时写入topic_text/topic_image_url/topic_link_url/topic_link_title,默认尺寸500x420→900x640)
SummaryPanel.tsx[CTC7ML]: F:课堂总结面板 | R:- | A:GET /rooms/:id/summary | S:修复卡死(handleToggle首次点击触发loadSummary/加载失败也展开显示错误+重试/expanded独立于summary/任何时候都能关闭)+QA正确率+DropZone预览+参与概览+Markdown导出+防空加固(BUG-011同类修复:wc.words/poll.options/qa.options/dz.submissions/sub.content均加||{}或||[]或??兜底防后端返回null时崩溃)
InsightPanel.tsx[CIR8MS]: F:学情雷达面板 | R:- | A:GET /insight | S:修复卡死(展开时立即fetch+10秒轮询/收起时clearInterval/fetch失败显示错误+重试/无数据空状态+在线人数仍展示)+8维展示(参与率进度条/未提交红色标签/问答正确率/高频词气泡/小组条形图/Top5奖牌/课件互动REQ-043新增)+safeInsightData归一化兼容后端{insight:{...}}包裹与未包裹两种返回+全字段访问改?.??[]防空加固(与后端InsightData对齐)+HtmlKnowledgeStat知识点掌握度进度条(latest-wins)+HtmlStudentStat学生作答明细可展开(含尝试次数attempts>1显示"试N次")
FlowNodeCard.tsx[TCT7M]: F:流程节点卡片 | R:- | A:- | S:单节点展示+状态徽章+Widget绑定提示
FlowEditor.tsx[TCT8M]: F:课堂流程编辑器 | R:flowApi | A:flow CRUD | S:课前备课/节点CRUD+类型选择+Widget绑定+文本大纲解析生成节点
FlowController.tsx[TCT8M]: F:课堂流程控制器 | R:flowApi,useWebSocket | A:flow推进 | S:课中执行/当前节点高亮+推进+画布模式联动free/readonly/follow+学生端进度条开关+防空加固:全部flow.nodes访问改(flow.nodes??[])兜底防后端返回null时崩溃

===组件-分享 /opt/mindcanvas/web/src/components/share/===
SharePublishModal.tsx[CSH8M]: F:分享发布弹窗 | R:- | A:POST /rooms/:id/share | S:三阶段loading→form→published+密码toggle+展示内容开关+过期日期+复制链接+访问计数+撤销分享

===组件-Widget /opt/mindcanvas/web/src/components/widgets/===
PollingWidget.tsx[CWG9M]: F:投票Widget展示 | R:roomStore | A:- | S:柱状图/饼图/条形图展示+实时更新+状态机渲染+匿名/实名显示+REQ-035-c改h-full flex flex-col跟随缩放容器高度,内容区改flex-1 overflow-y-auto min-h-0可滚动(原固定高度会被缩放容器裁切)
PollingCreateModal.tsx[CWG7MF]: F:投票创建弹窗 | R:- | A:- | S:缺陷修复V1:z-index=2147483647覆盖Excalidraw层(REQ-001)+onChange+onInput+onBlur三事件+DOM ref后备读取兼容粘贴自动填充(REQ-008)
WordCloudWidget.tsx[CWG8M]: F:词云Widget展示 | R:roomStore,widgetStore | A:- | S:词频可视化+实时更新+状态机渲染+BUG-009从widgetStore.myWordSubmissions读取服务端room_sync带回的本人已提交词(用Zustand selector而非CustomEvent监听避免"组件未挂载错过一次性广播"的时序问题)/只在本地myWords为空时采用服务端数据避免覆盖本次会话刚提交尚未同步的词+REQ-035-c根元素改w-full h-full跟随缩放容器(SVG已有ResizeObserver自适应)
WordCloudCreateModal.tsx[CWG6S]: F:词云创建弹窗 | R:- | A:- | S:缺陷修复V1:z-index=2147483647(REQ-001)+词数选项[1,2,3,4,5]补充缺失的4(REQ-016)+onInput+onBlur(REQ-008)
QAWidget.tsx[CWG8M]: F:问答Widget展示 | R:roomStore | A:- | S:单选题+即时对错反馈+正确率统计图+公布结果/解析+REQ-035-c改w-72定宽(与创建时payload写入的360宽本不一致)为w-full h-full跟随缩放容器+flex-col+中部内容区overflow-y-auto滚动,教师操作按钮固定底部
QACreateModal.tsx[CWG7MF]: F:问答创建弹窗 | R:- | A:- | S:缺陷修复V1:z-index=2147483647(REQ-001)+浅色白色主题移除dark:bg-gray-800(REQ-015)+onInput+onBlur(REQ-008)
DropZoneWidget.tsx[CWG9L]: F:作品墙Widget | R:roomStore | A:dropzone系列 | S:作品墙/互评双Tab+文字/图片/文件/链接提交+教师like+pin+tag+hide+delete+REVIEW_DIMENSIONS 3维度+内联星级评分表单+handleSubmitReview+renderReviewTab平均分展示+handleDeleteWidget(REQ-035-a补删除整个组件的入口,此前只有删单条提交没有删组件本身的入口,confirm二次确认后onUpdate({__delete:true}))
DropZoneCreateModal.tsx[CWG8M]: F:作品墙创建弹窗 | R:- | A:- | S:缺陷修复V1:z-index=2147483647(REQ-001)+acceptTypes/layout/maxPerStudent/hideNames配置
FallbackWidget.tsx[CWG3T]: F:未知Widget兜底 | R:WidgetRegistry | A:- | S:未注册Widget类型的降级展示
HtmlCreateModal.tsx[CHW7MFM]: F:HTML展示组件创建/编辑弹窗(REQ-041) | R:components/widgets/HtmlWidget.tsx | A:- | S:老师粘贴外部AI(豆包/ChatGPT等)生成的HTML交互课件代码,提交后画布上以iframe sandbox=allow-scripts渲染(源码在沙箱中运行无same-origin,拿不到Cookie/JWT)/体积上限512KB防超大代码拖垮渲染传输/MAX_ZIP_BYTES=100MB与后端CoursewareMaxUploadBytes及nginx client_max_body_size三处对齐,前端先拦一道给人话提示(否则100MB传完才被拒白等一场)/onConfirmZip传了才显示"上传压缩包"页签(REQ-059,编辑态不传因zip课件没有源码可编辑)
HtmlWidget.tsx[CHW8M]: F:HTML展示组件渲染(REQ-041) | R:components/widgets/HtmlCreateModal.tsx,store/roomStore | A:- | S:老师粘贴的HTML源码在iframe sandbox="allow-scripts"中运行,无allow-same-origin即iframe处于独立opaque源拿不到本站Cookie/JWT/localStorage即使粘贴恶意代码也无法窃取会话或操作父页面(设计前置安全要求)/学生端同样可交互(isTeacher无关iframe对所有人可点击)/源码不进room_elements.payload(REQ-032教训)改走REST按element_id拉取,payload仅存{title,htmlVersion}/编辑源码后bump htmlVersion经既有element_update广播链路触发全端重新拉取无需新增WS桥接/extractInner从双层嵌套payload取内层业务字段(与DropZoneWidget一致写法)

#前端React代码索引完毕

===数据库索引-mindcanvas===
数据库: PostgreSQL 16 | UTF-8 | 用户: mindcanvas | 扩展: pgcrypto | 41表(2026-07-03基线23表+14/15/16/17/19/20/21/23/24/25迁移新增18表)

【标签说明】
格式: 表名[业务域-表类型-规模预估-特征]
业务域: U用户 RM房间 EL元素 WG互动 SE会话 SC场景 CT流程 DZ作品墙 GRP分组 PR同伴互评 SH分享 TM模板 AV作业评价 TK作业码 JQ任务队列 IM图片 CH聊天日志 HW HTML课件 LR讲评报告与补救 CS班级花名册 KP知识点 DG AI图形生成 SN场景快照 AG智能体
表类型: M主表 R关联表 L日志表 C配置表 S统计表
规模预估: T微小(<100) S小(100-1K) M中(1K-10K) L大(10K-100K) X超大(>100K)
特征: G有JSONB字段 I多索引 U有唯一约束 D软删除 F有外键 W仅追加 N防重约束

===租户与用户===
tenants[U-M-T-I]: 租户主表,id UUID PK,name/max_teachers/max_rooms/is_active,当前2条记录
users[U-M-S-UI]: 用户主表,id UUID PK,tenant_id FK,username+email唯一,password bcrypt,role CHECK(superadmin|admin|teacher),is_active,avatar_url TEXT可null(需求3教师自定义头像),chat_enabled(养成对话)+agent_enabled(REQ-062房间智能体,管理员逐个开通,与chat_enabled分列互不影响)两开关均默认FALSE

===班级花名册(REQ-045)===
classes[CS-M-T-F]: 班级表(019迁移),id UUID PK,teacher_id FK,tenant_id FK,name
class_students[CS-M-S-UF]: 花名册成员表(019迁移),id UUID PK即稳定student_id,class_id FK,student_name,disambig重名消歧,UNIQUE(class_id,student_name,disambig);roster房间入场时room_sessions.student_uuid直接装这个id,作业侧(专属码/花名册/提交)零迁移自动继承

===房间===
rooms[RM-M-S-UIDF]: 房间主表,id UUID PK,teacher_id FK users,tenant_id FK,title,invite_code UNIQUE,is_locked/is_readonly=FALSE,max_capacity=50,status CHECK(active|finished|archived),room_mode CHECK(whiteboard|cards|interactive)默认interactive画布形态,collab_mode CHECK(roster|anonymous|team)默认anonymous协作形态(018迁移,与room_mode正交),class_id FK classes可null(仅roster用,019迁移),finished_at可null,当前8条记录

===元素===
room_elements[EL-M-L-GIF]: 画布元素表,id UUID PK,room_id FK,creator_uuid,creator_name,type(10种,含html_widget),payload JSONB='{}',is_deleted=FALSE,当前496条记录(最高频表)

===互动===
widget_interactions[WG-R-X-GIFNWU]: 互动行为事实表,id UUID PK,element_id FK(CASCADE),room_id,student_uuid,student_name,action_type,action_data JSONB,is_correct可null,widget_type,group_id,updated_at,knowledge_point_id FK knowledge_points可null(020迁移,对所有widget类型通用) | idx_wi_no_duplicate_vote/word/answer三个唯一约束防重 | 当前106条记录

===会话与文件===
room_sessions[SE-R-L-IF]: 学生会话表,student_uuid(非guest_uuid)+nickname+suffix防冒充+avatar_id+avatar_url TEXT可null(需求3学生自定义头像优先级高于avatar_id)+ip_address+is_banned+joined_at+left_at,当前355条记录
room_images[IM-S-S-IF]: 画布图片表,room_id FK,uploader_uuid,url,file_size,当前6条记录 | ⚠️owner=postgres(非mindcanvas)但已GRANT全部DML权限,被upload_handler.go引用功能正常
room_files[DZ-R-S-IF]: 作品墙文件表,room_id FK,element_id FK,uploader_uuid,file_name,file_url,file_size,file_type,当前1条记录
room_groups[GRP-M-S-IF]: 分组表,room_id FK,name,color,members TEXT[],zone_element_id FK,当前0条记录

===场景与流程===
room_scenes[SC-M-S-GXF]: 场景持久化表,room_id FK UNIQUE,scene_data JSONB,version递增,Redis热缓存7天+PG永久备份+V4.3大小保护(>2MB告警/>5MB拒绝),当前7条记录
teaching_flows[CT-M-S-GJF]: 课堂流程表,room_id FK UNIQUE,nodes JSONB节点数组,status CHECK(draft|active|finished),show_progress_to_students,当前1条记录

===Phase6===
peer_reviews[PR-R-S-GUF]: 同伴互评表,dropzone_id FK room_elements,submission_id,reviewer_uuid,scores JSONB,comment | UNIQUE(submission_id,reviewer_uuid)防重 | ⚠️owner=postgres(非mindcanvas)但已GRANT全部DML权限,当前0条记录

===Phase7===
room_shares[SH-M-S-GUIF]: 公开分享表,room_id FK UNIQUE(一房间一分享UPSERT),share_token UNIQUE,visibility CHECK(public|password),password_hash bcrypt,hide_names,show_stats/canvas/dropzone,expires_at,view_count,当前1条记录
room_templates[TM-M-S-GJF]: 模板表,name,category,source_room FK,steps_json/elements_json JSONB,is_public,author_id FK,use_count,当前0条记录

===Phase8作业评价===
assignments[AV-M-S-GIF]: 作业任务主表,id UUID PK,room_id FK可null,created_by FK users,title,description,status CHECK(draft|collecting|reviewing|closed),allow_resubmit,due_at,expected_count,roster_source,token_type,当前2条记录
assignment_materials[AV-R-S-GAUF]: 作业材料表,assignment_id FK CASCADE,uploader_id,uploader_role,material_role,original_name,file_path,file_url,file_type,file_size,content_text,parsed_markdown,parse_status CHECK(pending|parsing|done|failed),parse_error,word_count,char_count,parse_elapsed_ms,parsed_at,updated_at(V4.3补充供recoverOnStartup判断超时),当前0条记录
assignment_rubrics[AV-R-S-GJF]: 评分标准版本表,assignment_id FK CASCADE,version INT(UNIQUE per assignment),source,criteria_json JSONB,total_score,teacher_confirmed,confirmed_at,当前1条记录
assignment_submissions[AV-R-S-GUF]: 学生提交表,assignment_id FK,student_uuid,student_name,group_id,version,content_type CHECK(text|file|link|mixed),content_text,material_ids UUID[],当前1条记录
assignment_assessments[AV-R-S-GJF]: AI评价与教师确认表,submission_id FK,rubric_id FK,ai_score,ai_dimension_scores JSONB,ai_feedback/highlights/issues/suggestions,final_score,final_dimension_scores JSONB,final_feedback,review_status CHECK(pending|ai_done|teacher_confirmed|published),reviewed_by FK users,当前0条记录
assignment_feedback_logs[AV-L-T-GWF]: 反馈日志表,assessment_id FK,action_type,actor_id,action_data JSONB,仅追加不可改,当前0条记录

===Phase8-v2作业码与花名册===
assignment_tokens[TK-R-S-GUIF]: 作业码表,id UUID PK,assignment_id FK CASCADE,student_uuid可null,student_name,token VARCHAR(20) UNIQUE,token_type CHECK(dedicated|universal),expires_at,used_at,submission_id FK可null,当前45条记录
assignment_rosters[TK-R-S-GUF]: 花名册表,id UUID PK,assignment_id FK CASCADE,student_name,student_uuid,token_id FK可null,source CHECK(classroom|manual|import),expected=TRUE | UNIQUE(assignment_id,student_name),当前0条记录

===AI对话日志===
chat_logs[CH-L-S-W]: AI对话用量日志表(014迁移),id UUID PK,user_id FK CASCADE,session_id,model,prompt_tokens/completion_tokens/total_tokens,latency_ms,is_stream,error可null(NULL=成功),仅追加不可改,每条user消息一行

===HTML课件(REQ-041/REQ-059)===
html_widget_contents[HW-R-S-GF]: HTML展示组件源码表(015迁移),element_id PK即FK room_elements(CASCADE),room_id FK,html TEXT源码应用层上限512KB,courseware_id FK courseware_packages可null(023迁移新增,与html源码粘贴二选一互斥);源码不进room_elements.payload(REQ-032教训:base64进payload撑爆2MB场景容量),广播只传element_id客户端各自GET拉取
courseware_packages[HW-M-S-F]: zip课件包表(023迁移),id UUID PK,teacher_id FK,room_id FK可null(二期课件库留空为"库存课件"),storage_dir(=id磁盘目录名),entry_file默认index.html,file_count,total_bytes;文件落/opt/mindcanvas/courseware/<id>/不经nginx直出(防二期密码保护被已知路径绕过)

===知识点(REQ-043)===
knowledge_points[KP-M-T-F]: 最小知识点表(020迁移),id UUID PK,teacher_id FK,subject,name,code,parent_id自关联可null,UNIQUE(teacher_id,name);一期仅班级/教师级roll-up,为画像聚合脊椎的最小形态

===AI图形生成(REQ-050)===
diagram_generations[DG-L-M-GW]: AI图形生成信号采集表(021迁移,022迁移修正存活判定),id UUID PK,teacher_id FK,room_id不加外键(旁路采集不拖主流程),diagram_type,input_text截断4000字/input_chars真实字符数,node_count/edge_count,repairs/issues JSONB,outcome(老师动作:inserted|regenerated_same_input|switched_type|deleted,2026-07-25后降级语义非质量信号),element_ids/survived_count/survival(kept|partially_kept|discarded|unknown,022新增服务端观测存活判定)+survive_checked_at;为二期少样本飞轮攒真实样本用

===画布安全网(BUG-020)===
room_scene_snapshots[SN-L-M-GW]: 画布删除前自动留档表(024迁移),id UUID PK,room_id不加外键(旁路取证数据),scene_data JSONB删除前完整快照,data_size,element_count(快照时存活元素数,一等列)+deleted_count,reason默认bulk_delete,trigger_uuid+trigger_role(单列存不靠UUID前缀猜身份,吸取BUG-017/018教训);起因2026-08-11生产事故675元素被误删仅靠30秒节流残留才救回,每房间限20份由pruneSnapshots兜底

===讲评报告与学生补救(REQ-039)===
assignment_lecture_reports[LR-M-S-GF]: 讲评报告主表(016迁移),id UUID PK,assignment_id FK CASCADE,teacher_id FK,status CHECK(draft|confirmed|exported|archived),source_snapshot JSONB生成时快照(花名册数/已交数/rubric版本,报告可追溯),generation_status CHECK(pending|analyzing|done|failed)
assignment_report_blocks[LR-R-S-GF]: 讲评报告内容块表(016迁移,本期读写),id UUID PK,report_id FK CASCADE,block_type CHECK(overview|dimension_analysis|evidence|recommendation|student_summary|custom),sort_order,content JSONB,ai_generated,teacher_confirmed,source_refs JSONB
assignment_error_tags[LR-C-T-F]: 错因标签库(016迁移,本期只建骨架),id UUID PK,name,parent_id自关联,is_system,预置8类系统标签(概念混淆/审题遗漏/方法选择不当等)
assignment_error_evidence[LR-R-S-GUF]: 学生错误证据表(016迁移,本期只建骨架),assignment_id FK CASCADE,submission_id FK CASCADE,error_tag_id FK,evidence_type CHECK(text|image_crop|file_ref|teacher_note),evidence_content JSONB,confidence,anonymized
assignment_recommended_questions[LR-R-S-GF]: 推荐练习题表(016迁移本期只建骨架,017迁移补target_type='student'维度索引),assignment_id FK CASCADE,report_id FK,source_type CHECK(ai_generated|question_bank|teacher_created),target_type CHECK(class|group|student),knowledge_points/error_tag_ids JSONB,teacher_action CHECK(pending|accepted|edited|rejected|saved|published)
teacher_preference_events[LR-L-S-GWF]: 教师偏好学习事件日志(016迁移,017迁移放宽两处CHECK容纳student_remediation对象与send动作),仅追加,object_type CHECK(report_block|recommended_question|error_tag|export_template|student_remediation),action_type CHECK(accept|edit|reject|regenerate|save|publish|export|send),before_value/after_value JSONB
assignment_student_remediations[LR-M-S-GUF]: 学生补救主表(017迁移),id UUID PK,assignment_id FK CASCADE,report_id FK可null,submission_id FK可null,student_uuid VARCHAR(200)(通用码场景为token-<作业码>-<姓名>故留长),generation_status CHECK(pending|generating|done|failed),diagnosis JSONB教师版诊断仅教师可见,teacher_summary/teacher_note,gentle_feedback温和版反馈发送后学生可见,sent_at,UNIQUE(assignment_id,student_uuid)

===房间内智能体(REQ-062)===
agent_conversations[AG-M-S-F]: 智能体会话表(025迁移),id UUID PK,room_id不加外键(旁路观测),user_id可null(二期分享页访客场景),scope默认brainstorm(一期)|guide(REQ-061暂缓)|content(二期),title(026迁移name_room异步生成≤16字标题,本期仅落库),is_test区分真实课堂与验收自测(防REQ-050二期"生成者即验收者"覆辙)
agent_messages[AG-L-M-GW]: 智能体每轮消息+调用日志表(025迁移),conversation_id FK CASCADE,role(user|assistant),content,model/prompt_tokens/completion_tokens/total_tokens/latency_ms(仅assistant行),finish_reason+truncated设为一等列不藏日志(吸取REQ-050/REQ-057/BUG-013"有信号不读"教训),canvas_elements/canvas_chars/had_image(本轮喂了多少画布内容进去)
agent_prompts[AG-C-T-U]: 提示词入库表(025迁移),id UUID PK,prompt_key(brainstorm_system/summarize_room/name_room),version,content,is_active(同key仅一版true,由代码保证),UNIQUE(prompt_key,version);L3迭代用法:改提示词走新增版本不改存量行,v1不编造原则→v2(027迁移)补"看不到内容的部分"披露指引

===V4.3持久化任务队列===
job_queue[JQ-L-T-GAWU]: 任务队列表,id UUID PK,task_type VARCHAR(50)(parse_material/generate_rubric/ai_assess/export_report),entity_type,entity_id UUID,payload JSONB='{}',status CHECK(queued|running|done|failed|cancelled)默认queued,retry_count=0,max_retries=3,last_error,scheduled_at=NOW(),started_at,finished_at,worker_id VARCHAR(100),priority=10,created_by,4索引(status+priority+scheduled_at WHERE queued/entity关联/running超时扫描/task_type统计),当前0条记录

===文件存储路径索引===
/opt/mindcanvas/uploads/images/: 画布图片(UUID.ext,POST /upload/image)
/opt/mindcanvas/uploads/files/{category}/: 房间文件(UUID.ext,POST /upload/file)
/opt/mindcanvas/uploads/assignments/: 作业材料(UUID.ext,MarkItDown解析源文件,50MB限制)
/opt/mindcanvas/uploads/assignments/submissions/: 学生作业提交文件(UUID.ext,公开上传无需登录,50MB限制,UploadRateLimit保护)
/opt/mindcanvas/uploads/avatars/: 自定义头像(UUID.ext,公开上传无需登录,2MB限制,OptionalAuth+UploadRateLimit保护,JPG/PNG/WebP)
/opt/mindcanvas/courseware/{package_id}/: zip课件解压目录(REQ-059,023迁移),刻意不放/uploads/下(nginx location /uploads/直出无鉴权挡不住已知路径),全部经Go后端下发以便校验归属/密码/过期

===Redis键值索引===
room:scene:{roomId}[SC]: scene_data JSON | TTL:7天 | mergeSceneElements合并写入+V4.3大小保护(>2MB告警/>5MB拒绝)
scene:throttle:{roomId}[SC]: 节流锁 | TTL:30秒 | SetNX防并发写穿
session:{uuid}[SE]: {roomId,nickname,avatar_url} | TTL:24h | 学生会话
reclaim:{4位码}[SE]: {uuid} | TTL:120秒 | 跨设备认领
ban:{roomId}:{uuid}[SE]: "1" | TTL:24h | UUID封禁
ratelimit:login:{ip}[SY]: 计数 | TTL:1min窗口 | 10次/min
ratelimit:api:{ip}[SY]: 计数 | TTL:1min窗口 | 200次/min
ratelimit:upload:{ip}[SY]: 计数 | TTL:1min窗口 | 10次/min
insight:{roomId}[IR]: JSON聚合数据 | TTL:10秒 | 学情雷达缓存
share:meta:{token}[SH]: ShareMetaResponse JSON | TTL:10分钟 | 分享元数据缓存
share:data:{token}[SH]: 完整分享数据JSON | TTL:5分钟 | 分享页数据缓存
===Redis键值索引完毕===

===数据库索引完毕===

#MindCanvas V4.3代码部分索引完毕

====MindCanvas Platform 完整索引完毕====
