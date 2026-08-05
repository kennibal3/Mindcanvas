// =============================================================
// MindCanvas - REQ-059 一期：zip 课件包解压与管理
//
// 本文件只做两件事：把 zip 安全地解到磁盘、把包的元信息落库。
// 「安全地」是这里的全部难点，三道防线各自防的东西完全不同，不要合并理解：
//
//   1. Zip Slip（路径穿越）——条目名写成 `../../configs/.env` 就能写穿出去。
//      Go 的 archive/zip **不做任何路径清洗**，f.Name 是攻击者完全可控的字符串。
//      该项目的 configs/.env 里有 ARK_API_KEY / DB 密码 / JWT Secret
//      （2026-07-29 刚因它泄漏轮换过一次密钥），被写穿一次就是事故不是 bug。
//   2. 解压炸弹——几十 KB 的包能解出几 GB。**不能信 header 里的 UncompressedSize64**，
//      那个字段同样是攻击者可控的，必须边解边累计真实写入字节。
//   3. 入口文件缺失——没有 index.html 的包解出来也打不开，
//      必须当场拒收并说清楚，不能默默收下一个点开是空白的课件
//      （本项目「静默丢弃」已踩五次，不再添第六次）。
//
// 真实课件长什么样（2026-08-05 拆用户手上 4 个真包实测，不是猜的）：
//   - 多页课件：index.html（带翻页控件的壳，内部还套一层 iframe）+ p1..p20.html + assets/
//   - 资源引用全部相对路径（<img src="assets/x.jpg"> 与 CSS url('assets/y.png') 两种形式）
//   - 无绝对路径、无 <base>、无外链 CDN → 挂在任何 URL 前缀下都能正常解析
//   - 四个包**全都多包了一层顶级目录**，目录名含空格/中文/em dash → 故本文件剥掉公共前缀
//   - 含 14.6MB mp4 → 下发侧必须支持 Range 请求（见 courseware_handler.go）
// =============================================================
package services

import (
	"archive/zip"
	"database/sql"
	"fmt"
	"io"
	"log"
	"os"
	"path"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// CoursewareRoot 课件解压根目录。
//
// **刻意不放 /opt/mindcanvas/uploads/ 之下**：nginx 有
// `location /uploads/ { alias /opt/mindcanvas/uploads/; }`，是直出且零鉴权的
// （autoindex off 只挡列目录、挡不住已知路径）。课件放那里等于把二期的
// 密码保护和有效期全部架空——知道路径就能绕开。本目录 nginx 够不着，
// 只能经 Go 下发，鉴权才有意义。
const CoursewareRoot = "/opt/mindcanvas/courseware"

const (
	// CoursewareMaxUploadBytes 上传 zip 本身的上限，与 nginx 的 client_max_body_size 100M 对齐。
	// 对齐是有意的：若这里放得比 nginx 宽，超限请求会在 nginx 层以 413 被砍，
	// 报错长得完全不像「文件太大」，很难排查。
	CoursewareMaxUploadBytes = 100 << 20 // 100MB

	// CoursewareMaxTotalBytes 解压后总字节上限。
	// 实测手上真实课件解压后 2.6MB / 5.1MB / 19MB（带 mp4 那版），200MB 留了十倍余量。
	CoursewareMaxTotalBytes = 200 << 20 // 200MB

	// CoursewareMaxEntries 条目数上限。实测真实课件 19~32 个条目。
	CoursewareMaxEntries = 2000
)

// ExtractResult 解压结果摘要
type ExtractResult struct {
	EntryFile  string // 入口文件相对路径（剥掉公共顶级目录之后）
	FileCount  int
	TotalBytes int64
	Stripped   string // 被剥掉的公共顶级目录名，空串表示没剥
	SkippedN   int    // 跳过的垃圾条目数（__MACOSX/.DS_Store 之类）
}

// CoursewarePackage 课件包元信息
type CoursewarePackage struct {
	ID         string
	TeacherID  string
	RoomID     sql.NullString
	Title      string
	StorageDir string
	EntryFile  string
	FileCount  int
	TotalBytes int64
}

// CoursewareService 课件包服务
type CoursewareService struct {
	db *sql.DB
}

func NewCoursewareService(db *sql.DB) *CoursewareService {
	return &CoursewareService{db: db}
}

// ── 解压相关（纯函数，可单测，不碰数据库）─────────────────────────────────

// isJunkEntry 判断是否为打包工具产生的垃圾条目。
//
// 实测用户手上 4 个包里这类条目为 0（不是 Mac 压的），但过滤逻辑照写不误：
// 换一台 Mac 打包就会有，而且 __MACOSX/ 下的 ._xxx 文件与正常文件同名，
// 混进课件目录会让人以为文件重复了。CLAUDE.md 里已记过一次
// AppleDouble 文件污染 git status 的教训，同一类东西。
func isJunkEntry(name string) bool {
	if strings.HasPrefix(name, "__MACOSX/") || name == "__MACOSX" {
		return true
	}
	base := path.Base(name)
	switch base {
	case ".DS_Store", "Thumbs.db", "desktop.ini":
		return true
	}
	// AppleDouble 伴生文件
	return strings.HasPrefix(base, "._")
}

// commonTopDir 求所有条目共同的顶级目录名；没有共同前缀则返回空串。
//
// 为什么要剥：实测 4 个真实课件包**全都**多包了一层
// （`七年级 语文 — 1/index.html`），目录名带空格、中文和 em dash。
// 剥掉之后 index.html 落到根，URL 里不再出现这些字符，
// 一整类转义问题直接消失——这不只是整洁问题。
func commonTopDir(names []string) string {
	first := ""
	for _, n := range names {
		idx := strings.Index(n, "/")
		if idx <= 0 {
			// 有条目直接在根上 ⇒ 不存在公共顶级目录
			return ""
		}
		top := n[:idx]
		if first == "" {
			first = top
		} else if first != top {
			return ""
		}
	}
	return first
}

// safeJoin 把 zip 里的相对路径安全地拼到 root 之下。这是防 Zip Slip 的那道防线。
//
// **取「明确拒绝」而不是「夹紧到 root 内」**，这是个有意的选择：
// 单纯 Clean 一下能把 `../../etc/passwd` 变成 root 内的 `etc/passwd`，
// 危害是消除了，但包会被静默地收下——而一个正常课件包**不可能**有 `..` 条目，
// 出现即说明这个包有问题，应当当场告诉老师，而不是默默解出一堆位置错乱的文件。
// （静默收下坏输入正是本项目踩过五次的那类问题。）
//
// 三重检查，各防各的：① 显式拒 `..` 段与绝对路径；
// ② Clean 后再比一次，防被编码花招绕过；③ 最后断言落点确实在 root 内。
func safeJoin(root, name string) (string, error) {
	if !utf8.ValidString(name) {
		return "", fmt.Errorf("条目名不是合法 UTF-8")
	}
	if strings.ContainsRune(name, 0) {
		return "", fmt.Errorf("条目名含空字节")
	}
	// zip 规范里分隔符恒为 /，但见过用反斜杠的实现，统一掉再判断，
	// 否则 `..\..\x` 这种写法会从下面的 ".." 检查底下溜过去
	name = strings.ReplaceAll(name, `\`, "/")

	if strings.HasPrefix(name, "/") {
		return "", fmt.Errorf("条目使用了绝对路径: %s", name)
	}
	for _, seg := range strings.Split(name, "/") {
		if seg == ".." {
			return "", fmt.Errorf("条目路径含上跳（..）: %s", name)
		}
	}

	cleaned := path.Clean("/" + name)
	rel := strings.TrimPrefix(cleaned, "/")
	if rel == "" || rel == "." {
		return "", fmt.Errorf("条目名为空")
	}

	dst := filepath.Join(root, filepath.FromSlash(rel))
	// 最后一重：结果必须严格在 root 之内
	if dst != root && !strings.HasPrefix(dst, root+string(os.PathSeparator)) {
		return "", fmt.Errorf("条目路径越界: %s", name)
	}
	return dst, nil
}

// pickEntryFile 在已剥前缀的文件名列表里挑入口文件。
//
// 找不到就报错，不猜、不兜底。一个没有入口的课件包解出来点开是空白，
// 老师只会归因成「这功能不好使」——与 REQ-057 静默截断同一类可惜。
func pickEntryFile(names []string) (string, error) {
	rootHTML := []string{}
	for _, n := range names {
		if n == "index.html" || n == "index.htm" {
			return n, nil
		}
		if !strings.Contains(n, "/") {
			low := strings.ToLower(n)
			if strings.HasSuffix(low, ".html") || strings.HasSuffix(low, ".htm") {
				rootHTML = append(rootHTML, n)
			}
		}
	}
	if len(rootHTML) == 1 {
		return rootHTML[0], nil
	}
	if len(rootHTML) > 1 {
		return "", fmt.Errorf("压缩包根目录有 %d 个 html 文件且没有 index.html，无法确定入口，请把主页面命名为 index.html", len(rootHTML))
	}
	return "", fmt.Errorf("压缩包里找不到 index.html，请确认这是一份网页课件")
}

// ExtractZip 把 zip 解压到 destRoot，返回摘要。
// 失败时由调用方负责清理 destRoot（本函数不删，避免误删调用方传错的目录）。
func ExtractZip(zr *zip.Reader, destRoot string) (*ExtractResult, error) {
	if len(zr.File) > CoursewareMaxEntries {
		return nil, fmt.Errorf("压缩包内条目 %d 个，超过 %d 个上限", len(zr.File), CoursewareMaxEntries)
	}

	// ── 第一遍：筛出有效文件条目，算公共前缀 ──
	type item struct {
		f    *zip.File
		name string // 规范化后的名字（未剥前缀）
	}
	var items []item
	skipped := 0
	for _, f := range zr.File {
		name := strings.ReplaceAll(f.Name, `\`, "/")
		if strings.HasSuffix(name, "/") {
			continue // 目录条目，靠文件路径自动建即可
		}
		if isJunkEntry(name) {
			skipped++
			continue
		}
		// 符号链接条目：解压出来可能指向任意位置，直接拒
		if f.Mode()&os.ModeSymlink != 0 {
			return nil, fmt.Errorf("压缩包含符号链接条目（%s），出于安全考虑拒绝导入", name)
		}
		items = append(items, item{f: f, name: name})
	}
	if len(items) == 0 {
		return nil, fmt.Errorf("压缩包里没有任何有效文件")
	}

	allNames := make([]string, 0, len(items))
	for _, it := range items {
		allNames = append(allNames, it.name)
	}
	stripped := commonTopDir(allNames)

	// ── 第二遍：真正解压，边解边累计字节 ──
	remaining := int64(CoursewareMaxTotalBytes)
	var total int64
	relNames := make([]string, 0, len(items))

	for _, it := range items {
		rel := it.name
		if stripped != "" {
			rel = strings.TrimPrefix(rel, stripped+"/")
			if rel == "" {
				continue
			}
		}

		dst, err := safeJoin(destRoot, rel)
		if err != nil {
			return nil, fmt.Errorf("拒绝导入：%w", err)
		}
		if err := os.MkdirAll(filepath.Dir(dst), 0o755); err != nil {
			return nil, fmt.Errorf("建目录失败: %w", err)
		}

		rc, err := it.f.Open()
		if err != nil {
			return nil, fmt.Errorf("读取压缩包条目 %s 失败: %w", rel, err)
		}
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			rc.Close()
			return nil, fmt.Errorf("写入文件失败: %w", err)
		}

		// 关键：用 LimitReader 卡真实写入量，**不信 header 声明的 UncompressedSize64**
		// （那是压缩包里的一个字段，攻击者可以随便填）。多读 1 字节用于判定是否超限。
		n, cErr := io.Copy(out, io.LimitReader(rc, remaining+1))
		out.Close()
		rc.Close()
		if cErr != nil {
			return nil, fmt.Errorf("解压 %s 失败: %w", rel, cErr)
		}
		if n > remaining {
			return nil, fmt.Errorf("解压后总体积超过 %dMB 上限", CoursewareMaxTotalBytes>>20)
		}
		remaining -= n
		total += n
		relNames = append(relNames, filepath.ToSlash(rel))
	}

	entry, err := pickEntryFile(relNames)
	if err != nil {
		return nil, err
	}

	return &ExtractResult{
		EntryFile:  entry,
		FileCount:  len(relNames),
		TotalBytes: total,
		Stripped:   stripped,
		SkippedN:   skipped,
	}, nil
}

// ── 数据库部分 ──────────────────────────────────────────────────────────

// CreatePackage 先插一行拿到 id（id 同时用作磁盘目录名），再由调用方解压。
func (s *CoursewareService) CreatePackage(teacherID, roomID, title, originalName string) (string, error) {
	var rid interface{}
	if roomID != "" {
		rid = roomID
	}
	var id string
	err := s.db.QueryRow(
		`INSERT INTO courseware_packages (teacher_id, room_id, title, original_name, storage_dir)
		 VALUES ($1, $2, $3, $4, '')
		 RETURNING id`,
		teacherID, rid, title, originalName,
	).Scan(&id)
	if err != nil {
		return "", fmt.Errorf("创建课件记录失败: %w", err)
	}
	// storage_dir 就是 id；单独 UPDATE 一次是为了让「目录名从哪来」在数据里显式可见，
	// 而不是隐含在代码约定里（将来换布局时不必翻代码）
	if _, err := s.db.Exec(
		`UPDATE courseware_packages SET storage_dir = $1 WHERE id = $1`, id,
	); err != nil {
		return "", fmt.Errorf("回写课件目录失败: %w", err)
	}
	return id, nil
}

// FinalizePackage 解压成功后回填摘要
func (s *CoursewareService) FinalizePackage(id, entryFile string, fileCount int, totalBytes int64) error {
	_, err := s.db.Exec(
		`UPDATE courseware_packages
		    SET entry_file = $2, file_count = $3, total_bytes = $4, updated_at = NOW()
		  WHERE id = $1`,
		id, entryFile, fileCount, totalBytes,
	)
	if err != nil {
		return fmt.Errorf("回填课件摘要失败: %w", err)
	}
	return nil
}

// DeletePackage 删库删盘，用于上传失败回滚。
// 盘删失败只记日志不阻断——库里没有记录的孤儿目录不会被任何人访问到，
// 比留一条指向空目录的记录（点开是坏的）危害小。
func (s *CoursewareService) DeletePackage(id string) {
	if _, err := s.db.Exec(`DELETE FROM courseware_packages WHERE id = $1`, id); err != nil {
		log.Printf("[Courseware] 回滚删记录失败 id=%s: %v", id, err)
	}
	dir := filepath.Join(CoursewareRoot, id)
	if err := os.RemoveAll(dir); err != nil {
		log.Printf("[Courseware] 回滚删目录失败 %s: %v", dir, err)
	}
}

// GetPackageByElement 按画布组件 id 找它挂的课件包。
// 无挂接返回 (nil, nil)——「这个组件是粘贴源码的」是正常情况，不是错误。
func (s *CoursewareService) GetPackageByElement(elementID string) (*CoursewarePackage, error) {
	var p CoursewarePackage
	err := s.db.QueryRow(
		`SELECT p.id, p.teacher_id, p.room_id, p.title, p.storage_dir, p.entry_file,
		        p.file_count, p.total_bytes
		   FROM html_widget_contents h
		   JOIN courseware_packages p ON p.id = h.courseware_id
		  WHERE h.element_id = $1`,
		elementID,
	).Scan(&p.ID, &p.TeacherID, &p.RoomID, &p.Title, &p.StorageDir, &p.EntryFile,
		&p.FileCount, &p.TotalBytes)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("查询课件包失败: %w", err)
	}
	return &p, nil
}

// BindToElement 把课件包挂到 html_widget 组件上。
// html 列显式置空串——同一个组件不该既有粘贴源码又有 zip 课件，
// 留着旧源码会让「这个组件到底渲染哪个」变成一道要看代码才知道的题。
func (s *CoursewareService) BindToElement(elementID, roomID, packageID string) error {
	_, err := s.db.Exec(
		`INSERT INTO html_widget_contents (element_id, room_id, html, byte_size, courseware_id, updated_at)
		 VALUES ($1, $2, '', 0, $3, NOW())
		 ON CONFLICT (element_id)
		 DO UPDATE SET html = '', byte_size = 0, courseware_id = EXCLUDED.courseware_id, updated_at = NOW()`,
		elementID, roomID, packageID,
	)
	if err != nil {
		return fmt.Errorf("挂接课件包失败: %w", err)
	}
	return nil
}
