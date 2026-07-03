// =============================================================
// MindCanvas v3.0 - 图片上传 Hook
// 替代 base64 通过 WebSocket 传输的方案
// 教师：携带 JWT Cookie；学生：?uuid=guest-xxx query 参数
// =============================================================
import { useState, useCallback } from 'react';
import { useRoomStore } from '@/store/roomStore';
import { useAuthStore } from '@/store/authStore';

export interface UploadResult {
  id: string;
  url: string;
  name: string;
  size: number;
  mime: string;
}

interface UseImageUploadReturn {
  uploading: boolean;
  progress: number;
  error: string | null;
  uploadImage: (file: File) => Promise<UploadResult | null>;
  reset: () => void;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

export function useImageUpload(): UseImageUploadReturn {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [error, setError]         = useState<string | null>(null);

  const currentRoom = useRoomStore((s) => s.currentRoom);
  const user        = useAuthStore((s) => s.user);

  const uploadImage = useCallback(async (file: File): Promise<UploadResult | null> => {
    if (!currentRoom?.id) {
      setError('未加入房间');
      return null;
    }

    // 前端预校验
    if (!ALLOWED_MIMES.includes(file.type)) {
      setError('仅支持 JPEG / PNG / GIF / WebP 格式');
      return null;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setError('图片大小不能超过 5MB');
      return null;
    }

    setUploading(true);
    setProgress(0);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('room_id', currentRoom.id);

      // 构造 URL：学生附加 uuid query 参数
      let url = '/api/upload/image';
      if (!user) {
        const storedUUID = localStorage.getItem('mc_uuid');
        if (storedUUID?.startsWith('guest-')) {
          url += `?uuid=${encodeURIComponent(storedUUID)}`;
        }
      }

      // 用 XHR 以支持 progress 事件
      const result = await new Promise<UploadResult>((resolve, reject) => {
        const xhr = new XMLHttpRequest();

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setProgress(Math.round((e.loaded / e.total) * 100));
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) {
            try {
              resolve(JSON.parse(xhr.responseText) as UploadResult);
            } catch {
              reject(new Error('响应解析失败'));
            }
          } else {
            try {
              const errData = JSON.parse(xhr.responseText);
              reject(new Error(errData.error || `上传失败 (${xhr.status})`));
            } catch {
              reject(new Error(`上传失败 (${xhr.status})`));
            }
          }
        };

        xhr.onerror   = () => reject(new Error('网络错误'));
        xhr.ontimeout = () => reject(new Error('上传超时，请重试'));
        xhr.timeout   = 30000; // 30s

        xhr.open('POST', url);
        xhr.withCredentials = true; // 携带 Cookie（教师 JWT）
        xhr.send(formData);
      });

      setProgress(100);
      return result;

    } catch (err) {
      const msg = err instanceof Error ? err.message : '上传失败';
      setError(msg);
      return null;
    } finally {
      setUploading(false);
    }
  }, [currentRoom?.id, user]);

  const reset = useCallback(() => {
    setUploading(false);
    setProgress(0);
    setError(null);
  }, []);

  return { uploading, progress, error, uploadImage, reset };
}
