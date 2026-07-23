// =============================================================
// MindCanvas REQ-045 P2 - 班级 / 花名册服务
// 归属校验一律走 SQL 的 WHERE（不只比变量名，避免 BUG-015 老坑）：
//   superadmin 放行；其余按 classes.teacher_id 归属。
//   班级是教师私有资源，admin 不越权看他人班级（如需租户级再放开）。
// =============================================================
package services

import (
	"database/sql"
	"fmt"
	"strings"

	"mindcanvas-server/models"
)

// ClassService 班级/花名册服务。
type ClassService struct {
	db *sql.DB
}

// NewClassService 构造。
func NewClassService(db *sql.DB) *ClassService {
	return &ClassService{db: db}
}

// checkClassOwned 校验班级归当前教师所有（superadmin 放行）。
func (s *ClassService) checkClassOwned(classID, teacherID, role string) error {
	if role == "superadmin" {
		var exists bool
		if err := s.db.QueryRow(`SELECT EXISTS(SELECT 1 FROM classes WHERE id=$1)`, classID).Scan(&exists); err != nil {
			return fmt.Errorf("查询班级失败: %w", err)
		}
		if !exists {
			return fmt.Errorf("班级不存在")
		}
		return nil
	}
	var owner string
	err := s.db.QueryRow(`SELECT teacher_id FROM classes WHERE id=$1`, classID).Scan(&owner)
	if err == sql.ErrNoRows {
		return fmt.Errorf("班级不存在或无权操作")
	}
	if err != nil {
		return fmt.Errorf("查询班级失败: %w", err)
	}
	if owner != teacherID {
		// 与"不存在"同措辞，防越权探测
		return fmt.Errorf("班级不存在或无权操作")
	}
	return nil
}

// CreateClass 建班。
func (s *ClassService) CreateClass(teacherID, tenantID, name string) (*models.Class, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("班级名称不能为空")
	}
	if len(name) > 100 {
		name = name[:100]
	}
	var c models.Class
	err := s.db.QueryRow(
		`INSERT INTO classes (teacher_id, tenant_id, name)
		 VALUES ($1, $2, $3)
		 RETURNING id, teacher_id, tenant_id, name, created_at`,
		teacherID, tenantID, name,
	).Scan(&c.ID, &c.TeacherID, &c.TenantID, &c.Name, &c.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("创建班级失败: %w", err)
	}
	return &c, nil
}

// ListClasses 列出当前教师名下班级（含学生数）。
func (s *ClassService) ListClasses(teacherID string) ([]models.Class, error) {
	rows, err := s.db.Query(
		`SELECT c.id, c.teacher_id, c.tenant_id, c.name, c.created_at,
		        COUNT(cs.id) AS student_count
		 FROM classes c
		 LEFT JOIN class_students cs ON cs.class_id = c.id
		 WHERE c.teacher_id = $1
		 GROUP BY c.id
		 ORDER BY c.created_at DESC`,
		teacherID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询班级失败: %w", err)
	}
	defer rows.Close()

	classes := make([]models.Class, 0) // 空返 [] 而非 null，防前端白屏
	for rows.Next() {
		var c models.Class
		if err := rows.Scan(&c.ID, &c.TeacherID, &c.TenantID, &c.Name, &c.CreatedAt, &c.StudentCount); err != nil {
			return nil, fmt.Errorf("扫描班级失败: %w", err)
		}
		classes = append(classes, c)
	}
	return classes, nil
}

// DeleteClass 删除班级（级联删花名册；先解绑关联房间避免 FK 阻塞）。
func (s *ClassService) DeleteClass(classID, teacherID, role string) error {
	if err := s.checkClassOwned(classID, teacherID, role); err != nil {
		return err
	}
	// rooms.class_id 无 ON DELETE 级联，先解绑再删更友好
	if _, err := s.db.Exec(`UPDATE rooms SET class_id=NULL WHERE class_id=$1`, classID); err != nil {
		return fmt.Errorf("解绑关联房间失败: %w", err)
	}
	if _, err := s.db.Exec(`DELETE FROM classes WHERE id=$1`, classID); err != nil {
		return fmt.Errorf("删除班级失败: %w", err)
	}
	return nil
}

// ListStudents 列出班级花名册。
func (s *ClassService) ListStudents(classID, teacherID, role string) ([]models.ClassStudent, error) {
	if err := s.checkClassOwned(classID, teacherID, role); err != nil {
		return nil, err
	}
	rows, err := s.db.Query(
		`SELECT id, class_id, student_name, disambig, created_at
		 FROM class_students WHERE class_id=$1
		 ORDER BY student_name, disambig`,
		classID,
	)
	if err != nil {
		return nil, fmt.Errorf("查询花名册失败: %w", err)
	}
	defer rows.Close()

	students := make([]models.ClassStudent, 0)
	for rows.Next() {
		var st models.ClassStudent
		if err := rows.Scan(&st.ID, &st.ClassID, &st.StudentName, &st.Disambig, &st.CreatedAt); err != nil {
			return nil, fmt.Errorf("扫描学生失败: %w", err)
		}
		students = append(students, st)
	}
	return students, nil
}

// ImportStudents 粘一列名字批量插；同名同消歧重复则跳过。返回 inserted/skipped。
func (s *ClassService) ImportStudents(classID, teacherID, role string, names []string) (inserted, skipped int, err error) {
	if err = s.checkClassOwned(classID, teacherID, role); err != nil {
		return 0, 0, err
	}
	for _, raw := range names {
		name := strings.TrimSpace(raw)
		if name == "" {
			continue
		}
		disambig := ""
		// 单行带消歧：名字|消歧 / 名字,消歧 / 名字，消歧 / 名字<Tab>消歧
		for _, sep := range []string{"|", ",", "，", "\t"} {
			if i := strings.Index(name, sep); i >= 0 {
				disambig = strings.TrimSpace(name[i+len(sep):])
				name = strings.TrimSpace(name[:i])
				break
			}
		}
		if name == "" {
			continue
		}
		if len([]rune(name)) > 100 {
			name = string([]rune(name)[:100])
		}
		if len([]rune(disambig)) > 20 {
			disambig = string([]rune(disambig)[:20])
		}
		res, e := s.db.Exec(
			`INSERT INTO class_students (class_id, student_name, disambig)
			 VALUES ($1, $2, $3)
			 ON CONFLICT (class_id, student_name, disambig) DO NOTHING`,
			classID, name, disambig,
		)
		if e != nil {
			return inserted, skipped, fmt.Errorf("导入学生失败: %w", e)
		}
		if n, _ := res.RowsAffected(); n > 0 {
			inserted++
		} else {
			skipped++
		}
	}
	return inserted, skipped, nil
}

// AddStudent 单个添加（重名需填消歧，否则命中唯一约束报错）。
func (s *ClassService) AddStudent(classID, teacherID, role, name, disambig string) (*models.ClassStudent, error) {
	if err := s.checkClassOwned(classID, teacherID, role); err != nil {
		return nil, err
	}
	name = strings.TrimSpace(name)
	disambig = strings.TrimSpace(disambig)
	if name == "" {
		return nil, fmt.Errorf("学生姓名不能为空")
	}
	var st models.ClassStudent
	err := s.db.QueryRow(
		`INSERT INTO class_students (class_id, student_name, disambig)
		 VALUES ($1, $2, $3)
		 RETURNING id, class_id, student_name, disambig, created_at`,
		classID, name, disambig,
	).Scan(&st.ID, &st.ClassID, &st.StudentName, &st.Disambig, &st.CreatedAt)
	if err != nil {
		return nil, fmt.Errorf("添加学生失败（同名请填写消歧后重试）: %w", err)
	}
	return &st, nil
}

// DeleteStudent 删除单个花名册成员。
func (s *ClassService) DeleteStudent(classID, studentID, teacherID, role string) error {
	if err := s.checkClassOwned(classID, teacherID, role); err != nil {
		return err
	}
	res, err := s.db.Exec(`DELETE FROM class_students WHERE id=$1 AND class_id=$2`, studentID, classID)
	if err != nil {
		return fmt.Errorf("删除学生失败: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("学生不存在")
	}
	return nil
}
