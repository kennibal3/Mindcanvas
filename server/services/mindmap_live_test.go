//go:build live

package services

// REQ-068 第二步：真实模型的提示词调优测试（不进 CI，需 -tags live）。
// 运行（服务器上，key 只经环境变量传入，不会被打印）：
//
//	set -a; . /opt/mindcanvas/configs/.env; set +a
//	cd server && go test -tags live -run TestMindmapLive -v -timeout 15m ./services/
//
// 产出：$MM_LIVE_OUT（默认 /tmp/mindmap_live_out）下每份材料一个 .outline.md，外加 report.md。
// 把 report.md 和各 .outline.md 发回来即可评估/调提示词。

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestMindmapLive(t *testing.T) {
	key := os.Getenv("ARK_API_KEY")
	if key == "" {
		t.Skip("未设置 ARK_API_KEY")
	}
	base := os.Getenv("ARK_BASE_URL")
	if base == "" {
		base = "https://ark.cn-beijing.volces.com/api/v3"
	}
	model := os.Getenv("ARK_MODEL")
	if model == "" {
		model = "doubao-seed-2-1-turbo-260628"
	}
	svc := NewAIService(key, base, model)

	outDir := os.Getenv("MM_LIVE_OUT")
	if outDir == "" {
		outDir = "/tmp/mindmap_live_out"
	}
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		t.Fatal(err)
	}

	files, _ := filepath.Glob("testdata/mindmap_live/*.txt")
	sort.Strings(files)
	if len(files) == 0 {
		t.Fatal("testdata/mindmap_live 下没有材料")
	}

	var report strings.Builder
	fmt.Fprintf(&report, "# 思维导图流水线 live 报告\n\n模型：%s　时间：%s\n\n", model, time.Now().Format("2006-01-02 15:04"))

	for _, f := range files {
		name := strings.TrimSuffix(filepath.Base(f), ".txt")
		raw, err := os.ReadFile(f)
		if err != nil {
			t.Fatal(err)
		}
		text := strings.TrimSpace(string(raw))

		t.Run(name, func(t *testing.T) {
			start := time.Now()
			var events []string
			res, err := svc.GenerateMindmapOutline(context.Background(), text, func(e MindmapEvent) {
				events = append(events, fmt.Sprintf("[%s] %s", e.Stage, e.Message))
			})
			cost := time.Since(start).Round(time.Second)

			fmt.Fprintf(&report, "## %s（输入 %d 字，耗时 %s）\n\n", name, len([]rune(text)), cost)
			if err != nil {
				fmt.Fprintf(&report, "**失败**：%v\n\n", err)
				t.Errorf("失败: %v", err)
				return
			}
			fmt.Fprintf(&report, "- 框架：%s　分支 %d　节点 %d\n", res.Framework, res.Branches, res.Nodes)
			fmt.Fprintf(&report, "- 体检不合格 %d，重写采纳 %d，（补充）说明 %d\n", res.Flagged, res.Rewritten, res.SupplementNotes)
			if len(res.FailedBranches) > 0 {
				fmt.Fprintf(&report, "- 失败分支：%v\n", res.FailedBranches)
			}
			if len(res.TruncatedBranches) > 0 {
				fmt.Fprintf(&report, "- 截断分支：%v\n", res.TruncatedBranches)
			}
			for _, w := range res.Warnings {
				fmt.Fprintf(&report, "- ⚠ %s\n", w)
			}
			fmt.Fprintf(&report, "\n```\n%s```\n\n", res.Outline)

			if werr := os.WriteFile(filepath.Join(outDir, name+".outline.md"), []byte(res.Outline), 0o644); werr != nil {
				t.Error(werr)
			}
			t.Logf("%s: %s, %d 节点, 补充 %d, 事件 %d 条", name, cost, res.Nodes, res.SupplementNotes, len(events))
		})
	}
	if err := os.WriteFile(filepath.Join(outDir, "report.md"), []byte(report.String()), 0o644); err != nil {
		t.Fatal(err)
	}
	t.Logf("报告已写入 %s/report.md", outDir)
}
