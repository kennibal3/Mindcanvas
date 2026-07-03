// =============================================================
// MindCanvas v3.0 - 敏感词过滤服务
// 功能：基于 Trie 树的高效敏感词检测与替换
// 覆盖：昵称、文本卡片内容、词云词汇
// =============================================================
package services

import (
	"bufio"
	"log"
	"os"
	"strings"
	"sync"
	"unicode/utf8"
)

// ProfanityService 敏感词过滤服务
type ProfanityService struct {
	root *trieNode   // Trie 树根节点
	mu   sync.RWMutex // 读写锁（支持热加载）
}

// trieNode Trie 树节点
type trieNode struct {
	children map[rune]*trieNode // 子节点映射
	isEnd    bool               // 是否为敏感词结尾
}

// NewProfanityService 创建敏感词服务并加载词库
func NewProfanityService(dictPath string) *ProfanityService {
	ps := &ProfanityService{
		root: &trieNode{children: make(map[rune]*trieNode)},
	}

	// 加载词库文件
	if err := ps.LoadDict(dictPath); err != nil {
		log.Printf("[敏感词] 词库加载失败: %v，将使用空词库", err)
	}

	return ps
}

// LoadDict 从文件加载敏感词词库
// 支持热加载：加载期间不影响现有过滤
func (ps *ProfanityService) LoadDict(dictPath string) error {
	file, err := os.Open(dictPath)
	if err != nil {
		return err
	}
	defer file.Close()

	// 构建新的 Trie 树
	newRoot := &trieNode{children: make(map[rune]*trieNode)}
	count := 0

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		word := strings.TrimSpace(scanner.Text())
		if word == "" || strings.HasPrefix(word, "#") {
			continue // 跳过空行和注释行
		}
		insertWord(newRoot, word)
		count++
	}

	if err := scanner.Err(); err != nil {
		return err
	}

	// 原子替换 Trie 树
	ps.mu.Lock()
	ps.root = newRoot
	ps.mu.Unlock()

	log.Printf("[敏感词] 词库加载完成，共 %d 个词条", count)
	return nil
}

// insertWord 将敏感词插入 Trie 树
func insertWord(root *trieNode, word string) {
	node := root
	for _, r := range word {
		if node.children[r] == nil {
			node.children[r] = &trieNode{children: make(map[rune]*trieNode)}
		}
		node = node.children[r]
	}
	node.isEnd = true
}

// Filter 过滤文本中的敏感词，替换为 *
// 返回过滤后的文本
func (ps *ProfanityService) Filter(text string) string {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	runes := []rune(text)
	result := make([]rune, len(runes))
	copy(result, runes)

	for i := 0; i < len(runes); i++ {
		node := ps.root
		j := i
		lastMatchEnd := -1 // 记录最长匹配的结束位置

		// 尝试从位置 i 开始匹配最长敏感词
		for j < len(runes) {
			child, exists := node.children[runes[j]]
			if !exists {
				break
			}
			node = child
			if node.isEnd {
				lastMatchEnd = j // 更新最长匹配位置
			}
			j++
		}

		// 如果找到匹配，替换为 *
		if lastMatchEnd >= 0 {
			for k := i; k <= lastMatchEnd; k++ {
				result[k] = '*'
			}
			i = lastMatchEnd // 跳过已替换的部分
		}
	}

	return string(result)
}

// Contains 检测文本是否包含敏感词
// 返回 true 表示包含敏感词
func (ps *ProfanityService) Contains(text string) bool {
	ps.mu.RLock()
	defer ps.mu.RUnlock()

	runes := []rune(text)
	for i := 0; i < len(runes); i++ {
		node := ps.root
		for j := i; j < len(runes); j++ {
			child, exists := node.children[runes[j]]
			if !exists {
				break
			}
			node = child
			if node.isEnd {
				return true
			}
		}
	}
	return false
}

// WordCount 获取已加载的敏感词数量
func (ps *ProfanityService) WordCount() int {
	ps.mu.RLock()
	defer ps.mu.RUnlock()
	return countWords(ps.root)
}

// countWords 递归统计 Trie 树中的敏感词数量
func countWords(node *trieNode) int {
	count := 0
	if node.isEnd {
		count++
	}
	for _, child := range node.children {
		count += countWords(child)
	}
	return count
}

// 编译检查：确保使用了 utf8 包（ValidateNickname 可能需要）
var _ = utf8.RuneCountInString
