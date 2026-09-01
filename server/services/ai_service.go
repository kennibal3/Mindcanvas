package services

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type AIMessage struct {
	Role    string      `json:"role"`
	Content interface{} `json:"content"`
}

type AIContentPart struct {
	Type     string      `json:"type"`
	Text     string      `json:"text,omitempty"`
	ImageURL *AIImageURL `json:"image_url,omitempty"`
}

type AIImageURL struct {
	URL string `json:"url"`
}

type aiRequest struct {
	Model    string      `json:"model"`
	Messages []AIMessage `json:"messages"`
	Stream   bool        `json:"stream,omitempty"`
}

type aiResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
		Delta struct {
			Content string `json:"content"`
		} `json:"delta"`
		FinishReason string `json:"finish_reason"`
	} `json:"choices"`
	Usage struct {
		PromptTokens     int `json:"prompt_tokens"`
		CompletionTokens int `json:"completion_tokens"`
		TotalTokens      int `json:"total_tokens"`
	} `json:"usage"`
	Error *struct {
		Message string `json:"message"`
		Code    string `json:"code"`
	} `json:"error"`
}

type AIUsage struct {
	PromptTokens     int
	CompletionTokens int
	TotalTokens      int
}

type AIService struct {
	apiKey  string
	baseURL string
	model   string
	client  *http.Client
}

func NewAIService(apiKey, baseURL, model string) *AIService {
	return &AIService{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(baseURL, "/"),
		model:   model,
		client:  &http.Client{Timeout: 120 * time.Second},
	}
}

func (s *AIService) IsConfigured() bool { return s.apiKey != "" }
func (s *AIService) Model() string      { return s.model }

func (s *AIService) Chat(ctx context.Context, messages []AIMessage) (string, AIUsage, error) {
	return s.doChat(ctx, messages, false, nil)
}

func (s *AIService) ChatStream(ctx context.Context, messages []AIMessage, onChunk func(string)) (AIUsage, error) {
	_, usage, err := s.doChat(ctx, messages, true, onChunk)
	return usage, err
}

func (s *AIService) Analyze(ctx context.Context, systemPrompt, userContent string) (string, AIUsage, error) {
	var msgs []AIMessage
	if systemPrompt != "" {
		msgs = append(msgs, AIMessage{Role: "system", Content: systemPrompt})
	}
	msgs = append(msgs, AIMessage{Role: "user", Content: userContent})
	return s.Chat(ctx, msgs)
}

func (s *AIService) AnalyzeWithImage(ctx context.Context, systemPrompt, textPrompt, imageURL string) (string, AIUsage, error) {
	parts := []AIContentPart{
		{Type: "image_url", ImageURL: &AIImageURL{URL: imageURL}},
		{Type: "text", Text: textPrompt},
	}
	var msgs []AIMessage
	if systemPrompt != "" {
		msgs = append(msgs, AIMessage{Role: "system", Content: systemPrompt})
	}
	msgs = append(msgs, AIMessage{Role: "user", Content: parts})
	return s.Chat(ctx, msgs)
}

func (s *AIService) doChat(ctx context.Context, messages []AIMessage, stream bool, onChunk func(string)) (string, AIUsage, error) {
	if !s.IsConfigured() {
		return "", AIUsage{}, fmt.Errorf("ai service not configured: ARK_API_KEY is empty")
	}
	reqMap := map[string]interface{}{"model": s.model, "messages": messages}
	if stream {
		reqMap["stream"] = true
	}
	if fast, _ := ctx.Value(fastModeKey{}).(bool); fast {
		reqMap["thinking"] = map[string]string{"type": "disabled"}
		reqMap["max_tokens"] = 8192
	}
	body, err := json.Marshal(reqMap)
	if err != nil {
		return "", AIUsage{}, fmt.Errorf("ai marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", s.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", AIUsage{}, fmt.Errorf("ai new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.apiKey)
	resp, err := s.client.Do(req)
	if err != nil {
		return "", AIUsage{}, fmt.Errorf("ai http: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return "", AIUsage{}, fmt.Errorf("ai api status %d: %s", resp.StatusCode, string(raw))
	}
	if stream {
		return s.readStream(resp.Body, onChunk)
	}
	return s.readJSON(resp.Body)
}

func (s *AIService) readJSON(body io.Reader) (string, AIUsage, error) {
	var resp aiResponse
	if err := json.NewDecoder(body).Decode(&resp); err != nil {
		return "", AIUsage{}, fmt.Errorf("ai decode response: %w", err)
	}
	if resp.Error != nil {
		return "", AIUsage{}, fmt.Errorf("ai api error [%s]: %s", resp.Error.Code, resp.Error.Message)
	}
	if len(resp.Choices) == 0 {
		return "", AIUsage{}, fmt.Errorf("ai api: empty choices")
	}
	usage := AIUsage{
		PromptTokens:     resp.Usage.PromptTokens,
		CompletionTokens: resp.Usage.CompletionTokens,
		TotalTokens:      resp.Usage.TotalTokens,
	}
	return resp.Choices[0].Message.Content, usage, nil
}

func (s *AIService) readStream(body io.Reader, onChunk func(string)) (string, AIUsage, error) {
	var sb strings.Builder
	scanner := bufio.NewScanner(body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}
		var chunk aiResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		text := chunk.Choices[0].Delta.Content
		if text == "" {
			continue
		}
		sb.WriteString(text)
		if onChunk != nil {
			onChunk(text)
		}
	}
	if err := scanner.Err(); err != nil {
		return sb.String(), AIUsage{}, fmt.Errorf("ai stream read: %w", err)
	}
	return sb.String(), AIUsage{}, nil
}

const AIPromptGenerateRubric = `你是一位专业的教学评价设计师。
请根据提供的作业信息，生成一套包含6个评价维度的评分标准，总分100分。
输出严格遵守以下 JSON 格式，不要输出任何其他内容：
{
  "criteria": [
    {
      "name": "维度名称",
      "description": "评价说明",
      "weight": 20,
      "levels": [
        {"score": 20, "label": "优秀", "description": "达到标准描述"},
        {"score": 15, "label": "良好", "description": "达到标准描述"},
        {"score": 10, "label": "合格", "description": "达到标准描述"},
        {"score": 5,  "label": "待改进", "description": "达到标准描述"}
      ]
    }
  ]
}`

const AIPromptAssessSubmission = `你是一位公正、专业的作业评阅老师，擅长给出建设性反馈。
请根据提供的评分标准和学生提交内容，完成逐维度评分和综合评价。
输出严格遵守以下 JSON 格式，不要输出任何其他内容：
{
  "total_score": 85,
  "dimension_scores": [
    {"criterion_name": "维度名称", "score": 18, "feedback": "该维度具体评语"}
  ],
  "overall_feedback": "综合评价（2-4句话）",
  "highlights": "做得好的地方",
  "issues": "需要改进的地方",
  "suggestions": "具体改进建议"
}`

// ── FastMode：结构化输出场景（AI 图形生成等）关闭深度思考并限制输出长度 ──
type fastModeKey struct{}

// WithFastMode 返回带快速模式标记的 context；doChat 检测到后在请求体加 thinking:disabled + max_tokens
func WithFastMode(ctx context.Context) context.Context {
	return context.WithValue(ctx, fastModeKey{}, true)
}

// ════════════════════════════════════════════════════════════
// REQ-062：智能体专用的流式调用（新增，既有代码一行未动）
//
// 为什么另起一条路，而不是把既有的 doChat / readStream 改对：
//   ① `ChatStream` 不是死代码——`chat_handler_patch.go:94` 的养成对话在用它；
//   ② 既有 `readStream` 返回的 AIUsage 恒为空、且从不读 finish_reason。
//      要改对就得动 doChat 的返回签名，而 doChat 是 Chat / Analyze /
//      AnalyzeWithImage 的公共底座，图形生成、讲评分析、作业评阅全走它。
//      **在没有评测集的前提下，为了一个新功能去改所有既有功能的公共路径，
//      是不划算的风险**——同 BUG-023 那轮的结论：在没有问题的地方改动
//      已验证正常的代码，本身就是风险；
//   ③ `refine_service.go` 早有同样的先例（它也走自己的 refineComplete）。
// ════════════════════════════════════════════════════════════

// modelKey 按调用点覆盖模型的 context key（与既有 fastModeKey 同样的做法）
type modelKey struct{}

// WithModel 指定本次调用使用的模型；不传或传空则用实例默认模型。
//
// 存在的理由：图形生成 / 讲评分析 / 提炼 / 养成对话共用同一个 AIService 实例，
// 智能体要用更快的模型，但**绝不能因此去改全局 ARK_MODEL**——那等于一次性
// 替换所有 AI 功能的模型，而目前没有任何评测能证明图形生成不会退化。
//
// 注意：本 key 目前只被 StreamChatEx 读取，不影响既有的 Chat/Analyze 路径。
func WithModel(ctx context.Context, model string) context.Context {
	if model == "" {
		return ctx
	}
	return context.WithValue(ctx, modelKey{}, model)
}

// AIStreamOptions 流式调用参数
type AIStreamOptions struct {
	MaxTokens int  // 0 → 默认 2048
	Thinking  bool // 默认 false＝关闭深度思考（对话要快；seed 系列默认是开的）
}

// AIStreamResult 流式调用的完整结果。
// **Usage 与 FinishReason 是一等字段，不是日志里的一行字**——
// 已经栽过三次（REQ-050 静默丢节点 / REQ-057 静默丢文字 / BUG-013 绑定失败无人管），
// 共同结构都是「上游给了明确信号，代码只把它打进日志，一路当成功往下传」。
type AIStreamResult struct {
	Content      string
	Usage        AIUsage
	FinishReason string // stop / length / content_filter ...
	Truncated    bool   // FinishReason == "length"
	Model        string
}

// StreamChatEx 流式对话。onChunk 每收到一段文本回调一次，可传 nil（此时等价于非流式，
// 但仍能拿到 usage 与 finishReason，故摘要/命名这类不需要打字机效果的调用也走它）。
func (s *AIService) StreamChatEx(ctx context.Context, messages []AIMessage, opts AIStreamOptions, onChunk func(string)) (AIStreamResult, error) {
	res := AIStreamResult{}
	if !s.IsConfigured() {
		return res, fmt.Errorf("ai service not configured: ARK_API_KEY is empty")
	}

	model := s.model
	if m, _ := ctx.Value(modelKey{}).(string); m != "" {
		model = m
	}
	res.Model = model

	maxTokens := opts.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 2048
	}
	thinking := "disabled"
	if opts.Thinking {
		thinking = "enabled"
	}

	reqMap := map[string]interface{}{
		"model":      model,
		"messages":   messages,
		"stream":     true,
		"max_tokens": maxTokens,
		"thinking":   map[string]string{"type": thinking},
		// ⚠️ 少了这一行，流式响应里根本不会带 usage，
		// agent_messages 的 token 列会永远是 0 —— 等于主动把新建的日志表建成空的。
		"stream_options": map[string]interface{}{"include_usage": true},
	}

	body, err := json.Marshal(reqMap)
	if err != nil {
		return res, fmt.Errorf("ai marshal request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, "POST", s.baseURL+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return res, fmt.Errorf("ai new request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.apiKey)

	resp, err := s.client.Do(req)
	if err != nil {
		return res, fmt.Errorf("ai http: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		return res, fmt.Errorf("ai api status %d: %s", resp.StatusCode, string(raw))
	}

	var sb strings.Builder
	scanner := bufio.NewScanner(resp.Body)
	// 默认单行上限 64KB。SSE 单行通常很小，但上游偶尔会把一整段塞进一行，
	// 撞上限时 scanner 会**静默停止**（Err() 返回 ErrTooLong，内容却已经少了一截）——
	// 又是一个「看不见的那半截」，所以直接给到 1MB。
	scanner.Buffer(make([]byte, 0, 64*1024), 1024*1024)

	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			break
		}
		var chunk aiResponse
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if chunk.Error != nil {
			return res, fmt.Errorf("ai api error [%s]: %s", chunk.Error.Code, chunk.Error.Message)
		}
		// usage 通常在最后一个 chunk，且该 chunk 的 choices 为空数组，
		// 所以必须在 len(choices)==0 的分支之外先取，不能写在 choices 里面。
		if chunk.Usage.TotalTokens > 0 {
			res.Usage = AIUsage{
				PromptTokens:     chunk.Usage.PromptTokens,
				CompletionTokens: chunk.Usage.CompletionTokens,
				TotalTokens:      chunk.Usage.TotalTokens,
			}
		}
		if len(chunk.Choices) == 0 {
			continue
		}
		if fr := chunk.Choices[0].FinishReason; fr != "" {
			res.FinishReason = fr
		}
		text := chunk.Choices[0].Delta.Content
		if text == "" {
			continue
		}
		sb.WriteString(text)
		if onChunk != nil {
			onChunk(text)
		}
	}

	res.Content = sb.String()
	res.Truncated = res.FinishReason == "length"

	if err := scanner.Err(); err != nil {
		return res, fmt.Errorf("ai stream read: %w", err)
	}
	return res, nil
}
