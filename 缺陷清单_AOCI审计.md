# MindCanvas 全仓缺陷清单

来源：AOCI-CODE 认知索引构建过程中对 `代码_mindcanvas` 全部 223 个源文件的逐文件阅读（2026-09，索引已对齐 223/223）。
所有条目均有源码依据，已写进 `aoci.code.txt` 对应文件的 S 字段。

---

## 一、会直接影响上课的功能缺陷

### 1. 一人投票，全班变成「已投票」
- 位置：`web/src/hooks/useWebSocket.ts` 的 `widget_update` 分支 + `web/src/components/widgets/PollingWidget.tsx`
- 服务端 `ws_handler.go` 用 `room.BroadcastRaw` 把 `widget_update` 广播给全房，消息里带 `from`；但 `useWebSocket` 不看 `from`，无条件给所有客户端派发 `ws_widget_vote_result{confirmed:true}`，`PollingWidget` 的监听器收到即 `markSubmitted(id)`。
- 后果：任意一人投完票，房间里其他学生的投票组件全部切到「已提交」，再也投不了。
- 修法：派发前比对 `msg.from` 与本人 uuid。

### 2. 模板中心「删除模板」按钮必然失败
- 位置：`web/src/pages/DashboardPage.tsx` `handleDeleteTemplate`
- 前端打 `DELETE /api/templates/{id}`；`server/main.go` 的 `/api/templates` 组只注册了 `GET ""` 与 `POST /:id/use`，删除路由在 `/api/rooms/:id/templates/:tid`。
- 后果：404，前端只弹「删除失败」。

### 3. 协作墙学生留言全部显示「匿名」
- 位置：`web/src/components/canvas/FloatingWidgets.tsx` 渲染 `ShelfWidget` 处
- 传了 `elementId/roomId/payload/isTeacher/studentUUID/onUpdate/onDelete`，唯独漏传 `studentName`，每条回复以空 `author_name` 入库。

### 4. 学生端房间标题恒为「课堂」
- 位置：`web/src/pages/RoomPage.tsx` 学生分支
- 不请求房间接口，本地伪造 room 对象，`title` 读 `localStorage.getItem('mc_room_title')`，而全仓没有任何地方写过这个 key。锁定/只读也先给 `false`，真值要等 `room_sync`。

### 5. 学生改昵称/头像是纯本地的
- 位置：`web/src/pages/RoomPage.tsx` `EditProfileModal.handleSave`
- 只写 `localStorage` 再回调，不发接口也不走 WebSocket。学生自己看到新名字，老师和同学看到的还是入场时那个。

### 6. 问答组件的提交确认方向与投票相反
- 位置：`web/src/components/widgets/QAWidget.tsx`
- 点击即本地 `markSubmitted`，不监听 `ws_widget_vote_result`。服务端 `widget_error` 拒绝后学生卡在「已提交」无法重试。
- 另：`selected` 只在内存，刷新后 `room_sync` 能补回「已提交」标记却补不回选了哪项，此时教师公布结果，该学生一律显示「回答错误」。

### 7. InsightPanel 前后端字段名全线对不上
- 位置：`web/src/components/teacher/InsightPanel.tsx` vs `server/services/insight_service.go`
- 组件读 `type` / 后端发 `widget_type`；读 `title/total_answers/correct_count/correct_rate` / 后端发 `question/total/correct/rate`；小组与 Top5 读 `action_count` / 后端发 `count`；未提交按扁平学生数组读而后端按组件分组。
- 因为处处 `??` 兜底所以不报错，只是正确率恒 0%、次数恒 0、姓名恒空。

### 8. ControlPanel 的「编辑流程」其实是创建模式
- 位置：`web/src/components/teacher/ControlPanel.tsx`
- `currentFlow` 只在保存回调里赋值，初始恒为 `null`，保存会走 `createFlow`，把房间原有流程一并归档成 finished。
- 另：`MemberList` 只收到 `members/onKick/kickLoading`，没传 `onGatherOne` 与 `onBan`，成员菜单里那两项永远不渲染。

### 9. 教师带 `?uuid=` 打开房间会被降权成学生
- 位置：`web/src/pages/RoomPage.tsx`，`isTeacher = !!user && !urlUuid`

---

## 二、安全与隐私

1. **AOCI_INDEX.md 与三个 test_phase*.sh 里有明文口令**：服务器 IP、数据库口令、superadmin/teacher 测试账号密码。这些文件当前在仓库里。建议移到 `.env` / CI secret 并把历史清掉。
2. **ChatPage 的 API Key 说明与实际不符**：弹窗写「仅存储在本地浏览器，不会上传到服务器」，但 key 存 `localStorage.victoria_api_key` 后每条消息都以 `api_key` 字段发给后端（`/api/chat/sessions/{id}/send`）。要么改文案，要么改成后端托管。
3. **管理后台创建用户的密码框是 `type="text"`**：明文显示在屏幕上（`AdminPage.tsx`）。
4. **SubmitPage 通用码靠 `localStorage.submit_uuid_{作业id}` 认人**：同一浏览器换个人提交会被当成同一个学生；清缓存则再也看不到反馈。

---

## 三、数据一致性与配置

1. **导出房间统计 CSV 不带筛选条件**：`AdminPage.exportRoomStatsCSV` 直接打 `/admin/room-stats/export`，超管筛了机构，导出的仍是全部。
2. **图片上传上限两套标准**：`useImageUpload` 卡 5MB + 四种 MIME；`DropZoneWidget.handleImageUpload` 绕开该 Hook 自己写死 10MB。
3. **`constants.ts` 里的限制常量全是摆设**：`FILE_LIMITS`、`IMAGE_MIMES`、`DOC_MIMES`、`REACTIONS`、`CANVAS_CONFIG`、`CONTROL_CONFIG`、`WS_BASE` 全仓零引用，各上传处各写各的上限。
4. **`tailwind.config.cjs` 扩展的 `primary` 是蓝色系**，与 `index.css` 暖木主题的 `--color-primary-*` 令牌同名不同色，且全仓无任何 `primary-` 类名在用。
5. **`index.css` 结尾的「护眼模式」分节注释下没有任何规则**，全仓也无对应类名——该功能并未实现。
6. **`createDefaultNode` 用 `crypto.randomUUID()`**（`types/flow.ts`）：非 HTTPS 的局域网访问下该 API 不存在，会直接抛错。

---

## 四、死代码（可直接删）

| 文件 | 行数 | 说明 |
|---|---|---|
| `web/src/hooks/useCanvasTransform.ts` | 125 | 零引用；覆盖层定位由 `CanvasEngine` 自己实现 |
| `web/src/registry/ModuleRegistry.ts` | 92 | 零引用、零注册，空跑骨架 |
| `web/src/types/card.ts` | 146 | 零 import，卡片组件各自内联定义结构 |
| `types/message.ts` 的 `MessageTypes` | — | 零引用，分发处一律写字符串字面量 |
| `types/canvas.ts` 的 `ViewportBounds` / `GatherViewport` | — | 零引用 |
| `tokenApi.ts` 的 `getStudentResult` / `importRosterJSON` | — | 零调用 |

---

## 五、健壮性

1. **WebSocket 重连超过 `WS_CONFIG.MAX_RETRY`（5 次）后置 `error` 并永久停止**，不再自动恢复；离线待发队列超 50 条静默丢弃。
2. **`ctrl_kick` 与两个权限开关用阻塞 `alert()`**，会卡住后续浏览器事件。
3. **`useAuth.checkAuth` 只要非 200 或抛异常就 `clearUser`**，网络抖动会被当成未登录。
4. **`roomStore.updateElement` 只在 `payload` 顶层浅合并**，嵌套对象整块替换；`removeElement` 直接从数组剔除而非置 `is_deleted`。
5. **`widgetStore` 无持久化**，刷新或断线重连后已提交状态全清，靠 `room_sync` 的 `my_submissions` / `my_word_submissions` 补回。

---

## 六、索引自身的遗留项

需要一次 `cognition_optimization` 维护通道处理（CLI：`aoci maintain --intent cognition_optimization`）：
- `scripts/backup.sh` 的 S 含演进叙述（「改为……原设计……」），应改写成描述当前状态。
- `lecture_handler.go` 的 R 有一处重复前缀 `code:code:`。
