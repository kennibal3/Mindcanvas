====MindCanvas Platform 完整索引====
===头部索引===
【部署】裸机模式: Go二进制(15MB)+React SPA(Vite构建,Excalidraw v0.18集成) + Nginx(80→301重定向+443 HTTPS,静态no-cache+反代Go:8080+WS升级timeout=86400s+/uploads/静态7天缓存含avatars/submissions子目录+client_max_body_size=100M+proxy_read_timeout=300s+proxy_request_buffering=off) + PostgreSQL16 + Redis7 + Python3.12 MarkItDown微服务(gunicorn/2workers/127.0.0.1:8081) | systemd管理(mindcanvas.service+mindcanvas-parser.service) | Ubuntu24.04阿里云2核1.6G+2Gswap | 部署命令：cd /opt/mindcanvas && bash deploy.sh(set -Eeuo pipefail+5步骤任意失败即止)
【系统】MindCanvas V4.3 已封板 — 教育协同白板+课堂互动平台 | Excalidraw v0.18无限画布+四级用户体系+实时协同+互动数据沉淀+课堂流程+AI作业评价+稳定性封板 | React18+TS+Zustand+Vite5+TailwindCSS3+Lucide | Go1.21+Gin1.9+gorilla/websocket+lib/pq+redis/go-redis/v9 | 免注册扫码入场+Widget+TeachingModule双层扩展+widget_interactions事实表+先结构化后AI
【整体规范】
目录示例：===配置索引 /opt/mindcanvas/=== 描述+目录绝对路径 单独一行
注释：#为分区标题行（如#后端Go代码索引），用于结构分隔，不被索引工具提取但需理解上下文
本索引包含两套代码标签体系：后端Go代码索引、前端React代码索引，各自独立定义；数据库索引采用独立表标签格式，详见各自规范区块

【当前能力清单】
画布场景: scene_update增量diff+mergeSceneElements增量合并(删除状态保护:existingDeleted&&!incomingDeleted时保留删除+version比较)+Redis热缓存7天+PG永久备份+30秒节流写(SetNX)+Redis丢失自动PG兜底恢复回写+V4.3场景大小保护(>2MB告警/>5MB拒绝)+元素归属追踪(customData.creatorId)+删除权限双重校验(教师删任何/学生只删自己/isApplyingRemote跳过校验)+主题风格(暗/亮+8背景色实时updateScene)+跟随模式+只读双向切换+图片REST上传(multipart→磁盘→base64广播)+Toolbar导入.excalidraw
互动组件: 投票(单/多选/状态机draft→open→paused→closed/柱饼条形图/匿名/截止/CSV导出/option传选项文字非索引)+词云(词频/敏感词过滤/maxWordsPerStudent)+问答(单选/正确答案/is_correct/统计图/公布结果/公布解析/防重唯一约束)+作品墙DropZone(文字/图片/文件/链接/教师like+pin+tag+hide+delete/ZIP打包/分组/deadline/每人上限/隐藏姓名+同伴互评Tab星级3维度)
教学模块: Phase5课堂流程(FlowEditor备课+FlowController执行/节点lecture/discussion/interaction/break/review/Widget绑定/画布模式联动free/readonly/follow/进度条/大纲解析)+Phase6学情雷达(InsightPanel/10秒轮询/7维聚合/无数据空状态)+Phase6同伴互评(peer_reviews/唯一约束)+总结中心(聚合API+Markdown导出+全组件统计)
分享模板: Phase7公开分享页(room_shares/share_token/public|password/bcrypt/hideNames脱敏/show控制/过期/view_count/Redis缓存10min+5min/只读)+Phase7模板中心(room_templates/快照/is_public/use_count)
作业评价: Phase8 MVP(MarkItDown解析PDF/Word/PPT/Excel/图片/文本→Markdown/6表/CRUD+异步解析+Rubric6维度生成确认版本化+提交+查看)+Phase8-v2作业码花名册(专属码/通用码+花名册课堂同步/手动/CSV导入+SubmitPage独立提交页+跨设备续接+过期拒绝+三类型提交)
头像: 需求3(011_avatar/POST /api/upload/avatar公开2MB JPG/PNG/WebP/OptionalAuth携JWT自动更新/Canvas裁剪200x200/MemberList优先圆形图)
管理统计: 需求5房间统计(AdminPage room-stats Tab/按机构筛选+排序+CSV导出+展开列表)
V4.3封板: pprof(6060内网)+health后台缓存(10秒零DB)+UploadRateLimit(10次/min)+持久化任务队列(job_queue/SKIP LOCKED/retry3次/jobWorker2秒轮询/recoverOnStartup)+场景大小保护+DB连接池(25/5/300s)+前端5页面懒加载+WS三轮k6压测封板

【服务器】公网IP:47.83.246.106 内网IP:172.17.52.90 | 域名:mindcanvas.com.cn(Let's Encrypt SSL,90天自动续期) | 端口:Nginx80/443→Go8080 | MarkItDown:localhost:8081(不对外) | pprof:localhost:6060(仅内网) | 数据库用户:mindcanvas | 超管:superadmin | DB密码:MC@2026secure!
【账号密码】teacher01~teacher05/Test@2026 | admin01/Test@2026 | superadmin/Test@2026（2026-06-13统一重置）
【代码量】后端Go:49文件13621行 | 前端TS/TSX/CSS:62文件16776行 | i18n:3文件(index.ts+zh.json+en.json) | 数据库:23表 | SQL迁移:001~011共11个
【自动化测试】/opt/mindcanvas/test_phase8_full.sh | 122/123通过率99% | 17个Section覆盖认证/房间/学生入场/Widget4种/场控/导出/总结/学情/流程/分享/模板/作业评价/作业码/花名册/学生提交/专属码/边界安全 | 旧脚本test_phase7_final.sh(88/91)+test_phase7.sh(更早废弃)
【压测基线-V4.3封板】HTTP/200并发:16923req/s延迟15ms | WS并发建连:200VU成功率100%/PingPong-P95=51ms/连接建立P95=1.18s/内存+47Mi/Swap零增长/Goroutine无泄漏(11→12) | WS投票:100VU/成功率100%/唯一约束零重复(100票100学生)/三选项均匀33-34 | WS场景洪泛:50VU×10min/58942次scene_update/version单调递增(9→30)/Redis与DB一致/98次/秒 | DB连接池MaxOpenConns=25压测高峰db_wait最高445后归零 | 容量上限:200并发WS安全线/大场景(1.8MB)room_sync广播61MB需控元素量
【已知坑】入场字段room_code(非invite_code)+响应data.uuid嵌套 | 分组响应顶层group_id | flow advance需direction字段 | 投票action_data字段名为option(选项文字字符串非option_idx索引) | ParseToken参数顺序(tokenString,secret) | redis包路径用github.com/redis/go-redis/v9 | AssignmentDetailPage白屏根因roster.roster后端返回null需Array.isArray防护 | rubric.criteria_json需safeRubric防护 | room_handler.go广播全改BroadcastRaw(原BroadcastToRoom嵌套已替换) | ws_handler.go readElementPayload供widget提交后读最新payload | room.go Register分支移除重复member_join(ws_handler.go统一负责) | pgq函数需head-1避免INSERT行拼接 | room_steps表PRD规划但从未建表实际不存在(课堂流程用teaching_flows实现) | room_images与peer_reviews两表owner=postgres(非mindcanvas)但已GRANT全部DML权限给mindcanvas,room_images仍被upload_handler.go引用功能正常但迁移时需注意

===后端索引规范===
【格式】文件名[标签]: F:功能 | R:关联 | A:API | S:简述
【标签ABCDE】
A层级: B后端Go H-Handler S-Service W-Middleware C-Config M-Model D-Database U-Utils WS-WebSocket
B模块: C核心 A认证 T租户 U用户 RM房间 EL元素 GS学生 WG互动组件 EX导出 PF敏感词 SE会话 CT流程 SY系统 SC场景同步 DZ作品墙 GRP分组 IR学情雷达 PR同伴互评 SH分享 TM模板 AV作业评价 TK作业码 JQ任务队列 AD管理统计 AV2头像
C重要度: 9核心 8高频 7业务 5常规 3辅助 1边缘
D特征: J-JWT P-RBAC V校验 B-bcrypt R限速 G-JSONB W-WebSocket A异步 L锁 U唯一约束 D软删 Z广播 N防重 C-Cookie X-Redis持久化 F文件IO
E规模: L大>400 M中200-400 S小100-200 T微<100
===后端索引规范完毕===

===前端代码索引规范===
【格式】文件名[标签]: F:功能 | R:关联 | A:API | S:简述
【标签ABCDE】
A层级: F页面 C组件 H-Hook S-Store U工具 X配置/入口 T类型 R注册中心 L布局
B模块: C核心 AU认证 CV画布 AD管理后台 ST学生端 TC教师控制 WG互动组件 DZ作品墙 IR学情雷达 PR同伴互评 SH分享 TM模板 AV作业评价 TK作业码 AV2头像 CT流程
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

===压测脚本 /opt/mindcanvas/loadtest/===
ws_baseline.js[CC8M]: F:WS并发建连压测 | R:k6 | A:- | S:50/100/200VU阶梯/PingPong延迟/room_sync时间/成功率三阈值
ws_vote.js[CC8M]: F:WS投票并发写入压测 | R:k6 | A:- | S:100VU固定UUID/option传文字/唯一约束验证
ws_scene.js[CC8M]: F:WS场景同步洪泛压测 | R:k6 | A:- | S:50VU×10min/500ms频率/version单调递增验证

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
main.go[BC9L]: F:服务启动入口装配并启动HTTP | R:全部模块 | A::8080 | S:Load配置→InitPostgres→InitRedis→hub先初始化→服务装配(含assignmentSvc.StopWorker优雅关闭)→Handler装配→SetupMessageHandler→V4.3:healthCache后台缓存(startHealthCacheUpdater每10秒刷新parser+parseStats含job_queue子字段+dbStats)→pprof:6060内网调试端口(GIN_MODE!=release自动启动)→Gin路由(公开:login/logout/guest/ws/upload/rooms/:id/flow/progress/share/:token三接口/assignments/:aid/submit学生公开/submit四接口含upload各带UploadRateLimit或APIRateLimit/POST /api/upload/avatar用OptionalAuth();认证:me/profile/admin/rooms全套/templates/assignments15路由/tokens9路由+roster5路由+admin/room-stats3路由;健康:/health只读缓存零DB查询含parse_queue.job_queue+db_pool+cache_age)→优雅关闭

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

===模型 /opt/mindcanvas/server/models/===
tenant.go[MT9T]: F:租户模型 | R:- | A:- | S:Tenant结构体
user.go[MU9T]: F:用户模型 | R:- | A:- | S:User结构体含avatar_url(需求3)
room.go[MRM9T]: F:房间模型 | R:- | A:- | S:Room+RoomMode+CreateRoomRequest+UpdateRoomRequest
element.go[MEL9T]: F:画布元素模型 | R:- | A:- | S:Element+10个Type常量
interaction.go[MWG9T]: F:互动行为模型 | R:- | A:- | S:WidgetInteraction结构体
session.go[MSE8T]: F:学生会话模型 | R:- | A:- | S:Session含student_uuid(非guest_uuid)+avatar_url+入场响应{"data":{"uuid":...}}嵌套
flow.go[MCT8S]: F:课堂流程模型 | R:- | A:- | S:FlowNode+FlowNodeType(5种lecture/discussion/interaction/break/review)+AdvanceFlowRequest(direction必填)
share.go[MSH8T]: F:分享与模板模型 | R:- | A:- | S:RoomShare+RoomTemplate+CreateShareRequest+ShareMetaResponse+VerifyPasswordRequest+CreateTemplateRequest
assignment.go[MAV8M]: F:作业评价模型 | R:- | A:- | S:AssignmentStatus/MaterialRole/ParseStatus/ReviewStatus常量+Assignment+AssignmentMaterial+RubricCriterion+RubricLevel+AssignmentRubric+AssignmentSubmission+AssignmentAssessment+AssignmentDetail+请求响应结构体+ParseResult
assignment_token.go[MTK8S]: F:作业码与花名册模型 | R:- | A:- | S:TokenTypeDedicated/Universal+RosterSource常量+AssignmentToken+AssignmentRoster+RosterWithStatus(含提交状态)+TokenVerifyResult+GenerateTokensRequest+SubmitByTokenRequest(含FileURL/FileName/LinkURL)+RosterSummary+SubmitFileResponse

===服务层 /opt/mindcanvas/server/services/===
profanity.go[SPF8S]: F:敏感词过滤服务 | R:configs/profanity_words.txt | A:- | S:词库热加载+昵称/文本/词云/问答/作品提交过滤
session_service.go[SSE8M]: F:学生会话服务 | R:models/session,database/redis | A:- | S:guest入场+昵称防冒充后缀+UUID生成+跨设备认领(4位码reclaim)
room_service.go[SRM8M]: F:房间业务服务 | R:models/room | A:- | S:房间CRUD+创建房间默认room_mode=interactive+DB()暴露db供其他服务复用
widget_service.go[SWG9LN]: F:互动组件服务 | R:models/interaction | A:- | S:HandleVote(option字段为选项文字字符串非索引)+HandleWordCloud+HandleAnswer+状态机控制+widget_interactions写入+防重唯一约束
review_service.go[SPR8S]: F:同伴互评服务 | R:peer_reviews | A:- | S:CreateReview ON CONFLICT DO UPDATE+ListReviewsByDropzone按submission分组+平均分计算+CheckAlreadyReviewed
insight_service.go[SIR8MX]: F:学情雷达服务 | R:ws/hub(HubInterface注入),database/redis | A:- | S:HubInterface接口注入+7维聚合(在线人数含教师/组件参与率/未提交名单排除teacher/问答正确率/高频词Top10/小组活跃/Top5学生)+Redis10秒缓存
flow_service.go[SCT8L]: F:课堂流程服务 | R:teaching_flows | A:- | S:流程CRUD+状态机draft→active→finished+节点推进+学生进度查询
export_service.go[SEX7L]: F:导出与总结服务 | R:widget_interactions,teaching_flows,room_sessions | A:- | S:CSV导出(UTF-8 BOM)+Markdown总结+QASummary+DropZoneSummary结构体+buildQASummaries+buildDropZoneSummaries+进度条文本+truncateString+参与概览
share_service.go[SSH8LX]: F:分享与模板服务 | R:room_shares/room_templates,database/redis | A:- | S:PublishShare一房间一分享UPSERT+GetShareMetaByToken(Redis缓存10min)+GetShareData(Redis缓存5min)+VerifySharePassword bcrypt+异步view_count递增+anonymizeName脱敏+SaveTemplate快照Widget+ListTemplates(自己+公开)+UseTemplate递增use_count
token_service.go[STK8L]: F:作业码核心服务 | R:assignment_tokens/assignment_rosters,room_sessions | A:- | S:GenerateTokens批量生成专属/通用码+generateTokenString8位大写字母数字+VerifyToken验证过期/状态/已提交+BindTokenToSubmission+GetRosterWithStatus联合查询+AddRosterEntry幂等UPSERT+ImportRosterFromCSV(姓名/姓名,UUID)+SyncFromClassroom从room_sessions同步排除教师(rs.student_uuid字段)+ExportTokensCSV含UTF-8 BOM+SubmitByToken支持文字/文件/链接三类型(文件存"文件名|URL")+GetStudentAssessment仅published可见
assignment_service.go[SAV9LAFQ]: F:作业评价业务服务(V4.3-P2C升级) | R:assignments系列表,job_queue,MarkItDown微服务 | A:- | S:parseSem信号量2并发+workerStop优雅关闭/enqueueParseJob写job_queue/claimNextJob FOR UPDATE SKIP LOCKED原子领取/markJobDone+markJobFailed(重试<max则30秒后重新入队超限标记failed)/jobWorker每2秒ticker轮询/executeJob信号量控制+switch task_type/StopWorker关闭通道/ParseMaterialAsync改为enqueueParseJob+降级兜底goroutine/parseMaterial同步执行更新updated_at/recoverOnStartup(3秒延迟修复parsing超10分钟+running超15分钟)/JobQueueStats+ParseStats含job_queue子字段/CheckSceneSize(ok|warn|reject)/GenerateDefaultRubric6维度100分/ConfirmRubric版本化/CreateSubmission版本追踪/作业CRUD+材料管理+提交管理全套

===处理器 /opt/mindcanvas/server/handlers/===
auth_handler.go[HA9M]: F:登录鉴权处理器 | R:services,utils/jwt | A:POST /login,POST /logout,GET /me,PUT /profile | S:Login查询含avatar_url返回/GetCurrentUser从DB读COALESCE(avatar_url,'')不依赖JWT/UpdateProfile支持avatar_url(CASE WHEN $!=''THEN $ ELSE avatar_url END)/display_name+password+avatar_url三字段独立可选更新
admin_handler.go[HAD8ML]: F:管理后台处理器 | R:services | A:租户CRUD+用户CRUD+GET /admin/room-stats+GET /admin/room-stats/:teacher_id/rooms+GET /admin/room-stats/export | S:superadmin看全部/admin看本租户/TeacherRoomStat含total_rooms+active_rooms+last_active_str
room_handler.go[HRM8LZ]: F:房间管理处理器 | R:room_service,ws | A:rooms全套CRUD+lock+gather+export+分组+作品墙+ZIP下载 | S:缺陷修复V1:LockRoom+SetReadOnly+GatherMembers+分组CRUD全改BroadcastRaw扁平JSON(原BroadcastToRoom嵌套已全部替换/REQ-005)
guest_handler.go[HGS8S]: F:学生免注册入场处理器 | R:session_service | A:POST /guest/join | S:room_code字段(非invite_code)+data.uuid嵌套响应
upload_handler.go[BUP8MLF]: F:文件上传处理器 | R:room_images,services | A:POST /upload/image,POST /upload/file,GET /upload/file/:id,POST /upload/avatar | S:UploadAvatar(公开接口/字段名avatar/2MB/JPG+PNG+WebP/MIME嗅探+扩展名二次判断/携JWT时UPDATE users.avatar_url)/allowedAvatarMIMEs白名单/maxAvatarSize=2MB/引用room_images表(owner=postgres已GRANT)
ws_handler.go[WSC9LWXZ]: F:WebSocket处理器 | R:ws/hub,widget_service,scene持久化 | A:/ws | S:resolveTeacherFromCookie(直接解析Cookie JWT解决教师WS401)+mergeSceneElements增量合并+room_sync延迟800ms+场景大小保护(2MB告警/5MB拒绝)+缺陷修复V1:readElementPayload(从DB读最新payload供widget提交后广播/REQ-003)/HandleWebSocket广播member_join携avatar_url从Redis+DB两级读取(REQ-004)/handleWidgetSubmit提交成功后调readElementPayload确保payload非nil才广播
flow_handler.go[HCT8M]: F:课堂流程处理器 | R:flow_service | A:flow全套10个含公开学生进度接口 | S:AdvanceFlow需direction字段
insight_handler.go[HIR8T]: F:学情雷达处理器 | R:insight_service | A:GET /insight,POST /insight/refresh | S:GetInsight+刷新清缓存
review_handler.go[HPR8T]: F:同伴互评处理器 | R:review_service | A:POST /elements/:eid/reviews,GET /elements/:eid/reviews | S:resolveReviewerUUID三级身份解析
share_handler.go[HSH8M]: F:分享与模板处理器 | R:share_service | A:PublishShare+GetShareMeta+VerifySharePassword+GetShareData+SaveTemplate+DeleteTemplate+UseTemplate | S:PublishShare默认值JSON raw解析defaultTrue处理show_字段/GetShareMeta公开无认证/GetShareData密码鉴权(Query pwd|Header X-Share-Password)
assignment_handler.go[HAV8M]: F:作业评价处理器 | R:assignment_service | A:assignments全套15端点 | S:UploadMaterialFile(50MB/UUID文件名/异步解析)+StudentSubmit(UUID双鉴权)+ParserHealth代理检查
token_handler.go[HTK8L]: F:作业码与花名册处理器 | R:token_service | A:tokens9个+roster5个+submit4个(含UploadSubmitFile公开上传) | S:全套CRUD+UploadSubmitFile(submitFileExtensions白名单/50MB/UUID文件名/存assignments/submissions/)
pg_array.go[BDZ3T]: F:PG数组工具 | R:- | A:- | S:JSONB/数组类型扫描辅助

===WebSocket /opt/mindcanvas/server/ws/===
message.go[WSC8S]: F:消息类型定义 | R:- | A:- | S:30个消息常量含MsgCtrlFlowUpdate+MsgCtrlFlowWidgetHint+dropzone系列+group_update
client.go[WSRM8MW]: F:WS客户端 | R:hub,room | A:- | S:WritePump每条消息独立WriteMessage(原批量合并+\n致前端只解析首条已修复)+ReadPump
hub.go[WSC8SZ]: F:WS中心 | R:client,room | A:- | S:GetRoomClientCount+GetRoomClientList(含role字段供InsightService使用)
room.go[WSRM8LZ]: F:WS房间广播 | R:client,hub | A:- | S:BroadcastRaw/BroadcastRawToOthers并发安全(先收集待移除client出读锁再加写锁清理)+缺陷修复V1:Register分支移除重复member_join广播(REQ-004)/member_leave改BroadcastRaw扁平格式

===工具 /opt/mindcanvas/server/utils/===
jwt.go[UA8JS]: F:JWT工具 | R:- | A:- | S:ParseToken(tokenString,secret)参数顺序+签发+校验
random.go[UC3T]: F:随机串工具 | R:- | A:- | S:invite_code+token+4位认领码生成
validator.go[UC5S]: F:校验工具 | R:- | A:- | S:输入校验+格式验证

#后端Go代码索引完毕

#前端React代码索引(62文件16776行)

===入口 /opt/mindcanvas/web/src/===
main.tsx[XC9T]: F:React应用入口 | R:App.tsx,i18n/index.ts,index.css | A:- | S:ReactDOM.createRoot+StrictMode+BrowserRouter+QueryClientProvider
App.tsx[XC9ML]: F:路由与全局布局 | R:所有pages | A:- | S:V4.3-P2B懒加载升级/React.lazy(AdminPage+SharePage+SubmitPage+AssignmentPage+AssignmentDetailPage五页面)/Suspense统一LoadingFallback/RoomPage+LoginPage+JoinPage+DashboardPage同步加载保首屏/路由:/share/:token完全公开+/assignments+/assignments/:id受保护+/submit完全公开
index.css[XC5S]: F:全局样式 | R:tailwind.config.cjs | A:- | S:暗/亮色主题变量+移动端适配+防iOS缩放

===i18n /opt/mindcanvas/web/src/i18n/===
index.ts[XC5T]: F:i18n入口 | R:zh.json,en.json | A:- | S:语言切换+翻译函数
zh.json[XC5T]: F:中文翻译 | R:- | A:- | S:全量中文字符串
en.json[XC5T]: F:英文翻译 | R:- | A:- | S:全量英文字符串

===类型 /opt/mindcanvas/web/src/types/===
user.ts[TAU9T]: F:用户类型 | R:- | A:- | S:AuthUser含avatar_url?:string(需求3)
room.ts[TRM9T]: F:房间类型 | R:- | A:- | S:Room+RoomMember含avatar_url?:string(需求3)+ROOM_MODE_LABELS只读展示(已移除ROOM_MODES数组)
card.ts[TCV7M]: F:卡片类型 | R:- | A:- | S:TextCard+ImageCard+卡片payload类型定义
widget.ts[TWG8M]: F:Widget类型 | R:- | A:- | S:PollPayload+WordCloudPayload+QAPayload+DropzonePayload+状态机类型
message.ts[TC9T]: F:WS消息类型 | R:- | A:- | S:WebSocket消息结构体类型定义
canvas.ts[TCV8S]: F:画布类型 | R:- | A:- | S:CanvasElement+画布状态类型
flow.ts[TCT8S]: F:课堂流程类型 | R:- | A:- | S:FlowNode+FlowNodeType+FlowState类型定义
assignment.ts[TAV8M]: F:作业评价类型 | R:- | A:- | S:AssignmentStatus/MaterialRole/ParseStatus/ReviewStatus+Assignment+AssignmentMaterial+RubricCriterion+RubricLevel+AssignmentRubric+AssignmentSubmission+各常量映射
token.ts[TTK8S]: F:作业码与花名册类型 | R:- | A:- | S:AssignmentToken+AssignmentRoster+RosterWithStatus+RosterSummary+TokenVerifyResult+GenerateTokensRequest+SubmitByTokenRequest(含file_url/file_name/link_url)+StudentAssessmentResult+SubmitPageStep状态机类型(8种状态)

===状态 /opt/mindcanvas/web/src/store/===
authStore.ts[SAU9ZT]: F:认证状态 | R:- | A:- | S:Zustand/setUser存整个AuthUser含avatar_url/hydrate+checkAuth
roomStore.ts[SRM9ZM]: F:房间状态 | R:- | A:- | S:Zustand/房间成员列表+在线状态+消息队列
canvasStore.ts[SCV8ZS]: F:画布状态 | R:- | A:- | S:Zustand/ThemeMode类型+BACKGROUND_COLORS预设+theme/backgroundColor字段+setTheme/setBackgroundColor(供CanvasEngine监听和ControlPanel写入)
widgetStore.ts[SWG5ZT]: F:Widget状态 | R:- | A:- | S:Zustand/当前活跃Widget状态管理

===Hooks /opt/mindcanvas/web/src/hooks/===
useAuth.ts[HAU8S]: F:认证Hook | R:authStore | A:GET /api/auth/me | S:checkAuth调用/api/auth/me返回data.user含avatar_url自动存入store
useWebSocket.ts[HCV9WLE]: F:WebSocket连接Hook | R:roomStore,canvasStore | A:/ws | S:全面对齐后端扁平消息格式(room_sync读顶层字段/scene_update读msg.data/member_join读顶层uuid+name)/缺陷修复V1:member_join处理新增avatar_url写入RoomMember(REQ-004)/ctrl_follow_mode处理兼容enabled字段(REQ-009)
useCanvasTransform.ts[HCV7S]: F:画布变换Hook | R:canvasStore | A:- | S:scrollX/scrollY/zoom同步+DOM Overlay坐标转换
useImageUpload.ts[HCV8HS]: F:图片上传Hook | R:- | A:POST /upload/image | S:multipart上传+进度+错误处理

===注册中心 /opt/mindcanvas/web/src/registry/===
WidgetRegistry.ts[RWG7S]: F:Widget注册中心 | R:- | A:- | S:Widget类型注册+渲染组件映射+创建Modal映射
ModuleRegistry.ts[RTC7S]: F:Module注册中心 | R:- | A:- | S:TeachingModule注册+侧边栏挂载点
widgetRegister.ts[RWG7S]: F:Widget注册执行 | R:WidgetRegistry | A:- | S:投票/词云/问答/DropZone四种Widget注册

===工具 /opt/mindcanvas/web/src/utils/===
constants.ts[UC5M]: F:全局常量 | R:- | A:- | S:API基础路径+Widget类型常量+状态常量
flowApi.ts[UCT7S]: F:课堂流程API | R:- | A:flow全套10个端点 | S:flow CRUD+推进+学生进度查询
assignmentApi.ts[UAV8S]: F:作业评价API | R:- | A:assignments全套15端点 | S:13个函数覆盖全部assignment端点
tokenApi.ts[UTK8S]: F:作业码与花名册API | R:- | A:/api/assignments/:aid/tokens全套+/api/submit四接口含upload | S:12个函数+通用req<T>封装credentials:include

===页面 /opt/mindcanvas/web/src/pages/===
LoginPage.tsx[FAU9FMS]: F:登录页 | R:authStore | A:POST /login | S:教师/管理员登录+JWT Cookie+错误提示+响应式
DashboardPage.tsx[FTC9FMPL]: F:教师主页 | R:authStore,roomStore | A:rooms全套+templates | S:我的房间|模板中心双Tab+顶部导航含作业评价按钮+创建/删除房间+需求3个人设置弹窗(头像预览/更换/Canvas裁剪200x200+POST /api/upload/avatar credentials:include/保存时PUT /api/auth/profile携带avatar_url)+手机端底部弹出弹窗
JoinPage.tsx[FST9FRSL]: F:学生入场页 | R:roomStore | A:POST /guest/join | S:手机端全面优化(键盘弹出检测/autoCapitalize/loading动画)+需求3头像上传(头像格子末尾📷上传格子/handleAvatarFileChange+cropImageToSquare Canvas裁剪200x200取中心正方形/POST /api/upload/avatar公开接口/上传成功setAvatarURL清除预设选中/提交携带avatar_url/LocalStorage保存mc_avatar_url)
RoomPage.tsx[FCV9EML]: F:课堂主页 | R:canvasStore,roomStore,useWebSocket | A:- | S:Excalidraw画布+ControlPanel+CanvasOverlay+FloatingWidgets+WS连接管理+connectionStatus/onReadOnlyChange/onFollowModeChange
AdminPage.tsx[FAD9TFMPL]: F:管理后台页(懒加载) | R:authStore | A:admin全套 | S:三Tab(租户管理/用户管理/房间统计)+fetchRoomStats/toggleTeacherRooms/exportRoomStatsCSV/按机构筛选(超管)+按total_rooms|active_rooms排序+展开教师房间列表+CSV导出
SharePage.tsx[FSH9FML]: F:公开分享页(懒加载) | R:- | A:GET /api/share/:token | S:状态机loading→need_password|loaded|error|expired+密码保护弹窗+PollCard投票柱状图+QACard问答正确率+WordCloudCard词云气泡+DropzoneCard作品墙+StatCard参与概览+访问计数
AssignmentPage.tsx[FAV8ML]: F:作业列表页(懒加载) | R:- | A:assignments CRUD | S:作业列表+创建弹窗+删除+状态徽章+统计卡片+手机端底部弹出
AssignmentDetailPage.tsx[FAV9XL]: F:作业详情页(懒加载) | R:- | A:assignment全套 | S:四Tab(材料管理/评分标准/学生提交/作业码)+ErrorBoundary+safeRubric防criteria_json为null+roster.null防护Array.isArray
SubmitPage.tsx[FTK9ML]: F:学生作业独立提交页(懒加载) | R:- | A:/api/submit四接口 | S:完全公开/状态机8步(input_token→verifying→fill_name→write_content→submitting→success→view_result)/文字|文件|链接三Tab/LocalStorage跨会话UUID保存/AssessmentCard评价展示/手机端友好大按钮/URL参数?token=预填

===组件-画布 /opt/mindcanvas/web/src/components/canvas/===
CanvasEngine.tsx[CCV9EMLE]: F:画布引擎 | R:canvasStore,useWebSocket | A:- | S:Excalidraw核心封装+isApplyingRemote防远程删除被权限校验误拦截+applyRemote支持数组和{elements:[]}两种格式+handleAPI就绪后100ms延迟处理pending队列+学生删除权限收紧(owner明确且非自己才拦截)+需求1主题修复:新增useEffect监听canvasStore.theme→api.updateScene({appState:{theme}})+监听backgroundColor→api.updateScene({appState:{viewBackgroundColor}})+handleAPI就绪后立即同步store当前值
Toolbar.tsx[CCV7MS]: F:画布工具栏 | R:canvasStore | A:POST /upload/image | S:文本卡片+图片上传+缩放控制+需求7:新增FolderOpen导入按钮+handleExcalidrawFileSelected(解析.excalidraw|.json/验证elements/新ID去冲突/偏移20px/updateScene合并/成功Check提示2.5s/失败错误浮层3s)
CanvasOverlay.tsx[CCV7M]: F:画布覆盖层 | R:canvasStore,WidgetRegistry | A:- | S:DOM Overlay跟随画布缩放平移+Widget渲染+卡片渲染
FloatingWidgets.tsx[CCV8L]: F:浮动Widget层 | R:widgetStore,WidgetRegistry | A:- | S:Widget创建Modal管理+浮动工具栏

===组件-卡片 /opt/mindcanvas/web/src/components/cards/===
CardRenderer.tsx[CCV7S]: F:卡片渲染器 | R:WidgetRegistry | A:- | S:根据type分发渲染TextCard/ImageCard
TextCard.tsx[CCV7M]: F:文本卡片组件 | R:roomStore | A:- | S:双击编辑+点赞+反应+敏感词过滤
ImageCard.tsx[CCV7M]: F:图片卡片组件 | R:- | A:- | S:图片展示+标题+缩略图+懒加载

===组件-教师 /opt/mindcanvas/web/src/components/teacher/===
ControlPanel.tsx[CTC9PMLF]: F:教师控制面板 | R:canvasStore,roomStore,useWebSocket | A:rooms控制全套 | S:缺陷修复V1:新增React内联ConfirmModal(白色圆角卡片/AlertTriangle图标/z-index=2147483647/不冻结页面替代window.confirm/REQ-006)+handleSetReadOnly+handleKick均通过confirmModal状态触发+handleGather成功Toast(REQ-010)+isFollowMode开启时sendMessage ctrl_follow_mode{enabled:true}(REQ-009)+主题修复(亮/暗按钮onClick同步写useCanvasStore.getState().setTheme())+双Tab(场控/课堂流程)+数据导出区+分享与模板区+SaveTemplateModal
MemberList.tsx[CTC8PS]: F:在线成员列表 | R:roomStore | A:- | S:需求3头像展示优先级(member.avatar_url存在→圆形img w-7 h-7 rounded-full object-cover/否则→预设emoji span)+getAvatar返回{type:'url'|'emoji',value:string}+isMemberTeacher判断角色+踢人按钮仅对学生显示
WidgetToolbar.tsx[CTC8M]: F:Widget工具栏 | R:WidgetRegistry,widgetStore | A:- | S:教师创建Widget入口+四种Widget按钮
SummaryPanel.tsx[CTC7ML]: F:课堂总结面板 | R:- | A:GET /rooms/:id/summary | S:修复卡死(handleToggle首次点击触发loadSummary/加载失败也展开显示错误+重试/expanded独立于summary/任何时候都能关闭)+QA正确率+DropZone预览+参与概览+Markdown导出
InsightPanel.tsx[CIR8MS]: F:学情雷达面板 | R:- | A:GET /insight | S:修复卡死(展开时立即fetch+10秒轮询/收起时clearInterval/fetch失败显示错误+重试/无数据空状态+在线人数仍展示)+7维展示(参与率进度条/未提交红色标签/问答正确率/高频词气泡/小组条形图/Top5奖牌)
FlowNodeCard.tsx[TCT7M]: F:流程节点卡片 | R:- | A:- | S:单节点展示+状态徽章+Widget绑定提示
FlowEditor.tsx[TCT8M]: F:课堂流程编辑器 | R:flowApi | A:flow CRUD | S:课前备课/节点CRUD+类型选择+Widget绑定+文本大纲解析生成节点
FlowController.tsx[TCT8M]: F:课堂流程控制器 | R:flowApi,useWebSocket | A:flow推进 | S:课中执行/当前节点高亮+推进+画布模式联动free/readonly/follow+学生端进度条开关

===组件-分享 /opt/mindcanvas/web/src/components/share/===
SharePublishModal.tsx[CSH8M]: F:分享发布弹窗 | R:- | A:POST /rooms/:id/share | S:三阶段loading→form→published+密码toggle+展示内容开关+过期日期+复制链接+访问计数+撤销分享

===组件-Widget /opt/mindcanvas/web/src/components/widgets/===
PollingWidget.tsx[CWG9M]: F:投票Widget展示 | R:roomStore | A:- | S:柱状图/饼图/条形图展示+实时更新+状态机渲染+匿名/实名显示
PollingCreateModal.tsx[CWG7MF]: F:投票创建弹窗 | R:- | A:- | S:缺陷修复V1:z-index=2147483647覆盖Excalidraw层(REQ-001)+onChange+onInput+onBlur三事件+DOM ref后备读取兼容粘贴自动填充(REQ-008)
WordCloudWidget.tsx[CWG8M]: F:词云Widget展示 | R:roomStore | A:- | S:词频可视化+实时更新+状态机渲染
WordCloudCreateModal.tsx[CWG6S]: F:词云创建弹窗 | R:- | A:- | S:缺陷修复V1:z-index=2147483647(REQ-001)+词数选项[1,2,3,4,5]补充缺失的4(REQ-016)+onInput+onBlur(REQ-008)
QAWidget.tsx[CWG8M]: F:问答Widget展示 | R:roomStore | A:- | S:单选题+即时对错反馈+正确率统计图+公布结果/解析
QACreateModal.tsx[CWG7MF]: F:问答创建弹窗 | R:- | A:- | S:缺陷修复V1:z-index=2147483647(REQ-001)+浅色白色主题移除dark:bg-gray-800(REQ-015)+onInput+onBlur(REQ-008)
DropZoneWidget.tsx[CWG9L]: F:作品墙Widget | R:roomStore | A:dropzone系列 | S:作品墙/互评双Tab+文字/图片/文件/链接提交+教师like+pin+tag+hide+delete+REVIEW_DIMENSIONS 3维度+内联星级评分表单+handleSubmitReview+renderReviewTab平均分展示
DropZoneCreateModal.tsx[CWG8M]: F:作品墙创建弹窗 | R:- | A:- | S:缺陷修复V1:z-index=2147483647(REQ-001)+acceptTypes/layout/maxPerStudent/hideNames配置
FallbackWidget.tsx[CWG3T]: F:未知Widget兜底 | R:WidgetRegistry | A:- | S:未注册Widget类型的降级展示

#前端React代码索引完毕

===数据库索引-mindcanvas===
数据库: PostgreSQL 16 | UTF-8 | 用户: mindcanvas | 扩展: pgcrypto | 23表

【标签说明】
格式: 表名[业务域-表类型-规模预估-特征]
业务域: U用户 RM房间 EL元素 WG互动 SE会话 SC场景 CT流程 DZ作品墙 GRP分组 PR同伴互评 SH分享 TM模板 AV作业评价 TK作业码 JQ任务队列 IM图片
表类型: M主表 R关联表 L日志表 C配置表 S统计表
规模预估: T微小(<100) S小(100-1K) M中(1K-10K) L大(10K-100K) X超大(>100K)
特征: G有JSONB字段 I多索引 U有唯一约束 D软删除 F有外键 W仅追加 N防重约束

===租户与用户===
tenants[U-M-T-I]: 租户主表,id UUID PK,name/max_teachers/max_rooms/is_active,当前2条记录
users[U-M-S-UI]: 用户主表,id UUID PK,tenant_id FK,username+email唯一,password bcrypt,role CHECK(superadmin|admin|teacher),is_active,avatar_url TEXT可null(需求3教师自定义头像),当前7条记录

===房间===
rooms[RM-M-S-UIDF]: 房间主表,id UUID PK,teacher_id FK users,tenant_id FK,title,invite_code UNIQUE,is_locked/is_readonly=FALSE,max_capacity=50,status CHECK(active|finished|archived),room_mode CHECK(whiteboard|cards|interactive)默认interactive,finished_at可null,当前8条记录

===元素===
room_elements[EL-M-L-GIF]: 画布元素表,id UUID PK,room_id FK,creator_uuid,creator_name,type(10种),payload JSONB='{}',is_deleted=FALSE,当前496条记录(最高频表)

===互动===
widget_interactions[WG-R-X-GIFNWU]: 互动行为事实表,id UUID PK,element_id FK(CASCADE),room_id,student_uuid,student_name,action_type,action_data JSONB,is_correct可null,widget_type,group_id,updated_at | idx_wi_no_duplicate_vote/word/answer三个唯一约束防重 | 当前106条记录

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

===V4.3持久化任务队列===
job_queue[JQ-L-T-GAWU]: 任务队列表,id UUID PK,task_type VARCHAR(50)(parse_material/generate_rubric/ai_assess/export_report),entity_type,entity_id UUID,payload JSONB='{}',status CHECK(queued|running|done|failed|cancelled)默认queued,retry_count=0,max_retries=3,last_error,scheduled_at=NOW(),started_at,finished_at,worker_id VARCHAR(100),priority=10,created_by,4索引(status+priority+scheduled_at WHERE queued/entity关联/running超时扫描/task_type统计),当前0条记录

===文件存储路径索引===
/opt/mindcanvas/uploads/images/: 画布图片(UUID.ext,POST /upload/image)
/opt/mindcanvas/uploads/files/{category}/: 房间文件(UUID.ext,POST /upload/file)
/opt/mindcanvas/uploads/assignments/: 作业材料(UUID.ext,MarkItDown解析源文件,50MB限制)
/opt/mindcanvas/uploads/assignments/submissions/: 学生作业提交文件(UUID.ext,公开上传无需登录,50MB限制,UploadRateLimit保护)
/opt/mindcanvas/uploads/avatars/: 自定义头像(UUID.ext,公开上传无需登录,2MB限制,OptionalAuth+UploadRateLimit保护,JPG/PNG/WebP)

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
