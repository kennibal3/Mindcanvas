// =============================================================
// MindCanvas v4.1 - 学情雷达聚合服务
// 功能：聚合课堂实时数据，包含在线人数、参与率、未提交名单、
//       问答正确率、高频词、小组活跃度、Top5学生
// ⭐修复：在线人数统计同时计入教师（role=teacher）
// 缓存：Redis 10秒 TTL，手动刷新接口
// =============================================================
package services

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"strconv"
	"time"

	"github.com/redis/go-redis/v9"
)

// insightKey Redis缓存键
func insightKey(roomID string) string {
	return "insight:" + roomID
}

// InsightService 学情雷达服务
type InsightService struct {
	db  *sql.DB
	rdb *redis.Client
	hub interface{ GetRoomClientCount(roomID string) int
		GetRoomClientList(roomID string) []map[string]interface{} }
}

// NewInsightService 创建学情雷达服务
// hub 参数注入 WebSocket Hub，用于获取实时在线人数
func NewInsightService(db *sql.DB, rdb *redis.Client, hub interface {
	GetRoomClientCount(roomID string) int
	GetRoomClientList(roomID string) []map[string]interface{}
}) *InsightService {
	return &InsightService{db: db, rdb: rdb, hub: hub}
}

// ---- 数据结构 ------------------------------------------------

// ComponentInsight 单个互动组件的参与统计
type ComponentInsight struct {
	ElementID   string  `json:"element_id"`
	Title       string  `json:"title"`       // 组件标题（问题/提示语）
	WidgetType  string  `json:"widget_type"` // polling_widget / wordcloud_widget / qa_widget / dropzone_widget
	Status      string  `json:"status"`      // draft/open/paused/closed
	Submitted   int     `json:"submitted"`   // 已提交人数
	Total       int     `json:"total"`       // 在线人数（作为分母）
	Rate        float64 `json:"rate"`        // 参与率 0~1
}

// UnsubmittedStudent 未提交学生信息
type UnsubmittedStudent struct {
	UUID     string `json:"uuid"`
	Nickname string `json:"nickname"`
}

// UnsubmittedInfo 某组件的未提交信息
type UnsubmittedInfo struct {
	ElementID  string               `json:"element_id"`
	Title      string               `json:"title"`
	WidgetType string               `json:"widget_type"`
	Students   []UnsubmittedStudent `json:"students"`
}

// QAStat 问答组件正确率统计
type QAStat struct {
	ElementID string  `json:"element_id"`
	Question  string  `json:"question"`
	Total     int     `json:"total"`
	Correct   int     `json:"correct"`
	Rate      float64 `json:"rate"`
}

// WordFreq 词频统计
type WordFreq struct {
	Word  string `json:"word"`
	Count int    `json:"count"`
}

// GroupActivity 小组活跃度
type GroupActivity struct {
	GroupID   string `json:"group_id"`
	GroupName string `json:"group_name"`
	Count     int    `json:"count"` // 互动次数
}

// TopStudent Top5学生
type TopStudent struct {
	UUID     string `json:"uuid"`
	Nickname string `json:"nickname"`
	Count    int    `json:"count"` // 互动次数
}

// ---- REQ-043 Slice-3：HTML 课件互动统计 ----

// HtmlKnowledgeStat 按知识点的班级掌握度（latest-wins 去重后聚合）
type HtmlKnowledgeStat struct {
	Knowledge string  `json:"knowledge"`
	Students  int     `json:"students"`
	Got       float64 `json:"got"`
	Full      float64 `json:"full"`
	Rate      float64 `json:"rate"`
}

// HtmlWidgetStat 单个 HTML 课件的参与情况
type HtmlWidgetStat struct {
	ElementID string `json:"element_id"`
	Title     string `json:"title"`
	Students  int    `json:"students"`
	Events    int    `json:"events"`
}

// HtmlQuestionResult 某学生某题的最新一次结果（含尝试次数，历史保留在库中）
type HtmlQuestionResult struct {
	QuestionID string   `json:"question_id"`
	Knowledge  string   `json:"knowledge"`
	Event      string   `json:"event"`
	IsCorrect  *bool    `json:"is_correct"`
	Score      *float64 `json:"score"`
	MaxScore   *float64 `json:"max_score"`
	Response   string   `json:"response"`
	Attempts   int      `json:"attempts"`
}

// HtmlStudentStat 某学生在 HTML 课件里的作答明细
type HtmlStudentStat struct {
	UUID      string               `json:"uuid"`
	Nickname  string               `json:"nickname"`
	Questions []HtmlQuestionResult `json:"questions"`
}

// InsightData 学情雷达完整数据
type InsightData struct {
	RoomID        string               `json:"room_id"`
	// ⭐ 在线人数：包含教师和学生
	OnlineCount   int                  `json:"online_count"`
	// ⭐ 在线成员详情（含角色）
	OnlineClients []map[string]interface{} `json:"online_clients"`
	TotalJoined   int                  `json:"total_joined"`   // 历史累计进入人数
	Components    []ComponentInsight   `json:"components"`
	Unsubmitted   []UnsubmittedInfo    `json:"unsubmitted"`
	QAStats       []QAStat             `json:"qa_stats"`
	TopWords      []WordFreq           `json:"top_words"`
	GroupActivity []GroupActivity      `json:"group_activity"`
	TopStudents   []TopStudent         `json:"top_students"`
	// REQ-043 Slice-3：HTML 课件互动
	HtmlKnowledge []HtmlKnowledgeStat  `json:"html_knowledge"`
	HtmlWidgets   []HtmlWidgetStat     `json:"html_widgets"`
	HtmlStudents  []HtmlStudentStat    `json:"html_students"`
	UpdatedAt     string               `json:"updated_at"`
}

// ---- 核心方法 ------------------------------------------------

// GetInsight 获取学情雷达数据（Redis缓存优先，10秒TTL）
func (s *InsightService) GetInsight(roomID string) (*InsightData, error) {
	ctx := context.Background()

	// 尝试从 Redis 缓存读取
	cached, err := s.rdb.Get(ctx, insightKey(roomID)).Result()
	if err == nil && cached != "" {
		var data InsightData
		if json.Unmarshal([]byte(cached), &data) == nil {
			// 缓存命中：用实时在线人数覆盖缓存值（在线人数需实时）
			data.OnlineCount = s.hub.GetRoomClientCount(roomID)
			data.OnlineClients = s.hub.GetRoomClientList(roomID)
			return &data, nil
		}
	}

	// 缓存未命中：重新聚合
	data, err := s.buildInsight(roomID)
	if err != nil {
		return nil, err
	}

	// 写入 Redis 缓存，TTL 10秒
	if jsonBytes, err := json.Marshal(data); err == nil {
		s.rdb.Set(ctx, insightKey(roomID), string(jsonBytes), 10*time.Second)
	}

	return data, nil
}

// InvalidateInsightCache 手动清除学情缓存（教师刷新时调用）
func (s *InsightService) InvalidateInsightCache(roomID string) {
	ctx := context.Background()
	s.rdb.Del(ctx, insightKey(roomID))
	log.Printf("[InsightService] 清除学情缓存 roomID=%s", roomID)
}

// buildInsight 从数据库聚合学情数据
func (s *InsightService) buildInsight(roomID string) (*InsightData, error) {
	data := &InsightData{
		RoomID:    roomID,
		UpdatedAt: time.Now().Format("2006-01-02 15:04:05"),
	}

	// ⭐ 1. 实时在线人数（含教师）
	data.OnlineCount = s.hub.GetRoomClientCount(roomID)
	data.OnlineClients = s.hub.GetRoomClientList(roomID)

	// 2. 历史累计进入人数（room_sessions）
	err := s.db.QueryRow(
		`SELECT COUNT(DISTINCT student_uuid) FROM room_sessions WHERE room_id = $1`, roomID,
	).Scan(&data.TotalJoined)
	if err != nil {
		log.Printf("[InsightService] 查询总人数失败: %v", err)
	}

	// 3. 互动组件参与率
	components, err := s.buildComponentInsights(roomID, data.OnlineCount)
	if err != nil {
		log.Printf("[InsightService] 查询组件参与率失败: %v", err)
	}
	data.Components = components

	// 4. 开放中组件的未提交学生名单
	unsubmitted, err := s.buildUnsubmitted(roomID, data.OnlineClients)
	if err != nil {
		log.Printf("[InsightService] 查询未提交名单失败: %v", err)
	}
	data.Unsubmitted = unsubmitted

	// 5. 问答正确率统计
	qaStats, err := s.buildQAStats(roomID)
	if err != nil {
		log.Printf("[InsightService] 查询问答统计失败: %v", err)
	}
	data.QAStats = qaStats

	// 6. 词云高频词 Top10
	topWords, err := s.buildTopWords(roomID)
	if err != nil {
		log.Printf("[InsightService] 查询高频词失败: %v", err)
	}
	data.TopWords = topWords

	// 7. 小组活跃度
	groupActivity, err := s.buildGroupActivity(roomID)
	if err != nil {
		log.Printf("[InsightService] 查询小组活跃度失败: %v", err)
	}
	data.GroupActivity = groupActivity

	// 8. Top5 学生（互动次数）
	topStudents, err := s.buildTopStudents(roomID)
	if err != nil {
		log.Printf("[InsightService] 查询Top5学生失败: %v", err)
	}
	data.TopStudents = topStudents

	// 9. HTML 课件互动（REQ-043 Slice-3）
	data.HtmlKnowledge, data.HtmlWidgets, data.HtmlStudents = s.buildHtmlStats(roomID)

	return data, nil
}

// buildComponentInsights 聚合各互动组件参与率
func (s *InsightService) buildComponentInsights(roomID string, onlineCount int) ([]ComponentInsight, error) {
	// 查询所有非删除的互动组件
	rows, err := s.db.Query(`
		SELECT id, type, payload
		FROM room_elements
		WHERE room_id = $1
		  AND type IN ('polling_widget','wordcloud_widget','qa_widget','dropzone_widget')
		  AND is_deleted = FALSE
		ORDER BY created_at`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ComponentInsight
	for rows.Next() {
		var elemID, elemType string
		var payloadBytes []byte
		if err := rows.Scan(&elemID, &elemType, &payloadBytes); err != nil {
			continue
		}

		// 解析 payload 获取标题和状态
		var p map[string]interface{}
		title := ""
		status := "draft"
		if json.Unmarshal(payloadBytes, &p) == nil {
			// 优先取 question，其次 prompt，最后 title
			for _, key := range []string{"question", "prompt", "title"} {
				if v, ok := p[key].(string); ok && v != "" {
					title = v
					break
				}
			}
			if s, ok := p["status"].(string); ok {
				status = s
			}
		}

		// 统计已提交人数（去重按 student_uuid）
		var submitted int
		actionType := widgetActionType(elemType)
		s.db.QueryRow(
			`SELECT COUNT(DISTINCT student_uuid) FROM widget_interactions
			 WHERE element_id = $1 AND action_type = $2`,
			elemID, actionType,
		).Scan(&submitted)

		// 计算参与率
		total := onlineCount
		if total == 0 {
			total = 1 // 避免除零
		}
		rate := float64(submitted) / float64(total)
		if rate > 1 {
			rate = 1
		}

		result = append(result, ComponentInsight{
			ElementID:  elemID,
			Title:      title,
			WidgetType: elemType,
			Status:     status,
			Submitted:  submitted,
			Total:      onlineCount,
			Rate:       rate,
		})
	}
	return result, nil
}

// buildUnsubmitted 找出开放中组件的未提交学生
// ⭐ 基于当前在线学生列表（排除教师）
func (s *InsightService) buildUnsubmitted(roomID string, onlineClients []map[string]interface{}) ([]UnsubmittedInfo, error) {
	// 收集在线学生（排除教师角色）
	type onlineStudent struct {
		uuid     string
		nickname string
	}
	var students []onlineStudent
	for _, c := range onlineClients {
		role, _ := c["role"].(string)
		if role == "teacher" {
			continue // ⭐ 教师不算入未提交名单
		}
		uuid, _ := c["uuid"].(string)
		nickname, _ := c["nickname"].(string)
		if uuid != "" {
			students = append(students, onlineStudent{uuid, nickname})
		}
	}
	if len(students) == 0 {
		return []UnsubmittedInfo{}, nil
	}

	// 查询状态为 open 的互动组件
	rows, err := s.db.Query(`
		SELECT id, type, payload
		FROM room_elements
		WHERE room_id = $1
		  AND type IN ('polling_widget','wordcloud_widget','qa_widget','dropzone_widget')
		  AND is_deleted = FALSE
		  AND payload->>'status' = 'open'`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []UnsubmittedInfo
	for rows.Next() {
		var elemID, elemType string
		var payloadBytes []byte
		if err := rows.Scan(&elemID, &elemType, &payloadBytes); err != nil {
			continue
		}

		// 获取标题
		title := ""
		var p map[string]interface{}
		if json.Unmarshal(payloadBytes, &p) == nil {
			for _, key := range []string{"question", "prompt", "title"} {
				if v, ok := p[key].(string); ok && v != "" {
					title = v
					break
				}
			}
		}

		// 查询已提交的学生 UUID 集合
		actionType := widgetActionType(elemType)
		submittedRows, err := s.db.Query(
			`SELECT DISTINCT student_uuid FROM widget_interactions
			 WHERE element_id = $1 AND action_type = $2`, elemID, actionType)
		if err != nil {
			continue
		}
		submitted := make(map[string]bool)
		for submittedRows.Next() {
			var uuid string
			submittedRows.Scan(&uuid)
			submitted[uuid] = true
		}
		submittedRows.Close()

		// 找出在线但未提交的学生
		var unsubStudents []UnsubmittedStudent
		for _, s := range students {
			if !submitted[s.uuid] {
				unsubStudents = append(unsubStudents, UnsubmittedStudent{
					UUID:     s.uuid,
					Nickname: s.nickname,
				})
			}
		}

		if len(unsubStudents) > 0 {
			result = append(result, UnsubmittedInfo{
				ElementID:  elemID,
				Title:      title,
				WidgetType: elemType,
				Students:   unsubStudents,
			})
		}
	}
	return result, nil
}

// buildQAStats 统计问答组件正确率
func (s *InsightService) buildQAStats(roomID string) ([]QAStat, error) {
	rows, err := s.db.Query(`
		SELECT id, payload FROM room_elements
		WHERE room_id = $1 AND type = 'qa_widget' AND is_deleted = FALSE
		ORDER BY created_at`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []QAStat
	for rows.Next() {
		var elemID string
		var payloadBytes []byte
		if err := rows.Scan(&elemID, &payloadBytes); err != nil {
			continue
		}
		question := ""
		var p map[string]interface{}
		if json.Unmarshal(payloadBytes, &p) == nil {
			if q, ok := p["question"].(string); ok {
				question = q
			}
		}

		var total, correct int
		s.db.QueryRow(
			`SELECT COUNT(*), COUNT(*) FILTER (WHERE is_correct = TRUE)
			 FROM widget_interactions WHERE element_id = $1 AND action_type = 'answer'`, elemID,
		).Scan(&total, &correct)

		rate := 0.0
		if total > 0 {
			rate = float64(correct) / float64(total)
		}

		result = append(result, QAStat{
			ElementID: elemID,
			Question:  question,
			Total:     total,
			Correct:   correct,
			Rate:      rate,
		})
	}
	return result, nil
}

// buildTopWords 统计词云高频词 Top10
func (s *InsightService) buildTopWords(roomID string) ([]WordFreq, error) {
	rows, err := s.db.Query(`
		SELECT action_data->>'word' as word, COUNT(*) as cnt
		FROM widget_interactions
		WHERE room_id = $1 AND action_type = 'add_word'
		  AND action_data->>'word' IS NOT NULL
		GROUP BY action_data->>'word'
		ORDER BY cnt DESC LIMIT 10`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []WordFreq
	for rows.Next() {
		var word string
		var count int
		rows.Scan(&word, &count)
		result = append(result, WordFreq{Word: word, Count: count})
	}
	return result, nil
}

// buildGroupActivity 统计小组活跃度
func (s *InsightService) buildGroupActivity(roomID string) ([]GroupActivity, error) {
	rows, err := s.db.Query(`
		SELECT
			COALESCE(rg.id::text, 'unknown') as group_id,
			COALESCE(rg.name, '未分组') as group_name,
			COUNT(wi.id) as cnt
		FROM widget_interactions wi
		LEFT JOIN room_groups rg ON rg.id::text = wi.group_id::text AND rg.room_id = $1
		WHERE wi.room_id = $1
		GROUP BY rg.id, rg.name
		ORDER BY cnt DESC`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []GroupActivity
	for rows.Next() {
		var g GroupActivity
		rows.Scan(&g.GroupID, &g.GroupName, &g.Count)
		result = append(result, g)
	}
	return result, nil
}

// buildTopStudents 统计互动次数最多的 Top5 学生
func (s *InsightService) buildTopStudents(roomID string) ([]TopStudent, error) {
	rows, err := s.db.Query(`
		SELECT student_uuid, COALESCE(MAX(student_name), student_uuid) as name, COUNT(*) as cnt
		FROM widget_interactions
		WHERE room_id = $1 AND student_uuid != ''
		GROUP BY student_uuid
		ORDER BY cnt DESC LIMIT 5`, roomID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []TopStudent
	for rows.Next() {
		var s TopStudent
		rows.Scan(&s.UUID, &s.Nickname, &s.Count)
		result = append(result, s)
	}
	return result, nil
}

// buildHtmlStats 聚合 HTML 课件互动（REQ-043 Slice-3）。
// 口径（用户 2026-07-24 拍板）：掌握度取每个 (学生,元素,题) 的最后一次提交（latest-wins），
// 但保留每题尝试次数（历史完整留在库里）；complete 汇总事件不计入按题统计。
func (s *InsightService) buildHtmlStats(roomID string) ([]HtmlKnowledgeStat, []HtmlWidgetStat, []HtmlStudentStat) {
	rows, err := s.db.Query(`
		SELECT wi.student_uuid,
		       COALESCE(NULLIF(wi.student_name,''), wi.student_uuid) AS name,
		       wi.element_id,
		       COALESCE(re.payload->'payload'->>'title', re.payload->>'title', 'HTML 课件') AS title,
		       COALESCE(wi.action_data->>'questionId','')     AS qid,
		       COALESCE(wi.action_data->>'event','interact')  AS event,
		       wi.is_correct,
		       wi.action_data->>'score'    AS score,
		       wi.action_data->>'maxScore' AS maxscore,
		       COALESCE(kp.name,'')                           AS kp,
		       COALESCE(wi.action_data->>'response','')       AS response
		FROM widget_interactions wi
		LEFT JOIN knowledge_points kp ON kp.id = wi.knowledge_point_id
		LEFT JOIN room_elements re    ON re.id = wi.element_id
		WHERE wi.room_id = $1 AND wi.action_type = 'html_event'
		ORDER BY wi.created_at DESC`, roomID)
	if err != nil {
		log.Printf("[InsightService] 查询 HTML 互动失败: %v", err)
		return nil, nil, nil
	}
	defer rows.Close()

	type rowT struct {
		student, name, elem, title, qid, event, kp, response string
		isCorrect                                            *bool
		score, max                                           *float64
	}
	type key struct{ s, e, q string }
	latest := map[key]*rowT{}
	attempts := map[key]int{}
	var order []key

	widgetStudents := map[string]map[string]bool{}
	widgetEvents := map[string]int{}
	widgetTitle := map[string]string{}

	for rows.Next() {
		var r rowT
		var ic sql.NullBool
		var sc, mx sql.NullString
		if err := rows.Scan(&r.student, &r.name, &r.elem, &r.title, &r.qid, &r.event,
			&ic, &sc, &mx, &r.kp, &r.response); err != nil {
			continue
		}
		if ic.Valid {
			b := ic.Bool
			r.isCorrect = &b
		}
		if sc.Valid {
			if f, e := strconv.ParseFloat(sc.String, 64); e == nil {
				r.score = &f
			}
		}
		if mx.Valid {
			if f, e := strconv.ParseFloat(mx.String, 64); e == nil {
				r.max = &f
			}
		}

		// 课件参与统计：所有事件都算
		if widgetStudents[r.elem] == nil {
			widgetStudents[r.elem] = map[string]bool{}
		}
		widgetStudents[r.elem][r.student] = true
		widgetEvents[r.elem]++
		widgetTitle[r.elem] = r.title

		// complete 汇总事件不进按题统计
		if r.event == "complete" {
			continue
		}
		k := key{r.student, r.elem, r.qid}
		attempts[k]++
		if _, ok := latest[k]; !ok { // 已按 created_at DESC 排序，首见即最新
			rr := r
			latest[k] = &rr
			order = append(order, k)
		}
	}

	kAgg := map[string]*HtmlKnowledgeStat{}
	kStudents := map[string]map[string]bool{}
	var kOrder []string
	stuAgg := map[string]*HtmlStudentStat{}
	var stuOrder []string

	for _, k := range order {
		r := latest[k]
		if _, ok := stuAgg[r.student]; !ok {
			stuAgg[r.student] = &HtmlStudentStat{UUID: r.student, Nickname: r.name}
			stuOrder = append(stuOrder, r.student)
		}
		stuAgg[r.student].Questions = append(stuAgg[r.student].Questions, HtmlQuestionResult{
			QuestionID: k.q, Knowledge: r.kp, Event: r.event,
			IsCorrect: r.isCorrect, Score: r.score, MaxScore: r.max,
			Response: r.response, Attempts: attempts[k],
		})

		// 知识点掌握度：仅统计有对错信号且挂了知识点的
		if r.kp == "" {
			continue
		}
		var got, full float64
		has := false
		if r.score != nil && r.max != nil && *r.max > 0 {
			got, full, has = *r.score, *r.max, true
		} else if r.isCorrect != nil {
			full = 1
			if *r.isCorrect {
				got = 1
			}
			has = true
		}
		if !has {
			continue
		}
		if _, ok := kAgg[r.kp]; !ok {
			kAgg[r.kp] = &HtmlKnowledgeStat{Knowledge: r.kp}
			kStudents[r.kp] = map[string]bool{}
			kOrder = append(kOrder, r.kp)
		}
		kAgg[r.kp].Got += got
		kAgg[r.kp].Full += full
		kStudents[r.kp][r.student] = true
	}

	knowledge := make([]HtmlKnowledgeStat, 0, len(kOrder))
	for _, name := range kOrder {
		a := kAgg[name]
		a.Students = len(kStudents[name])
		if a.Full > 0 {
			a.Rate = a.Got / a.Full
		}
		knowledge = append(knowledge, *a)
	}
	students := make([]HtmlStudentStat, 0, len(stuOrder))
	for _, id := range stuOrder {
		students = append(students, *stuAgg[id])
	}
	widgets := make([]HtmlWidgetStat, 0, len(widgetEvents))
	for elem, ev := range widgetEvents {
		widgets = append(widgets, HtmlWidgetStat{
			ElementID: elem, Title: widgetTitle[elem],
			Students: len(widgetStudents[elem]), Events: ev,
		})
	}
	return knowledge, widgets, students
}

// widgetActionType 根据组件类型返回对应的 action_type
func widgetActionType(widgetType string) string {
	switch widgetType {
	case "polling_widget":
		return "vote"
	case "wordcloud_widget":
		return "add_word"
	case "qa_widget":
		return "answer"
	case "dropzone_widget":
		return "submit"
	default:
		return "submit"
	}
}
