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
	body, err := json.Marshal(aiRequest{Model: s.model, Messages: messages, Stream: stream})
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
