// =============================================================
// MindCanvas - PostgreSQL 数组类型辅助
// 封装 lib/pq Array 函数，供 room_handler.go 的分组操作使用
// =============================================================
package handlers

import "github.com/lib/pq"

// postgresArray 返回 pq.Array 包装
// 用于扫描（Scan）和插入（Exec）PostgreSQL TEXT[] 数组类型
func postgresArray(arr interface{}) interface{} {
	return pq.Array(arr)
}
