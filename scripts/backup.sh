#!/bin/bash
# ============================================================
# MindCanvas 数据备份脚本
# 备份内容:PostgreSQL 数据库 + 上传文件
# 保留策略:最近 7 天,超过自动删除
# ============================================================

# 任何一步失败立即终止,管道中任何命令失败也算失败
set -Eeuo pipefail

# ----- 配置区(将来要改就改这里) -----
BACKUP_ROOT="/var/backups/mindcanvas"
DB_BACKUP_DIR="${BACKUP_ROOT}/database"
UPLOADS_BACKUP_DIR="${BACKUP_ROOT}/uploads"
LOG_FILE="/var/log/mindcanvas/backup.log"

DB_NAME="mindcanvas"
DB_USER="mindcanvas"

UPLOADS_SRC="/opt/mindcanvas/uploads"

RETAIN_DAYS=7
# ----- 配置区结束 -----

# 当前时间戳,用于命名备份文件
TIMESTAMP=$(date '+%Y%m%d_%H%M%S')

# 日志函数:同时输出到屏幕和日志文件
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "${LOG_FILE}"
}

# 错误处理:任何步骤出错,记录并退出(非零退出码,crontab 会知道失败了)
trap 'log "❌ 备份失败,出错行号: $LINENO"; exit 1' ERR

log "========== 备份开始 =========="

# ---------- 1. 备份数据库 ----------
DB_BACKUP_FILE="${DB_BACKUP_DIR}/mindcanvas_${TIMESTAMP}.sql.gz"
log "📦 开始备份数据库 → ${DB_BACKUP_FILE}"

# pg_dump 导出 → gzip 压缩 → 落盘
# 密码从 ~/.pgpass 读,不写在脚本里(下一步会配置)
pg_dump -h localhost -U "${DB_USER}" -d "${DB_NAME}" --no-owner --no-acl \
    | gzip > "${DB_BACKUP_FILE}"

DB_SIZE=$(du -h "${DB_BACKUP_FILE}" | cut -f1)
log "✅ 数据库备份完成,大小: ${DB_SIZE}"

# ---------- 2. 备份上传文件 ----------
if [ -d "${UPLOADS_SRC}" ]; then
    UPLOADS_BACKUP_FILE="${UPLOADS_BACKUP_DIR}/uploads_${TIMESTAMP}.tar.gz"
    log "📦 开始备份上传文件 → ${UPLOADS_BACKUP_FILE}"
    
    # -C 切到父目录再打包,避免压缩包里带绝对路径
    tar -czf "${UPLOADS_BACKUP_FILE}" -C "$(dirname ${UPLOADS_SRC})" "$(basename ${UPLOADS_SRC})"
    
    UPLOADS_SIZE=$(du -h "${UPLOADS_BACKUP_FILE}" | cut -f1)
    log "✅ 上传文件备份完成,大小: ${UPLOADS_SIZE}"
else
    log "⚠️  上传目录不存在,跳过: ${UPLOADS_SRC}"
fi

# ---------- 3. 清理旧备份 ----------
log "🧹 清理 ${RETAIN_DAYS} 天前的旧备份"

# 数据库:删除 7 天前的 .sql.gz
DELETED_DB=$(find "${DB_BACKUP_DIR}" -name "mindcanvas_*.sql.gz" -type f -mtime +${RETAIN_DAYS} -print -delete | wc -l)
log "   数据库:删除 ${DELETED_DB} 个旧备份"

# 上传文件:删除 7 天前的 .tar.gz
DELETED_UP=$(find "${UPLOADS_BACKUP_DIR}" -name "uploads_*.tar.gz" -type f -mtime +${RETAIN_DAYS} -print -delete | wc -l)
log "   上传文件:删除 ${DELETED_UP} 个旧备份"

# ---------- 4. 完成 ----------
TOTAL_SIZE=$(du -sh "${BACKUP_ROOT}" | cut -f1)
log "✅ 备份全部完成,总占用: ${TOTAL_SIZE}"
log "========== 备份结束 =========="
echo ""

