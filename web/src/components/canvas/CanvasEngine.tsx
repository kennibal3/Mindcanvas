// =============================================================
// MindCanvas v4.1 - 画布引擎
// 修复（需求1）：主题模式和背景色切换实时生效
//   - 新增 useEffect 监听 canvasStore.theme 变化 → 调用 updateScene
//   - 新增 useEffect 监听 canvasStore.backgroundColor 变化 → 调用 updateScene
// 权限规则：
//   - 教师：可删除任何元素
//   - 学生：只能删除自己创建的元素
// 同步规则：
//   - isApplyingRemote=true 时 onChange 直接 return
// =============================================================
import { useCallback, useRef, useEffect } from 'react';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { useCanvasStore } from '@/store/canvasStore';
import { useRoomStore } from '@/store/roomStore';
import { useImageUpload } from '@/hooks/useImageUpload';
import type { RoomMode } from '@/types/room';

interface Props {
  sendMessage: (type: string, payload: Record<string, any>) => void;
  isTeacher: boolean;
  roomMode?: RoomMode;
}

function dataURLtoBlob(dataURL: string): Blob | null {
  try {
    const [header, data] = dataURL.split(',');
    if (!header || !data) return null;
    const mime = header.match(/:(.*?);/)?.[1];
    if (!mime) return null;
    const byteStr = atob(data);
    const ab = new ArrayBuffer(byteStr.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
    return new Blob([ab], { type: mime });
  } catch { return null; }
}

const CanvasEngine: React.FC<Props> = ({ sendMessage, isTeacher, roomMode = 'whiteboard' }) => {
  const setExcalidrawAPI = useCanvasStore((s) => s.setExcalidrawAPI);
  const theme            = useCanvasStore((s) => s.theme);
  const backgroundColor  = useCanvasStore((s) => s.backgroundColor);
  const isLocked         = useRoomStore((s) => s.isLocked);
  const isReadOnly       = useRoomStore((s) => s.isReadOnly);
  const currentUserUUID  = useRoomStore((s) => s.currentUserUUID);

  const { uploadImage } = useImageUpload();

  const apiRef              = useRef<any>(null);
  const prevVersionsRef     = useRef<Map<string, number>>(new Map());
  const isApplyingRemoteRef = useRef(false);
  const syncTimerRef        = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef          = useRef<any[]>([]);
  const uploadedFilesRef    = useRef<Map<string, string>>(new Map());
  const uploadingRef        = useRef<Set<string>>(new Set());
  const pendingUploadIds    = useRef<Set<string>>(new Set());
  // REQ-032：记录已经现拉过 dataURL 的 fileId，避免重复 fetch 同一张图
  const hydratedFileIdsRef  = useRef<Set<string>>(new Set());
  const uploadPollRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingRemoteRef    = useRef<any[]>([]);
  const apiReadyRef         = useRef(false);
  const ownersRef           = useRef<Map<string, { id: string; name: string }>>(new Map());
  const knownIdsRef         = useRef<Set<string>>(new Set());
  const sendMessageRef      = useRef(sendMessage);
  sendMessageRef.current    = sendMessage;

  // =============================================================
  // 需求1修复：监听 theme 变化，实时更新 Excalidraw 主题
  // Excalidraw 的 theme prop 只在初始化时生效，后续必须通过
  // updateScene 的 appState 来更新
  // =============================================================
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    try {
      api.updateScene({
        appState: { theme },
      });
    } catch (err) {
      console.warn('[Canvas] 主题更新失败:', err);
    }
  }, [theme]);

  // =============================================================
  // 需求1修复：监听 backgroundColor 变化，实时更新画布背景色
  // =============================================================
  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    try {
      api.updateScene({
        appState: { viewBackgroundColor: backgroundColor },
      });
    } catch (err) {
      console.warn('[Canvas] 背景色更新失败:', err);
    }
  }, [backgroundColor]);

  const getMyName = useCallback((): string => {
    if (isTeacher) return '教师';
    return localStorage.getItem('mc_nickname') || '学生';
  }, [isTeacher]);

  const getViewMode = (): boolean => {
    if (isLocked || isReadOnly) return true;
    if (roomMode === 'cards' && !isTeacher) return true;
    return false;
  };

  // =============================================================
  // REQ-032（2026-07-09 修复）：画布粘贴/拖拽插入的图片走 Excalidraw
  // 原生 files 机制，此前上传到服务器拿到 URL 后，广播给其他人时又把
  // 原始 base64（originalBase64）重新塞回 scene_update 里——上传等于白做，
  // base64 该多大还是多大，照样占 REQ-029 那 2MB/5MB 的场景容量额度。
  // 改为只广播 { url }（几十字节），接收端在 applyRemote 里现拉现渲染
  // （见下方 hydrateRemoteImages）。持久化到 room_scenes 的也是同一份
  // 轻量数据，从根上解决"画布里插几张照片就把场景撑爆"的问题。
  // 兼容：房间里已有的历史场景可能还是旧格式（files 里存的是完整 dataURL），
  // applyRemote 两种格式都认，不需要迁移脚本。
  // =============================================================
  const uploadFileAndBroadcast = useCallback(async (fileId: string) => {
    const api = apiRef.current;
    if (!api) return;
    const allFiles = api.getFiles?.() || {};
    const f = allFiles[fileId];
    if (!f) return;
    const dataURL: string = f.dataURL || '';
    if (!dataURL) return;
    if (dataURL.startsWith('http') || dataURL.startsWith('/uploads/')) {
      uploadedFilesRef.current.set(fileId, dataURL);
      uploadingRef.current.delete(fileId);
      pendingUploadIds.current.delete(fileId);
      return;
    }
    if (!dataURL.startsWith('data:')) return;
    uploadingRef.current.add(fileId);
    pendingUploadIds.current.delete(fileId);
    try {
      const blob = dataURLtoBlob(dataURL);
      if (!blob) return;
      const ext = blob.type.split('/')[1]?.split('+')[0] || 'png';
      const file = new File([blob], `canvas_${fileId}.${ext}`, { type: blob.type });
      const result = await uploadImage(file);
      if (!result) {
        // 上传失败（网络抖动等瞬时问题）：重新排队，靠 500ms 轮询下次重试
        pendingUploadIds.current.add(fileId);
        return;
      }
      uploadedFilesRef.current.set(fileId, result.url);
      hydratedFileIdsRef.current.add(fileId); // 自己本地已经有真实图，不用再去拉

      const elements = api.getSceneElements() || [];
      const relatedEls = elements
        .filter((el: any) => el.type === 'image' && el.fileId === fileId && !el.isDeleted)
        .map((el: any) => {
          const owner = ownersRef.current.get(el.id);
          const copy = JSON.parse(JSON.stringify(el));
          if (owner) copy.customData = { ...(copy.customData || {}), creatorId: owner.id, creatorName: owner.name };
          return copy;
        });
      if (relatedEls.length > 0) {
        sendMessageRef.current('scene_update', {
          elements: relatedEls,
          files: { [fileId]: { id: fileId, mimeType: f.mimeType, url: result.url } },
        });
      }
    } catch (err) {
      console.warn('[Canvas] 上传失败:', err);
      pendingUploadIds.current.add(fileId);
    } finally {
      uploadingRef.current.delete(fileId);
    }
  }, [uploadImage]);

  // REQ-032：接收端按 URL 现拉图片字节，转成 dataURL 后喂给 Excalidraw
  // 的 addFiles——用户看到的还是完整原图，不是压缩版，只是数据传输方式
  // 从"塞进 WS 广播"换成了"按需 HTTP 拉取"。
  const hydrateRemoteImages = useCallback(
    async (items: { fileId: string; url: string; mimeType?: string }[]) => {
      const api = apiRef.current;
      if (!api) return;
      for (const { fileId, url, mimeType } of items) {
        if (hydratedFileIdsRef.current.has(fileId)) continue;
        hydratedFileIdsRef.current.add(fileId);
        try {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const blob = await resp.blob();
          const dataURL: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          apiRef.current?.addFiles?.([
            { id: fileId, dataURL, mimeType: mimeType || blob.type || 'image/png', created: Date.now() },
          ]);
        } catch (err) {
          console.warn('[Canvas] 图片拉取失败，允许下次同步重试:', fileId, err);
          hydratedFileIdsRef.current.delete(fileId); // 失败不计数，下次 applyRemote 再试
        }
      }
    },
    []
  );

  const startUploadPoller = useCallback(() => {
    if (uploadPollRef.current) return;
    uploadPollRef.current = setInterval(() => {
      if (pendingUploadIds.current.size === 0) {
        if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null; }
        return;
      }
      for (const fileId of Array.from(pendingUploadIds.current)) {
        if (!uploadingRef.current.has(fileId)) uploadFileAndBroadcast(fileId);
      }
    }, 500);
  }, [uploadFileAndBroadcast]);

  const ensurePollerRunning = useCallback(() => {
    if (!uploadPollRef.current && pendingUploadIds.current.size > 0) startUploadPoller();
  }, [startUploadPoller]);

  useEffect(() => {
    return () => {
      if (uploadPollRef.current) { clearInterval(uploadPollRef.current); uploadPollRef.current = null; }
    };
  }, []);

  // =============================================================
  // applyRemote：合并远程元素到本地画布
  // =============================================================
  const applyRemote = useCallback((detail: any) => {
    const api = apiRef.current;
    if (!api) return;

    const remoteElements: any[] = Array.isArray(detail)
      ? detail
      : (detail?.elements || []);

    if (!remoteElements || remoteElements.length === 0) return;

    try {
      isApplyingRemoteRef.current = true;
      const local: any[] = api.getSceneElements() || [];
      const map = new Map<string, any>();
      for (const el of local) map.set(el.id, el);

      let changed = false;
      for (const r of remoteElements) {
        const l = map.get(r.id);
        if (!l || r.version > l.version) {
          map.set(r.id, r);
          changed = true;
        }
        if (r.customData?.creatorId) {
          ownersRef.current.set(r.id, {
            id: r.customData.creatorId,
            name: r.customData.creatorName || '未知',
          });
        }
        knownIdsRef.current.add(r.id);
      }

      if (detail?.files) {
        const toAdd: any[] = [];
        const toFetch: { fileId: string; url: string; mimeType?: string }[] = [];
        for (const [fid, fdata] of Object.entries(detail.files) as [string, any][]) {
          const dataURL: string = fdata?.dataURL || '';
          if (dataURL.startsWith('data:')) {
            // 兼容旧数据：房间历史场景里可能还留着 REQ-032 修复前存的完整 base64
            toAdd.push({ id: fid, ...fdata });
            uploadedFilesRef.current.set(fid, dataURL);
            uploadingRef.current.delete(fid);
            pendingUploadIds.current.delete(fid);
            hydratedFileIdsRef.current.add(fid);
          } else if (fdata?.url) {
            // REQ-032 新格式：场景里只存了 URL，本地按需现拉
            uploadedFilesRef.current.set(fid, fdata.url);
            if (!hydratedFileIdsRef.current.has(fid)) {
              toFetch.push({ fileId: fid, url: fdata.url, mimeType: fdata.mimeType });
            }
          }
        }
        if (toAdd.length > 0 && api.addFiles) { api.addFiles(toAdd); changed = true; }
        if (toFetch.length > 0) void hydrateRemoteImages(toFetch);
      }

      if (changed) {
        const merged = Array.from(map.values());
        api.updateScene({ elements: merged });
        const nv = new Map<string, number>();
        for (const el of merged) nv.set(el.id, el.version);
        prevVersionsRef.current = nv;
      }
    } catch (err) {
      console.warn('[Canvas] 合并失败:', err);
    } finally {
      setTimeout(() => { isApplyingRemoteRef.current = false; }, 100);
    }
  }, []);

  // =============================================================
  // handleAPI：Excalidraw API 就绪
  // API 就绪后立即应用当前 store 中的主题和背景色
  // （解决组件挂载时 API 还未就绪导致 useEffect 无法生效的问题）
  // =============================================================
  const handleAPI = useCallback((api: any) => {
    apiRef.current = api;
    apiReadyRef.current = true;
    setExcalidrawAPI(api);

    // API 就绪后立即同步当前 store 的主题和背景色
    try {
      const { theme: currentTheme, backgroundColor: currentBg } = useCanvasStore.getState();
      api.updateScene({
        appState: {
          theme: currentTheme,
          viewBackgroundColor: currentBg,
        },
      });
    } catch {}

    if (pendingRemoteRef.current.length > 0) {
      const pending = [...pendingRemoteRef.current];
      pendingRemoteRef.current = [];
      setTimeout(() => {
        for (const d of pending) applyRemote(d);
      }, 100);
    }
  }, [setExcalidrawAPI, applyRemote]);

  // =============================================================
  // handleChange：本地画布变化
  // =============================================================
  const handleChange = useCallback((elements: readonly any[], appState: any) => {
    useCanvasStore.getState().setTransform({
      scrollX: appState.scrollX ?? 0,
      scrollY: appState.scrollY ?? 0,
      zoom: appState.zoom?.value ?? 1,
    });
    if (apiRef.current) useCanvasStore.getState().setExcalidrawAPI(apiRef.current);

    if (isApplyingRemoteRef.current) return;

    const prev = prevVersionsRef.current;
    const changed: any[] = [];

    for (const el of elements) {
      const pv = prev.get(el.id);
      if (pv === undefined || pv !== el.version) {
        const copy = JSON.parse(JSON.stringify(el));
        if (!knownIdsRef.current.has(el.id) && !el.isDeleted) {
          ownersRef.current.set(el.id, { id: currentUserUUID, name: getMyName() });
        }
        const owner = ownersRef.current.get(el.id);
        if (owner) {
          copy.customData = { ...(copy.customData || {}), creatorId: owner.id, creatorName: owner.name };
        }
        if (el.type === 'image' && el.fileId && !el.isDeleted) {
          const fid = el.fileId;
          if (!uploadedFilesRef.current.has(fid) && !uploadingRef.current.has(fid)) {
            pendingUploadIds.current.add(fid);
            ensurePollerRunning();
          }
        }
        changed.push(copy);
      }
      knownIdsRef.current.add(el.id);
      if (el.customData?.creatorId && !ownersRef.current.has(el.id)) {
        ownersRef.current.set(el.id, {
          id: el.customData.creatorId,
          name: el.customData.creatorName || '未知',
        });
      }
    }

    const nv = new Map<string, number>();
    for (const el of elements) nv.set(el.id, el.version);
    prevVersionsRef.current = nv;

    // 删除权限判定统一交给服务端（单一权威，见 ws_handler validateDeletePermissions + isTeamRoom）：
    // 客户端一律把改动（含删除）发出去，服务端按房间形态决定放行(团队)或恢复(其它)。
    // 被恢复时服务端会向本人回发 scene_restore，由下方监听器即时回弹（不再本地预判，避免 owner 追踪时序漏判）。
    if (changed.length > 0) {
      pendingRef.current.push(...changed);
      if (!syncTimerRef.current) {
        syncTimerRef.current = setTimeout(() => {
          syncTimerRef.current = null;
          const toSend = pendingRef.current;
          pendingRef.current = [];
          if (toSend.length > 0) sendMessage('scene_update', { elements: toSend });
        }, 100);
      }
    }
  }, [sendMessage, isTeacher, currentUserUUID, getMyName, ensurePollerRunning]);

  // 监听远程场景更新
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (!d) return;
      if (apiReadyRef.current && apiRef.current) {
        applyRemote(d);
      } else {
        pendingRemoteRef.current.push(d);
      }
    };
    window.addEventListener('excalidraw-remote-update', h);
    return () => window.removeEventListener('excalidraw-remote-update', h);
  }, [applyRemote]);

  // 监听非法删除恢复事件
  useEffect(() => {
    const h = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.illegal_ids?.length) return;
      const api = apiRef.current;
      if (!api) return;
      const illegalSet = new Set<string>(detail.illegal_ids as string[]);
      isApplyingRemoteRef.current = true;
      // 必须用 getSceneElementsIncludingDeleted：刚被删的元素 isDeleted=true，
      // getSceneElements() 不含已删元素 → 找不到就恢复不了（这是"删了不回弹、要刷新才复原"的根因）。
      const all: any[] = (api.getSceneElementsIncludingDeleted?.() ?? api.getSceneElements()) || [];
      const m = new Map<string, any>();
      for (const el of all) m.set(el.id, el);
      let c = false;
      for (const id of illegalSet) {
        const el = m.get(id);
        if (el && el.isDeleted) {
          m.set(id, { ...el, isDeleted: false, version: el.version + 1 });
          c = true;
        }
      }
      if (c) api.updateScene({ elements: Array.from(m.values()) });
      setTimeout(() => { isApplyingRemoteRef.current = false; }, 100);
    };
    window.addEventListener('excalidraw-scene-restore', h);
    return () => window.removeEventListener('excalidraw-scene-restore', h);
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, zIndex: 1 }}>
        <Excalidraw
          excalidrawAPI={handleAPI}
          onChange={handleChange as any}
          viewModeEnabled={getViewMode()}
          langCode="zh-CN"
          theme="light"
          initialData={{ elements: [], appState: { viewBackgroundColor: backgroundColor } }}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
        />
      </div>
    </div>
  );
};

export default CanvasEngine;
