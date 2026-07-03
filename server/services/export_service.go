// =============================================================
// MindCanvas v4.1 - 数据导出服务
// 功能：课堂总结聚合、CSV/Markdown导出、画布元素导出
// ⭐ 强化总结中心：加入 QA 问答统计、DropZone 作品墙统计
// 修复：导出查询兼容widget_type字段、student_name空值
// =============================================================
package services

import (
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"time"

	"github.com/redis/go-redis/v9"
)

// ExportService 导出服务
type ExportService struct {
	db  *sql.DB
	rdb *redis.Client
}

// NewExportService 创建导出服务
func NewExportService(db *sql.DB, rdb ...*redis.Client) *ExportService {
	svc := &ExportService{db: db}
	if len(rdb) > 0 {
		svc.rdb = rdb[0]
	}
	return svc
}

// sceneKeyExport Redis场景键
func sceneKeyExport(roomID string) string {
	return "room:scene:" + roomID
}

// =============================================================
// CSV 导出
// =============================================================

// ExportInteractions 导出互动数据 CSV
func (s *ExportService) ExportInteractions(writer io.Writer, roomID, exportType string, elementID ...string) error {
	// UTF-8 BOM 兼容 Excel 中文
	writer.Write([]byte{0xEF, 0xBB, 0xBF})
	csvWriter := csv.NewWriter(writer)
	defer csvWriter.Flush()

	csvWriter.Write([]string{"学生姓名", "组件类型", "操作类型", "提交内容", "是否正确", "提交时间"})

	// 使用 COALESCE 处理空值，widget_type 或 re.type 二选一
	query := `SELECT
		COALESCE(NULLIF(wi.student_name, ''), wi.student_uuid) as name,
		COALESCE(wi.widget_type, re.type) as wtype,
		wi.action_type,
		wi.action_data,
		wi.is_correct,
		wi.created_at
	FROM widget_interactions wi
	LEFT JOIN room_elements re ON wi.element_id = re.id
	WHERE wi.room_id = $1`

	args := []interface{}{roomID}

	switch exportType {
	case "vote":
		query += " AND wi.action_type = 'vote'"
	case "wordcloud":
		query += " AND wi.action_type = 'add_word'"
	case "qa":
		query += " AND wi.action_type = 'answer'"
	case "dropzone":
		query += " AND wi.action_type = 'submit'"
	}

	// 支持按单个 Widget 导出
	if len(elementID) > 0 && elementID[0] != "" {
		args = append(args, elementID[0])
		query += fmt.Sprintf(" AND wi.element_id = $%d", len(args))
	}

	query += " ORDER BY wi.created_at ASC"

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return fmt.Errorf("查询导出数据失败: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			studentName string
			elemType    string
			actionType  string
			actionData  json.RawMessage
			isCorrect   *bool
			createdAt   time.Time
		)

		if err := rows.Scan(&studentName, &elemType, &actionType, &actionData, &isCorrect, &createdAt); err != nil {
			return fmt.Errorf("扫描导出数据失败: %w", err)
		}

		content := extractContent(actionType, actionData)
		correctStr := ""
		if isCorrect != nil {
			if *isCorrect {
				correctStr = "正确"
			} else {
				correctStr = "错误"
			}
		}

		csvWriter.Write([]string{
			studentName, elemType, actionType, content, correctStr,
			createdAt.Format("2006-01-02 15:04:05"),
		})
	}

	return nil
}

// extractContent 从 action_data 提取可读内容
func extractContent(actionType string, data json.RawMessage) string {
	var parsed map[string]interface{}
	if json.Unmarshal(data, &parsed) != nil {
		return string(data)
	}
	switch actionType {
	case "vote":
		if option, ok := parsed["option"].(string); ok {
			return option
		}
	case "add_word":
		if word, ok := parsed["word"].(string); ok {
			return word
		}
	case "answer":
		if answer, ok := parsed["answer"].(string); ok {
			return answer
		}
	case "submit":
		// DropZone 提交：提取文本内容或文件名
		if content, ok := parsed["content"].(string); ok && content != "" {
			return content
		}
		if fileName, ok := parsed["file_name"].(string); ok && fileName != "" {
			return "[文件] " + fileName
		}
		if link, ok := parsed["link"].(string); ok && link != "" {
			return "[链接] " + link
		}
	}
	return string(data)
}

// ExportContributions 导出贡献统计 CSV
func (s *ExportService) ExportContributions(writer io.Writer, roomID string) error {
	writer.Write([]byte{0xEF, 0xBB, 0xBF})
	csvWriter := csv.NewWriter(writer)
	defer csvWriter.Flush()
	csvWriter.Write([]string{"创建者姓名", "创建元素数", "元素类型分布"})

	elements, err := s.getSceneElements(roomID)
	if err != nil || len(elements) == 0 {
		return s.exportContributionsFromDB(writer, roomID, csvWriter)
	}

	type stat struct {
		count int
		types map[string]int
	}
	stats := make(map[string]*stat)
	for _, el := range elements {
		m, ok := el.(map[string]interface{})
		if !ok {
			continue
		}
		if deleted, _ := m["isDeleted"].(bool); deleted {
			continue
		}
		creator := "未知"
		if cd, ok := m["customData"].(map[string]interface{}); ok {
			if name, ok := cd["creatorName"].(string); ok && name != "" {
				creator = name
			}
		}
		elemType, _ := m["type"].(string)
		if _, exists := stats[creator]; !exists {
			stats[creator] = &stat{types: make(map[string]int)}
		}
		stats[creator].count++
		if elemType != "" {
			stats[creator].types[elemType]++
		}
	}
	for name, st := range stats {
		typeStr := ""
		for t, c := range st.types {
			if typeStr != "" {
				typeStr += " / "
			}
			typeStr += fmt.Sprintf("%s×%d", t, c)
		}
		csvWriter.Write([]string{name, fmt.Sprintf("%d", st.count), typeStr})
	}
	return nil
}

// exportContributionsFromDB 从数据库查询贡献统计（Redis 缓存不可用时的降级）
func (s *ExportService) exportContributionsFromDB(writer io.Writer, roomID string, csvWriter *csv.Writer) error {
	rows, err := s.db.Query(`
		SELECT creator_name, COUNT(*) FILTER (WHERE is_deleted = FALSE), COUNT(*) FILTER (WHERE is_deleted = TRUE)
		FROM room_elements WHERE room_id=$1 AND creator_name IS NOT NULL AND creator_name != ''
		GROUP BY creator_name ORDER BY 2 DESC`, roomID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var created, deleted int
		rows.Scan(&name, &created, &deleted)
		csvWriter.Write([]string{name, fmt.Sprintf("%d", created), fmt.Sprintf("%d", deleted)})
	}
	return nil
}

// ExportTextContent 导出文字内容 CSV（去重）
func (s *ExportService) ExportTextContent(writer io.Writer, roomID string) error {
	writer.Write([]byte{0xEF, 0xBB, 0xBF})
	csvWriter := csv.NewWriter(writer)
	defer csvWriter.Flush()
	csvWriter.Write([]string{"创建者", "内容类型", "文字内容"})

	seen := make(map[string]bool)

	elements, err := s.getSceneElements(roomID)
	if err == nil && len(elements) > 0 {
		for _, el := range elements {
			m, ok := el.(map[string]interface{})
			if !ok {
				continue
			}
			if deleted, _ := m["isDeleted"].(bool); deleted {
				continue
			}
			elemType, _ := m["type"].(string)
			if elemType != "text" && elemType != "text_card" {
				continue
			}
			creator := "未知"
			if cd, ok := m["customData"].(map[string]interface{}); ok {
				if name, ok := cd["creatorName"].(string); ok && name != "" {
					creator = name
				}
			}
			text := ""
			if t, ok := m["text"].(string); ok {
				text = t
			}
			if text == "" {
				if p, ok := m["payload"].(map[string]interface{}); ok {
					if c, ok := p["content"].(string); ok {
						text = c
					}
				}
			}
			if text == "" {
				continue
			}
			typeLabel := "画布文字"
			if elemType == "text_card" {
				typeLabel = "文本卡片"
			}
			key := creator + "|" + typeLabel + "|" + text
			if seen[key] {
				continue
			}
			seen[key] = true
			csvWriter.Write([]string{creator, typeLabel, text})
		}
	}

	rows, err := s.db.Query(`SELECT creator_name, payload FROM room_elements WHERE room_id=$1 AND type='text_card' AND is_deleted=FALSE`, roomID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var name string
			var payload json.RawMessage
			rows.Scan(&name, &payload)
			var p map[string]interface{}
			if json.Unmarshal(payload, &p) == nil {
				if content, ok := p["content"].(string); ok && content != "" {
					key := name + "|文本卡片|" + content
					if !seen[key] {
						seen[key] = true
						csvWriter.Write([]string{name, "文本卡片(DB)", content})
					}
				}
			}
		}
	}
	return nil
}

// getSceneElements 从 Redis 获取场景元素列表
func (s *ExportService) getSceneElements(roomID string) ([]interface{}, error) {
	if s.rdb == nil {
		return nil, fmt.Errorf("redis不可用")
	}
	ctx := context.Background()
	data, err := s.rdb.Get(ctx, sceneKeyExport(roomID)).Result()
	if err != nil {
		return nil, err
	}
	var scene map[string]interface{}
	if json.Unmarshal([]byte(data), &scene) != nil {
		return nil, fmt.Errorf("解析失败")
	}
	els, _ := scene["elements"].([]interface{})
	return els, nil
}

// =============================================================
// 总结数据结构
// =============================================================

// PollSummary 投票汇总
type PollSummary struct {
	ElementID   string         `json:"element_id"`
	Question    string         `json:"question"`
	Options     []string       `json:"options"`
	Votes       map[string]int `json:"votes"`
	TotalVoters int            `json:"total_voters"`
	Mode        string         `json:"mode"`
}

// WordCloudSummary 词云汇总
type WordCloudSummary struct {
	ElementID  string         `json:"element_id"`
	Prompt     string         `json:"prompt"`
	Words      map[string]int `json:"words"`
	TotalWords int            `json:"total_words"`
}

// QASummary ⭐问答汇总
type QASummary struct {
	ElementID     string         `json:"element_id"`
	Question      string         `json:"question"`
	Options       []string       `json:"options"`
	CorrectIndex  int            `json:"correct_index"`
	AnswerCounts  map[string]int `json:"answer_counts"`  // 选项→答题人数
	TotalAnswers  int            `json:"total_answers"`
	CorrectCount  int            `json:"correct_count"`
	CorrectRate   float64        `json:"correct_rate"`
	ShowAnswer    bool           `json:"show_answer"`
}

// DropZoneSubmission ⭐作品墙单个提交
type DropZoneSubmission struct {
	StudentName  string `json:"student_name"`
	ContentType  string `json:"content_type"` // text/image/file/link
	Content      string `json:"content"`
	SubmittedAt  string `json:"submitted_at"`
	Likes        int    `json:"likes"`
}

// DropZoneSummary ⭐作品墙汇总
type DropZoneSummary struct {
	ElementID       string               `json:"element_id"`
	Title           string               `json:"title"`
	TotalSubmissions int                 `json:"total_submissions"`
	Submissions     []DropZoneSubmission `json:"submissions"`
}

// RoomSummary 课堂总结完整数据
type RoomSummary struct {
	RoomID        string             `json:"room_id"`
	Title         string             `json:"title"`
	CreatedAt     string             `json:"created_at"`
	Duration      string             `json:"duration"`
	TotalSessions int                `json:"total_sessions"`
	Polls         []PollSummary      `json:"polls"`
	WordClouds    []WordCloudSummary `json:"word_clouds"`
	// ⭐ 新增
	QASummaries   []QASummary        `json:"qa_summaries"`
	DropZones     []DropZoneSummary  `json:"dropzones"`
	TopWords      []string           `json:"top_words"`
	Participation map[string]int     `json:"participation"`
}

// =============================================================
// 总结数据聚合
// =============================================================

// GetSummary 聚合课堂总结数据
func (s *ExportService) GetSummary(roomID string) (*RoomSummary, error) {
	// 1. 获取房间基本信息
	var title string
	var createdAt time.Time
	var finishedAt *time.Time
	err := s.db.QueryRow(
		`SELECT title, created_at, finished_at FROM rooms WHERE id = $1`, roomID,
	).Scan(&title, &createdAt, &finishedAt)
	if err != nil {
		return nil, fmt.Errorf("房间不存在: %w", err)
	}

	// 2. 计算持续时间
	duration := "进行中"
	if finishedAt != nil {
		d := finishedAt.Sub(createdAt)
		h := int(d.Hours())
		m := int(d.Minutes()) % 60
		if h > 0 {
			duration = fmt.Sprintf("%d小时%d分钟", h, m)
		} else {
			duration = fmt.Sprintf("%d分钟", m)
		}
	}

	// 3. 参与人数
	var totalSessions int
	s.db.QueryRow(`SELECT COUNT(DISTINCT student_uuid) FROM room_sessions WHERE room_id = $1`, roomID).Scan(&totalSessions)

	// 4. 投票汇总
	polls, err := s.buildPollSummaries(roomID)
	if err != nil {
		polls = []PollSummary{}
	}

	// 5. 词云汇总
	wordClouds, err := s.buildWordCloudSummaries(roomID)
	if err != nil {
		wordClouds = []WordCloudSummary{}
	}

	// 6. ⭐ 问答汇总
	qaSummaries, err := s.buildQASummaries(roomID)
	if err != nil {
		qaSummaries = []QASummary{}
	}

	// 7. ⭐ 作品墙汇总
	dropzones, err := s.buildDropZoneSummaries(roomID)
	if err != nil {
		dropzones = []DropZoneSummary{}
	}

	// 8. 全局高频词 Top10
	topWords := s.buildTopWordsList(roomID)

	// 9. 参与度统计
	participation := map[string]int{"total_sessions": totalSessions}
	var totalVotes, totalWords, totalAnswers, totalDropzone int
	s.db.QueryRow(`SELECT COUNT(*) FROM widget_interactions WHERE room_id=$1 AND action_type='vote'`, roomID).Scan(&totalVotes)
	s.db.QueryRow(`SELECT COUNT(*) FROM widget_interactions WHERE room_id=$1 AND action_type='add_word'`, roomID).Scan(&totalWords)
	s.db.QueryRow(`SELECT COUNT(*) FROM widget_interactions WHERE room_id=$1 AND action_type='answer'`, roomID).Scan(&totalAnswers)
	s.db.QueryRow(`SELECT COUNT(*) FROM widget_interactions WHERE room_id=$1 AND action_type='submit'`, roomID).Scan(&totalDropzone)
	participation["total_votes"] = totalVotes
	participation["total_words"] = totalWords
	participation["total_answers"] = totalAnswers
	participation["total_submissions"] = totalDropzone

	return &RoomSummary{
		RoomID:        roomID,
		Title:         title,
		CreatedAt:     createdAt.Format("2006-01-02 15:04"),
		Duration:      duration,
		TotalSessions: totalSessions,
		Polls:         polls,
		WordClouds:    wordClouds,
		QASummaries:   qaSummaries,
		DropZones:     dropzones,
		TopWords:      topWords,
		Participation: participation,
	}, nil
}

// buildPollSummaries 聚合投票数据
func (s *ExportService) buildPollSummaries(roomID string) ([]PollSummary, error) {
	rows, err := s.db.Query(
		`SELECT id, payload FROM room_elements WHERE room_id = $1 AND type = 'polling_widget' AND is_deleted = false ORDER BY created_at`,
		roomID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []PollSummary
	for rows.Next() {
		var elemID string
		var payloadBytes []byte
		if rows.Scan(&elemID, &payloadBytes) != nil {
			continue
		}
		var p map[string]interface{}
		if json.Unmarshal(payloadBytes, &p) != nil {
			continue
		}
		question, _ := p["question"].(string)
		mode, _ := p["mode"].(string)
		if mode == "" {
			mode = "single"
		}
		var options []string
		if optsRaw, ok := p["options"].([]interface{}); ok {
			for _, o := range optsRaw {
				if str, ok := o.(string); ok {
					options = append(options, str)
				}
			}
		}

		// 从 widget_interactions 统计真实票数
		votes := make(map[string]int)
		voteRows, verr := s.db.Query(
			`SELECT action_data->>'option' as opt, COUNT(*) FROM widget_interactions
			 WHERE element_id = $1 AND action_type = 'vote'
			 GROUP BY action_data->>'option'`, elemID,
		)
		if verr == nil {
			for voteRows.Next() {
				var opt string
				var cnt int
				voteRows.Scan(&opt, &cnt)
				votes[opt] = cnt
			}
			voteRows.Close()
		}
		totalVoters := 0
		for _, v := range votes {
			totalVoters += v
		}

		result = append(result, PollSummary{
			ElementID:   elemID,
			Question:    question,
			Options:     options,
			Votes:       votes,
			TotalVoters: totalVoters,
			Mode:        mode,
		})
	}
	return result, nil
}

// buildWordCloudSummaries 聚合词云数据
func (s *ExportService) buildWordCloudSummaries(roomID string) ([]WordCloudSummary, error) {
	rows, err := s.db.Query(
		`SELECT id, payload FROM room_elements WHERE room_id = $1 AND type = 'wordcloud_widget' AND is_deleted = false ORDER BY created_at`,
		roomID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []WordCloudSummary
	for rows.Next() {
		var elemID string
		var payloadBytes []byte
		if rows.Scan(&elemID, &payloadBytes) != nil {
			continue
		}
		var p map[string]interface{}
		if json.Unmarshal(payloadBytes, &p) != nil {
			continue
		}
		prompt, _ := p["prompt"].(string)

		words := make(map[string]int)
		wRows, werr := s.db.Query(
			`SELECT action_data->>'word' as word, COUNT(*) FROM widget_interactions
			 WHERE element_id = $1 AND action_type = 'add_word'
			 GROUP BY action_data->>'word' ORDER BY COUNT(*) DESC`, elemID,
		)
		if werr == nil {
			for wRows.Next() {
				var word string
				var cnt int
				wRows.Scan(&word, &cnt)
				words[word] = cnt
			}
			wRows.Close()
		}
		totalWords := 0
		for _, v := range words {
			totalWords += v
		}
		result = append(result, WordCloudSummary{
			ElementID:  elemID,
			Prompt:     prompt,
			Words:      words,
			TotalWords: totalWords,
		})
	}
	return result, nil
}

// buildQASummaries ⭐ 聚合问答组件数据
func (s *ExportService) buildQASummaries(roomID string) ([]QASummary, error) {
	rows, err := s.db.Query(
		`SELECT id, payload FROM room_elements WHERE room_id = $1 AND type = 'qa_widget' AND is_deleted = false ORDER BY created_at`,
		roomID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []QASummary
	for rows.Next() {
		var elemID string
		var payloadBytes []byte
		if rows.Scan(&elemID, &payloadBytes) != nil {
			continue
		}
		var p map[string]interface{}
		if json.Unmarshal(payloadBytes, &p) != nil {
			continue
		}

		question, _ := p["question"].(string)
		showAnswer, _ := p["show_answer"].(bool)
		correctIndex := -1
		if ci, ok := p["correct_answer"].(float64); ok {
			correctIndex = int(ci)
		}

		var options []string
		if optsRaw, ok := p["options"].([]interface{}); ok {
			for _, o := range optsRaw {
				if str, ok := o.(string); ok {
					options = append(options, str)
				}
			}
		}

		// 统计每个选项的答题人数
		answerCounts := make(map[string]int)
		aRows, aerr := s.db.Query(
			`SELECT action_data->>'answer' as ans, COUNT(*) FROM widget_interactions
			 WHERE element_id = $1 AND action_type = 'answer'
			 GROUP BY action_data->>'answer'`, elemID,
		)
		if aerr == nil {
			for aRows.Next() {
				var ans string
				var cnt int
				aRows.Scan(&ans, &cnt)
				answerCounts[ans] = cnt
			}
			aRows.Close()
		}

		var totalAnswers, correctCount int
		s.db.QueryRow(
			`SELECT COUNT(*), COUNT(*) FILTER (WHERE is_correct = TRUE)
			 FROM widget_interactions WHERE element_id = $1 AND action_type = 'answer'`, elemID,
		).Scan(&totalAnswers, &correctCount)

		correctRate := 0.0
		if totalAnswers > 0 {
			correctRate = float64(correctCount) / float64(totalAnswers)
		}

		result = append(result, QASummary{
			ElementID:    elemID,
			Question:     question,
			Options:      options,
			CorrectIndex: correctIndex,
			AnswerCounts: answerCounts,
			TotalAnswers: totalAnswers,
			CorrectCount: correctCount,
			CorrectRate:  correctRate,
			ShowAnswer:   showAnswer,
		})
	}
	return result, nil
}

// buildDropZoneSummaries ⭐ 聚合作品墙提交数据
func (s *ExportService) buildDropZoneSummaries(roomID string) ([]DropZoneSummary, error) {
	rows, err := s.db.Query(
		`SELECT id, payload FROM room_elements WHERE room_id = $1 AND type = 'dropzone_widget' AND is_deleted = false ORDER BY created_at`,
		roomID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []DropZoneSummary
	for rows.Next() {
		var elemID string
		var payloadBytes []byte
		if rows.Scan(&elemID, &payloadBytes) != nil {
			continue
		}
		var p map[string]interface{}
		title := "作品收集"
		if json.Unmarshal(payloadBytes, &p) == nil {
			if t, ok := p["title"].(string); ok && t != "" {
				title = t
			}
		}

		// 查询该 DropZone 的所有提交记录
		subRows, serr := s.db.Query(
			`SELECT
				COALESCE(NULLIF(student_name, ''), student_uuid) as name,
				action_data,
				created_at
			 FROM widget_interactions
			 WHERE element_id = $1 AND action_type = 'submit'
			 ORDER BY created_at ASC`, elemID,
		)
		if serr != nil {
			continue
		}

		var submissions []DropZoneSubmission
		for subRows.Next() {
			var studentName string
			var actionData json.RawMessage
			var submittedAt time.Time
			subRows.Scan(&studentName, &actionData, &submittedAt)

			// 解析提交内容
			var ad map[string]interface{}
			contentType := "text"
			content := ""
			likes := 0
			if json.Unmarshal(actionData, &ad) == nil {
				if ct, ok := ad["content_type"].(string); ok {
					contentType = ct
				}
				if c, ok := ad["content"].(string); ok {
					content = c
				}
				if l, ok := ad["likes"].(float64); ok {
					likes = int(l)
				}
			}

			submissions = append(submissions, DropZoneSubmission{
				StudentName: studentName,
				ContentType: contentType,
				Content:     content,
				SubmittedAt: submittedAt.Format("2006-01-02 15:04:05"),
				Likes:       likes,
			})
		}
		subRows.Close()

		result = append(result, DropZoneSummary{
			ElementID:        elemID,
			Title:            title,
			TotalSubmissions: len(submissions),
			Submissions:      submissions,
		})
	}
	return result, nil
}

// buildTopWordsList 获取全局高频词列表
func (s *ExportService) buildTopWordsList(roomID string) []string {
	var result []string
	rows, err := s.db.Query(
		`SELECT action_data->>'word' as word, COUNT(*) as cnt
		 FROM widget_interactions
		 WHERE room_id = $1 AND action_type = 'add_word'
		 GROUP BY action_data->>'word' ORDER BY cnt DESC LIMIT 10`, roomID,
	)
	if err != nil {
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var word string
		var cnt int
		rows.Scan(&word, &cnt)
		result = append(result, word)
	}
	return result
}

// =============================================================
// Markdown 导出（强化版）
// =============================================================

// ExportSummaryMarkdown 导出 Markdown 格式总结
func (s *ExportService) ExportSummaryMarkdown(writer io.Writer, roomID string) error {
	summary, err := s.GetSummary(roomID)
	if err != nil {
		return err
	}

	md := fmt.Sprintf("# %s 课堂总结\n\n", summary.Title)
	md += fmt.Sprintf("**日期**：%s  \n", summary.CreatedAt)
	md += fmt.Sprintf("**时长**：%s  \n", summary.Duration)
	md += fmt.Sprintf("**参与人数**：%d 人  \n\n", summary.TotalSessions)
	md += "---\n\n"

	// ---- 参与统计 ----
	if len(summary.Participation) > 0 {
		md += "## 📈 参与统计\n\n"
		if v, ok := summary.Participation["total_votes"]; ok && v > 0 {
			md += fmt.Sprintf("- 投票总次数：**%d** 次\n", v)
		}
		if v, ok := summary.Participation["total_words"]; ok && v > 0 {
			md += fmt.Sprintf("- 词云提交总数：**%d** 个\n", v)
		}
		if v, ok := summary.Participation["total_answers"]; ok && v > 0 {
			md += fmt.Sprintf("- 问答作答总数：**%d** 次\n", v)
		}
		if v, ok := summary.Participation["total_submissions"]; ok && v > 0 {
			md += fmt.Sprintf("- 作品提交总数：**%d** 件\n", v)
		}
		md += "\n"
	}

	// ---- 投票结果 ----
	if len(summary.Polls) > 0 {
		md += "## 📊 投票结果\n\n"
		for i, poll := range summary.Polls {
			md += fmt.Sprintf("### 投票 %d：%s\n\n", i+1, poll.Question)
			md += fmt.Sprintf("共 **%d** 人参与投票\n\n", poll.TotalVoters)
			for _, opt := range poll.Options {
				cnt := poll.Votes[opt]
				pct := 0
				if poll.TotalVoters > 0 {
					pct = cnt * 100 / poll.TotalVoters
				}
				bar := buildProgressBar(pct)
				md += fmt.Sprintf("- **%s**：%d 票（%d%%） %s\n", opt, cnt, pct, bar)
			}
			md += "\n"
		}
	}

	// ---- 词云收集 ----
	if len(summary.WordClouds) > 0 {
		md += "## ☁️ 词云收集\n\n"
		for i, wc := range summary.WordClouds {
			md += fmt.Sprintf("### 词云 %d：%s\n\n", i+1, wc.Prompt)
			md += fmt.Sprintf("共收集 **%d** 个词语\n\n", wc.TotalWords)
			// 按频率排序输出前10个词
			type wordCount struct {
				word  string
				count int
			}
			var sorted []wordCount
			for w, c := range wc.Words {
				sorted = append(sorted, wordCount{w, c})
			}
			sort.Slice(sorted, func(i, j int) bool {
				return sorted[i].count > sorted[j].count
			})
			limit := 10
			if len(sorted) < limit {
				limit = len(sorted)
			}
			for _, wc := range sorted[:limit] {
				md += fmt.Sprintf("- **%s**（%d次）\n", wc.word, wc.count)
			}
			md += "\n"
		}
	}

	// ---- ⭐ 问答结果 ----
	if len(summary.QASummaries) > 0 {
		md += "## ❓ 问答结果\n\n"
		for i, qa := range summary.QASummaries {
			md += fmt.Sprintf("### 问题 %d：%s\n\n", i+1, qa.Question)
			md += fmt.Sprintf("共 **%d** 人作答", qa.TotalAnswers)
			if qa.TotalAnswers > 0 {
				md += fmt.Sprintf("，正确率 **%.0f%%**", qa.CorrectRate*100)
			}
			md += "\n\n"
			for j, opt := range qa.Options {
				cnt := qa.AnswerCounts[opt]
				pct := 0
				if qa.TotalAnswers > 0 {
					pct = cnt * 100 / qa.TotalAnswers
				}
				prefix := ""
				if qa.ShowAnswer && j == qa.CorrectIndex {
					prefix = "✅ "
				}
				md += fmt.Sprintf("- %s**%s**：%d 人（%d%%）\n", prefix, opt, cnt, pct)
			}
			md += "\n"
		}
	}

	// ---- ⭐ 作品墙 ----
	if len(summary.DropZones) > 0 {
		md += "## 🖼️ 作品墙\n\n"
		for _, dz := range summary.DropZones {
			md += fmt.Sprintf("### %s（共 %d 件作品）\n\n", dz.Title, dz.TotalSubmissions)
			limit := 10 // Markdown 中最多展示10件
			if len(dz.Submissions) < limit {
				limit = len(dz.Submissions)
			}
			for _, sub := range dz.Submissions[:limit] {
				typeIcon := "📝"
				switch sub.ContentType {
				case "image":
					typeIcon = "🖼️"
				case "file":
					typeIcon = "📎"
				case "link":
					typeIcon = "🔗"
				}
				likeStr := ""
				if sub.Likes > 0 {
					likeStr = fmt.Sprintf(" 👍%d", sub.Likes)
				}
				md += fmt.Sprintf("- %s **%s**：%s%s\n",
					typeIcon, sub.StudentName, truncateString(sub.Content, 80), likeStr)
			}
			if len(dz.Submissions) > limit {
				md += fmt.Sprintf("\n*...共 %d 件，导出 CSV 查看全部*\n", len(dz.Submissions))
			}
			md += "\n"
		}
	}

	// ---- 全场高频词 ----
	if len(summary.TopWords) > 0 {
		md += "## 🔑 全场高频词\n\n"
		for _, w := range summary.TopWords {
			md += fmt.Sprintf("`%s` ", w)
		}
		md += "\n\n"
	}

	md += "---\n\n"
	md += fmt.Sprintf("*由 MindCanvas 自动生成 · %s*\n", time.Now().Format("2006-01-02 15:04"))

	_, err = writer.Write([]byte(md))
	return err
}

// buildProgressBar 生成文本进度条（用于 Markdown）
func buildProgressBar(pct int) string {
	filled := pct / 10
	if filled > 10 {
		filled = 10
	}
	bar := ""
	for i := 0; i < filled; i++ {
		bar += "█"
	}
	for i := filled; i < 10; i++ {
		bar += "░"
	}
	return bar
}

// truncateString 截断字符串（用于 Markdown 展示）
func truncateString(s string, maxLen int) string {
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}
	return string(runes[:maxLen]) + "..."
}

// ---- 以下为未使用但保留的辅助函数（兼容旧调用）------------------

// wordCountSlice 词频排序辅助（供外部可能调用）
type wordCountSlice []struct {
	word  string
	count int
}

func (w wordCountSlice) Len() int           { return len(w) }
func (w wordCountSlice) Less(i, j int) bool { return w[i].count > w[j].count }
func (w wordCountSlice) Swap(i, j int)      { w[i], w[j] = w[j], w[i] }

// DropzoneSummaryLegacy 旧版 DropZone 总结（兼容旧调用，不删除）
type DropzoneSummaryLegacy struct {
	ElementID        string   `json:"element_id"`
	Title            string   `json:"title"`
	TotalSubmissions int      `json:"total_submissions"`
	UniqueStudents   int      `json:"unique_students"`
	ContentTypes     []string `json:"content_types"`
}
