package services

import (
	"context"
	"time"
)

// mindmapCallTimeout 流水线中单次模型调用的超时（展开是并发的，总耗时≈骨架+最慢的一批展开+重写）
const mindmapCallTimeout = 60 * time.Second

// GenerateMindmapOutline REQ-068 第二步：把一段老师的原始文字，经「骨架→并行展开→体检重写」
// 生成带说明/图标/重点的缩进大纲。复用提炼的调用通道（重试、超时、截断识别、RefineError）。
func (s *AIService) GenerateMindmapOutline(ctx context.Context, text string, emit func(MindmapEvent)) (*MindmapResult, error) {
	llm := func(ctx context.Context, system, user string, maxTokens int, temperature float64) (string, bool, error) {
		return s.completeWithTemp(ctx, system, user, maxTokens, temperature, mindmapCallTimeout)
	}
	return RunMindmapPipeline(ctx, llm, text, emit)
}
