// =============================================================
// MindCanvas v4.1 - Phase 5 课堂流程控制器
// 服务层：流程CRUD、节点推进、学生端进度生成
// =============================================================
package services

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"mindcanvas-server/models"
)

// FlowService 课堂流程服务
type FlowService struct {
	db *sql.DB
}

// NewFlowService 构造函数
func NewFlowService(db *sql.DB) *FlowService {
	return &FlowService{db: db}
}

// =============================================================
// CRUD 操作
// =============================================================

// GetFlowByRoom 获取房间当前流程（优先返回active，其次draft，最新一条）
func (s *FlowService) GetFlowByRoom(roomID string) (*models.TeachingFlow, error) {
	query := `
		SELECT id, room_id, title, nodes, current_node_index,
		       status, show_progress_to_students,
		       started_at, finished_at, created_at, updated_at
		FROM teaching_flows
		WHERE room_id = $1
		ORDER BY
		    CASE status
		        WHEN 'active'   THEN 1
		        WHEN 'draft'    THEN 2
		        WHEN 'finished' THEN 3
		    END,
		    updated_at DESC
		LIMIT 1
	`
	return s.scanFlow(s.db.QueryRow(query, roomID))
}

// GetFlowByID 按ID获取流程
func (s *FlowService) GetFlowByID(flowID string) (*models.TeachingFlow, error) {
	query := `
		SELECT id, room_id, title, nodes, current_node_index,
		       status, show_progress_to_students,
		       started_at, finished_at, created_at, updated_at
		FROM teaching_flows
		WHERE id = $1
	`
	return s.scanFlow(s.db.QueryRow(query, flowID))
}

// ListFlowsByRoom 获取房间所有流程（包含历史）
func (s *FlowService) ListFlowsByRoom(roomID string) ([]*models.TeachingFlow, error) {
	query := `
		SELECT id, room_id, title, nodes, current_node_index,
		       status, show_progress_to_students,
		       started_at, finished_at, created_at, updated_at
		FROM teaching_flows
		WHERE room_id = $1
		ORDER BY updated_at DESC
	`
	rows, err := s.db.Query(query, roomID)
	if err != nil {
		return nil, fmt.Errorf("查询流程列表失败: %w", err)
	}
	defer rows.Close()

	var flows []*models.TeachingFlow
	for rows.Next() {
		flow, err := s.scanFlowFromRows(rows)
		if err != nil {
			log.Printf("[FlowService] 扫描行失败: %v", err)
			continue
		}
		flows = append(flows, flow)
	}
	if flows == nil {
		flows = []*models.TeachingFlow{}
	}
	return flows, nil
}

// CreateFlow 创建新流程
// 若房间已有 draft/active 流程，先将其状态设为 finished（一房间只保留一个活跃流程）
func (s *FlowService) CreateFlow(roomID string, req models.CreateFlowRequest) (*models.TeachingFlow, error) {
	// 序列化节点
	nodesJSON, err := json.Marshal(req.Nodes)
	if err != nil {
		return nil, fmt.Errorf("序列化节点失败: %w", err)
	}

	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("开启事务失败: %w", err)
	}
	defer tx.Rollback()

	// 将旧的 draft/active 流程归档（保留历史）
	_, err = tx.Exec(`
		UPDATE teaching_flows
		SET status = 'finished', finished_at = NOW(), updated_at = NOW()
		WHERE room_id = $1 AND status IN ('draft', 'active')
	`, roomID)
	if err != nil {
		return nil, fmt.Errorf("归档旧流程失败: %w", err)
	}

	// 插入新流程
	title := req.Title
	if title == "" {
		title = "课堂流程"
	}

	var flowID string
	err = tx.QueryRow(`
		INSERT INTO teaching_flows
		    (room_id, title, nodes, current_node_index, status, show_progress_to_students)
		VALUES ($1, $2, $3, 0, 'draft', $4)
		RETURNING id
	`, roomID, title, nodesJSON, req.ShowProgressToStudents).Scan(&flowID)
	if err != nil {
		return nil, fmt.Errorf("创建流程失败: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("提交事务失败: %w", err)
	}

	log.Printf("[FlowService] 创建流程 room:%s flow:%s 节点数:%d", roomID, flowID, len(req.Nodes))
	return s.GetFlowByID(flowID)
}

// UpdateFlow 更新流程（全量覆盖nodes，仅允许draft状态）
func (s *FlowService) UpdateFlow(flowID string, req models.UpdateFlowRequest) (*models.TeachingFlow, error) {
	// 获取当前流程验证状态
	current, err := s.GetFlowByID(flowID)
	if err != nil {
		return nil, err
	}

	// active状态也允许编辑（课中调整），finished不允许
	if current.Status == "finished" {
		return nil, errors.New("已结束的流程不能编辑")
	}

	// 构建更新字段
	setClauses := "updated_at = NOW()"
	args := []interface{}{}
	argIdx := 1

	if req.Title != nil {
		setClauses += fmt.Sprintf(", title = $%d", argIdx)
		args = append(args, *req.Title)
		argIdx++
	}

	if req.Nodes != nil {
		nodesJSON, err := json.Marshal(req.Nodes)
		if err != nil {
			return nil, fmt.Errorf("序列化节点失败: %w", err)
		}
		setClauses += fmt.Sprintf(", nodes = $%d", argIdx)
		args = append(args, nodesJSON)
		argIdx++
	}

	if req.ShowProgressToStudents != nil {
		setClauses += fmt.Sprintf(", show_progress_to_students = $%d", argIdx)
		args = append(args, *req.ShowProgressToStudents)
		argIdx++
	}

	args = append(args, flowID)
	query := fmt.Sprintf("UPDATE teaching_flows SET %s WHERE id = $%d", setClauses, argIdx)

	if _, err := s.db.Exec(query, args...); err != nil {
		return nil, fmt.Errorf("更新流程失败: %w", err)
	}

	log.Printf("[FlowService] 更新流程 flow:%s", flowID)
	return s.GetFlowByID(flowID)
}

// DeleteFlow 删除流程（仅draft状态可删除）
func (s *FlowService) DeleteFlow(flowID string) error {
	current, err := s.GetFlowByID(flowID)
	if err != nil {
		return err
	}
	if current.Status == "active" {
		return errors.New("进行中的流程不能删除，请先结束流程")
	}

	_, err = s.db.Exec("DELETE FROM teaching_flows WHERE id = $1", flowID)
	if err != nil {
		return fmt.Errorf("删除流程失败: %w", err)
	}
	log.Printf("[FlowService] 删除流程 flow:%s", flowID)
	return nil
}

// =============================================================
// 流程推进
// =============================================================

// ActivateFlow 开始上课（draft → active）
func (s *FlowService) ActivateFlow(flowID string) (*models.TeachingFlow, error) {
	current, err := s.GetFlowByID(flowID)
	if err != nil {
		return nil, err
	}
	if current.Status != "draft" {
		return nil, errors.New("只有草稿状态的流程才能开始")
	}
	if len(current.Nodes) == 0 {
		return nil, errors.New("流程没有节点，请先添加节点")
	}

	_, err = s.db.Exec(`
		UPDATE teaching_flows
		SET status = 'active', current_node_index = 0,
		    started_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, flowID)
	if err != nil {
		return nil, fmt.Errorf("激活流程失败: %w", err)
	}

	log.Printf("[FlowService] 流程开始 flow:%s", flowID)
	return s.GetFlowByID(flowID)
}

// AdvanceFlow 推进节点（next/prev/jump）
// 返回更新后的流程和当前节点信息
func (s *FlowService) AdvanceFlow(flowID string, req models.AdvanceFlowRequest) (*models.TeachingFlow, error) {
	current, err := s.GetFlowByID(flowID)
	if err != nil {
		return nil, err
	}
	if current.Status != "active" {
		return nil, errors.New("流程未激活，无法推进节点")
	}

	totalNodes := len(current.Nodes)
	if totalNodes == 0 {
		return nil, errors.New("流程没有节点")
	}

	newIndex := current.CurrentNodeIndex

	switch req.Direction {
	case "next":
		newIndex++
		if newIndex >= totalNodes {
			// 已是最后一个节点，自动结束流程
			return s.FinishFlow(flowID)
		}
	case "prev":
		newIndex--
		if newIndex < 0 {
			newIndex = 0
		}
	case "jump":
		if req.TargetIndex < 0 || req.TargetIndex >= totalNodes {
			return nil, fmt.Errorf("目标节点索引越界：%d（共%d个节点）", req.TargetIndex, totalNodes)
		}
		newIndex = req.TargetIndex
	default:
		return nil, fmt.Errorf("未知方向：%s（支持 next/prev/jump）", req.Direction)
	}

	_, err = s.db.Exec(`
		UPDATE teaching_flows
		SET current_node_index = $1, updated_at = NOW()
		WHERE id = $2
	`, newIndex, flowID)
	if err != nil {
		return nil, fmt.Errorf("推进节点失败: %w", err)
	}

	log.Printf("[FlowService] 节点推进 flow:%s %d→%d (%s)",
		flowID, current.CurrentNodeIndex, newIndex, req.Direction)
	return s.GetFlowByID(flowID)
}

// FinishFlow 结束流程（active → finished）
func (s *FlowService) FinishFlow(flowID string) (*models.TeachingFlow, error) {
	_, err := s.db.Exec(`
		UPDATE teaching_flows
		SET status = 'finished', finished_at = NOW(), updated_at = NOW()
		WHERE id = $1
	`, flowID)
	if err != nil {
		return nil, fmt.Errorf("结束流程失败: %w", err)
	}

	log.Printf("[FlowService] 流程结束 flow:%s", flowID)
	return s.GetFlowByID(flowID)
}

// UpdateShowProgress 更新学生端进度显示开关（课中实时切换）
func (s *FlowService) UpdateShowProgress(flowID string, show bool) error {
	_, err := s.db.Exec(`
		UPDATE teaching_flows
		SET show_progress_to_students = $1, updated_at = NOW()
		WHERE id = $2
	`, show, flowID)
	if err != nil {
		return fmt.Errorf("更新进度显示失败: %w", err)
	}
	return nil
}

// =============================================================
// 学生端进度（脱敏）
// =============================================================

// GetProgressForStudents 生成学生端可见的进度信息
// 仅在 show_progress_to_students=true 时返回有意义的数据
func (s *FlowService) GetProgressForStudents(roomID string) (*models.FlowProgress, error) {
	flow, err := s.GetFlowByRoom(roomID)
	if err != nil {
		return nil, err
	}
	if flow == nil || flow.Status != "active" {
		return nil, nil // 没有活跃流程，不展示
	}

	progress := &models.FlowProgress{
		FlowID:           flow.ID,
		FlowTitle:        flow.Title,
		CurrentNodeIndex: flow.CurrentNodeIndex,
		TotalNodes:       len(flow.Nodes),
		Nodes:            make([]models.FlowNodePublic, len(flow.Nodes)),
	}

	// 将节点脱敏：去除备注、Widget绑定信息
	for i, node := range flow.Nodes {
		publicNode := models.FlowNodePublic{
			ID:             node.ID,
			Type:           node.Type,
			Duration:       node.Duration,
			ShowToStudents: node.ShowToStudents,
		}
		// 仅showToStudents=true的节点才展示标题
		if node.ShowToStudents {
			publicNode.Title = node.Title
		} else {
			publicNode.Title = "" // 隐藏标题
		}
		progress.Nodes[i] = publicNode

		// 当前节点单独返回
		if i == flow.CurrentNodeIndex {
			nodeCopy := publicNode
			progress.CurrentNode = &nodeCopy
		}
	}

	return progress, nil
}

// =============================================================
// 辅助函数：数据库扫描
// =============================================================

// scanFlow 从 *sql.Row 扫描 TeachingFlow
func (s *FlowService) scanFlow(row *sql.Row) (*models.TeachingFlow, error) {
	var flow models.TeachingFlow
	var nodesJSON []byte
	var startedAt, finishedAt sql.NullTime

	err := row.Scan(
		&flow.ID, &flow.RoomID, &flow.Title, &nodesJSON,
		&flow.CurrentNodeIndex, &flow.Status,
		&flow.ShowProgressToStudents,
		&startedAt, &finishedAt,
		&flow.CreatedAt, &flow.UpdatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil // 没有流程返回nil，不报错
	}
	if err != nil {
		return nil, fmt.Errorf("扫描流程数据失败: %w", err)
	}

	// 反序列化节点
	nodes, err := models.ParseNodesJSON(nodesJSON)
	if err != nil {
		log.Printf("[FlowService] 节点JSON解析失败: %v", err)
		nodes = []models.FlowNode{}
	}
	flow.Nodes = nodes

	// 处理可空时间
	if startedAt.Valid {
		t := startedAt.Time
		flow.StartedAt = &t
	}
	if finishedAt.Valid {
		t := finishedAt.Time
		flow.FinishedAt = &t
	}

	return &flow, nil
}

// scanFlowFromRows 从 *sql.Rows 扫描 TeachingFlow
func (s *FlowService) scanFlowFromRows(rows *sql.Rows) (*models.TeachingFlow, error) {
	var flow models.TeachingFlow
	var nodesJSON []byte
	var startedAt, finishedAt sql.NullTime

	err := rows.Scan(
		&flow.ID, &flow.RoomID, &flow.Title, &nodesJSON,
		&flow.CurrentNodeIndex, &flow.Status,
		&flow.ShowProgressToStudents,
		&startedAt, &finishedAt,
		&flow.CreatedAt, &flow.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}

	nodes, err := models.ParseNodesJSON(nodesJSON)
	if err != nil {
		nodes = []models.FlowNode{}
	}
	flow.Nodes = nodes

	if startedAt.Valid {
		t := startedAt.Time
		flow.StartedAt = &t
	}
	if finishedAt.Valid {
		t := finishedAt.Time
		flow.FinishedAt = &t
	}

	return &flow, nil
}

// 确保time包被使用（Go编译器要求）
var _ = time.Now
