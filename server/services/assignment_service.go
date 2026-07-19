// =============================================================
// MindCanvas Phase8 - 作业评价中心服务层
// V4.3 P2-C：集成持久化任务队列（job_queue 表）
//
// 核心变更：
//   - 新增 JobQueueService 接口（解耦，方便测试和替换）
//   - ParseMaterialAsync 改为先写 job_queue 再异步消费
//   - 新增 jobWorker goroutine（服务启动时运行，轮询队列）
//   - recoverStuckParsingTasks 升级：同时处理 job_queue 中
//     长期 running 的任务
//   - 保留原有信号量并发控制（job_queue + 信号量双层保护）
// =============================================================
package services

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"mindcanvas-server/models"
)

// jobRecord job_queue 表中一条任务记录的关键字段
type jobRecord struct {
	ID       string
	TaskType string
	EntityID string
	Payload  json.RawMessage
}

// AssignmentService 作业评价服务
type AssignmentService struct {
	db        *sql.DB
	parserURL string // MarkItDown 微服务地址

	// 解析并发控制：最多同时2个解析任务，避免压垮CPU
	// job_queue 负责持久化排队，信号量负责并发上限控制
	parseSem chan struct{}

	// worker 停止信号（优雅关闭时通知 worker 退出）
	workerStop chan struct{}
	// AI 服务（可选，由 SetAIService 注入）
	aiSvc *AIService
}

// NewAssignmentService 创建服务实例
// V4.3：启动时自动修复卡住任务 + 启动 job_queue worker
func NewAssignmentService(db *sql.DB, parserURL string) *AssignmentService {
	if parserURL == "" {
		parserURL = "http://localhost:8081"
	}
	svc := &AssignmentService{
		db:         db,
		parserURL:  parserURL,
		parseSem:   make(chan struct{}, 2), // 最多2个并发解析
		workerStop: make(chan struct{}),
	}

	// 启动时异步执行（不阻塞服务启动）：
	//   1. 修复 assignment_materials 中卡住的 parsing 任务
	//   2. 修复 job_queue 中卡住的 running 任务
	//   3. 恢复 queued 的 parse_material 任务入内存队列
	go svc.recoverOnStartup()

	// 启动 job_queue worker（持续轮询队列）
	go svc.jobWorker()

	return svc
}

// StopWorker 优雅关闭 worker（供 main.go 在 Shutdown 时调用）
func (s *AssignmentService) StopWorker() {
	close(s.workerStop)
}

// SetAIService 注入 AI 服务（可在 NewAssignmentService 后调用）
func (s *AssignmentService) SetAIService(ai *AIService) { s.aiSvc = ai }

// =============================================================
// V4.3 P2-C：job_queue 核心操作
// =============================================================

// enqueueParseJob 将文件解析任务写入 job_queue
// 设计：先写库再异步消费，服务重启后任务不丢失
func (s *AssignmentService) enqueueParseJob(materialID string) error {
	payload, _ := json.Marshal(map[string]string{
		"material_id": materialID,
	})
	_, err := s.db.Exec(`
		INSERT INTO job_queue
		  (task_type, entity_type, entity_id, payload, status, priority, created_by)
		VALUES
		  ('parse_material', 'assignment_material', $1, $2::jsonb, 'queued', 10, 'system')
	`, materialID, string(payload))
	if err != nil {
		return fmt.Errorf("写入任务队列失败: %w", err)
	}
	log.Printf("[任务队列] 已入队 parse_material entity=%s", materialID)
	return nil
}

// claimNextJob 从 job_queue 领取一个待执行任务（原子操作）
// 使用 FOR UPDATE SKIP LOCKED 实现无锁并发领取（PostgreSQL 特性）
func (s *AssignmentService) claimNextJob() (jobID string, taskType string, payload []byte, err error) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", "", nil, err
	}
	defer func() {
		if err != nil {
			tx.Rollback()
		}
	}()

	var payloadStr string
	err = tx.QueryRow(`
		SELECT id, task_type, payload::text
		FROM job_queue
		WHERE status = 'queued'
		  AND scheduled_at <= NOW()
		ORDER BY priority ASC, scheduled_at ASC
		LIMIT 1
		FOR UPDATE SKIP LOCKED
	`).Scan(&jobID, &taskType, &payloadStr)

	if err == sql.ErrNoRows {
		tx.Rollback()
		return "", "", nil, nil // 队列为空，正常情况
	}
	if err != nil {
		return "", "", nil, err
	}

	// 标记为 running
	_, err = tx.Exec(`
		UPDATE job_queue
		SET status = 'running', started_at = NOW(), worker_id = 'default', updated_at = NOW()
		WHERE id = $1
	`, jobID)
	if err != nil {
		return "", "", nil, err
	}

	if err = tx.Commit(); err != nil {
		return "", "", nil, err
	}

	return jobID, taskType, []byte(payloadStr), nil
}

// markJobDone 标记任务成功完成
func (s *AssignmentService) markJobDone(jobID string) {
	s.db.Exec(`
		UPDATE job_queue
		SET status = 'done', finished_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, jobID)
}

// markJobFailed 标记任务失败（超过重试次数则最终失败，否则重新入队）
func (s *AssignmentService) markJobFailed(jobID string, errMsg string) {
	// 查询当前重试次数和最大重试次数
	var retryCount, maxRetries int
	s.db.QueryRow(`SELECT retry_count, max_retries FROM job_queue WHERE id=$1`, jobID).
		Scan(&retryCount, &maxRetries)

	if retryCount < maxRetries {
		// 还有重试机会：延迟 30 秒后重新入队
		s.db.Exec(`
			UPDATE job_queue
			SET status       = 'queued',
			    retry_count  = retry_count + 1,
			    last_error   = $1,
			    scheduled_at = NOW() + INTERVAL '30 seconds',
			    updated_at   = NOW()
			WHERE id = $2
		`, errMsg, jobID)
		log.Printf("[任务队列] 任务 %s 失败，将在30秒后重试（第%d次）: %s",
			jobID, retryCount+1, errMsg)
	} else {
		// 超过重试次数：最终失败
		s.db.Exec(`
			UPDATE job_queue
			SET status      = 'failed',
			    last_error  = $1,
			    finished_at = NOW(),
			    updated_at  = NOW()
			WHERE id = $2
		`, errMsg, jobID)
		log.Printf("[任务队列] 任务 %s 最终失败（已重试%d次）: %s",
			jobID, retryCount, errMsg)
	}
}

// jobWorker 持续轮询 job_queue 并执行任务
// 每 2 秒轮询一次，收到 workerStop 信号后退出
func (s *AssignmentService) jobWorker() {
	log.Printf("[任务队列] Worker 启动（轮询间隔 2s，最大并发 %d）", cap(s.parseSem))
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-s.workerStop:
			log.Printf("[任务队列] Worker 收到停止信号，退出")
			return

		case <-ticker.C:
			// 每次 tick 尝试领取并处理任务
			// 一次 tick 处理完队列中当前所有可执行任务（直到队列空）
			for {
				jobID, taskType, payload, err := s.claimNextJob()
				if err != nil {
					log.Printf("[任务队列] 领取任务失败: %v", err)
					break
				}
				if jobID == "" {
					// 队列为空，等待下次 tick
					break
				}

				// 异步执行任务（通过信号量控制并发上限）
				go s.executeJob(jobID, taskType, payload)
			}
		}
	}
}

// executeJob 执行单个任务（由 jobWorker 异步调用）
func (s *AssignmentService) executeJob(jobID, taskType string, payload []byte) {
	// 获取并发信号量（阻塞等待，保证不超过 CPU 并发上限）
	s.parseSem <- struct{}{}
	defer func() { <-s.parseSem }()

	log.Printf("[任务队列] 开始执行 job=%s type=%s（当前并发: %d/%d）",
		jobID, taskType, len(s.parseSem), cap(s.parseSem))

	switch taskType {
	case "parse_material":
		// 从 payload 中取出 material_id
		var p struct {
			MaterialID string `json:"material_id"`
		}
		if err := json.Unmarshal(payload, &p); err != nil {
			s.markJobFailed(jobID, "payload 解析失败: "+err.Error())
			return
		}
		if p.MaterialID == "" {
			s.markJobFailed(jobID, "payload 缺少 material_id")
			return
		}

		// 执行文件解析
		if err := s.parseMaterial(p.MaterialID); err != nil {
			s.markJobFailed(jobID, err.Error())
			return
		}
		s.markJobDone(jobID)

	case "generate_rubric":
		var entityID string
		if err := s.db.QueryRow(`SELECT entity_id FROM job_queue WHERE id=$1`, jobID).Scan(&entityID); err != nil {
			s.markJobFailed(jobID, "查询 entity_id 失败: "+err.Error())
			return
		}
		jobRec := jobRecord{ID: jobID, TaskType: taskType, EntityID: entityID, Payload: json.RawMessage(payload)}
		if err := s.executeGenerateRubric(context.Background(), jobRec); err != nil {
			s.markJobFailed(jobID, err.Error())
			return
		}
		s.markJobDone(jobID)
	case "ai_assess":
		var entityID string
		if err := s.db.QueryRow(`SELECT entity_id FROM job_queue WHERE id=$1`, jobID).Scan(&entityID); err != nil {
			s.markJobFailed(jobID, "查询 entity_id 失败: "+err.Error())
			return
		}
		jobRec := jobRecord{ID: jobID, TaskType: taskType, EntityID: entityID, Payload: json.RawMessage(payload)}
		if err := s.executeAIAssess(context.Background(), jobRec); err != nil {
			s.markJobFailed(jobID, err.Error())
			return
		}
		s.markJobDone(jobID)
	case "assignment_lecture_analyze":
		var entityID string
		if err := s.db.QueryRow(`SELECT entity_id FROM job_queue WHERE id=$1`, jobID).Scan(&entityID); err != nil {
			s.markJobFailed(jobID, "查询 entity_id 失败: "+err.Error())
			return
		}
		jobRec := jobRecord{ID: jobID, TaskType: taskType, EntityID: entityID, Payload: json.RawMessage(payload)}
		if err := s.executeLectureAnalyze(context.Background(), jobRec); err != nil {
			s.markJobFailed(jobID, err.Error())
			return
		}
		s.markJobDone(jobID)
	case "assignment_lecture_block_regen":
		var entityID string
		if err := s.db.QueryRow(`SELECT entity_id FROM job_queue WHERE id=$1`, jobID).Scan(&entityID); err != nil {
			s.markJobFailed(jobID, "查询 entity_id 失败: "+err.Error())
			return
		}
		jobRec := jobRecord{ID: jobID, TaskType: taskType, EntityID: entityID, Payload: json.RawMessage(payload)}
		if err := s.executeLectureBlockRegen(context.Background(), jobRec); err != nil {
			s.markJobFailed(jobID, err.Error())
			return
		}
		s.markJobDone(jobID)
	case "assignment_recommendation_generate":
		var entityID string
		if err := s.db.QueryRow(`SELECT entity_id FROM job_queue WHERE id=$1`, jobID).Scan(&entityID); err != nil {
			s.markJobFailed(jobID, "查询 entity_id 失败: "+err.Error())
			return
		}
		jobRec := jobRecord{ID: jobID, TaskType: taskType, EntityID: entityID, Payload: json.RawMessage(payload)}
		if err := s.executeRecommendationGenerate(context.Background(), jobRec); err != nil {
			s.markJobFailed(jobID, err.Error())
			return
		}
		s.markJobDone(jobID)
	default:
		// 未知任务类型，直接标记失败（不重试）
		s.db.Exec(`
			UPDATE job_queue
			SET status='failed', last_error=$1, finished_at=NOW(), updated_at=NOW()
			WHERE id=$2
		`, "未知任务类型: "+taskType, jobID)
		log.Printf("[任务队列] 未知任务类型 %s，已跳过", taskType)
	}
}

// JobQueueStats 任务队列统计（供 /health 接口使用）
func (s *AssignmentService) JobQueueStats() map[string]interface{} {
	stats := map[string]interface{}{}

	var queued, running, done, failed int
	s.db.QueryRow(`SELECT COUNT(*) FROM job_queue WHERE status='queued'`).Scan(&queued)
	s.db.QueryRow(`SELECT COUNT(*) FROM job_queue WHERE status='running'`).Scan(&running)
	s.db.QueryRow(`SELECT COUNT(*) FROM job_queue WHERE status='done'`).Scan(&done)
	s.db.QueryRow(`SELECT COUNT(*) FROM job_queue WHERE status='failed'`).Scan(&failed)

	stats["queued"] = queued
	stats["running"] = running
	stats["done"] = done
	stats["failed"] = failed
	stats["in_flight"] = len(s.parseSem)
	stats["max_conc"] = cap(s.parseSem)
	return stats
}

// =============================================================
// V4.3 启动恢复
// =============================================================

// recoverOnStartup 服务启动时修复卡住的任务
// 同时处理：
//   1. assignment_materials 中卡住的 parsing 状态（旧机制兼容）
//   2. job_queue 中卡住的 running 状态（新机制）
func (s *AssignmentService) recoverOnStartup() {
	// 等待服务完全启动后再执行
	time.Sleep(3 * time.Second)

	log.Printf("[启动恢复] 开始扫描卡住的任务...")

	// ---- 1. 修复 assignment_materials 中 parsing 超时的记录 ----
	rows, err := s.db.Query(`
		SELECT id, original_name
		FROM assignment_materials
		WHERE parse_status = 'parsing'
		  AND updated_at < NOW() - INTERVAL '10 minutes'
	`)
	if err != nil {
		log.Printf("[启动恢复] 查询卡住材料失败: %v", err)
	} else {
		defer rows.Close()
		var count int
		for rows.Next() {
			var id, name string
			if err := rows.Scan(&id, &name); err != nil {
				continue
			}
			s.db.Exec(`
				UPDATE assignment_materials
				SET parse_status = 'failed',
				    parse_error  = '服务重启导致解析中断，请点击重试',
				    updated_at   = NOW()
				WHERE id = $1 AND parse_status = 'parsing'
			`, id)
			log.Printf("[启动恢复] 材料重置为failed: %s (%s)", id, name)
			count++
		}
		if count == 0 {
			log.Printf("[启动恢复] 无卡住的材料解析任务")
		} else {
			log.Printf("[启动恢复] 共修复 %d 个卡住的材料解析任务", count)
		}
	}

	// ---- 2. 修复 job_queue 中 running 超时的任务 ----
	// 超过 15 分钟未完成的 running 任务视为卡住，重置为 queued 重试
	result, err := s.db.Exec(`
		UPDATE job_queue
		SET status      = 'queued',
		    retry_count = retry_count + 1,
		    last_error  = '服务重启导致任务中断，自动重新入队',
		    started_at  = NULL,
		    worker_id   = NULL,
		    scheduled_at = NOW(),
		    updated_at  = NOW()
		WHERE status = 'running'
		  AND started_at < NOW() - INTERVAL '15 minutes'
		  AND retry_count < max_retries
	`)
	if err != nil {
		log.Printf("[启动恢复] 修复job_queue running任务失败: %v", err)
	} else {
		affected, _ := result.RowsAffected()
		if affected > 0 {
			log.Printf("[启动恢复] 已将 %d 个卡住的job_queue任务重新入队", affected)
		}
	}

	// 超过重试次数的 running 任务直接标记 failed
	s.db.Exec(`
		UPDATE job_queue
		SET status      = 'failed',
		    last_error  = '服务重启导致任务中断，已超过最大重试次数',
		    finished_at = NOW(),
		    updated_at  = NOW()
		WHERE status = 'running'
		  AND started_at < NOW() - INTERVAL '15 minutes'
		  AND retry_count >= max_retries
	`)

	log.Printf("[启动恢复] 完成")
}

// ParseStats 解析队列统计（兼容旧接口，返回 assignment_materials 维度）
// V4.3 同时返回 job_queue 统计
func (s *AssignmentService) ParseStats() map[string]interface{} {
	var pending, parsing, done, failed int
	s.db.QueryRow(`SELECT COUNT(*) FROM assignment_materials WHERE parse_status='pending'`).Scan(&pending)
	s.db.QueryRow(`SELECT COUNT(*) FROM assignment_materials WHERE parse_status='parsing'`).Scan(&parsing)
	s.db.QueryRow(`SELECT COUNT(*) FROM assignment_materials WHERE parse_status='done'`).Scan(&done)
	s.db.QueryRow(`SELECT COUNT(*) FROM assignment_materials WHERE parse_status='failed'`).Scan(&failed)

	// job_queue 维度统计
	jqStats := s.JobQueueStats()

	return map[string]interface{}{
		// assignment_materials 维度（旧）
		"pending":   pending,
		"parsing":   parsing,
		"done":      done,
		"failed":    failed,
		"in_flight": len(s.parseSem),
		"max_conc":  cap(s.parseSem),
		// job_queue 维度（新）
		"job_queue": jqStats,
	}
}

// =============================================================
// 作业任务 CRUD
// =============================================================

// CreateAssignment 创建作业任务
func (s *AssignmentService) CreateAssignment(createdBy string, req models.CreateAssignmentRequest) (*models.Assignment, error) {
	a := &models.Assignment{}
	query := `
		INSERT INTO assignments (room_id, created_by, title, description, allow_resubmit, due_at)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, room_id, created_by, title, description, status,
		          allow_resubmit, due_at, created_at, updated_at`

	var dueAt *time.Time
	if req.DueAt != nil && *req.DueAt != "" {
		t, err := time.Parse(time.RFC3339, *req.DueAt)
		if err == nil {
			dueAt = &t
		}
	}

	err := s.db.QueryRow(query,
		req.RoomID, createdBy, req.Title, req.Description,
		req.AllowResubmit, dueAt,
	).Scan(&a.ID, &a.RoomID, &a.CreatedBy, &a.Title, &a.Description,
		&a.Status, &a.AllowResubmit, &a.DueAt, &a.CreatedAt, &a.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("创建作业失败: %w", err)
	}
	log.Printf("[作业] 创建成功 ID:%s 标题:%s", a.ID, a.Title)
	return a, nil
}

// GetAssignment 获取作业详情（含统计）
func (s *AssignmentService) GetAssignment(assignmentID string) (*models.AssignmentDetail, error) {
	a := &models.AssignmentDetail{}
	err := s.db.QueryRow(`
		SELECT id, room_id, created_by, title, description, status,
		       allow_resubmit, due_at, created_at, updated_at
		FROM assignments WHERE id = $1`, assignmentID,
	).Scan(&a.ID, &a.RoomID, &a.CreatedBy, &a.Title, &a.Description,
		&a.Status, &a.AllowResubmit, &a.DueAt, &a.CreatedAt, &a.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("作业不存在")
	}
	if err != nil {
		return nil, err
	}

	// 统计数量
	s.db.QueryRow(`SELECT COUNT(*) FROM assignment_materials WHERE assignment_id=$1`, assignmentID).Scan(&a.MaterialCount)
	s.db.QueryRow(`SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id=$1`, assignmentID).Scan(&a.SubmissionCount)
	s.db.QueryRow(`SELECT COUNT(*) FROM assignment_assessments aa
		JOIN assignment_submissions sub ON aa.submission_id=sub.id
		WHERE sub.assignment_id=$1 AND aa.review_status!='pending'`, assignmentID).Scan(&a.AssessedCount)
	s.db.QueryRow(`SELECT COUNT(*) FROM assignment_assessments aa
		JOIN assignment_submissions sub ON aa.submission_id=sub.id
		WHERE sub.assignment_id=$1 AND aa.review_status='published'`, assignmentID).Scan(&a.PublishedCount)

	// 最新 Rubric
	rubric, err := s.GetLatestRubric(assignmentID)
	if err == nil {
		a.LatestRubric = rubric
	}
	return a, nil
}

// ListAssignments 列出教师的作业（可按 room_id 过滤）
func (s *AssignmentService) ListAssignments(createdBy string, roomID *string) ([]models.AssignmentDetail, error) {
	query := `
		SELECT id, room_id, created_by, title, description, status,
		       allow_resubmit, due_at, created_at, updated_at
		FROM assignments WHERE created_by = $1`
	args := []interface{}{createdBy}
	if roomID != nil && *roomID != "" {
		query += ` AND room_id = $2`
		args = append(args, *roomID)
	}
	query += ` ORDER BY created_at DESC`

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.AssignmentDetail
	for rows.Next() {
		var a models.AssignmentDetail
		if err := rows.Scan(&a.ID, &a.RoomID, &a.CreatedBy, &a.Title, &a.Description,
			&a.Status, &a.AllowResubmit, &a.DueAt, &a.CreatedAt, &a.UpdatedAt); err != nil {
			continue
		}
		s.db.QueryRow(`SELECT COUNT(*) FROM assignment_materials WHERE assignment_id=$1`, a.ID).Scan(&a.MaterialCount)
		s.db.QueryRow(`SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id=$1`, a.ID).Scan(&a.SubmissionCount)
		result = append(result, a)
	}
	if result == nil {
		result = []models.AssignmentDetail{}
	}
	return result, nil
}

// UpdateAssignmentStatus 更新作业状态
func (s *AssignmentService) UpdateAssignmentStatus(assignmentID, status string) error {
	_, err := s.db.Exec(
		`UPDATE assignments SET status=$1, updated_at=NOW() WHERE id=$2`,
		status, assignmentID,
	)
	return err
}

// DeleteAssignment 删除作业（级联删除所有材料和评价）
func (s *AssignmentService) DeleteAssignment(assignmentID string) error {
	_, err := s.db.Exec(`DELETE FROM assignments WHERE id=$1`, assignmentID)
	return err
}

// =============================================================
// 材料管理
// =============================================================

// SaveMaterial 保存材料记录（文字内容）
func (s *AssignmentService) SaveMaterial(assignmentID, uploaderID, uploaderRole string,
	req models.UploadMaterialRequest) (*models.AssignmentMaterial, error) {

	m := &models.AssignmentMaterial{}
	err := s.db.QueryRow(`
		INSERT INTO assignment_materials
		  (assignment_id, uploader_id, uploader_role, material_role,
		   original_name, content_text, file_type, parse_status)
		VALUES ($1,$2,$3,$4,$5,$6,'text','skipped')
		RETURNING id, assignment_id, uploader_id, uploader_role, material_role,
		          original_name, file_type, content_text, parse_status, created_at`,
		assignmentID, uploaderID, uploaderRole,
		req.MaterialRole, req.OriginalName, req.ContentText,
	).Scan(&m.ID, &m.AssignmentID, &m.UploaderID, &m.UploaderRole, &m.MaterialRole,
		&m.OriginalName, &m.FileType, &m.ContentText, &m.ParseStatus, &m.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("保存材料失败: %w", err)
	}
	return m, nil
}

// SaveFileMaterial 保存文件材料记录（上传文件后调用）
// V4.3：改为写入 job_queue 而不是直接 goroutine
func (s *AssignmentService) SaveFileMaterial(assignmentID, uploaderID, uploaderRole,
	materialRole, originalName, filePath, fileURL, fileType string, fileSize int64) (*models.AssignmentMaterial, error) {

	m := &models.AssignmentMaterial{}
	err := s.db.QueryRow(`
		INSERT INTO assignment_materials
		  (assignment_id, uploader_id, uploader_role, material_role,
		   original_name, file_path, file_url, file_type, file_size, parse_status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')
		RETURNING id, assignment_id, uploader_id, uploader_role, material_role,
		          original_name, file_path, file_url, file_type, file_size, parse_status, created_at`,
		assignmentID, uploaderID, uploaderRole, materialRole,
		originalName, filePath, fileURL, fileType, fileSize,
	).Scan(&m.ID, &m.AssignmentID, &m.UploaderID, &m.UploaderRole, &m.MaterialRole,
		&m.OriginalName, &m.FilePath, &m.FileURL, &m.FileType, &m.FileSize,
		&m.ParseStatus, &m.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("保存文件材料失败: %w", err)
	}
	return m, nil
}

// ListMaterials 列出作业材料
func (s *AssignmentService) ListMaterials(assignmentID string) ([]models.AssignmentMaterial, error) {
	rows, err := s.db.Query(`
		SELECT id, assignment_id, uploader_id, uploader_role, material_role,
		       original_name, COALESCE(file_path,''), COALESCE(file_url,''),
		       COALESCE(file_type,''), file_size,
		       COALESCE(content_text,''), COALESCE(parsed_markdown,''),
		       parse_status, COALESCE(parse_error,''),
		       word_count, char_count, parse_elapsed_ms, parsed_at, created_at
		FROM assignment_materials
		WHERE assignment_id=$1
		ORDER BY created_at ASC`, assignmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.AssignmentMaterial
	for rows.Next() {
		var m models.AssignmentMaterial
		if err := rows.Scan(
			&m.ID, &m.AssignmentID, &m.UploaderID, &m.UploaderRole, &m.MaterialRole,
			&m.OriginalName, &m.FilePath, &m.FileURL, &m.FileType, &m.FileSize,
			&m.ContentText, &m.ParsedMarkdown,
			&m.ParseStatus, &m.ParseError,
			&m.WordCount, &m.CharCount, &m.ParseElapsedMs, &m.ParsedAt, &m.CreatedAt,
		); err != nil {
			log.Printf("[材料] 扫描失败: %v", err)
			continue
		}
		result = append(result, m)
	}
	if result == nil {
		result = []models.AssignmentMaterial{}
	}
	return result, nil
}

// DeleteMaterial 删除材料
func (s *AssignmentService) DeleteMaterial(materialID, assignmentID string) error {
	var filePath string
	s.db.QueryRow(`SELECT COALESCE(file_path,'') FROM assignment_materials WHERE id=$1 AND assignment_id=$2`,
		materialID, assignmentID).Scan(&filePath)

	_, err := s.db.Exec(`DELETE FROM assignment_materials WHERE id=$1 AND assignment_id=$2`,
		materialID, assignmentID)
	if err != nil {
		return err
	}

	if filePath != "" && strings.HasPrefix(filePath, "/opt/mindcanvas/uploads/") {
		os.Remove(filePath)
	}
	return nil
}

// =============================================================
// 文件解析（V4.3 P2-C：通过 job_queue 调度）
// =============================================================

// ParseMaterialAsync 异步解析材料入口
// V4.3 P2-C 改进：先写 job_queue 持久化，再由 jobWorker 执行
// 服务重启后任务不丢失，自动重试
func (s *AssignmentService) ParseMaterialAsync(materialID string) {
	if err := s.enqueueParseJob(materialID); err != nil {
		// 入队失败时降级为直接 goroutine（兼容性保底）
		log.Printf("[解析] 入队失败，降级直接执行: %v", err)
		go func() {
			s.parseSem <- struct{}{}
			defer func() { <-s.parseSem }()
			if err := s.parseMaterial(materialID); err != nil {
				log.Printf("[解析] 材料 %s 直接执行失败: %v", materialID, err)
			}
		}()
	}
}

// parseMaterial 同步解析单个材料（由 jobWorker/executeJob 调用）
func (s *AssignmentService) parseMaterial(materialID string) error {
	var filePath, fileURL, contentText, fileType string
	err := s.db.QueryRow(`
		SELECT COALESCE(file_path,''), COALESCE(file_url,''),
		       COALESCE(content_text,''), COALESCE(file_type,'')
		FROM assignment_materials WHERE id=$1`, materialID,
	).Scan(&filePath, &fileURL, &contentText, &fileType)
	if err != nil {
		return fmt.Errorf("查询材料失败: %w", err)
	}

	// 标记为解析中（更新 updated_at，供超时检测使用）
	s.db.Exec(`
		UPDATE assignment_materials
		SET parse_status='parsing', updated_at=NOW()
		WHERE id=$1`, materialID)

	var result *models.ParseResult

	if filePath != "" && filePath != "/opt/mindcanvas/uploads/" {
		result, err = s.callParseByPath(filePath)
	} else if contentText != "" {
		result, err = s.callParseText(contentText, "")
	} else {
		s.db.Exec(`
			UPDATE assignment_materials
			SET parse_status='skipped', updated_at=NOW()
			WHERE id=$1`, materialID)
		return nil
	}

	if err != nil || !result.Success {
		errMsg := ""
		if err != nil {
			errMsg = err.Error()
		} else {
			errMsg = result.Error
		}
		s.db.Exec(`
			UPDATE assignment_materials
			SET parse_status='failed', parse_error=$1, updated_at=NOW()
			WHERE id=$2`, errMsg, materialID)
		return fmt.Errorf("解析失败: %s", errMsg)
	}

	now := time.Now()
	_, dbErr := s.db.Exec(`
		UPDATE assignment_materials
		SET parse_status='done', parsed_markdown=$1,
		    word_count=$2, char_count=$3, parse_elapsed_ms=$4,
		    parsed_at=$5, updated_at=NOW()
		WHERE id=$6`,
		result.Markdown, result.WordCount, result.CharCount, result.ElapsedMs, now, materialID)
	if dbErr != nil {
		return fmt.Errorf("保存解析结果失败: %w", dbErr)
	}

	log.Printf("[解析] 材料 %s 完成 字符=%d 耗时=%dms", materialID, result.CharCount, result.ElapsedMs)
	return nil
}

// ParseMaterialByID 触发单个材料重新解析（供重试按钮使用）
func (s *AssignmentService) ParseMaterialByID(materialID string) error {
	// 重置状态
	s.db.Exec(`
		UPDATE assignment_materials
		SET parse_status='pending', parse_error='', updated_at=NOW()
		WHERE id=$1 AND parse_status IN ('failed','skipped')`, materialID)

	// 通过 job_queue 重新入队（而不是直接执行，保持可观测性）
	if err := s.enqueueParseJob(materialID); err != nil {
		// 降级：同步执行
		return s.parseMaterial(materialID)
	}
	return nil
}

// callParseByPath 调用微服务解析本地文件
func (s *AssignmentService) callParseByPath(filePath string) (*models.ParseResult, error) {
	body, _ := json.Marshal(map[string]string{"file_path": filePath})
	resp, err := http.Post(s.parserURL+"/parse/path",
		"application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("调用解析服务失败: %w", err)
	}
	defer resp.Body.Close()

	var result models.ParseResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	return &result, nil
}

// callParseText 调用微服务解析文本
func (s *AssignmentService) callParseText(text, title string) (*models.ParseResult, error) {
	body, _ := json.Marshal(map[string]string{"text": text, "title": title})
	resp, err := http.Post(s.parserURL+"/parse/text",
		"application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("调用文本解析失败: %w", err)
	}
	defer resp.Body.Close()

	var result models.ParseResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析响应失败: %w", err)
	}
	return &result, nil
}

// CallParseFile 上传文件到解析服务（直接传文件流）
func (s *AssignmentService) CallParseFile(filePath, originalName string) (*models.ParseResult, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return nil, fmt.Errorf("打开文件失败: %w", err)
	}
	defer f.Close()

	var buf bytes.Buffer
	w := multipart.NewWriter(&buf)
	fw, err := w.CreateFormFile("file", originalName)
	if err != nil {
		return nil, err
	}
	if _, err = io.Copy(fw, f); err != nil {
		return nil, err
	}
	w.Close()

	resp, err := http.Post(s.parserURL+"/parse/file", w.FormDataContentType(), &buf)
	if err != nil {
		return nil, fmt.Errorf("上传文件失败: %w", err)
	}
	defer resp.Body.Close()

	var result models.ParseResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, err
	}
	return &result, nil
}

// =============================================================
// Rubric 评分标准管理
// =============================================================

// GetLatestRubric 获取最新评分标准
func (s *AssignmentService) GetLatestRubric(assignmentID string) (*models.AssignmentRubric, error) {
	r := &models.AssignmentRubric{}
	err := s.db.QueryRow(`
		SELECT id, assignment_id, version, source, criteria_json::text,
		       total_score, teacher_confirmed, confirmed_at, created_at
		FROM assignment_rubrics
		WHERE assignment_id=$1
		ORDER BY version DESC LIMIT 1`, assignmentID,
	).Scan(&r.ID, &r.AssignmentID, &r.Version, &r.Source, &r.CriteriaJSON,
		&r.TotalScore, &r.TeacherConfirmed, &r.ConfirmedAt, &r.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("暂无评分标准")
	}
	return r, err
}

// GenerateDefaultRubric 生成默认评分标准（6维度，共100分）
func (s *AssignmentService) GenerateDefaultRubric(assignmentID string) (*models.AssignmentRubric, error) {
	criteria := []models.RubricCriterion{
		{
			Name: "内容理解", Weight: 20,
			Levels: []models.RubricLevel{
				{Score: 20, Label: "优秀", Desc: "准确理解核心概念，内容完整深入"},
				{Score: 14, Label: "良好", Desc: "基本理解主要内容，有一定深度"},
				{Score: 8, Label: "待改进", Desc: "理解不够准确，内容较浅"},
			},
		},
		{
			Name: "逻辑结构", Weight: 20,
			Levels: []models.RubricLevel{
				{Score: 20, Label: "优秀", Desc: "结构清晰，逻辑严密，层次分明"},
				{Score: 14, Label: "良好", Desc: "结构基本合理，逻辑较清楚"},
				{Score: 8, Label: "待改进", Desc: "结构混乱，逻辑不清"},
			},
		},
		{
			Name: "表达质量", Weight: 15,
			Levels: []models.RubricLevel{
				{Score: 15, Label: "优秀", Desc: "语言流畅，表达准确，词汇丰富"},
				{Score: 10, Label: "良好", Desc: "语言基本流畅，表达较清楚"},
				{Score: 5, Label: "待改进", Desc: "语言不流畅，表达不清"},
			},
		},
		{
			Name: "创新性", Weight: 15,
			Levels: []models.RubricLevel{
				{Score: 15, Label: "优秀", Desc: "有独到见解，思维创新，角度新颖"},
				{Score: 10, Label: "良好", Desc: "有一定独立思考，部分内容有新意"},
				{Score: 5, Label: "待改进", Desc: "缺乏独立思考，内容雷同"},
			},
		},
		{
			Name: "规范性", Weight: 15,
			Levels: []models.RubricLevel{
				{Score: 15, Label: "优秀", Desc: "格式规范，引用正确，符合要求"},
				{Score: 10, Label: "良好", Desc: "基本规范，小部分格式问题"},
				{Score: 5, Label: "待改进", Desc: "格式不规范，存在明显问题"},
			},
		},
		{
			Name: "完成度", Weight: 15,
			Levels: []models.RubricLevel{
				{Score: 15, Label: "优秀", Desc: "完整回应所有要求，内容充实"},
				{Score: 10, Label: "良好", Desc: "基本完成要求，部分内容略简"},
				{Score: 5, Label: "待改进", Desc: "未完整回应要求，内容缺失"},
			},
		},
	}

	criteriaJSON, _ := json.Marshal(criteria)

	var maxVersion int
	s.db.QueryRow(`SELECT COALESCE(MAX(version),0) FROM assignment_rubrics WHERE assignment_id=$1`,
		assignmentID).Scan(&maxVersion)

	r := &models.AssignmentRubric{}
	err := s.db.QueryRow(`
		INSERT INTO assignment_rubrics (assignment_id, version, source, criteria_json, total_score)
		VALUES ($1, $2, 'generated', $3::jsonb, 100)
		RETURNING id, assignment_id, version, source, criteria_json::text,
		          total_score, teacher_confirmed, confirmed_at, created_at`,
		assignmentID, maxVersion+1, string(criteriaJSON),
	).Scan(&r.ID, &r.AssignmentID, &r.Version, &r.Source, &r.CriteriaJSON,
		&r.TotalScore, &r.TeacherConfirmed, &r.ConfirmedAt, &r.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("生成评分标准失败: %w", err)
	}

	log.Printf("[Rubric] 生成默认评分标准 作业:%s 版本:%d", assignmentID, r.Version)
	return r, nil
}

// ConfirmRubric 教师确认/更新评分标准（创建新版本）
func (s *AssignmentService) ConfirmRubric(assignmentID, confirmedBy string,
	req models.ConfirmRubricRequest) (*models.AssignmentRubric, error) {

	criteriaJSON, _ := json.Marshal(req.Criteria)
	totalScore := req.TotalScore
	if totalScore <= 0 {
		totalScore = 100
	}

	var maxVersion int
	s.db.QueryRow(`SELECT COALESCE(MAX(version),0) FROM assignment_rubrics WHERE assignment_id=$1`,
		assignmentID).Scan(&maxVersion)

	now := time.Now()
	r := &models.AssignmentRubric{}
	err := s.db.QueryRow(`
		INSERT INTO assignment_rubrics
		  (assignment_id, version, source, criteria_json, total_score, teacher_confirmed, confirmed_at)
		VALUES ($1, $2, 'manual', $3::jsonb, $4, TRUE, $5)
		RETURNING id, assignment_id, version, source, criteria_json::text,
		          total_score, teacher_confirmed, confirmed_at, created_at`,
		assignmentID, maxVersion+1, string(criteriaJSON), totalScore, now,
	).Scan(&r.ID, &r.AssignmentID, &r.Version, &r.Source, &r.CriteriaJSON,
		&r.TotalScore, &r.TeacherConfirmed, &r.ConfirmedAt, &r.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("保存评分标准失败: %w", err)
	}

	log.Printf("[Rubric] 教师确认 作业:%s 版本:%d", assignmentID, r.Version)
	return r, nil
}

// =============================================================
// 学生提交管理
// =============================================================

// CreateSubmission 创建学生提交记录
func (s *AssignmentService) CreateSubmission(assignmentID string,
	req models.SubmitAssignmentRequest, studentUUID string) (*models.AssignmentSubmission, error) {

	var allowResubmit bool
	var assignStatus string
	s.db.QueryRow(`SELECT allow_resubmit, status FROM assignments WHERE id=$1`,
		assignmentID).Scan(&allowResubmit, &assignStatus)

	if assignStatus != models.AssignmentStatusCollecting {
		return nil, fmt.Errorf("作业当前状态不允许提交")
	}

	var existingVersion int
	s.db.QueryRow(`SELECT COALESCE(MAX(version),0) FROM assignment_submissions
		WHERE assignment_id=$1 AND student_uuid=$2`, assignmentID, studentUUID).Scan(&existingVersion)

	if existingVersion > 0 && !allowResubmit {
		return nil, fmt.Errorf("不允许重复提交")
	}

	sub := &models.AssignmentSubmission{}
	err := s.db.QueryRow(`
		INSERT INTO assignment_submissions
		  (assignment_id, student_uuid, student_name, content_type, content_text, version)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, assignment_id, student_uuid, student_name,
		          content_type, content_text, version, submitted_at, updated_at`,
		assignmentID, studentUUID, req.StudentName,
		req.ContentType, req.ContentText, existingVersion+1,
	).Scan(&sub.ID, &sub.AssignmentID, &sub.StudentUUID, &sub.StudentName,
		&sub.ContentType, &sub.ContentText, &sub.Version, &sub.SubmittedAt, &sub.UpdatedAt)
	if err != nil {
		return nil, fmt.Errorf("提交失败: %w", err)
	}

	log.Printf("[提交] 学生 %s 提交作业 %s v%d", studentUUID, assignmentID, sub.Version)
	return sub, nil
}

// ListSubmissions 列出作业的所有提交
func (s *AssignmentService) ListSubmissions(assignmentID string) ([]models.AssignmentSubmission, error) {
	rows, err := s.db.Query(`
		SELECT id, assignment_id, student_uuid, student_name,
		       COALESCE(group_id::text,''), version, content_type,
		       COALESCE(content_text,''), submitted_at, updated_at
		FROM assignment_submissions
		WHERE assignment_id=$1
		ORDER BY submitted_at DESC`, assignmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []models.AssignmentSubmission
	for rows.Next() {
		var sub models.AssignmentSubmission
		var groupID string
		if err := rows.Scan(&sub.ID, &sub.AssignmentID, &sub.StudentUUID, &sub.StudentName,
			&groupID, &sub.Version, &sub.ContentType, &sub.ContentText,
			&sub.SubmittedAt, &sub.UpdatedAt); err != nil {
			continue
		}
		if groupID != "" {
			sub.GroupID = &groupID
		}
		result = append(result, sub)
	}
	if result == nil {
		result = []models.AssignmentSubmission{}
	}
	return result, nil
}

// =============================================================
// 工具函数
// =============================================================

// CheckParserHealth 检查解析微服务是否可用
func (s *AssignmentService) CheckParserHealth() bool {
	client := &http.Client{Timeout: 3 * time.Second}
	resp, err := client.Get(s.parserURL + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200
}

// GetParserURL 获取解析服务地址
func (s *AssignmentService) GetParserURL() string {
	return s.parserURL
}

// FileTypeFromExt 根据扩展名推断文件类型标签
func FileTypeFromExt(filename string) string {
	ext := strings.ToLower(filepath.Ext(filename))
	switch ext {
	case ".pdf":
		return "pdf"
	case ".doc", ".docx":
		return "word"
	case ".ppt", ".pptx":
		return "ppt"
	case ".xls", ".xlsx":
		return "excel"
	case ".jpg", ".jpeg", ".png", ".gif", ".webp":
		return "image"
	case ".txt":
		return "text"
	case ".html", ".htm":
		return "html"
	case ".csv":
		return "csv"
	case ".zip", ".rar", ".7z":
		return "archive"
	default:
		return "file"
	}
}

// =============================================================
// V4.3 场景数据大小保护工具（供 ws_handler 调用）
// =============================================================

var (
	sceneSizeWarnBytes   = 2 * 1024 * 1024 // 2MB 告警
	sceneSizeRejectBytes = 5 * 1024 * 1024 // 5MB 拒绝写入
	sceneSizeMu          sync.RWMutex
)

// CheckSceneSize 检查场景JSON大小
// 返回: "ok" | "warn" | "reject"
func CheckSceneSize(size int) string {
	sceneSizeMu.RLock()
	defer sceneSizeMu.RUnlock()
	if size >= sceneSizeRejectBytes {
		return "reject"
	}
	if size >= sceneSizeWarnBytes {
		return "warn"
	}
	return "ok"
}
