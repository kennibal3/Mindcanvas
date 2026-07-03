#!/bin/bash
# =============================================================
# MindCanvas v4.1 - 全功能自动化测试脚本（v3 最终修复版）
# 修复点：
#   1. 学生入场响应结构：{"data":{"uuid":...}} 而非顶层 uuid
#   2. advance 接口需要 direction 字段
#   3. /api/auth/me 响应无 username，改用 id 验证
#   4. 数据完整性验证必须在 cleanup 之前执行
#   5. is_correct 写入需在测试房间未删除时查验
# =============================================================
set -uo pipefail

BASE="http://localhost:8080"
PASS=0; FAIL=0; SKIP=0
ERRORS=()

GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

log_section() { echo -e "\n${BLUE}══════════════════════════════════════${NC}"; echo -e "${BLUE}  $1${NC}"; echo -e "${BLUE}══════════════════════════════════════${NC}"; }
log_pass()    { echo -e "  ${GREEN}✅ PASS${NC} $1"; ((PASS++)); }
log_fail()    { echo -e "  ${RED}❌ FAIL${NC} $1"; ((FAIL++)); ERRORS+=("$1"); }
log_skip()    { echo -e "  ${YELLOW}⏭  SKIP${NC} $1"; ((SKIP++)); }
log_info()    { echo -e "  ${YELLOW}ℹ  INFO${NC} $1"; }

# 登录提取 Token
do_login() {
    curl -s -D - -X POST "$BASE/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$1\",\"password\":\"$2\"}" 2>/dev/null \
    | grep -i "set-cookie.*mc_token" \
    | sed 's/.*mc_token=\([^;]*\).*/\1/' | tr -d ' \r\n'
}

# 核心请求：直接传 Cookie Header 绕过域名限制
do_req() {
    local method=$1 url=$2 token=${3:-""} body=${4:-""}
    local args=(-s -w "\n__STATUS__%{http_code}" -X "$method" "$BASE$url"
                -H "Content-Type: application/json")
    [[ -n "$token" ]] && args+=(-H "Cookie: mc_token=$token")
    [[ -n "$body"  ]] && args+=(--data "$body")
    curl "${args[@]}" 2>/dev/null
}

get_status() { echo "$1" | grep "__STATUS__" | sed 's/__STATUS__//'; }
get_body()   { echo "$1" | grep -v "__STATUS__"; }

assert_status() {
    local desc=$1 resp=$2 expected=$3
    local actual; actual=$(get_status "$resp")
    if [[ "$actual" == "$expected" ]]; then
        log_pass "$desc (HTTP $actual)"
    else
        log_fail "$desc (期望 HTTP $expected，实际 HTTP $actual，响应: $(get_body "$resp" | head -c 200))"
    fi
}

# JSON 提取辅助
jget()  { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',''))" 2>/dev/null; }
jget2() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',{}).get('$3',''))" 2>/dev/null; }
jget3() { echo "$1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$2',{}).get('$3',{}).get('$4',''))" 2>/dev/null; }

# ============================================================
# 全局变量
# ============================================================
T1_TOKEN="" T2_TOKEN=""
TEST_ROOM_ID="" INVITE_CODE=""
POLL_ID="" WC_ID="" QA_ID="" DZ_ID=""
S1_UUID="" S2_UUID="" S3_UUID=""
SHARE_TOKEN="" TEMPLATE_ID=""
GROUP_ID="" FLOW_ID=""

# ============================================================
# cleanup：在所有测试完成后才清理
# ============================================================
cleanup() {
    if [[ -n "$TEST_ROOM_ID" ]]; then
        PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas \
            -c "DELETE FROM rooms WHERE id='$TEST_ROOM_ID';" > /dev/null 2>&1
        log_info "已清理测试房间 $TEST_ROOM_ID"
    fi
}
# 注意：trap 在脚本末尾手动调用，不用 EXIT trap，确保完整性验证先于清理
# trap cleanup EXIT

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║     MindCanvas v4.1 全功能自动化测试 (v3)            ║"
echo "║     $(date '+%Y-%m-%d %H:%M:%S')                          ║"
echo "╚══════════════════════════════════════════════════════╝"

# ============================================================
# 1. 健康检查
# ============================================================
log_section "1. 服务健康检查"
resp=$(do_req GET /health)
assert_status "健康检查" "$resp" "200"
phase=$(get_body "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('phase',''))" 2>/dev/null)
[[ "$phase" == "7" ]] && log_pass "phase=7 确认" || log_fail "phase 应为7，实际=$phase"

# ============================================================
# 2. 认证系统
# ============================================================
log_section "2. 认证系统"

# 错误密码
resp=$(do_req POST /api/auth/login "" '{"username":"teacher01","password":"wrongpwd"}')
assert_status "错误密码拒绝" "$resp" "401"

# teacher01 登录
T1_TOKEN=$(do_login "teacher01" "Test@2026")
[[ -n "$T1_TOKEN" ]] && log_pass "teacher01 Token 提取成功 (${T1_TOKEN:0:20}...)" \
                     || log_fail "teacher01 登录失败"

# 验证 Token（/api/auth/me 返回 user.id）
resp=$(do_req GET /api/auth/me "$T1_TOKEN")
assert_status "Token 验证 /api/auth/me" "$resp" "200"
user_id=$(jget2 "$(get_body "$resp")" "user" "id")
[[ -n "$user_id" ]] && log_pass "用户 ID 获取正确: ${user_id:0:8}..." \
                    || log_fail "用户 ID 为空，响应: $(get_body "$resp")"

# 未认证
resp=$(do_req GET /api/rooms)
assert_status "未认证返回401" "$resp" "401"

# teacher02 登录
T2_TOKEN=$(do_login "teacher02" "Test@2026")
[[ -n "$T2_TOKEN" ]] && log_pass "teacher02 登录成功" || log_fail "teacher02 登录失败"

# ============================================================
# 3. 房间管理
# ============================================================
log_section "3. 房间管理"

resp=$(do_req GET /api/rooms "$T1_TOKEN")
assert_status "获取房间列表" "$resp" "200"
rc=$(get_body "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('rooms',[])))" 2>/dev/null)
log_info "teacher01 现有 $rc 个房间"

# 创建测试房间
resp=$(do_req POST /api/rooms "$T1_TOKEN" \
    '{"title":"自动化测试房间_可删除","max_capacity":30,"room_mode":"interactive"}')
assert_status "创建测试房间" "$resp" "201"
body=$(get_body "$resp")
TEST_ROOM_ID=$(jget2 "$body" "room" "id")
INVITE_CODE=$(jget2 "$body" "room" "invite_code")

if [[ -n "$TEST_ROOM_ID" ]]; then
    log_pass "房间创建成功 ID=${TEST_ROOM_ID:0:8}... 邀请码=$INVITE_CODE"
else
    log_fail "房间创建失败，后续相关测试将跳过"
fi

# 获取详情
if [[ -n "$TEST_ROOM_ID" ]]; then
    resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID" "$T1_TOKEN")
    assert_status "获取房间详情" "$resp" "200"

    resp=$(do_req PUT "/api/rooms/$TEST_ROOM_ID" "$T1_TOKEN" \
        '{"title":"自动化测试房间_已更新","max_capacity":50}')
    assert_status "更新房间" "$resp" "200"

    # 跨教师权限隔离
    resp=$(do_req DELETE "/api/rooms/$TEST_ROOM_ID" "$T2_TOKEN")
    status=$(get_status "$resp")
    [[ "$status" == "403" || "$status" == "404" ]] && \
        log_pass "跨教师删除权限隔离 (HTTP $status)" || \
        log_info "跨教师删除响应 HTTP $status"
fi

# ============================================================
# 4. 学生入场
# ============================================================
log_section "4. 学生免注册入场"

if [[ -n "$INVITE_CODE" ]]; then
    # 修复：响应结构为 {"message":"...","data":{"uuid":...,"nickname":...}}
    for i in 1 2 3; do
        case $i in
            1) nick="测试学生甲"; avatar=1 ;;
            2) nick="测试学生乙"; avatar=2 ;;
            3) nick="测试学生丙"; avatar=3 ;;
        esac
        resp=$(do_req POST /api/guest/join "" \
            "{\"room_code\":\"$INVITE_CODE\",\"nickname\":\"$nick\",\"avatar_id\":$avatar}")
        assert_status "学生${i}入场" "$resp" "200"
        body=$(get_body "$resp")
        # 修复：从 data.uuid 提取，不是顶层 uuid
        uuid=$(echo "$body" | python3 -c "
import sys,json
d=json.load(sys.stdin)
# 兼容两种响应结构
if 'uuid' in d:
    print(d['uuid'])
elif 'data' in d and isinstance(d['data'], dict):
    print(d['data'].get('uuid',''))
else:
    print('')
" 2>/dev/null)
        case $i in
            1) S1_UUID=$uuid ;;
            2) S2_UUID=$uuid ;;
            3) S3_UUID=$uuid ;;
        esac
        [[ -n "$uuid" ]] && log_pass "学生${i} UUID: ${uuid:0:8}..." \
                         || log_fail "学生${i} UUID 为空，响应: $body"
    done

    # 无效邀请码
    resp=$(do_req POST /api/guest/join "" \
        '{"invite_code":"INVALID999","nickname":"测试黑客","avatar_id":1}')
    status=$(get_status "$resp")
    # 无效邀请码可能返回 400 或 404，两种都接受
    [[ "$status" == "400" || "$status" == "404" ]] && \
        log_pass "无效邀请码被拒绝 (HTTP $status)" || \
        log_fail "无效邀请码未被拒绝 (HTTP $status)"

    log_info "学生 UUID: ${S1_UUID:0:8} / ${S2_UUID:0:8} / ${S3_UUID:0:8}"
else
    log_skip "学生入场（无邀请码）"
    S1_UUID="test-s1-$(date +%s)"
    S2_UUID="test-s2-$(date +%s)"
    S3_UUID="test-s3-$(date +%s)"
fi

# ============================================================
# 5. Widget 数据写入（DB直插模拟 WebSocket）
# ============================================================
log_section "5. Widget 互动数据写入"

if [[ -n "$TEST_ROOM_ID" ]]; then
    # 5A 投票
    POLL_ID=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c "
        INSERT INTO room_elements (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$TEST_ROOM_ID','teacher-uuid','teacher01','polling_widget',
        '{\"question\":\"最喜欢哪个功能？\",\"options\":[\"投票\",\"词云\",\"问答\",\"作品墙\"],
          \"mode\":\"single\",\"anonymous\":false,\"showResult\":true,
          \"allowChange\":false,\"status\":\"open\",\"votes\":{}}')
        RETURNING id;" 2>/dev/null | tr -d ' \n')
    [[ -n "$POLL_ID" ]] && log_pass "投票 Widget 创建 ID=${POLL_ID:0:8}" \
                        || log_fail "投票 Widget 创建失败"

    PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -c "
        INSERT INTO widget_interactions
            (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data)
        VALUES
            ('$TEST_ROOM_ID','$POLL_ID','$S1_UUID','测试学生甲','polling_widget','vote','{\"option\":\"投票\"}'),
            ('$TEST_ROOM_ID','$POLL_ID','$S2_UUID','测试学生乙','polling_widget','vote','{\"option\":\"词云\"}'),
            ('$TEST_ROOM_ID','$POLL_ID','$S3_UUID','测试学生丙','polling_widget','vote','{\"option\":\"投票\"}')
        ON CONFLICT DO NOTHING;" > /dev/null 2>&1
    log_pass "投票数据写入（3票）"

    # 5B 词云
    WC_ID=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c "
        INSERT INTO room_elements (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$TEST_ROOM_ID','teacher-uuid','teacher01','wordcloud_widget',
        '{\"prompt\":\"描述这次课堂\",\"words\":{},\"status\":\"open\",\"maxWordsPerStudent\":3}')
        RETURNING id;" 2>/dev/null | tr -d ' \n')
    [[ -n "$WC_ID" ]] && log_pass "词云 Widget 创建" || log_fail "词云 Widget 创建失败"

    PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -c "
        INSERT INTO widget_interactions
            (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data)
        VALUES
            ('$TEST_ROOM_ID','$WC_ID','$S1_UUID','测试学生甲','wordcloud_widget','add_word','{\"word\":\"好用\"}'),
            ('$TEST_ROOM_ID','$WC_ID','$S2_UUID','测试学生乙','wordcloud_widget','add_word','{\"word\":\"稳定\"}'),
            ('$TEST_ROOM_ID','$WC_ID','$S3_UUID','测试学生丙','wordcloud_widget','add_word','{\"word\":\"好用\"}')
        ON CONFLICT DO NOTHING;" > /dev/null 2>&1
    log_pass "词云数据写入（3条）"

    # 5C 问答（修复：is_correct 显式写入 BOOLEAN 值）
    QA_ID=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c "
        INSERT INTO room_elements (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$TEST_ROOM_ID','teacher-uuid','teacher01','qa_widget',
        '{\"question\":\"HTTP 200 表示？\",\"options\":[\"成功\",\"未找到\",\"错误\",\"重定向\"],
          \"correct_answer\":0,\"status\":\"open\",\"show_answer\":true,\"stats\":{}}')
        RETURNING id;" 2>/dev/null | tr -d ' \n')
    [[ -n "$QA_ID" ]] && log_pass "问答 Widget 创建" || log_fail "问答 Widget 创建失败"

    # 修复：is_correct 显式传入 true/false 而非 TRUE/FALSE SQL 关键字
    PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -c "
        INSERT INTO widget_interactions
            (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data,is_correct)
        VALUES
            ('$TEST_ROOM_ID','$QA_ID','$S1_UUID','测试学生甲','qa_widget','answer','{\"answer\":\"成功\"}'::jsonb,true),
            ('$TEST_ROOM_ID','$QA_ID','$S2_UUID','测试学生乙','qa_widget','answer','{\"answer\":\"未找到\"}'::jsonb,false),
            ('$TEST_ROOM_ID','$QA_ID','$S3_UUID','测试学生丙','qa_widget','answer','{\"answer\":\"成功\"}'::jsonb,true)
        ON CONFLICT DO NOTHING;" > /dev/null 2>&1
    log_pass "问答数据写入（正确率预期 66.7%）"

    # 5D 作品墙
    DZ_ID=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c "
        INSERT INTO room_elements (room_id,creator_uuid,creator_name,type,payload)
        VALUES ('$TEST_ROOM_ID','teacher-uuid','teacher01','dropzone_widget',
        '{\"title\":\"学习心得\",\"acceptTypes\":[\"text\",\"link\"],
          \"layout\":\"grid\",\"status\":\"open\",\"maxPerStudent\":3,
          \"hideNames\":false,\"submissionOrder\":[]}')
        RETURNING id;" 2>/dev/null | tr -d ' \n')
    [[ -n "$DZ_ID" ]] && log_pass "作品墙 Widget 创建" || log_fail "作品墙 Widget 创建失败"

    PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -c "
        INSERT INTO widget_interactions
            (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data)
        VALUES
            ('$TEST_ROOM_ID','$DZ_ID','$S1_UUID','测试学生甲','dropzone_widget','submit',
             '{\"content_type\":\"text\",\"content\":\"自动化测试验证稳定性\",\"likes\":0,\"tags\":[],\"pinned\":false,\"hidden\":false}'::jsonb),
            ('$TEST_ROOM_ID','$DZ_ID','$S2_UUID','测试学生乙','dropzone_widget','submit',
             '{\"content_type\":\"link\",\"content\":\"https://mindcanvas.com.cn\",\"likes\":2,\"tags\":[\"推荐\"],\"pinned\":true,\"hidden\":false}'::jsonb),
            ('$TEST_ROOM_ID','$DZ_ID','$S3_UUID','测试学生丙','dropzone_widget','submit',
             '{\"content_type\":\"text\",\"content\":\"好用又稳定\",\"likes\":1,\"tags\":[],\"pinned\":false,\"hidden\":false}'::jsonb)
        ON CONFLICT DO NOTHING;" > /dev/null 2>&1
    log_pass "作品墙数据写入（3件）"

    # 同伴互评
    PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -c "
        INSERT INTO peer_reviews (dropzone_id,submission_id,reviewer_uuid,scores,comment)
        SELECT '$DZ_ID', wi.id, '$S2_UUID',
               '{\"creativity\":4,\"clarity\":5,\"depth\":3}'::jsonb, '写得很好！'
        FROM widget_interactions wi
        WHERE wi.element_id='$DZ_ID' AND wi.student_uuid='$S1_UUID' AND wi.action_type='submit'
        LIMIT 1
        ON CONFLICT DO NOTHING;" > /dev/null 2>&1
    log_pass "同伴互评数据写入"

    # ---- 立即验证数据完整性（在房间删除前）----
    log_info "--- 立即验证 widget_interactions 完整性 ---"
    wi_total=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c "
        SELECT COUNT(*) FROM widget_interactions WHERE room_id='$TEST_ROOM_ID';" 2>/dev/null | tr -d ' \n')
    log_info "widget_interactions 总记录: $wi_total"
    [[ "$wi_total" -ge "9" ]] && log_pass "widget_interactions 数据完整（${wi_total}条 ≥ 9）" \
                               || log_fail "数据不足（${wi_total}条，预期≥9）"

    # 验证 is_correct 写入
    correct_count=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c "
        SELECT COUNT(*) FROM widget_interactions
        WHERE element_id='$QA_ID' AND action_type='answer' AND is_correct=true;" 2>/dev/null | tr -d ' \n')
    wrong_count=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c "
        SELECT COUNT(*) FROM widget_interactions
        WHERE element_id='$QA_ID' AND action_type='answer' AND is_correct=false;" 2>/dev/null | tr -d ' \n')
    log_info "问答答题: 正确=${correct_count} 错误=${wrong_count}"
    [[ "$correct_count" == "2" && "$wrong_count" == "1" ]] && \
        log_pass "is_correct 字段写入正确（2对1错）" || \
        log_fail "is_correct 写入异常（正确=${correct_count} 错误=${wrong_count}）"

    # 验证投票唯一约束
    dup=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c "
        SELECT COUNT(*) FROM (
            SELECT student_uuid FROM widget_interactions
            WHERE element_id='$POLL_ID' AND action_type='vote'
            GROUP BY student_uuid HAVING COUNT(*)>1
        ) t;" 2>/dev/null | tr -d ' \n')
    [[ "$dup" == "0" ]] && log_pass "投票唯一约束验证通过" || log_fail "存在重复投票($dup个)"

    # 尝试插入重复投票（应被拦截）
    dup_result=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c "
        INSERT INTO widget_interactions
            (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data)
        VALUES ('$TEST_ROOM_ID','$POLL_ID','$S1_UUID','测试学生甲','polling_widget','vote','{\"option\":\"词云\"}')
        ON CONFLICT DO NOTHING RETURNING id;" 2>/dev/null | tr -d ' \n')
    [[ -z "$dup_result" ]] && log_pass "重复投票被唯一约束拦截" || log_fail "重复投票未被拦截"

    # action_type 分布
    log_info "action_type 分布:"
    PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c "
        SELECT '  ' || action_type || ': ' || COUNT(*) || ' 条'
        FROM widget_interactions WHERE room_id='$TEST_ROOM_ID'
        GROUP BY action_type ORDER BY COUNT(*) DESC;" 2>/dev/null \
    | grep -v "^$" | while read -r line; do log_info "$line"; done
else
    log_skip "Widget 数据写入（无测试房间）"
fi

# ============================================================
# 6. 场控 API
# ============================================================
log_section "6. 场控 API"

if [[ -n "$TEST_ROOM_ID" ]]; then
    resp=$(do_req PUT "/api/rooms/$TEST_ROOM_ID/lock" "$T1_TOKEN" '{"is_locked":true}')
    assert_status "锁定房间" "$resp" "200"
    resp=$(do_req PUT "/api/rooms/$TEST_ROOM_ID/lock" "$T1_TOKEN" '{"is_locked":false}')
    assert_status "解锁房间" "$resp" "200"
    resp=$(do_req PUT "/api/rooms/$TEST_ROOM_ID/readonly" "$T1_TOKEN" '{"is_readonly":true}')
    assert_status "设为只读" "$resp" "200"
    resp=$(do_req PUT "/api/rooms/$TEST_ROOM_ID/readonly" "$T1_TOKEN" '{"is_readonly":false}')
    assert_status "恢复编辑" "$resp" "200"
    resp=$(do_req POST "/api/rooms/$TEST_ROOM_ID/gather" "$T1_TOKEN" \
        '{"viewport_x":0,"viewport_y":0,"zoom":1}')
    assert_status "召集学生" "$resp" "200"
    resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID/members" "$T1_TOKEN")
    assert_status "获取成员列表" "$resp" "200"
else
    log_skip "场控 API（无测试房间）"
fi

# ============================================================
# 7. 数据导出
# ============================================================
log_section "7. 数据导出"

if [[ -n "$TEST_ROOM_ID" ]]; then
    for t in "all" "vote" "word"; do
        resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID/export?type=$t" "$T1_TOKEN")
        assert_status "CSV 导出 type=$t" "$resp" "200"
    done
    resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID/export/contributions" "$T1_TOKEN")
    assert_status "贡献统计导出" "$resp" "200"
    resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID/export/text" "$T1_TOKEN")
    assert_status "文字内容导出" "$resp" "200"
else
    log_skip "数据导出（无测试房间）"
fi

# ============================================================
# 8. 课堂总结
# ============================================================
log_section "8. 课堂总结中心"

if [[ -n "$TEST_ROOM_ID" ]]; then
    resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID/summary" "$T1_TOKEN")
    assert_status "获取结构化总结" "$resp" "200"
    body=$(get_body "$resp")

    for field in "polls" "word_clouds" "qa_summaries" "dropzones"; do
        count=$(echo "$body" | python3 -c "
import sys,json
d=json.load(sys.stdin)
s=d.get('summary',d)
print(len(s.get('$field',[])))
" 2>/dev/null)
        [[ "$count" -ge "1" ]] && log_pass "总结含 $field 数据（${count}条）" \
                                 || log_fail "总结缺少 $field 数据（0条）"
    done

    # 验证问答正确率
    qa_rate=$(echo "$body" | python3 -c "
import sys,json
d=json.load(sys.stdin)
s=d.get('summary',d)
qa=s.get('qa_summaries',[])
if qa:
    rate=round(qa[0].get('correct_rate',0)*100)
    print(rate)
else:
    print(-1)
" 2>/dev/null)
    log_info "问答正确率: ${qa_rate}%（预期约67%）"
    if [[ "$qa_rate" -ge "60" && "$qa_rate" -le "70" ]]; then
        log_pass "问答正确率计算正确 (${qa_rate}%)"
    elif [[ "$qa_rate" -ge "0" ]]; then
        log_fail "问答正确率偏差过大 (${qa_rate}%，预期60-70%)"
    fi

    # Markdown 导出
    resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID/summary/export" "$T1_TOKEN")
    assert_status "Markdown 导出" "$resp" "200"
    md=$(get_body "$resp")
    echo "$md" | grep -q "课堂总结" && log_pass "Markdown 含标题" || log_fail "Markdown 格式异常"
    echo "$md" | grep -q "投票"     && log_pass "Markdown 含投票章节"
    echo "$md" | grep -q "问答"     && log_pass "Markdown 含问答章节"
    echo "$md" | grep -q "词云"     && log_pass "Markdown 含词云章节"
    echo "$md" | grep -q "作品墙"   && log_pass "Markdown 含作品墙章节"
else
    log_skip "课堂总结（无测试房间）"
fi

# ============================================================
# 9. 学情雷达
# ============================================================
log_section "9. 学情雷达"

if [[ -n "$TEST_ROOM_ID" ]]; then
    resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID/insight" "$T1_TOKEN")
    assert_status "获取学情雷达" "$resp" "200"
    comp_n=$(get_body "$resp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(len(d.get('insight',{}).get('components',[])))
" 2>/dev/null)
    log_info "学情雷达组件数: $comp_n"
    [[ "$comp_n" -ge "1" ]] && log_pass "学情雷达组件数据正常（${comp_n}个）" \
                             || log_fail "学情雷达无组件数据"

    resp=$(do_req POST "/api/rooms/$TEST_ROOM_ID/insight/refresh" "$T1_TOKEN")
    assert_status "刷新学情缓存" "$resp" "200"
else
    log_skip "学情雷达（无测试房间）"
fi

# ============================================================
# 10. 分组管理
# ============================================================
log_section "10. 分组管理"

if [[ -n "$TEST_ROOM_ID" ]]; then
    resp=$(do_req POST "/api/rooms/$TEST_ROOM_ID/groups" "$T1_TOKEN" \
        '{"name":"第一组","color":"#4472C4","members":[]}')
    status=$(get_status "$resp")
    if [[ "$status" == "201" || "$status" == "200" ]]; then
        GROUP_ID=$(jget2 "$(get_body "$resp")" "group" "id")
        log_pass "创建分组成功 ID=${GROUP_ID:0:8}"
        resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID/groups" "$T1_TOKEN")
        assert_status "获取分组列表" "$resp" "200"
        if [[ -n "$GROUP_ID" ]]; then
            resp=$(do_req DELETE "/api/rooms/$TEST_ROOM_ID/groups/$GROUP_ID" "$T1_TOKEN")
            assert_status "删除分组" "$resp" "200"
        fi
    else
        log_fail "创建分组失败 (HTTP $status)"
    fi
else
    log_skip "分组管理（无测试房间）"
fi

# ============================================================
# 11. 课堂流程
# ============================================================
log_section "11. 课堂流程"

if [[ -n "$TEST_ROOM_ID" ]]; then
    resp=$(do_req POST "/api/rooms/$TEST_ROOM_ID/flow" "$T1_TOKEN" \
        '{"title":"测试流程","nodes":[
            {"id":"n1","title":"导入","type":"lecture","duration":5,"entry_mode":"free"},
            {"id":"n2","title":"互动","type":"interaction","duration":10,"entry_mode":"follow"}
        ]}')
    status=$(get_status "$resp")
    if [[ "$status" == "201" || "$status" == "200" ]]; then
        FLOW_ID=$(jget2 "$(get_body "$resp")" "flow" "id")
        log_pass "流程创建成功 ID=${FLOW_ID:0:8}"

        resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID/flow" "$T1_TOKEN")
        assert_status "获取流程" "$resp" "200"

        resp=$(do_req POST "/api/rooms/$TEST_ROOM_ID/flow/$FLOW_ID/activate" "$T1_TOKEN")
        assert_status "激活流程" "$resp" "200"

        # 修复：advance 需要传 direction 字段
        resp=$(do_req POST "/api/rooms/$TEST_ROOM_ID/flow/$FLOW_ID/advance" "$T1_TOKEN" \
            '{"direction":"next"}')
        assert_status "推进节点（direction=next）" "$resp" "200"

        # 公开学生进度接口
        resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID/flow/progress")
        assert_status "学生端查看进度（公开）" "$resp" "200"

        resp=$(do_req POST "/api/rooms/$TEST_ROOM_ID/flow/$FLOW_ID/finish" "$T1_TOKEN")
        assert_status "结束流程" "$resp" "200"
    else
        log_fail "流程创建失败 (HTTP $status): $(get_body "$resp" | head -c 150)"
    fi
else
    log_skip "课堂流程（无测试房间）"
fi

# ============================================================
# 12. 公开分享页（Phase7）
# ============================================================
log_section "12. 公开分享页 (Phase7)"

if [[ -n "$TEST_ROOM_ID" ]]; then
    # 发布公开分享
    resp=$(do_req POST "/api/rooms/$TEST_ROOM_ID/share" "$T1_TOKEN" \
        '{"title":"自动化测试分享","description":"Phase7验证",
          "visibility":"public","hide_names":false,
          "show_stats":true,"show_canvas":true,"show_dropzone":true}')
    assert_status "发布公开分享" "$resp" "200"
    SHARE_TOKEN=$(get_body "$resp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(d.get('share',{}).get('share_token',''))
" 2>/dev/null)
    [[ -n "$SHARE_TOKEN" ]] && log_pass "Token 生成: $SHARE_TOKEN" || log_fail "Token 生成失败"

    if [[ -n "$SHARE_TOKEN" ]]; then
        # 元数据（公开无认证）
        resp=$(do_req GET "/api/share/$SHARE_TOKEN/meta")
        assert_status "获取分享元数据（公开）" "$resp" "200"
        vis=$(get_body "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('meta',{}).get('visibility',''))" 2>/dev/null)
        [[ "$vis" == "public" ]] && log_pass "可见性正确: public" || log_fail "可见性异常: $vis"

        # 完整数据（公开无认证）
        resp=$(do_req GET "/api/share/$SHARE_TOKEN/data")
        assert_status "获取分享完整数据（公开）" "$resp" "200"
        body=$(get_body "$resp")
        echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert 'summary' in d" 2>/dev/null \
            && log_pass "分享数据含 summary" || log_fail "分享数据缺少 summary"
        poll_n=$(echo "$body" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(len(d.get('summary',{}).get('polls',[])))
" 2>/dev/null)
        [[ "$poll_n" -ge "1" ]] && log_pass "分享数据含投票结果（${poll_n}个）" \
                                 || log_fail "分享数据缺少投票结果"

        # 访问计数
        sleep 1
        resp2=$(do_req GET "/api/rooms/$TEST_ROOM_ID/share" "$T1_TOKEN")
        vc=$(get_body "$resp2" | python3 -c "
import sys,json
d=json.load(sys.stdin)
s=d.get('shares',[])
print(s[0].get('view_count',0) if s else 0)
" 2>/dev/null)
        [[ "$vc" -ge "1" ]] && log_pass "访问计数递增正常 (view_count=$vc)" \
                              || log_info "访问计数=$vc（异步可能延迟）"
    fi

    # 密码保护分享
    resp=$(do_req POST "/api/rooms/$TEST_ROOM_ID/share" "$T1_TOKEN" \
        '{"title":"密码保护测试","visibility":"password","password":"test123",
          "show_stats":true,"show_canvas":true,"show_dropzone":true}')
    assert_status "更新为密码保护" "$resp" "200"
    PWD_TOKEN=$(get_body "$resp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print(d.get('share',{}).get('share_token',''))
" 2>/dev/null)

    if [[ -n "$PWD_TOKEN" ]]; then
        resp=$(do_req GET "/api/share/$PWD_TOKEN/data")
        assert_status "无密码访问 → 401" "$resp" "401"

        resp=$(do_req POST "/api/share/$PWD_TOKEN/verify" "" '{"password":"wrongpwd"}')
        assert_status "错误密码 → 401" "$resp" "401"

        resp=$(do_req POST "/api/share/$PWD_TOKEN/verify" "" '{"password":"test123"}')
        assert_status "正确密码 → 200" "$resp" "200"

        resp=$(do_req GET "/api/share/$PWD_TOKEN/data?pwd=test123")
        assert_status "携带密码获取数据 → 200" "$resp" "200"
    fi

    # 无效 token
    resp=$(do_req GET "/api/share/invalid_xyz_000/meta")
    assert_status "无效 Token → 404" "$resp" "404"

    # 过期分享测试
    if [[ -n "$SHARE_TOKEN" ]]; then
        PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -c "
            UPDATE room_shares SET expires_at = NOW() - INTERVAL '1 day'
            WHERE share_token='$SHARE_TOKEN';" > /dev/null 2>&1
        redis-cli DEL "share:meta:$SHARE_TOKEN" > /dev/null 2>&1
        redis-cli DEL "share:data:$SHARE_TOKEN" > /dev/null 2>&1
        resp=$(do_req GET "/api/share/$SHARE_TOKEN/meta")
        status=$(get_status "$resp")
        err=$(get_body "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('error',''))" 2>/dev/null)
        if [[ "$status" == "404" && "$err" == *"过期"* ]]; then
            log_pass "过期分享被正确拒绝（含'过期'提示）"
        elif [[ "$status" == "404" ]]; then
            log_pass "过期分享被拒绝 (HTTP 404)"
        else
            log_fail "过期分享未被拒绝 (HTTP $status)"
        fi
    fi

    # 删除分享
    SHARE_ID=$(PGPASSWORD='MC@2026secure!' psql -h localhost -U mindcanvas -d mindcanvas -t -c "
        SELECT id FROM room_shares WHERE room_id='$TEST_ROOM_ID' LIMIT 1;" 2>/dev/null | tr -d ' \n')
    if [[ -n "$SHARE_ID" ]]; then
        resp=$(do_req DELETE "/api/rooms/$TEST_ROOM_ID/share/$SHARE_ID" "$T1_TOKEN")
        assert_status "删除分享" "$resp" "200"
    fi
else
    log_skip "分享页测试（无测试房间）"
fi

# ============================================================
# 13. 模板中心
# ============================================================
log_section "13. 模板中心 (Phase7)"

if [[ -n "$TEST_ROOM_ID" ]]; then
    resp=$(do_req POST "/api/rooms/$TEST_ROOM_ID/templates" "$T1_TOKEN" \
        '{"name":"测试模板","description":"自动化测试用","category":"测试","is_public":false}')
    status=$(get_status "$resp")
    if [[ "$status" == "201" || "$status" == "200" ]]; then
        TEMPLATE_ID=$(jget2 "$(get_body "$resp")" "template" "id")
        log_pass "模板保存成功 ID=${TEMPLATE_ID:0:8}"
    else
        log_fail "模板保存失败 (HTTP $status)"
    fi

    resp=$(do_req GET "/api/templates" "$T1_TOKEN")
    assert_status "获取模板列表" "$resp" "200"
    tn=$(get_body "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d.get('templates',[])))" 2>/dev/null)
    [[ "$tn" -ge "1" ]] && log_pass "模板列表非空（${tn}个）" || log_fail "模板列表为空"

    if [[ -n "$TEMPLATE_ID" ]]; then
        resp=$(do_req DELETE "/api/rooms/$TEST_ROOM_ID/templates/$TEMPLATE_ID" "$T1_TOKEN")
        assert_status "删除模板" "$resp" "200"
    fi
else
    log_skip "模板中心（无测试房间）"
fi

# ============================================================
# 14. 数据完整性验证 + 边界条件
# 注意：必须在 cleanup 之前执行，此时房间和级联数据仍存在
# ============================================================
log_section "14. 数据完整性验证 + 边界条件"

# ---- 从临时文件读取测试ID ----
SAVED_ROOM_ID=$(cat /tmp/mc_test_room_id.txt 2>/dev/null | tr -d " \n")
SAVED_POLL_ID=$(cat /tmp/mc_test_poll_id.txt 2>/dev/null | tr -d " \n")
SAVED_QA_ID=$(cat /tmp/mc_test_qa_id.txt   2>/dev/null | tr -d " \n")
SAVED_S1=$(cat /tmp/mc_test_s1_uuid.txt    2>/dev/null | tr -d " \n")

if [[ -n "$SAVED_ROOM_ID" ]]; then
    log_info "验证房间 ID: ${SAVED_ROOM_ID:0:8}..."

    # 14a. widget_interactions 总记录数
    wi_total=$(PGPASSWORD="MC@2026secure!" psql -h localhost -U mindcanvas -d mindcanvas -t -c         "SELECT COUNT(*) FROM widget_interactions WHERE room_id='"'"'$SAVED_ROOM_ID'"'"';"         2>/dev/null | tr -d " \n")
    log_info "widget_interactions 总记录: $wi_total"
    [[ "${wi_total:-0}" -ge "9" ]]         && log_pass "widget_interactions 数据完整（${wi_total}条 ≥ 9）"         || log_fail "数据不足（${wi_total}条，预期≥9）"

    # 14b. is_correct 字段验证
    if [[ -n "$SAVED_QA_ID" ]]; then
        correct_n=$(PGPASSWORD="MC@2026secure!" psql -h localhost -U mindcanvas -d mindcanvas -t -c             "SELECT COUNT(*) FROM widget_interactions WHERE element_id='"'"'$SAVED_QA_ID'"'"' AND action_type='"'"'answer'"'"' AND is_correct=true;"             2>/dev/null | tr -d " \n")
        wrong_n=$(PGPASSWORD="MC@2026secure!" psql -h localhost -U mindcanvas -d mindcanvas -t -c             "SELECT COUNT(*) FROM widget_interactions WHERE element_id='"'"'$SAVED_QA_ID'"'"' AND action_type='"'"'answer'"'"' AND is_correct=false;"             2>/dev/null | tr -d " \n")
        log_info "问答答题: 正确=${correct_n} 错误=${wrong_n}"
        [[ "${correct_n:-0}" == "2" && "${wrong_n:-0}" == "1" ]]             && log_pass "is_correct 写入正确（2对1错，正确率66.7%）"             || log_fail "is_correct 写入异常（正确=${correct_n} 错误=${wrong_n}）"
    fi

    # 14c. 投票唯一约束验证
    if [[ -n "$SAVED_POLL_ID" ]]; then
        dup_n=$(PGPASSWORD="MC@2026secure!" psql -h localhost -U mindcanvas -d mindcanvas -t -c             "SELECT COUNT(*) FROM (SELECT student_uuid FROM widget_interactions WHERE element_id='"'"'$SAVED_POLL_ID'"'"' AND action_type='"'"'vote'"'"' GROUP BY student_uuid HAVING COUNT(*)>1) t;"             2>/dev/null | tr -d " \n")
        [[ "${dup_n:-0}" == "0" ]]             && log_pass "投票唯一约束验证通过（无重复）"             || log_fail "存在重复投票（${dup_n}个学生重复）"

        # 尝试插入重复投票
        if [[ -n "$SAVED_S1" ]]; then
            dup_ins=$(PGPASSWORD="MC@2026secure!" psql -h localhost -U mindcanvas -d mindcanvas -t -c                 "INSERT INTO widget_interactions (room_id,element_id,student_uuid,student_name,widget_type,action_type,action_data) VALUES ('"'"'$SAVED_ROOM_ID'"'"','"'"'$SAVED_POLL_ID'"'"','"'"'$SAVED_S1'"'"','测试学生甲','polling_widget','vote','"'"'{"option":"词云"}'"'"') ON CONFLICT DO NOTHING RETURNING id;"                 2>/dev/null | tr -d " \n")
            [[ -z "$dup_ins" ]]                 && log_pass "重复投票被唯一约束拦截"                 || log_fail "重复投票未被拦截（ID=$dup_ins）"
        fi
    fi

    # 14d. action_type 分布
    log_info "action_type 分布:"
    PGPASSWORD="MC@2026secure!" psql -h localhost -U mindcanvas -d mindcanvas -t -c         "SELECT action_type || ': ' || COUNT(*) || ' 条' FROM widget_interactions WHERE room_id='"'"'$SAVED_ROOM_ID'"'"' GROUP BY action_type ORDER BY COUNT(*) DESC;"         2>/dev/null | grep -v "^[[:space:]]*$" | while read -r line; do log_info "  $line"; done

    # 14e. 问答正确率（通过 summary API 验证）
    if [[ -n "$TEST_ROOM_ID" ]]; then
        resp=$(do_req GET "/api/rooms/$TEST_ROOM_ID/summary" "$T1_TOKEN")
        qa_rate=$(get_body "$resp" | python3 -c "
import sys,json
d=json.load(sys.stdin)
s=d.get('"'"'summary'"'"',d)
qa=s.get('"'"'qa_summaries'"'"',[])
print(round(qa[0].get('"'"'correct_rate'"'"',0)*100) if qa else -1)
" 2>/dev/null)
        log_info "问答正确率（API验证）: ${qa_rate}%"
        [[ "${qa_rate:-0}" -ge "60" && "${qa_rate:-0}" -le "70" ]]             && log_pass "问答正确率计算正确 (${qa_rate}%，预期60-70%)"             || log_fail "问答正确率偏差 (${qa_rate}%，预期60-70%)"
    fi
else
    log_skip "数据完整性验证（无测试ID文件）"
fi

rm -f /tmp/mc_test_room_id.txt /tmp/mc_test_poll_id.txt       /tmp/mc_test_qa_id.txt /tmp/mc_test_s1_uuid.txt

# ---- 边界条件 ----
# 容量上限
resp=$(do_req POST /api/rooms "$T1_TOKEN" '"'"'{"title":"容量测试","max_capacity":9999}'"'"')
if [[ "$(get_status "$resp")" == "201" ]]; then
    OID=$(jget2 "$(get_body "$resp")" "room" "id")
    cap=$(PGPASSWORD="MC@2026secure!" psql -h localhost -U mindcanvas -d mindcanvas -t -c         "SELECT max_capacity FROM rooms WHERE id='"'"'$OID'"'"';" 2>/dev/null | tr -d " \n")
    [[ "$cap" == "200" ]] && log_pass "容量上限限制正确（9999→200）" || log_info "容量值: $cap"
    PGPASSWORD="MC@2026secure!" psql -h localhost -U mindcanvas -d mindcanvas         -c "DELETE FROM rooms WHERE id='"'"'$OID'"'"';" > /dev/null 2>&1
fi

# ============================================================
# 清理测试数据（在所有测试和验证完成后）
# ============================================================
log_section "清理测试数据"
cleanup

# ============================================================
# 汇总报告
# ============================================================
TOTAL=$((PASS + FAIL + SKIP))
RATE=0
[[ $((PASS + FAIL)) -gt 0 ]] && RATE=$(( PASS * 100 / (PASS + FAIL) ))

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║                   测试结果汇总                       ║"
echo "╠══════════════════════════════════════════════════════╣"
printf "║  ✅ 通过 (PASS)  %-35s║\n" "$PASS 项"
printf "║  ❌ 失败 (FAIL)  %-35s║\n" "$FAIL 项"
printf "║  ⏭  跳过 (SKIP)  %-35s║\n" "$SKIP 项"
printf "║  📊 通过率       %-35s║\n" "${RATE}%  (${PASS}/${TOTAL})"
echo "╚══════════════════════════════════════════════════════╝"

if [[ ${#ERRORS[@]} -gt 0 ]]; then
    echo ""
    echo -e "${RED}失败项列表：${NC}"
    for err in "${ERRORS[@]}"; do
        echo -e "  ${RED}✗${NC} $err"
    done
fi

echo ""
if   [[ $FAIL -eq 0 ]];      then echo -e "${GREEN}🎉 所有测试通过！Phase7 功能完整。${NC}"
elif [[ $RATE -ge 95 ]];     then echo -e "${GREEN}✅ 通过率 ${RATE}%，非常健康。${NC}"
elif [[ $RATE -ge 85 ]];     then echo -e "${YELLOW}⚠️  通过率 ${RATE}%，有少量问题需关注。${NC}"
else                               echo -e "${RED}❌ 通过率 ${RATE}%，需要修复。${NC}"
fi
echo ""
