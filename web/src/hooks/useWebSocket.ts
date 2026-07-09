// =============================================================
// MindCanvas v4.3 - WebSocket Hook
// REQ-009修复：ctrl_follow_mode dispatch ws_follow_mode 自定义事件
// REQ-003-FIX6：widget_update广播ws_widget_vote_result确认事件
// =============================================================
import { useRef, useCallback, useEffect } from 'react';
import { useRoomStore } from '@/store/roomStore';
import { useCanvasStore } from '@/store/canvasStore';
import { WS_CONFIG } from '@/utils/constants';
import type { WSMessage } from '@/types/message';

interface UseWebSocketOptions {
  roomId: string;
  uuid?: string;
  isTeacher?: boolean;
  onMessage?: (msg: WSMessage) => void;
}

interface UseWebSocketReturn {
  send: (type: string, payload: Record<string, any>) => void;
  disconnect: () => void;
}

export const useWebSocket = (options: UseWebSocketOptions): UseWebSocketReturn => {
  const { roomId, uuid, isTeacher = false, onMessage } = options;

  const ws              = useRef<WebSocket | null>(null);
  const retryCount      = useRef(0);
  const heartbeatTimer  = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const manualClose     = useRef(false);
  const onMessageRef    = useRef(onMessage);
  const pendingQueue    = useRef<string[]>([]);
  const connectRef       = useRef<() => void>(() => {});
  const handleMessageRef = useRef<(event: MessageEvent) => void>(() => {});

  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);

  const getStore = useCallback(() => useRoomStore.getState(), []);

  const startHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) clearInterval(heartbeatTimer.current);
    heartbeatTimer.current = setInterval(() => {
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(JSON.stringify({ type: 'ping' }));
      }
    }, WS_CONFIG.HEARTBEAT_INTERVAL);
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatTimer.current) {
      clearInterval(heartbeatTimer.current);
      heartbeatTimer.current = null;
    }
  }, []);

  const flushQueue = useCallback(() => {
    if (ws.current?.readyState !== WebSocket.OPEN) return;
    while (pendingQueue.current.length > 0) {
      const data = pendingQueue.current.shift();
      if (data) ws.current.send(data);
    }
  }, []);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      let msg: any;
      try { msg = JSON.parse(event.data); } catch { return; }

      const store = getStore();

      switch (msg.type) {

        case 'room_sync': {
          if (msg.elements) store.setElements(msg.elements);
          if (msg.excalidraw_scene) {
            window.dispatchEvent(new CustomEvent('excalidraw-remote-update', { detail: msg.excalidraw_scene }));
          }
          if (typeof msg.is_locked === 'boolean') store.setIsLocked(msg.is_locked);
          if (typeof msg.is_readonly === 'boolean') store.setIsReadOnly(msg.is_readonly);
          if (msg.members && Array.isArray(msg.members)) {
            store.setMembers(msg.members.map((m: any) => ({
              ...m,
              uuid: m.uuid || m.student_uuid || '',
              role: m.role || 'student',
            })));
          }
          if (msg.payload?.elements) store.setElements(msg.payload.elements);
          if (msg.payload?.excalidraw_scene) {
            window.dispatchEvent(new CustomEvent('excalidraw-remote-update', { detail: msg.payload.excalidraw_scene }));
          }
          if (msg.payload?.room) store.setCurrentRoom(msg.payload.room);
          // REQ-029：入场时携带当前场景容量，让场控面板一开始就能显示
          if (typeof msg.scene_size === 'number') {
            const warnBytes = msg.scene_size_warn ?? 0;
            const rejectBytes = msg.scene_size_reject ?? 0;
            window.dispatchEvent(new CustomEvent('ws_scene_size', {
              detail: {
                size: msg.scene_size,
                warnBytes,
                rejectBytes,
                status: msg.scene_size >= rejectBytes ? 'reject' : msg.scene_size >= warnBytes ? 'warn' : 'ok',
              },
            }));
          }
          break;
        }

        case 'scene_update': {
          const sceneData = msg.data || msg.payload;
          if (sceneData) {
            window.dispatchEvent(new CustomEvent('excalidraw-remote-update', { detail: sceneData }));
          }
          break;
        }

        case 'scene_restore': {
          const restoreData = msg.data || msg.payload;
          if (restoreData) {
            window.dispatchEvent(new CustomEvent('excalidraw-scene-restore', { detail: restoreData }));
          }
          break;
        }

        // REQ-029：场景容量提示，每次 scene_update 落地后服务端都会广播一次
        case 'scene_size_update': {
          window.dispatchEvent(new CustomEvent('ws_scene_size', {
            detail: {
              size: msg.size,
              warnBytes: msg.warn_bytes,
              rejectBytes: msg.reject_bytes,
              status: msg.status,
            },
          }));
          break;
        }

        case 'member_join': {
          const memberUuid      = msg.uuid || msg.payload?.uuid;
          const memberName      = msg.name || msg.payload?.name || msg.payload?.nickname || '匿名';
          const memberRole      = msg.role || msg.payload?.role || 'student';
          const memberAvatar    = msg.avatar_id ?? msg.payload?.avatar_id ?? 1;
          const memberAvatarUrl = msg.avatar_url || msg.payload?.avatar_url || '';
          if (memberUuid) {
            store.addMember({
              id:         memberUuid,
              uuid:       memberUuid,
              nickname:   memberName,
              suffix:     msg.suffix || msg.payload?.suffix || '',
              avatar_id:  memberAvatar,
              avatar_url: memberAvatarUrl,
              is_banned:  false,
              role:       memberRole,
              joined_at:  msg.joined_at || new Date().toISOString(),
            });
          }
          break;
        }

        case 'member_leave': {
          const leaveUuid = msg.uuid || msg.payload?.uuid;
          if (leaveUuid) {
            store.removeMember(leaveUuid);
            store.removeCursor(leaveUuid); // REQ-021：成员离开时清除光标
          }
          break;
        }

        case 'element_create': {
          const elemData = msg.data || msg.payload;
          if (elemData) {
            store.addElement({
              id:           elemData.id || '',
              room_id:      roomId,
              creator_uuid: elemData.creator_uuid || msg.from || '',
              creator_name: elemData.creator_name || '',
              type:         elemData.type || '',
              payload:      elemData.payload || elemData,
              is_deleted:   false,
              created_at:   new Date().toISOString(),
              updated_at:   new Date().toISOString(),
            });
          }
          break;
        }

        case 'element_update': {
          const updData = msg.data || msg.payload;
          if (updData?.id && updData?.payload) {
            store.updateElement(updData.id, updData.payload);
          }
          break;
        }

        case 'element_delete': {
          const delData = msg.data || msg.payload;
          if (delData?.id) store.removeElement(delData.id);
          break;
        }

        case 'widget_update': {
          const elemId        = msg.element_id || msg.payload?.element_id;
          const widgetPayload = msg.payload;
          if (elemId && widgetPayload) {
            store.updateElement(elemId, { payload: widgetPayload });
          }
          if (elemId) {
            window.dispatchEvent(new CustomEvent('ws_widget_vote_result', {
              detail: { element_id: elemId, confirmed: true, payload: widgetPayload },
            }));
          }
          break;
        }

        case 'widget_error': {
          const errorMsg  = msg.error || '提交失败';
          const errorElem = msg.element_id || '';
          window.dispatchEvent(new CustomEvent('ws_widget_vote_result', {
            detail: { element_id: errorElem, confirmed: false, error: errorMsg },
          }));
          console.warn('[Widget] 服务端拒绝提交:', errorMsg, 'element:', errorElem);
          break;
        }

        case 'dropzone_update': {
          if (msg.element_id && msg.payload) {
            store.updateElement(msg.element_id, msg.payload);
          }
          window.dispatchEvent(new CustomEvent('ws_dropzone_update', { detail: msg }));
          break;
        }

        case 'dropzone_error': {
          console.warn('[DropZone] server error:', msg.error);
          window.dispatchEvent(new CustomEvent('ws_dropzone_update', { detail: msg }));
          break;
        }

        case 'card_like': {
          const likeData   = msg.data || msg.payload;
          const likeElemId = likeData?.element_id;
          if (likeElemId) {
            const el = store.getElementById(likeElemId);
            if (el) store.updateElement(likeElemId, { likes: (el.payload?.likes || 0) + 1 });
          }
          break;
        }

        case 'ctrl_lockdown': {
          const locked = msg.is_locked ?? msg.payload?.is_locked;
          if (typeof locked === 'boolean') store.setIsLocked(locked);
          break;
        }

        case 'ctrl_readonly': {
          const readonly = msg.is_readonly ?? msg.payload?.is_readonly;
          if (typeof readonly === 'boolean') store.setIsReadOnly(readonly);
          break;
        }

        case 'ctrl_kick': {
          const reason = msg.reason || msg.payload?.reason || '';
          alert(`您已被移出房间：${reason}`);
          localStorage.removeItem('mc_uuid');
          window.location.href = '/join';
          return;
        }

        case 'ctrl_gather':
          // 由 RoomPage onMessage 处理
          break;

        // REQ-009修复：dispatch ws_follow_mode 自定义事件
        // RoomPage 中的 handleWSMessage 通过 onMessage 回调也会收到
        // 双重保险：自定义事件 + onMessage 回调都会触发学生端横幅
        case 'ctrl_follow_mode': {
          const enabled = msg.enabled ?? msg.data?.enabled ?? msg.payload?.enabled;
          useCanvasStore.getState().setFollowMode(!!enabled);
          window.dispatchEvent(new CustomEvent('ws_follow_mode', {
            detail: { enabled: !!enabled },
          }));
          break;
        }

        case 'cursor_move': {
          // REQ-021：收到其他用户光标位置，更新 store
          const fromUuid  = msg.from  || msg.sender_uuid || '';
          const nickname  = msg.nickname || '';
          const cursorD   = msg.data  || msg.payload || {};
          const cx        = typeof cursorD.x === 'number' ? cursorD.x : 0;
          const cy        = typeof cursorD.y === 'number' ? cursorD.y : 0;
          if (fromUuid) store.updateCursor(fromUuid, cx, cy, nickname);
          break;
        }

        case 'ctrl_cursor_mode': {
          // REQ-021：教师开启/关闭光标模式，同步到 store
          const modeEnabled = msg.enabled ?? msg.data?.enabled ?? msg.payload?.enabled;
          store.setCursorModeEnabled(!!modeEnabled);
          // 关闭时清空所有光标
          if (!modeEnabled) {
            Object.keys(store.cursors).forEach(u => store.removeCursor(u));
          }
          break;
        }

        case 'ctrl_follow_sync':
          // 由 RoomPage onMessage 处理视角同步
          break;

        case 'ctrl_flow_update': {
          const flowDetail = msg.payload || msg.data || msg;
          window.dispatchEvent(new CustomEvent('ws_flow_update', { detail: flowDetail }));
          break;
        }

        case 'ctrl_flow_widget_hint': {
          const hintDetail = msg.payload || msg.data || msg;
          window.dispatchEvent(new CustomEvent('ws_flow_widget_hint', { detail: hintDetail }));
          break;
        }

        case 'group_update': {
          window.dispatchEvent(new CustomEvent('ws_group_update', { detail: msg }))
          break;
        }
        case 'shelf_card_create':
        case 'shelf_card_delete':
        case 'shelf_visibility': {
          window.dispatchEvent(new CustomEvent('ws_shelf', { detail: { type: msg.type, data: msg.data } }))
          break;
        }
        case 'pong':
          break;

        default:
          break;
      }

      // 透传给 RoomPage 的 onMessage
      onMessageRef.current?.(msg);
    },
    [getStore, roomId]
  );

  useEffect(() => { handleMessageRef.current = handleMessage; }, [handleMessage]);

  const connect = useCallback(() => {
    if (!roomId) return;
    if (
      ws.current?.readyState === WebSocket.OPEN ||
      ws.current?.readyState === WebSocket.CONNECTING
    ) return;

    const store = getStore();
    store.setConnectionStatus('connecting');

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    let url = `${protocol}//${window.location.host}/ws/room/${roomId}`;
    if (uuid && !isTeacher) url += `?uuid=${encodeURIComponent(uuid)}`;

    const socket = new WebSocket(url);

    socket.onopen = () => {
      retryCount.current = 0;
      store.setConnectionStatus('connected');
      startHeartbeat();
      flushQueue();
    };

    socket.onmessage = (event) => handleMessageRef.current(event);

    socket.onclose = () => {
      store.setConnectionStatus('disconnected');
      stopHeartbeat();
      if (!manualClose.current && retryCount.current < WS_CONFIG.MAX_RETRY) {
        retryCount.current++;
        retryTimer.current = setTimeout(
          () => connectRef.current(),
          WS_CONFIG.RETRY_INTERVAL * retryCount.current
        );
      } else if (retryCount.current >= WS_CONFIG.MAX_RETRY) {
        store.setConnectionStatus('error');
      }
    };

    socket.onerror = () => {};
    ws.current = socket;
  }, [roomId, uuid, isTeacher, getStore, startHeartbeat, stopHeartbeat, flushQueue]);

  useEffect(() => { connectRef.current = connect; }, [connect]);

  const send = useCallback(
    (type: string, payload: Record<string, any>) => {
      const data = JSON.stringify({
        type,
        payload,
        sender_uuid: uuid || '',
        room_id:     roomId,
        timestamp:   Date.now(),
      });
      if (ws.current?.readyState === WebSocket.OPEN) {
        ws.current.send(data);
      } else {
        if (pendingQueue.current.length < 50) {
          pendingQueue.current.push(data);
        }
        if (ws.current?.readyState !== WebSocket.CONNECTING && !manualClose.current) {
          connectRef.current();
        }
      }
    },
    [uuid, roomId]
  );

  const disconnect = useCallback(() => {
    manualClose.current = true;
    stopHeartbeat();
    if (retryTimer.current) { clearTimeout(retryTimer.current); retryTimer.current = null; }
    if (ws.current) { ws.current.close(1000, 'manual'); ws.current = null; }
    getStore().setConnectionStatus('disconnected');
  }, [stopHeartbeat, getStore]);

  useEffect(() => {
    manualClose.current = false;
    pendingQueue.current = [];
    connectRef.current();
    return () => { disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, uuid, isTeacher]);

  return { send, disconnect };
};
