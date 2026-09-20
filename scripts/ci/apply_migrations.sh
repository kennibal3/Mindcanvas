#!/usr/bin/env bash
# =============================================================
# REQ-054 方案 C：在一个「空库」上按编号顺序执行 configs/NNN_*.sql
#
# 这是 CI 此前完全没有的一项检查：迁移文件能否从零跑到最新。
# 生产库是一路增量演进来的，从没有人在空库上完整跑过一遍——
# 2026-09-20 第一次跑就发现 012_chat.sql 与 001 的约束冲突（见 seed_smoke.sql 顶部说明）。
#
# 用法（连接参数走标准 PG 环境变量）：
#   PGHOST=127.0.0.1 PGPORT=5432 PGUSER=mindcanvas PGPASSWORD=xxx PGDATABASE=mindcanvas \
#     bash scripts/ci/apply_migrations.sh
# 任何一个迁移失败都会立刻停下并指出是哪个文件（ON_ERROR_STOP）。
# =============================================================
set -Eeuo pipefail

cd "$(dirname "$0")/../.."

: "${PGHOST:?需要 PGHOST}" "${PGUSER:?需要 PGUSER}" "${PGDATABASE:?需要 PGDATABASE}"

run_sql() { psql -X -q -v ON_ERROR_STOP=1 -f "$1"; }

# C 排序：012_chat.sql 排在 012_groups_v2.sql 之前（两个 012 互不依赖，实测都能过）
mapfile -t files < <(printf '%s\n' configs/[0-9][0-9][0-9]_*.sql | LC_ALL=C sort)

if [ "${#files[@]}" -eq 0 ]; then
  echo "❌ 没找到任何迁移文件（configs/NNN_*.sql）" >&2
  exit 1
fi

for f in "${files[@]}"; do
  if ! run_sql "$f"; then
    echo "❌ 迁移失败：$f" >&2
    exit 1
  fi
  echo "ok  $f"
  # 001 建好 tenants/users 后立刻播种，原因见 seed_smoke.sql 顶部
  if [ "$(basename "$f")" = "001_init.sql" ]; then
    run_sql scripts/ci/seed_smoke.sql
    echo "ok  scripts/ci/seed_smoke.sql"
  fi
done

tables=$(psql -X -At -c "select count(*) from information_schema.tables where table_schema='public'")
echo "✅ ${#files[@]} 个迁移全部通过，public 下共 ${tables} 张表"
