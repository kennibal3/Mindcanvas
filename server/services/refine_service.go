package services

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

// ============================================================
// REQ-028（第一步）：普通文本 → Markdown AI 提炼
// 移植自 markdown-mindmap 项目 server/providers/doubao.ts + api/refine.ts，
// 提示词与分段压缩逻辑保持一致，复用本项目 AIService 的 apiKey/baseURL/model/client。
// 与既有 Chat/ChatStream/Analyze（doChat）互不影响：本文件走独立的 refineComplete，
// 因为提炼场景需要固定 temperature=0.2、thinking 始终关闭、且 maxTokens 按调用阶段区分
// （直接提炼/分段压缩/摘要合并三种不同 maxTokens），跟聊天/图形生成的 FastMode 约定不同。
// ============================================================

const (
	refineLongTextThreshold = 2500  // 超过该字符数走「分段压缩→合并」
	refineChunkSize         = 2000  // 单段最大字符数
	refineMaxSourceLength   = 20000 // 提炼接口允许的最大输入长度
)

// REQ-057：三阶段的输出上限。
//
// 原值 1800/600/2000 里，压缩阶段的 600 与它自己的提示词
// 「控制在约 800 个中文字符以内」直接矛盾——中文在豆包分词下大致 1 字 ≥ 1 token，
// 600 token 根本装不下提示词要求的产出，模型照着提示词写就必然被砍。
// 2026-07-29 实测一次 18691 字输入：压缩 8/11 段撞顶、合并 1/1 撞顶，
// 而 direct 路径（上限 1800、输入上限 2500 字，提炼本就是压缩）一次没撞。
//
// 两阶段修法不同，因为约束不同：
//   - 压缩阶段并发跑（每段一个 goroutine），抬上限不显著拉长总耗时 → 直接抬到安全高于 800 字。
//   - 合并阶段串行且超时只有 45s，2000 token 已实测耗时 35s（≈57 token/秒，REQ-056 定案），
//     再抬上限会直接撞超时 → 上限保持不变，改为给提示词加长度上限让模型自己收敛，
//     max_tokens 退回「安全网」角色而不是实际的裁剪刀。
const (
	refineDirectMaxTokens    = 1800
	refineCompressMaxTokens  = 1200
	refineSynthesisMaxTokens = 2000
)

const refineDirectPrompt = `你是一名信息架构师。请将用户提供的普通文本提炼为适合思维导图的 Markdown。
要求：
1. 只输出 Markdown，不要代码围栏、解释或前后缀。
2. 先压缩内容：合并重复信息、删除格式噪音，保留关键事实、状态、结论、风险、行动项、责任人、时间和必要数字。
3. 再分类组织：使用一个一级标题作为中心主题，使用二级、三级标题和无序列表表达层级。
4. 不添加原文没有的事实，不遗漏尚未完成、存在风险或需要跟进的事项。
5. 节点文字简洁明确，避免长段落。
6. 输出总长度控制在约 1200 个中文字符以内；内容较多时优先保留结论、风险与行动项，宁可少写枝节也要写完整。`

const refineChunkCompressPrompt = `你是一名长文本压缩器。请压缩用户提供的一个文本分段，为后续统一分类做准备。
要求：
1. 只输出结构化摘要，不要解释、代码围栏或总标题。
2. 合并重复内容并删除表格符号、装饰符号等格式噪音。
3. 保留主题、关键事实、完成状态、结论、数字、责任人、时间、风险、待办和下一步行动。
4. 不添加原文没有的事实，不因为压缩而删除未完成或异常事项。
5. 控制在约 800 个中文字符以内，使用简短条目。`

const refineSynthesisPrompt = `你是一名信息架构师。输入内容是同一篇长文本的分段摘要汇总，请去重、归类并生成适合思维导图的 Markdown。
要求：
1. 只输出 Markdown，不要代码围栏、解释或前后缀。
2. 使用一个一级标题作为中心主题。
3. 使用二级、三级标题和无序列表表达层级，优先按主题、状态、风险和行动项分类。
4. 合并同义内容，但保留关键事实、状态、结论、数字、责任人、时间、风险和待办。
5. 不添加摘要中不存在的事实，节点文字保持简洁。
6. 输出总长度控制在约 1200 个中文字符以内；内容较多时优先保留结论、风险与行动项，宁可少写枝节也要写完整。`

// RefineErrorKind 对应 doubao.ts 的 DoubaoFailureKind，供 handler 映射 HTTP 状态码
type RefineErrorKind string

const (
	RefineErrTimeout     RefineErrorKind = "timeout"
	RefineErrNetwork     RefineErrorKind = "network"
	RefineErrUpstream    RefineErrorKind = "upstream"
	RefineErrInvalidResp RefineErrorKind = "invalid-response"
)

// RefineError 提炼失败的结构化错误，handler 据此映射 HTTP 状态码与用户提示文案
type RefineError struct {
	Kind        RefineErrorKind
	Status      int
	UpstreamMsg string
}

func (e *RefineError) Error() string {
	return fmt.Sprintf("refine failed: kind=%s status=%d upstream=%s", e.Kind, e.Status, e.UpstreamMsg)
}

var mdFenceRe = regexp.MustCompile("(?s)^```(?:markdown|md)?\\s*\\n?(.*?)\\n?```$")

// normalizeRefinedMarkdown 去除 AI 偶尔多带的 ```markdown 代码围栏，对应 doubao.ts 的 normalizeMarkdown
func normalizeRefinedMarkdown(s string) string {
	s = strings.TrimSpace(s)
	if m := mdFenceRe.FindStringSubmatch(s); len(m) > 1 {
		s = strings.TrimSpace(m[1])
	}
	return s
}

// extractUpstreamErrorMsg 尝试从非 200 响应体里取出上游错误信息，仅用于日志排查，不对外展示原始内容
func extractUpstreamErrorMsg(raw []byte) string {
	var e struct {
		Error *struct {
			Message string `json:"message"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &e) == nil && e.Error != nil {
		return e.Error.Message
	}
	return ""
}

// RefineResult 提炼结果
type RefineResult struct {
	Markdown string
	Model    string

	// REQ-057：截断信号。
	// 上游 finish_reason=length 表示输出被 max_tokens 砍断。此前这个信号只在
	// refineOnce 里被 log.Printf 读过一次就丢弃，结果一路以 result=ok 返回，
	// 老师拿到的是少一截的提炼内容而毫不知情——压缩阶段的截断尤其看不见，
	// 只会被归因成「AI 不好使」。与 REQ-050「转图静默丢节点」同类：
	// 上游已给明确失败信号，代码不读。
	Truncated       bool
	TruncatedChunks int    // 分段压缩阶段被截断的段数（direct 路径恒为 0）
	TruncatedStage  string // direct / compress / synthesis / compress+synthesis
}

// refineComplete 对应 doubao.ts 的 private complete()：单次带重试的 chat completions 调用。
// 网络错误在 attempt=0 时重试一次；HTTP 429/5xx 同样重试一次；超时不重试直接返回。
// 第二个返回值 truncated：本次输出是否因撞到 max_tokens 被截断（REQ-057）。
func (s *AIService) refineComplete(ctx context.Context, systemPrompt, userContent string, maxTokens int, timeout time.Duration) (string, bool, error) {
	if !s.IsConfigured() {
		return "", false, &RefineError{Kind: RefineErrUpstream, Status: 503, UpstreamMsg: "AI 服务未配置"}
	}

	reqBody, err := json.Marshal(map[string]interface{}{
		"model": s.model,
		"messages": []AIMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userContent},
		},
		"max_tokens":  maxTokens,
		"temperature": 0.2,
		"stream":      false,
		"thinking":    map[string]string{"type": "disabled"},
	})
	if err != nil {
		return "", false, fmt.Errorf("refine marshal request: %w", err)
	}

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		content, finishReason, retry, err := s.refineOnce(ctx, reqBody, timeout, attempt)
		if err == nil {
			// finish_reason=length ＝ 输出撞到 max_tokens 被砍断
			return content, finishReason == "length", nil
		}
		lastErr = err
		if !retry {
			return "", false, err
		}
	}
	return "", false, lastErr
}

// refineOnce 执行一次请求；retry=true 表示调用方应在 attempt==0 时重试。
// finishReason 原样上抛，由调用方判断是否被截断（REQ-057：此前它只进日志不上抛）。
func (s *AIService) refineOnce(ctx context.Context, reqBody []byte, timeout time.Duration, attempt int) (content string, finishReason string, retry bool, err error) {
	startedAt := time.Now()
	callCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	req, buildErr := http.NewRequestWithContext(callCtx, "POST", s.baseURL+"/chat/completions", bytes.NewReader(reqBody))
	if buildErr != nil {
		return "", "", false, fmt.Errorf("refine new request: %w", buildErr)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+s.apiKey)

	resp, doErr := s.client.Do(req)
	if doErr != nil {
		if errors.Is(callCtx.Err(), context.DeadlineExceeded) {
			return "", "", false, &RefineError{Kind: RefineErrTimeout, Status: 504}
		}
		return "", "", attempt == 0, &RefineError{Kind: RefineErrNetwork, Status: 502}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		raw, _ := io.ReadAll(resp.Body)
		upstreamMsg := extractUpstreamErrorMsg(raw)
		retryable := attempt == 0 && (resp.StatusCode == 429 || resp.StatusCode >= 500)
		log.Printf("[Refine] attempt=%d upstreamStatus=%d retryable=%t elapsed=%s msg=%s",
			attempt, resp.StatusCode, retryable, time.Since(startedAt).Round(time.Millisecond), upstreamMsg)
		return "", "", retryable, &RefineError{Kind: RefineErrUpstream, Status: resp.StatusCode, UpstreamMsg: upstreamMsg}
	}

	var data aiResponse
	if decErr := json.NewDecoder(resp.Body).Decode(&data); decErr != nil {
		return "", "", false, &RefineError{Kind: RefineErrInvalidResp, Status: 502}
	}
	if data.Error != nil {
		return "", "", false, &RefineError{Kind: RefineErrUpstream, Status: 502, UpstreamMsg: data.Error.Message}
	}
	if len(data.Choices) == 0 {
		return "", "", false, &RefineError{Kind: RefineErrInvalidResp, Status: 502}
	}
	// 单次上游调用的观测点：耗时 + token 用量 + 第几次尝试。
	// 加这行的原因：2026-07-29 排查「提炼 36s / 图形生成 13s」时，既无耗时也无 token 记录，
	// 只能靠猜（先猜深度思考未关——错，本文件 125 行一直是 disabled；再猜长文本双轮——也错，输入未超 2500 字）。
	// Usage 本来就已经解析在 aiResponse 里，白白丢弃。attempt>0 的行同时暴露「静默重试」。
	log.Printf("[Refine] attempt=%d elapsed=%s promptTokens=%d completionTokens=%d finishReason=%s",
		attempt, time.Since(startedAt).Round(time.Millisecond),
		data.Usage.PromptTokens, data.Usage.CompletionTokens, data.Choices[0].FinishReason)

	normalized := normalizeRefinedMarkdown(data.Choices[0].Message.Content)
	if normalized == "" {
		return "", "", false, &RefineError{Kind: RefineErrInvalidResp, Status: 502}
	}
	return normalized, data.Choices[0].FinishReason, false, nil
}

// splitLongText 按行贪心分段，单行超长则按字符数硬切；对应 doubao.ts 的 splitLongText
func splitLongText(source string) []string {
	var chunks []string
	var current strings.Builder

	pushCurrent := func() {
		chunk := strings.TrimSpace(current.String())
		if chunk != "" {
			chunks = append(chunks, chunk)
		}
		current.Reset()
	}

	for _, line := range strings.Split(source, "\n") {
		if utf8.RuneCountInString(line) > refineChunkSize {
			pushCurrent()
			runes := []rune(line)
			for offset := 0; offset < len(runes); offset += refineChunkSize {
				end := offset + refineChunkSize
				if end > len(runes) {
					end = len(runes)
				}
				chunks = append(chunks, string(runes[offset:end]))
			}
			continue
		}

		var candidate string
		if current.Len() > 0 {
			candidate = current.String() + "\n" + line
		} else {
			candidate = line
		}
		if utf8.RuneCountInString(candidate) > refineChunkSize {
			pushCurrent()
			current.WriteString(line)
		} else {
			current.Reset()
			current.WriteString(candidate)
		}
	}
	pushCurrent()
	return chunks
}

// RefineToMarkdown 文本 → Markdown 提炼主入口。
// <= 2500 字：一次直接提炼；超过：并发分段压缩（<=2000字/段）后统一合并提炼。
func (s *AIService) RefineToMarkdown(ctx context.Context, sourceText string) (*RefineResult, error) {
	startedAt := time.Now()
	srcLen := utf8.RuneCountInString(sourceText)

	if srcLen <= refineLongTextThreshold {
		content, truncated, err := s.refineComplete(ctx, refineDirectPrompt, sourceText, refineDirectMaxTokens, 60*time.Second)
		if err != nil {
			log.Printf("[Refine] path=direct srcLen=%d elapsed=%s result=error err=%v",
				srcLen, time.Since(startedAt).Round(time.Millisecond), err)
			return nil, err
		}
		log.Printf("[Refine] path=direct srcLen=%d elapsed=%s truncated=%t result=ok",
			srcLen, time.Since(startedAt).Round(time.Millisecond), truncated)
		res := &RefineResult{Markdown: content, Model: s.model, Truncated: truncated}
		if truncated {
			res.TruncatedStage = "direct"
		}
		return res, nil
	}

	chunks := splitLongText(sourceText)
	summaries := make([]string, len(chunks))
	errs := make([]error, len(chunks))
	chunkTruncated := make([]bool, len(chunks)) // REQ-057：逐段记录是否撞顶
	var wg sync.WaitGroup
	for i, chunk := range chunks {
		wg.Add(1)
		go func(idx int, c string) {
			defer wg.Done()
			userContent := fmt.Sprintf("第 %d/%d 段：\n%s", idx+1, len(chunks), c)
			content, truncated, err := s.refineComplete(ctx, refineChunkCompressPrompt, userContent, refineCompressMaxTokens, 45*time.Second)
			summaries[idx] = content
			errs[idx] = err
			chunkTruncated[idx] = truncated
		}(i, chunk)
	}
	wg.Wait()
	chunkDoneAt := time.Now()
	for _, e := range errs {
		if e != nil {
			log.Printf("[Refine] path=chunked srcLen=%d chunks=%d elapsed=%s result=error stage=compress err=%v",
				srcLen, len(chunks), time.Since(startedAt).Round(time.Millisecond), e)
			return nil, e
		}
	}

	var sb strings.Builder
	for i, sum := range summaries {
		if i > 0 {
			sb.WriteString("\n\n")
		}
		fmt.Fprintf(&sb, "## 分段摘要 %d\n%s", i+1, sum)
	}

	content, synthTruncated, err := s.refineComplete(ctx, refineSynthesisPrompt, sb.String(), refineSynthesisMaxTokens, 45*time.Second)
	if err != nil {
		log.Printf("[Refine] path=chunked srcLen=%d chunks=%d elapsed=%s result=error stage=synthesis err=%v",
			srcLen, len(chunks), time.Since(startedAt).Round(time.Millisecond), err)
		return nil, err
	}

	// REQ-057：把两个阶段的截断信号汇总。压缩阶段的截断是「看不见的那半截」——
	// 摘要少一块，合并出来的大纲照样通顺，老师无从察觉，只会觉得 AI 漏了东西。
	nTruncated := 0
	for _, t := range chunkTruncated {
		if t {
			nTruncated++
		}
	}
	stage := ""
	switch {
	case nTruncated > 0 && synthTruncated:
		stage = "compress+synthesis"
	case nTruncated > 0:
		stage = "compress"
	case synthTruncated:
		stage = "synthesis"
	}

	// 分两段计时：压缩阶段是并发的、合并阶段是串行的，分开才看得出瓶颈在哪一头
	log.Printf("[Refine] path=chunked srcLen=%d chunks=%d compressElapsed=%s synthesisElapsed=%s elapsed=%s truncatedChunks=%d/%d synthTruncated=%t result=ok",
		srcLen, len(chunks),
		chunkDoneAt.Sub(startedAt).Round(time.Millisecond),
		time.Since(chunkDoneAt).Round(time.Millisecond),
		time.Since(startedAt).Round(time.Millisecond),
		nTruncated, len(chunks), synthTruncated)

	return &RefineResult{
		Markdown:        content,
		Model:           s.model,
		Truncated:       stage != "",
		TruncatedChunks: nTruncated,
		TruncatedStage:  stage,
	}, nil
}
