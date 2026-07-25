// =============================================================
// MindCanvas REQ-050 一期 B - AI 图形生成信号采集
//
// 采集是旁路：任何一步失败都只记日志，绝不影响图形生成主流程
// （老师正在上课，采集不通不能变成生成不出图）。
//
// 归属校验一律进 SQL 的 WHERE（BUG-015 教训：只比变量名会误判为已保护）：
// SetOutcome 的 UPDATE 带 teacher_id 条件，别人的记录改不动。
// =============================================================
package services

import (
	"database/sql"
	"fmt"
	"log"
)

// DiagramSampleService 图形生成样本服务。
type DiagramSampleService struct {
	db *sql.DB
}

// NewDiagramSampleService 构造。
func NewDiagramSampleService(db *sql.DB) *DiagramSampleService {
	return &DiagramSampleService{db: db}
}

// DiagramSample 一次生成的采集内容
type DiagramSample struct {
	TeacherID   string
	RoomID      string // 空串 → 入库 NULL
	DiagramType string
	InputText   string // 调用方已截断
	InputChars  int    // 截断前的真实字符数
	NodeCount   int
	EdgeCount   int
	RepairsJSON []byte // 序列化好的 JSON 数组，nil → '[]'
	IssuesJSON  []byte
	RepairCount int
	IssueCount  int
	Regenerated bool
	ResultJSON  []byte // {nodes,edges}
	ElapsedMs   int
}

// 合法的老师后续动作（白名单，防止前端塞任意字符串）
var validDiagramOutcomes = map[string]bool{
	"inserted":               true, // 直接插进画布用了 ≈ 不用手改就能用
	"regenerated_same_input": true, // 同一段文本重来 ≈ 这张不行
	"switched_type":          true, // 换个图型重来 ≈ 选型不对
	"deleted":                true, // 删掉不要了
}

// IsValidDiagramOutcome 供 handler 校验
func IsValidDiagramOutcome(o string) bool { return validDiagramOutcomes[o] }

// Record 落一条生成记录，返回记录 id。
// 失败只返回错误由调用方记日志——调用方不得因此中断响应。
func (s *DiagramSampleService) Record(in DiagramSample) (string, error) {
	if in.TeacherID == "" {
		return "", fmt.Errorf("teacher_id 为空，跳过采集")
	}
	if len(in.RepairsJSON) == 0 {
		in.RepairsJSON = []byte("[]")
	}
	if len(in.IssuesJSON) == 0 {
		in.IssuesJSON = []byte("[]")
	}

	var roomID interface{}
	if in.RoomID != "" {
		roomID = in.RoomID
	}

	var id string
	err := s.db.QueryRow(
		`INSERT INTO diagram_generations
		   (teacher_id, room_id, diagram_type, input_text, input_chars,
		    node_count, edge_count, repairs, issues, repair_count, issue_count,
		    regenerated, result, elapsed_ms)
		 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
		 RETURNING id`,
		in.TeacherID, roomID, in.DiagramType, in.InputText, in.InputChars,
		in.NodeCount, in.EdgeCount, in.RepairsJSON, in.IssuesJSON, in.RepairCount, in.IssueCount,
		in.Regenerated, in.ResultJSON, in.ElapsedMs,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("采集入库失败: %w", err)
	}
	return id, nil
}

// SetOutcome 记录老师拿到图之后干了什么。
// 归属校验进 WHERE：只能改自己的记录；改不到（不存在或不属于本人）返回错误。
// 同一条记录允许被覆盖更新（如先 inserted 后又 deleted，以最后一次为准）。
func (s *DiagramSampleService) SetOutcome(genID, teacherID, outcome string) error {
	if !validDiagramOutcomes[outcome] {
		return fmt.Errorf("不支持的 outcome: %s", outcome)
	}
	res, err := s.db.Exec(
		`UPDATE diagram_generations
		    SET outcome = $1, outcome_at = NOW()
		  WHERE id = $2 AND teacher_id = $3`,
		outcome, genID, teacherID,
	)
	if err != nil {
		return fmt.Errorf("更新 outcome 失败: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		log.Printf("[DiagramSample] RowsAffected 读取失败: %v", err)
		return nil
	}
	if n == 0 {
		return fmt.Errorf("记录不存在或不属于当前教师")
	}
	return nil
}
