// =============================================================
// MindCanvas REQ-045 P2 - 班级 / 花名册模型
// classes         老师建一次的班级，开 roster 房间时选。
// class_students  花名册成员＝稳定学生实体，其 id ＝稳定 student_id。
// =============================================================
package models

import "time"

// Class 班级实体。
type Class struct {
	ID           string    `json:"id"`
	TeacherID    string    `json:"teacher_id"`
	TenantID     string    `json:"tenant_id"`
	Name         string    `json:"name"`
	CreatedAt    time.Time `json:"created_at"`
	StudentCount int       `json:"student_count"` // 列表时聚合；详情接口可为 0
}

// ClassStudent 花名册成员（id ＝稳定 student_id）。
type ClassStudent struct {
	ID          string    `json:"id"`
	ClassID     string    `json:"class_id"`
	StudentName string    `json:"student_name"`
	Disambig    string    `json:"disambig"` // 重名消歧：学号后两位/老师备注
	CreatedAt   time.Time `json:"created_at"`
}

// CreateClassRequest 建班请求。
type CreateClassRequest struct {
	Name string `json:"name" binding:"required"`
}

// ImportStudentsRequest 粘一列名字批量导入；每项一个名字，
// 可写 "名字|消歧" / "名字,消歧" 单行带消歧（也支持中文逗号、制表符）。
type ImportStudentsRequest struct {
	Names []string `json:"names" binding:"required"`
}

// AddStudentRequest 单个添加（重名时需填消歧）。
type AddStudentRequest struct {
	StudentName string `json:"student_name" binding:"required"`
	Disambig    string `json:"disambig"`
}
