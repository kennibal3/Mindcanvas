#!/bin/bash
# ============================================================
# MindCanvas 数据备份脚本
# 备份内容:PostgreSQL 数据库 + 上传文件
# 保留策略:最近 7 天,超过自动删除；每周日额外归档一份,留存 90 天(REQ-053)
# 异地副本:加密后 scp 到异地机器(REQ-053,默认关闭,启用步骤见下方配置区)
# ============================================================

# 任何一步失败立即终止,管道中任何命令失败也算失败
set -Eeuo pipefail

# ----- 配置区(将来要改就改这里) -----
BACKUP_ROOT="/var/backups/mindcanvas"
DB_BACKUP_DIR="${BACKUP_ROOT}/database"
UPLOADS_BACKUP_DIR="${BACKUP_ROOT}/uploads"
WEEKLY_DB_DIR="${BACKUP_ROOT}/weekly/database"
WEEKLY_UPLOADS_DIR="${BACKUP_ROOT}/weekly/uploads"
LOG_FILE="/var/log/mindcanvas/backup.log"

DB_NAME="mindcanvas"
DB_USER="mindcanvas"

UPLOADS_SRC="/opt/mindcanvas/uploads"

RETAIN_DAYS=7
WEEKLY_RETAIN_DAYS=90   # 每周日归档的留存天数(REQ-053 范围条目 b)

# ----- 异地副本配置(REQ-053 范围条目 a+c,默认关闭) -----
# 启用前必须先完成三步,否则不要把 OFFSITE_ENABLE 改成 true:
#   1) 服务器上 `ssh-keygen -t ed25519`(没有免密钥对才做)生成一对,把公钥加进
#      异地目标机器(如你的 Mac)的 ~/.ssh/authorized_keys;
#   2) 服务器上手工跑一次 `ssh -p <端口> <OFFSITE_USER>@<OFFSITE_HOST> exit`
#      确认免密码能连通;
#   3) 生成加密密钥文件并锁权限(值见 运维凭证_机密_请勿外发.md「备份加密密钥」):
#        echo '<运维凭证文档里的值>' > /etc/mindcanvas/backup.key && chmod 600 /etc/mindcanvas/backup.key
# 三步都做完、且异地目标机器长期在线可达,再把下面五项填好并把 OFFSITE_ENABLE 改成 true。
# 注意:如果异地目标是笔记本电脑(动态 IP/会睡眠),从服务器主动 scp 过去大概率连不上——
# 更稳的做法是反过来,在那台机器上用 launchd/cron 定时主动 ssh 到服务器公网 IP 拉取,
# 参见 MindCanvas_灾备预案.md「异地副本」一节。
OFFSITE_ENABLE=false
OFFSITE_HOST=""          # 异地目标机器地址
OFFSITE_USER=""          # 登录用户名
OFFSITE_PORT=22
OFFSITE_PATH=""          # 目标机器上已存在的接收目录(需提前手工创建好)
ENC_KEY_FILE="/etc/mindcanvas/backup.key"

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
UPLOADS_BACKUP_FILE=""
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

# ---------- 3. 清理旧备份(7 天,与此前行为完全一致,未改动) ----------
log "🧹 清理 ${RETAIN_DAYS} 天前的旧备份"

# 数据库:删除 7 天前的 .sql.gz
DELETED_DB=$(find "${DB_BACKUP_DIR}" -name "mindcanvas_*.sql.gz" -type f -mtime +${RETAIN_DAYS} -print -delete | wc -l)
log "   数据库:删除 ${DELETED_DB} 个旧备份"

# 上传文件:删除 7 天前的 .tar.gz
DELETED_UP=$(find "${UPLOADS_BACKUP_DIR}" -name "uploads_*.tar.gz" -type f -mtime +${RETAIN_DAYS} -print -delete | wc -l)
log "   上传文件:删除 ${DELETED_UP} 个旧备份"

# ---------- 3.5 周归档,留存 90 天(REQ-053 范围条目 b) ----------
# 与步骤 3 相互独立:步骤 3 该删still删,这里只是在归档目录里多留一份周日的副本,
# 归档目录有自己单独的 90 天清理,互不影响。
mkdir -p "${WEEKLY_DB_DIR}" "${WEEKLY_UPLOADS_DIR}"

if [ "$(date '+%u')" = "7" ]; then
    log "📅 今天是周日,归档一份到长留存目录(留 ${WEEKLY_RETAIN_DAYS} 天): ${WEEKLY_DB_DIR}"
    if cp "${DB_BACKUP_FILE}" "${WEEKLY_DB_DIR}/"; then
        log "✅ 周归档(数据库)完成"
    else
        log "⚠️ 周归档(数据库)失败,不影响本次日常备份"
    fi
    if [ -n "${UPLOADS_BACKUP_FILE}" ]; then
        if cp "${UPLOADS_BACKUP_FILE}" "${WEEKLY_UPLOADS_DIR}/"; then
            log "✅ 周归档(上传文件)完成"
        else
            log "⚠️ 周归档(上传文件)失败,不影响本次日常备份"
        fi
    fi
fi

# 清理超过 90 天的周归档
find "${WEEKLY_DB_DIR}" -name "mindcanvas_*.sql.gz" -type f -mtime +${WEEKLY_RETAIN_DAYS} -delete
find "${WEEKLY_UPLOADS_DIR}" -name "uploads_*.tar.gz" -type f -mtime +${WEEKLY_RETAIN_DAYS} -delete

# ---------- 4. 本地部分完成 ----------
TOTAL_SIZE=$(du -sh "${BACKUP_ROOT}" | cut -f1)
log "✅ 本地备份全部完成,总占用: ${TOTAL_SIZE}"

# ---------- 5. 异地副本:加密后 scp(REQ-053 范围条目 a+c,默认关闭) ----------
# 失败不算本次备份失败——本地备份已经落盘是主保障,异地只是第二道保险;
# 失败会写进日志,但目前没有主动告警(REQ-055 可观测性未做),需要人工定期看日志。
if [ "${OFFSITE_ENABLE}" = "true" ]; then
    if [ ! -f "${ENC_KEY_FILE}" ]; then
        log "⚠️ 异地副本已启用但找不到加密密钥文件 ${ENC_KEY_FILE},跳过本次异地副本"
    else
        offsite_send() {
            local src="$1"
            local enc="${src}.enc"
            openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt \
                -in "${src}" -out "${enc}" -pass file:"${ENC_KEY_FILE}" \
                && scp -P "${OFFSITE_PORT}" -o ConnectTimeout=10 -o BatchMode=yes \
                    "${enc}" "${OFFSITE_USER}@${OFFSITE_HOST}:${OFFSITE_PATH}/"
            local rc=$?
            rm -f "${enc}"
            return ${rc}
        }
        if offsite_send "${DB_BACKUP_FILE}"; then
            log "✅ 异地副本(数据库,已加密)已传输"
        else
            log "⚠️ 异地副本(数据库)传输失败,本地备份不受影响;请检查异地机器是否在线: ${OFFSITE_HOST}"
        fi
        if [ -n "${UPLOADS_BACKUP_FILE}" ]; then
            if offsite_send "${UPLOADS_BACKUP_FILE}"; then
                log "✅ 异地副本(上传文件,已加密)已传输"
            else
                log "⚠️ 异地副本(上传文件)传输失败,本地备份不受影响;请检查异地机器是否在线: ${OFFSITE_HOST}"
            fi
        fi
    fi
else
    log "ℹ️ 异地副本未启用(OFFSITE_ENABLE=false),仅本地备份。启用步骤见脚本顶部配置区注释"
fi

log "========== 备份结束 =========="
echo ""
