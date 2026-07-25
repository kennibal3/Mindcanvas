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
//
// ⚠️ 语义已于 2026-07-25 降级修正：这一列记的是「老师点了什么」，**不等于图的质量**。
// 老师生成完无法判断好坏，**默认动作就是插进画布看一眼**，所以 inserted 几乎每条都会有、
// 零区分度；deleted_history 抓的是「删工作台历史条目」，而不满意时的真实操作是在画布上
// 删掉那组元素或 Ctrl+Z，根本不回工作台。真正的质量判据见 survival 列（服务端观测存活率）。
// 但 switched_type / regenerated_same_input **是准的**——换图型或同文本重来说明上一张不行，
// 与「插入是默认动作」无关，故保留并与 survival 分列并存、互不覆盖。
var validDiagramOutcomes = map[string]bool{
	"inserted":               true, // 插进画布（中性动作，看一眼而已，不是好评）
	"regenerated_same_input": true, // 同一段文本重来 ≈ 这张不行（准）
	"switched_type":          true, // 换个图型重来 ≈ 选型不对（准）
	"deleted_history":        true, // 删掉工作台历史条目（弱信号）
}

// 存活判定（survival 列取值，由后台 checker 写入，是二期飞轮该看的主标签）
const (
	SurvivalKept          = "kept"           // 基本都还在 → 老师认了这张图
	SurvivalPartiallyKept = "partially_kept" // 留了一部分 → 在此基础上改
	SurvivalDiscarded     = "discarded"      // 基本没了 → 插进去看了一眼就删
	SurvivalUnknown       = "unknown"        // 无法判定（场景没同步过 / 房间没了）
)

// 存活率阈值
const (
	survivalKeptRatio      = 0.8 // ≥ 80% 视为 kept
	survivalDiscardedRatio = 0.2 // < 20% 视为 discarded
)

// classifySurvival 按存活比例给出判定（纯函数，便于单测）
func classifySurvival(survived, total int) string {
	if total <= 0 {
		return SurvivalUnknown
	}
	ratio := float64(survived) / float64(total)
	switch {
	case ratio >= survivalKeptRatio:
		return SurvivalKept
	case ratio < survivalDiscardedRatio:
		return SurvivalDiscarded
	default:
		return SurvivalPartiallyKept
	}
}

// ClassifySurvival 导出版（供单测与调用方复用）
func ClassifySurvival(survived, total int) string { return classifySurvival(survived, total) }

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

// MarkInserted 记录「这批元素被插进了画布」，供后台 checker 之后回来观测存活率。
// elementIDsJSON 是前端上报的元素 id 数组（已序列化的 JSON）。
// 归属校验同样进 WHERE。
func (s *DiagramSampleService) MarkInserted(genID, teacherID string, elementIDsJSON []byte, count int) error {
	if len(elementIDsJSON) == 0 || count <= 0 {
		return fmt.Errorf("元素 id 列表为空，跳过")
	}
	res, err := s.db.Exec(
		`UPDATE diagram_generations
		    SET element_ids = $1, element_count = $2, inserted_at = NOW(),
		        survival = NULL, survived_count = NULL, survive_checked_at = NULL
		  WHERE id = $3 AND teacher_id = $4`,
		elementIDsJSON, count, genID, teacherID,
	)
	if err != nil {
		return fmt.Errorf("记录插入元素失败: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("记录不存在或不属于当前教师")
	}
	return nil
}

// ── 存活观测（后台 checker 调用）─────────────────────────────

// survivalDelay 插入后等多久再观测。课堂节奏下十分钟足够老师判断好坏；
// 太短会把「还在看」误判成弃用，太长则老师可能已离开房间、场景不再更新。
const survivalDelay = "10 minutes"

// survivalBatch 每轮最多处理多少条，避免一次占用过多 DB 时间
const survivalBatch = 50

// CheckPendingSurvival 观测一批已插入画布、但还没判过存活的记录。
// 返回本轮处理条数。任何单条失败都只记日志继续，不中断整批。
//
// 关键设计（两个误判陷阱）：
//  1. **excalidraw 是软删除**：元素被删后可能仍以 isDeleted:true 留在数组里，
//     所以存活判定必须排掉 isDeleted（本项目 REQ-046 那轮踩过
//     getSceneElements() 含不含已删元素的坑）。
//  2. **场景可能还没同步过**：老师插完立刻关页面时，room_scenes 里根本没有这批元素，
//     存活数会是 0 → 会被误判成「删掉了」。故先比 room_scenes.updated_at 是否晚于
//     inserted_at，不晚就判 unknown，不冤枉这张图。
func (s *DiagramSampleService) CheckPendingSurvival() int {
	rows, err := s.db.Query(
		`SELECT id, room_id, element_ids, element_count
		   FROM diagram_generations
		  WHERE inserted_at IS NOT NULL
		    AND survive_checked_at IS NULL
		    AND inserted_at < NOW() - INTERVAL '` + survivalDelay + `'
		  ORDER BY inserted_at
		  LIMIT ` + fmt.Sprint(survivalBatch),
	)
	if err != nil {
		log.Printf("[DiagramSurvival] 取待观测记录失败: %v", err)
		return 0
	}

	type pending struct {
		id      string
		roomID  sql.NullString
		idsJSON []byte
		total   int
	}
	var list []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.roomID, &p.idsJSON, &p.total); err != nil {
			log.Printf("[DiagramSurvival] 扫描失败: %v", err)
			continue
		}
		list = append(list, p)
	}
	rows.Close()

	done := 0
	for _, p := range list {
		// 房间信息缺失 → 无法判定
		if !p.roomID.Valid || p.roomID.String == "" || p.total <= 0 {
			s.writeSurvival(p.id, 0, SurvivalUnknown)
			done++
			continue
		}

		// 陷阱 2：场景快照比插入还旧 ⇒ 这批元素根本没同步上去过，不能算「被删」
		var sceneFresh bool
		err := s.db.QueryRow(
			`SELECT rs.updated_at > dg.inserted_at
			   FROM room_scenes rs, diagram_generations dg
			  WHERE rs.room_id = $1 AND dg.id = $2`,
			p.roomID.String, p.id,
		).Scan(&sceneFresh)
		if err != nil || !sceneFresh {
			if err != nil && err != sql.ErrNoRows {
				log.Printf("[DiagramSurvival] 场景时间比对失败 id=%s: %v", p.id, err)
			}
			s.writeSurvival(p.id, 0, SurvivalUnknown)
			done++
			continue
		}

		// 陷阱 1：排掉 isDeleted 的软删除元素。
		// 整条在 SQL 里算，不把上兆的 scene_data 拉进 Go。
		var survived int
		err = s.db.QueryRow(
			`SELECT count(*)
			   FROM room_scenes rs,
			        jsonb_array_elements(rs.scene_data->'elements') e
			  WHERE rs.room_id = $1
			    AND e->>'id' IN (SELECT jsonb_array_elements_text($2::jsonb))
			    AND COALESCE((e->>'isDeleted')::boolean, false) = false`,
			p.roomID.String, p.idsJSON,
		).Scan(&survived)
		if err != nil {
			log.Printf("[DiagramSurvival] 存活统计失败 id=%s: %v", p.id, err)
			continue // 不写 checked_at，下一轮重试
		}

		verdict := classifySurvival(survived, p.total)
		s.writeSurvival(p.id, survived, verdict)
		log.Printf("[DiagramSurvival] id=%s 存活 %d/%d → %s", p.id, survived, p.total, verdict)
		done++
	}
	return done
}

// writeSurvival 落判定结果（同时标记已观测，避免下一轮重复扫）
func (s *DiagramSampleService) writeSurvival(genID string, survived int, verdict string) {
	if _, err := s.db.Exec(
		`UPDATE diagram_generations
		    SET survived_count = $1, survival = $2, survive_checked_at = NOW()
		  WHERE id = $3`,
		survived, verdict, genID,
	); err != nil {
		log.Printf("[DiagramSurvival] 写回判定失败 id=%s: %v", genID, err)
	}
}
