// =============================================================
// MindCanvas v4.1 - 服务启动入口
// Phase5新增：课堂流程控制器路由注册
// Phase6新增：学情雷达路由注册
// Phase7新增：公开分享页 + 模板中心路由注册
// Phase8新增：AI作业评价中心路由注册
// Phase8-v2新增：作业码 + 花名册 + 学生独立提交路由注册
// V4.3新增：pprof调试端点 + 健康指标后台缓存(零DB查询) + 上传限流
// =============================================================
package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"net/http"
	_ "net/http/pprof" // V4.3: pprof 性能分析端点
	"os"
	"os/signal"
	"sync"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"

	"mindcanvas-server/config"
	"mindcanvas-server/database"
	"mindcanvas-server/handlers"
	"mindcanvas-server/middleware"
	"mindcanvas-server/services"
	"mindcanvas-server/ws"
)

// =============================================================
// V4.3: 健康指标缓存
// health接口高并发下不能每次打DB+HTTP，改为后台goroutine每10秒刷新
// /health 接口只读内存，不打DB、不打HTTP，可以承受任意并发
// =============================================================

// healthCache 健康指标缓存结构体
type healthCache struct {
	mu          sync.RWMutex
	parserOK    bool
	parseStats  map[string]interface{}
	dbOpen      int
	dbInUse     int
	dbIdle      int
	dbMaxOpen   int
	dbWaitCount int64
	dbWaitDur   string
	lastUpdated time.Time
}

// startHealthCacheUpdater 启动后台goroutine，每10秒刷新一次健康指标缓存
func startHealthCacheUpdater(
	cache *healthCache,
	assignmentSvc *services.AssignmentService,
	db *sql.DB,
) {
	refresh := func() {
		// 1. 检查解析服务（HTTP到8081，有3秒超时）
		parserOK := assignmentSvc.CheckParserHealth()
		// 2. 解析队列统计（4次DB查询）
		parseStats := assignmentSvc.ParseStats()
		// 3. DB连接池统计（纯内存，无查询）
		stats := db.Stats()

		cache.mu.Lock()
		cache.parserOK = parserOK
		cache.parseStats = parseStats
		cache.dbOpen = stats.OpenConnections
		cache.dbInUse = stats.InUse
		cache.dbIdle = stats.Idle
		cache.dbMaxOpen = stats.MaxOpenConnections
		cache.dbWaitCount = stats.WaitCount
		cache.dbWaitDur = stats.WaitDuration.String()
		cache.lastUpdated = time.Now()
		cache.mu.Unlock()
	}

	// 启动时立即刷新一次（同步，确保服务启动后立即有数据）
	refresh()

	// 之后每10秒后台刷新
	go func() {
		ticker := time.NewTicker(10 * time.Second)
		defer ticker.Stop()
		for range ticker.C {
			refresh()
		}
	}()
}

func main() {
	log.Println("========================================")
	log.Println("  MindCanvas v4.1 Phase8-v2 / V4.3 - 教育协同白板平台")
	log.Println("========================================")

	// ========== 1. 加载配置 ==========
	cfg := config.Load("/opt/mindcanvas/configs/.env")

	// ========== 2. 初始化数据库 ==========
	db, err := database.InitPostgres(cfg.DB)
	if err != nil {
		log.Fatalf("[启动] PostgreSQL 初始化失败: %v", err)
	}
	defer database.Close()

	// ========== 3. 初始化 Redis ==========
	rdb, err := database.InitRedis(cfg.Redis)
	if err != nil {
		log.Fatalf("[启动] Redis 初始化失败: %v", err)
	}
	defer database.CloseRedis()

	// ========== 4. 初始化服务 ==========
	profanityService := services.NewProfanityService(cfg.Profanity.DictPath)
	log.Printf("[启动] 敏感词服务就绪，词条数: %d", profanityService.WordCount())

	roomService    := services.NewRoomService(db)
	sessionService := services.NewSessionService(db, rdb, profanityService)
	widgetService  := services.NewWidgetService(db, profanityService)
	exportService  := services.NewExportService(db, rdb)
	flowService    := services.NewFlowService(db)

	// Phase6 互评服务
	reviewService := services.NewReviewService(db)

	// Phase7 分享服务
	shareService := services.NewShareService(db, rdb, exportService)

	// Phase8 作业评价服务（V4.3：内置启动恢复 + 并发限制）
	parserURL := os.Getenv("PARSER_URL")
	if parserURL == "" {
		parserURL = "http://localhost:8081"
	}
	assignmentService := services.NewAssignmentService(db, parserURL)
	log.Printf("[启动] 作业评价服务就绪，解析服务: %s", parserURL)
	// AI 服务（Doubao）
	aiSvc := services.NewAIService(cfg.AI.APIKey, cfg.AI.BaseURL, cfg.AI.Model)
	assignmentService.SetAIService(aiSvc)
	log.Printf("[启动] AI 服务就绪，模型: %s", cfg.AI.Model)

	// Phase8-v2 作业码服务
	tokenService := services.NewTokenService(db)
	log.Printf("[启动] 作业码服务就绪")

	// ========== 5. 初始化 WebSocket Hub ==========
	hub := ws.NewHub()

	// Phase6 学情雷达服务（需在 hub 初始化后创建）
	insightService := services.NewInsightService(db, rdb, hub)

	// ========== 6. 初始化处理器 ==========
	authHandler       := handlers.NewAuthHandler(db)
	adminHandler      := handlers.NewAdminHandler(db)
	roomHandler       := handlers.NewRoomHandler(roomService, sessionService, widgetService, exportService, hub, rdb)
	guestHandler      := handlers.NewGuestHandler(sessionService)
	wsHandler         := handlers.NewWSHandler(db, rdb, hub, widgetService, sessionService, profanityService)
	uploadHandler     := handlers.NewUploadHandler(db, rdb)
	flowHandler       := handlers.NewFlowHandler(flowService, roomService, hub)
	insightHandler    := handlers.NewInsightHandler(insightService)
	reviewHandler     := handlers.NewReviewHandler(reviewService)
	shareHandler      := handlers.NewShareHandler(shareService)
	assignmentHandler := handlers.NewAssignmentHandler(assignmentService, roomService)
	tokenHandler      := handlers.NewTokenHandler(tokenService)
	shelfHandler      := handlers.NewShelfHandler(roomService, hub)

	// REQ-045 P2 班级/花名册
	classService := services.NewClassService(db)
	classHandler := handlers.NewClassHandler(classService)

	// Chat养成对话处理器
	chatHandler := handlers.NewChatHandler(db)
	chatDoubaoHandler := handlers.NewChatDoubaoHandler(db, aiSvc)
	diagramHandler := handlers.NewDiagramHandler(aiSvc)
	refineHandler := handlers.NewRefineHandler(aiSvc) // REQ-028：文本→Markdown AI 提炼
	parseFileHandler := handlers.NewParseFileHandler(assignmentService, aiSvc) // REQ-038：AI 工作台文件→Markdown 解析；REQ-040：图片走豆包 OCR

	// ========== 7. 注册 WebSocket 消息处理器 ==========
	wsHandler.SetupMessageHandler()

	// ========== 8. V4.3: 启动健康指标后台缓存 ==========
	// 解决高并发下 health 接口每次打DB导致连接池耗尽的问题
	hCache := &healthCache{}
	startHealthCacheUpdater(hCache, assignmentService, db)
	log.Printf("[启动] 健康指标缓存已启动（每10秒后台刷新）")

	// ========== 9. V4.3: 启动 pprof 调试服务（内网独立端口 6060）==========
	// 访问：http://127.0.0.1:6060/debug/pprof/
	// 压测时用于采样 goroutine、heap、CPU，禁止对外暴露
	pprofEnabled := os.Getenv("PPROF_ENABLED")
	if cfg.Server.GinMode != "release" || pprofEnabled == "true" {
		go func() {
			pprofAddr := ":6060"
			log.Printf("[pprof] 调试服务启动: http://127.0.0.1%s/debug/pprof/", pprofAddr)
			log.Printf("[pprof] 注意：仅限内网访问，勿对外暴露")
			if err := http.ListenAndServe(pprofAddr, nil); err != nil {
				log.Printf("[pprof] 启动失败: %v", err)
			}
		}()
	}

	// ========== 10. 配置路由 ==========
	gin.SetMode(cfg.Server.GinMode)
	r := gin.Default()
	r.Use(middleware.CORS())

	// ---------- 公开接口（无需认证）----------
	auth := r.Group("/api/auth")
	{
		auth.POST("/login", middleware.LoginRateLimit(), authHandler.Login)
		auth.POST("/logout", authHandler.Logout)
	}

	guest := r.Group("/api/guest")
	{
		guest.POST("/join", middleware.APIRateLimit(), guestHandler.JoinRoom)
		guest.POST("/reclaim/generate", guestHandler.GenerateReclaimCode)
		guest.POST("/reclaim/verify", guestHandler.VerifyReclaimCode)
	}

	// WebSocket（自定义鉴权）
	r.GET("/ws/room/:id", wsHandler.HandleWebSocket)

	// 文件上传
	r.POST("/api/upload/image", middleware.OptionalAuth(), uploadHandler.UploadImage)
	r.POST("/api/upload/file", middleware.OptionalAuth(), uploadHandler.UploadFile)
	r.GET("/api/upload/file/:id", uploadHandler.GetFileInfo)
	// 需求3：头像上传（公开接口，学生入场前调用；教师携带JWT时自动更新avatar_url）
	r.POST("/api/upload/avatar", middleware.OptionalAuth(), uploadHandler.UploadAvatar)

	// 学生端课堂进度查询（公开）
	r.GET("/api/rooms/:id/flow/progress", flowHandler.GetStudentProgress)
	r.GET("/api/rooms/:id/elements/:eid/shelf-cards", middleware.OptionalAuth(), shelfHandler.ListShelfCards)
	r.POST("/api/rooms/:id/elements/:eid/shelf-cards", middleware.OptionalAuth(), shelfHandler.CreateShelfCard)
	// REQ-041 HTML 展示组件源码拉取：学生也需渲染，走 OptionalAuth 公共路由（同 shelf-cards 模式）
	r.GET("/api/rooms/:id/elements/:eid/html", middleware.OptionalAuth(), roomHandler.GetHtmlWidgetContent)

	// Phase7 公开分享页接口（无需认证）
	sharePublic := r.Group("/api/share")
	{
		sharePublic.GET("/:token/meta",    shareHandler.GetShareMeta)
		sharePublic.POST("/:token/verify", shareHandler.VerifySharePassword)
		sharePublic.GET("/:token/data",    shareHandler.GetShareData)
	}

	// Phase8 学生提交作业（原有UUID鉴权方式，保留兼容）
	r.POST("/api/assignments/:aid/submit", assignmentHandler.StudentSubmit)

	// Phase8-v2 学生凭作业码提交（完全公开）
	// V4.3: /submit/upload 使用专用限流（每IP每分钟10次）
	submit := r.Group("/api/submit")
	{
		submit.POST("/verify", middleware.APIRateLimit(), tokenHandler.VerifyToken)
		submit.POST("", middleware.APIRateLimit(), tokenHandler.SubmitByToken)
		submit.POST("/upload", middleware.UploadRateLimit(), tokenHandler.UploadSubmitFile)
		submit.GET("/:aid/result", tokenHandler.GetStudentResult)
		// REQ-039 3c 学生查看老师的反馈（token+uuid 双证，挂 AssignmentHandler 用 AssignmentService）
		submit.GET("/:aid/remediation", assignmentHandler.GetStudentRemediationPublic)
	}

	// ========== V4.3 健康检查（只读内存缓存，零DB查询，高并发安全）==========
	r.GET("/health", func(c *gin.Context) {
		hCache.mu.RLock()
		defer hCache.mu.RUnlock()

		c.JSON(http.StatusOK, gin.H{
			"status":    "ok",
			"service":   "mindcanvas",
			"version":   "4.1",
			"phase":     "8-v2-v4.3",
			"rooms":     hub.RoomCount(),
			"parser_ok": hCache.parserOK,
			"timestamp": time.Now().Format(time.RFC3339),
			"cache_age": time.Since(hCache.lastUpdated).String(),

			// 解析队列指标（10秒缓存，不实时）
			"parse_queue": hCache.parseStats,

			// DB连接池指标（10秒缓存，不实时）
			"db_pool": gin.H{
				"open":          hCache.dbOpen,
				"in_use":        hCache.dbInUse,
				"idle":          hCache.dbIdle,
				"max_open":      hCache.dbMaxOpen,
				"wait_count":    hCache.dbWaitCount,
				"wait_duration": hCache.dbWaitDur,
			},
		})
	})

	// ---------- 需认证接口 ----------
	r.GET("/api/auth/me", middleware.AuthRequired(), authHandler.GetCurrentUser)
	r.PUT("/api/auth/profile", middleware.AuthRequired(), authHandler.UpdateProfile)

	// 管理后台
	admin := r.Group("/api/admin")
	admin.Use(middleware.AuthRequired(), middleware.RequireRole("superadmin", "admin"))
	{
		admin.POST("/tenants", middleware.RequireRole("superadmin"), adminHandler.CreateTenant)
		admin.GET("/tenants", middleware.RequireRole("superadmin"), adminHandler.ListTenants)
		admin.PUT("/tenants/:id", middleware.RequireRole("superadmin"), adminHandler.UpdateTenant)
		admin.POST("/users", adminHandler.CreateUser)
		admin.GET("/users", adminHandler.ListUsers)
		admin.PUT("/users/:id/status", adminHandler.UpdateUserStatus)
			admin.PATCH("/users/:id/chat", adminHandler.UpdateUserChat)
		// 需求5：房间统计（superadmin 看全部，admin 看本租户）
		admin.GET("/room-stats", adminHandler.GetRoomStats)
		admin.GET("/room-stats/export", adminHandler.ExportRoomStatsCSV)
		admin.GET("/room-stats/:teacher_id/rooms", adminHandler.GetTeacherRooms)
	}

	// REQ-045 P2 班级/花名册管理（认证，教师私有）
	classes := r.Group("/api/classes")
	classes.Use(middleware.AuthRequired(), middleware.RequireRole("superadmin", "admin", "teacher"))
	{
		classes.GET("", classHandler.ListClasses)
		classes.POST("", classHandler.CreateClass)
		classes.DELETE("/:cid", classHandler.DeleteClass)
		classes.GET("/:cid/students", classHandler.ListStudents)
		classes.POST("/:cid/students", classHandler.AddStudent)
		classes.POST("/:cid/students/import", classHandler.ImportStudents)
		classes.DELETE("/:cid/students/:sid", classHandler.DeleteStudent)
	}

	// 房间管理（需认证）
	rooms := r.Group("/api/rooms")
	rooms.Use(middleware.AuthRequired(), middleware.RequireRole("superadmin", "admin", "teacher"))
	{
		rooms.GET("", roomHandler.ListRooms)
		rooms.POST("", roomHandler.CreateRoom)
		rooms.GET("/:id", roomHandler.GetRoom)
		rooms.PUT("/:id", roomHandler.UpdateRoom)
		rooms.DELETE("/:id", roomHandler.DeleteRoom)

		// 场控
		rooms.PUT("/:id/lock", roomHandler.LockRoom)
		rooms.PUT("/:id/readonly", roomHandler.SetReadOnly)
		rooms.POST("/:id/kick", roomHandler.KickMember)
		rooms.POST("/:id/gather", roomHandler.GatherMembers)
		rooms.GET("/:id/members", roomHandler.ListMembers)

		// 导出
		rooms.GET("/:id/export", roomHandler.ExportData)
		rooms.GET("/:id/export/contributions", roomHandler.ExportContributions)
		rooms.GET("/:id/export/text", roomHandler.ExportTextContent)

		// 总结
		rooms.GET("/:id/summary", roomHandler.GetSummary)
		rooms.GET("/:id/summary/export", roomHandler.ExportSummaryMarkdown)

		// 分组管理
		rooms.GET("/:id/groups", roomHandler.ListGroups)
		rooms.POST("/:id/groups/auto", roomHandler.AutoGroup)
		rooms.POST("/:id/groups", roomHandler.CreateGroup)
		rooms.PATCH("/:id/groups/:gid", roomHandler.UpdateGroup)
		rooms.DELETE("/:id/groups/:gid", roomHandler.DeleteGroup)

		// 作品墙
		rooms.GET("/:id/elements/:eid/submissions", roomHandler.GetDropzoneSubmissions)
		rooms.GET("/:id/elements/:eid/download", roomHandler.DownloadDropzoneZip)

		// REQ-041 HTML 展示组件（教师：创建 / 替换源码）
		rooms.POST("/:id/html-widget", roomHandler.CreateHtmlWidget)
		rooms.PUT("/:id/elements/:eid/html", roomHandler.UpdateHtmlWidgetContent)

		// Phase6 互评
		rooms.POST("/:id/elements/:eid/reviews", reviewHandler.CreateReview)
		rooms.GET("/:id/elements/:eid/reviews", reviewHandler.ListReviews)
			rooms.DELETE("/:id/elements/:eid/shelf-cards/:cid", shelfHandler.DeleteShelfCard)
			rooms.PATCH("/:id/elements/:eid/shelf-visibility", shelfHandler.ToggleShelfVisibility)

		// Phase6 学情雷达
		rooms.GET("/:id/insight", insightHandler.GetInsight)
		rooms.POST("/:id/insight/refresh", insightHandler.RefreshInsight)

		// Phase5 课堂流程
		rooms.GET("/:id/flow", flowHandler.GetFlow)
		rooms.GET("/:id/flows", flowHandler.ListFlows)
		rooms.POST("/:id/flow", flowHandler.CreateFlow)
		rooms.PUT("/:id/flow/:fid", flowHandler.UpdateFlow)
		rooms.DELETE("/:id/flow/:fid", flowHandler.DeleteFlow)
		rooms.POST("/:id/flow/:fid/activate", flowHandler.ActivateFlow)
		rooms.POST("/:id/flow/:fid/advance", flowHandler.AdvanceFlow)
		rooms.POST("/:id/flow/:fid/finish", flowHandler.FinishFlow)
		rooms.PATCH("/:id/flow/:fid/progress-visibility", flowHandler.UpdateShowProgress)

		// Phase7 分享管理
		rooms.POST("/:id/share", shareHandler.PublishShare)
		rooms.GET("/:id/share", shareHandler.GetRoomShares)
		rooms.DELETE("/:id/share/:sid", shareHandler.DeleteShare)

		// Phase7 模板管理
		rooms.POST("/:id/templates", shareHandler.SaveTemplate)
		rooms.DELETE("/:id/templates/:tid", shareHandler.DeleteTemplate)
	}

	// Phase7 模板列表 + 使用模板（跨房间）
	tmpl := r.Group("/api/templates")
	tmpl.Use(middleware.AuthRequired(), middleware.RequireRole("superadmin", "admin", "teacher"))
	{
		tmpl.GET("", shareHandler.ListTemplates)
		tmpl.POST("/:id/use", shareHandler.UseTemplate)
	}

	// Phase8 作业评价中心（教师端，需认证）
	assignments := r.Group("/api/assignments")
	// BUG-015：补作业归属校验，防止任意登录教师凭 UUID 操作他人作业
	assignments.Use(middleware.AuthRequired(), middleware.RequireRole("superadmin", "admin", "teacher"), middleware.AssignmentOwnership(db))
	{
		assignments.GET("/parser/health", assignmentHandler.ParserHealth)
		assignments.GET("", assignmentHandler.ListAssignments)
		assignments.POST("", assignmentHandler.CreateAssignment)
		assignments.GET("/:aid", assignmentHandler.GetAssignment)
		assignments.PATCH("/:aid/status", assignmentHandler.UpdateStatus)
		assignments.PATCH("/:aid/room", assignmentHandler.UpdateRoom) // REQ-048：关联/解绑课堂
		assignments.DELETE("/:aid", assignmentHandler.DeleteAssignment)
		assignments.POST("/:aid/materials", assignmentHandler.UploadMaterialFile)
		assignments.POST("/:aid/materials/text", assignmentHandler.AddTextMaterial)
		assignments.GET("/:aid/materials", assignmentHandler.ListMaterials)
		assignments.DELETE("/:aid/materials/:mid", assignmentHandler.DeleteMaterial)
		assignments.POST("/:aid/materials/:mid/parse", assignmentHandler.ReParseMaterial)
		assignments.POST("/:aid/rubric/generate", assignmentHandler.GenerateRubric)
		assignments.GET("/:aid/rubric", assignmentHandler.GetRubric)
		assignments.PUT("/:aid/rubric", assignmentHandler.ConfirmRubric)
		assignments.GET("/:aid/submissions", assignmentHandler.ListSubmissions)
		assignments.POST("/:aid/tokens/generate", tokenHandler.GenerateTokens)
		assignments.GET("/:aid/tokens", tokenHandler.ListTokens)
		assignments.GET("/:aid/tokens/export", tokenHandler.ExportTokensCSV)
		assignments.GET("/:aid/roster", tokenHandler.GetRoster)
		assignments.POST("/:aid/roster", tokenHandler.AddRosterEntry)
		assignments.POST("/:aid/roster/import", tokenHandler.ImportRosterCSV)
		assignments.POST("/:aid/roster/sync", tokenHandler.SyncRosterFromClassroom)
		assignments.DELETE("/:aid/roster/:rid", tokenHandler.DeleteRosterEntry)
		assignments.POST("/:aid/lecture/analyze", assignmentHandler.LectureAnalyze)
		assignments.GET("/:aid/lecture/report", assignmentHandler.GetLectureReport)
		assignments.PATCH("/:aid/lecture/blocks/:bid", assignmentHandler.UpdateLectureBlock)
		assignments.DELETE("/:aid/lecture/blocks/:bid", assignmentHandler.DeleteLectureBlock)
		assignments.POST("/:aid/lecture/blocks/:bid/regenerate", assignmentHandler.RegenerateLectureBlock)
		assignments.GET("/:aid/lecture/jobs/:jid", assignmentHandler.GetLectureJob)
		assignments.POST("/:aid/lecture/confirm", assignmentHandler.ConfirmLectureReport)
		assignments.POST("/:aid/recommendations/generate", assignmentHandler.GenerateRecommendations)
		assignments.GET("/:aid/recommendations/jobs/:jid", assignmentHandler.GetRecommendationJob)
		assignments.GET("/:aid/recommendations", assignmentHandler.ListRecommendations)
		assignments.PATCH("/:aid/recommendations/:rid", assignmentHandler.UpdateRecommendation)
		assignments.POST("/:aid/recommendations/publish", assignmentHandler.PublishRecommendations)
		// REQ-039 3c 学生补救
		assignments.GET("/:aid/remediations", assignmentHandler.ListRemediations)
		assignments.GET("/:aid/remediation/jobs/:jid", assignmentHandler.GetRemediationJob)
		assignments.POST("/:aid/students/:sid/remediation/generate", assignmentHandler.GenerateStudentRemediation)
		assignments.GET("/:aid/students/:sid/remediation", assignmentHandler.GetStudentRemediation)
		assignments.PATCH("/:aid/students/:sid/remediation", assignmentHandler.UpdateStudentRemediation)
		assignments.POST("/:aid/students/:sid/remediation/send", assignmentHandler.SendStudentRemediation)
	}

	// ===== Chat养成对话路由（仅chat_enabled用户可访问）=====
	chat := r.Group("/api/chat")
	chat.Use(middleware.AuthRequired())
	{
		// 人设管理
		chat.GET("/persona",  chatHandler.GetPersona)
		chat.PUT("/persona",  chatHandler.UpdatePersona)

		// 会话管理
		chat.GET("/sessions",        chatHandler.ListSessions)
		chat.POST("/sessions",       chatHandler.CreateSession)
		chat.DELETE("/sessions/:sid", chatHandler.DeleteSession)

		// 消息
		chat.GET("/sessions/:sid/messages", chatHandler.GetMessages)
		chat.POST("/sessions/:sid/send",    chatHandler.SendMessage)

		// Claude代理（解决浏览器直调403问题，API Key通过X-API-Key请求头传入）
		chat.POST("/proxy", chatHandler.ClaudeProxy)
		// Doubao 流式接口
		chat.POST("/doubao/messages", chatDoubaoHandler.SendMessage)
		chat.GET("/doubao/models",   chatDoubaoHandler.ListModels)

		// 文件记忆库
		chat.POST("/memory/upload",               chatHandler.UploadMemoryFile)
		chat.GET("/memory/files",                 chatHandler.ListMemoryFiles)
		chat.PATCH("/memory/files/:fid/toggle",   chatHandler.ToggleMemoryFile)
		chat.DELETE("/memory/files/:fid",         chatHandler.DeleteMemoryFile)
	}
	// ===== AI 图形生成路由（思维导图/流程图/时间轴/架构图/鱼骨图）=====
	ai := r.Group("/api/ai")
	ai.Use(middleware.AuthRequired())
	{
		ai.POST("/diagram", diagramHandler.Generate)
		ai.POST("/refine", refineHandler.Refine) // REQ-028：文本→Markdown AI 提炼
		ai.POST("/parse-file", parseFileHandler.ParseFile) // REQ-038：文件→Markdown（MarkItDown）
	}

	// 教学模块扩展路由预留
	modules := r.Group("/api/modules")
	modules.Use(middleware.AuthRequired())
	{
		_ = modules
	}

	// ========== 11. 启动服务 ==========
	addr := fmt.Sprintf(":%s", cfg.Server.Port)
	srv := &http.Server{Addr: addr, Handler: r}

	go func() {
		log.Printf("[启动] 服务监听 %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[启动] 服务启动失败: %v", err)
		}
	}()

	// ========== 12. 优雅关闭 ==========
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("[关闭] 收到关闭信号，开始优雅关闭...")

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("[关闭] 服务关闭出错: %v", err)
	}
	log.Println("[关闭] MindCanvas 服务已停止")
}
