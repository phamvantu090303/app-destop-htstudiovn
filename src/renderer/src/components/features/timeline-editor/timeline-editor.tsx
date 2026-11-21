'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  Play, Pause, SkipBack, SkipForward, ZoomIn, ZoomOut, Maximize2, Minimize2, Volume2, Download,
  Music, Upload, CheckCircle2, AlertCircle, ChevronDown, ChevronUp,
  Loader2, Film, Mic2, Sparkles, Cloud, Trash2, X, Scissors, Captions, Waves,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { FieldError } from '@/components/ui/field-error';
import { Button } from '@/components/ui/button';
import type { VideoScene } from '@/lib/scene/scenes';
import type { PresetTimelineDemo } from '@/lib/preset/preset-scripts';
import { findSceneAtPlayhead, scenesTimingSignature } from '@/lib/scene/scenes';
import {
  trimScene,
  reorderScenes,
  type TrimEdge,
} from '@/lib/scene/scene-timeline-edit';
import {
  SCENE_TRANSITION_OPTIONS,
  crossfadeAudio,
  crossfadeVideo,
  transitionMs,
} from '@/lib/scene/scene-transition';
import { composeVideo, downloadBlob, type BgmSource } from '@/lib/video-library/video-composer';
import { CAPTION_FONTS, DEFAULT_CAPTION_FONT_ID } from '@/lib/video-library/video-captions';
import { fetchBgmLibraryTracks, findBgmLibraryTrack, type BgmLibraryTrack } from '@/lib/video-library/bgm-library';
import { uploadRenderVideo } from '@/lib/video-library/video-library-storage';
import { toUserMessage } from '@/lib/error-messages';
import { useAuth } from '@/contexts/auth-context';
import { useVideoLibrary } from '@/contexts/video-library-context';
import { createClient } from '@/lib/supabase/client';
import { insertRenderHistory } from '@/lib/render-history/render-history-remote';

const ACCEPTED_AUDIO = ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/x-m4a', 'audio/m4a'];
const ACCEPTED_EXT = /\.(mp3|wav|ogg|m4a)$/i;
const MAX_AUDIO_MB = 20;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

interface TimelineEditorProps {
  scenes?: VideoScene[];
  focusBgmKey?: number;
  timelineDefaults?: PresetTimelineDemo | null;
  /** ID project active — dùng lưu BGM/video render vào đúng thư mục Storage */
  projectId?: string;
  /** Tỷ lệ khung hình đã chọn lúc generate ('16:9' | '9:16' | '1:1') — quyết định kích thước xuất thật */
  aspectRatio?: string;
  /** Chất lượng video đã chọn lúc generate ('720p' | '1080p' | ...) */
  videoQuality?: string;
  /** Mục 4 — nhạc nền (BGM) đã lưu từ trước (path Storage bucket `bgm-uploads` + tên hiển thị + volume) */
  savedBgmPath?: string;
  savedBgmFileName?: string;
  savedBgmVolume?: number;
  /** Sau khi sửa cảnh ở mục 3 — timeline seek về đúng cảnh đó */
  focusSceneId?: string | null;
  onFocusSceneHandled?: () => void;
}

export function TimelineEditor({
  scenes = [],
  focusBgmKey,
  timelineDefaults,
  projectId,
  aspectRatio,
  videoQuality,
  savedBgmPath,
  savedBgmFileName,
  savedBgmVolume,
  focusSceneId,
  onFocusSceneHandled,
}: TimelineEditorProps = {}) {
  const { user } = useAuth();
  const { uploadBgm, deleteBgm, updateBgmVolume, getBgmSignedUrl, setActiveScenes } = useVideoLibrary();
  const supabaseRef = useRef(createClient());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bgmSectionRef = useRef<HTMLDivElement>(null);
  const sceneBlockRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const previewARef = useRef<HTMLVideoElement>(null);
  const previewBRef = useRef<HTMLVideoElement>(null);
  const frontVideoIsA = useRef(true);
  const ttsAudioRef = useRef<HTMLAudioElement>(null);
  const ttsAudioBRef = useRef<HTMLAudioElement>(null);
  const activeTtsIsMain = useRef(true);
  const isTransitioningRef = useRef(false);
  const ttsSceneIdRef = useRef<string | null>(null);
  const playheadRef = useRef(0);
  const prevScenesRef = useRef<VideoScene[]>([]);
  const playRafRef = useRef<number | null>(null);
  const playLastTickRef = useRef(0);

  /** Bật = phát thêm track TTS (giữ tiếng gốc video); Tắt = chỉ tiếng trong video */
  const [playNarration, setPlayNarration] = useState(false);

  const readyScenes = useMemo(
    () => scenes.filter((s) =>
      s.status === 'success' || s.status === 'edited' || s.status === 'generating',
    ),
    [scenes],
  );
  const readyScenesRef = useRef(readyScenes);
  readyScenesRef.current = readyScenes;

  const totalDuration = useMemo(() => {
    if (readyScenes.length === 0) return 0;
    return readyScenes[readyScenes.length - 1].timeEnd;
  }, [readyScenes]);

  const timelineMarks = useMemo(() => {
    if (totalDuration <= 0) return [0];
    const step = totalDuration <= 30 ? 3 : Math.ceil(totalDuration / 10);
    const marks: number[] = [];
    for (let t = 0; t <= totalDuration; t += step) marks.push(t);
    if (marks[marks.length - 1] !== totalDuration) marks.push(totalDuration);
    return marks;
  }, [totalDuration]);

  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSceneId, setPlaybackSceneId] = useState<string | null>(null);
  const [volume, setVolume] = useState(80);
  const [zoom, setZoom] = useState(50);
  /** Phóng to khung xem trước (video preview) để coi rõ hơn — mặc định chỉ rộng 192px (w-48), khó xem. */
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  playheadRef.current = playhead;

  const [showBgm, setShowBgm] = useState(false);
  // Thư viện nhạc nền — admin quản lý qua /admin/bgm-tracks, fetch lúc mount (không đợi mở
  // panel showBgm vì hasBgm/activeBgmLabel/resolveBgmSourceForRender/preset đều cần bất kể
  // panel có mở hay không).
  const [bgmTracks, setBgmTracks] = useState<BgmLibraryTrack[]>([]);
  useEffect(() => {
    fetchBgmLibraryTracks()
      .then(setBgmTracks)
      .catch((err) => console.error('[timeline-editor] Tải thư viện nhạc nền thất bại:', err));
  }, []);
  const [selectedTrack, setSelectedTrack] = useState<string | null>(null);
  /** id track thư viện đang phát thử — null = không phát */
  const [previewingTrackId, setPreviewingTrackId] = useState<string | null>(null);
  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [bgmVolume, setBgmVolume] = useState(savedBgmVolume ?? 30);
  const [bgmSaved, setBgmSaved] = useState(false);
  const [bgmSaving, setBgmSaving] = useState(false);
  const [bgmDeleting, setBgmDeleting] = useState(false);
  const [bgmError, setBgmError] = useState<string | null>(null);

  // Mặc định "Cắt nhanh" (0 — không crossfade) trừ khi người dùng tự chọn chế độ khác — video
  // xuất ra khớp chính xác tổng thời lượng từng cảnh, không hụt giây nào ngoài dự kiến.
  const [transitionSec, setTransitionSec] = useState(0);
  const [frontIsA, setFrontIsA] = useState(true);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState(0);
  const [renderMessage, setRenderMessage] = useState('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [renderDone, setRenderDone] = useState(false);
  /** Tuỳ chọn — upload thêm bản MP4 lên Supabase Storage (bucket `renders`), ngoài tải máy */
  const [saveRenderToCloud, setSaveRenderToCloud] = useState(false);
  /** Burn phụ đề từ lời thoại vào video — cần font tại public/fonts/captions.ttf, thiếu font tự bỏ qua */
  const [burnCaptions, setBurnCaptions] = useState(false);
  /** Font phụ đề — xem CAPTION_FONTS trong video-captions.ts */
  const [captionFontId, setCaptionFontId] = useState(DEFAULT_CAPTION_FONT_ID);
  /** Tự hạ volume BGM khi có thoại/SFX (sidechaincompress) */
  const [duckBgm, setDuckBgm] = useState(true);

  /** Đang kéo tay trim 1 đầu clip trên track Video — null = không có thao tác trim nào */
  const [trimDrag, setTrimDrag] = useState<{ sceneId: string; edge: TrimEdge; startX: number } | null>(null);
  /** id cảnh đang được kéo để đổi thứ tự (drag-and-drop) trên track Video */
  const [draggedSceneId, setDraggedSceneId] = useState<string | null>(null);

  /** Đã lưu Storage từ trước (phiên khác) và chưa chọn file mới đè lên trong phiên này */
  const hasSavedBgm = Boolean(savedBgmPath) && !uploadedFile;
  const hasBgm = selectedTrack !== null || uploadedFile !== null || Boolean(savedBgmPath);
  const ttsReadyCount = readyScenes.filter((s) => s.audioUrl).length;
  const progressPct = totalDuration > 0 ? (playhead / totalDuration) * 100 : 0;

  useEffect(() => {
    if (!focusBgmKey) return;
    setShowBgm(true);
    setTimeout(() => bgmSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
  }, [focusBgmKey]);

  useEffect(() => {
    if (!timelineDefaults) return;
    setBgmVolume(timelineDefaults.bgmVolume);
    // Phụ thuộc thêm bgmTracks: nếu timelineDefaults đã có ngay từ lần render đầu (áp preset),
    // effect này có thể chạy TRƯỚC khi fetch thư viện xong (bgmTracks vẫn rỗng) — không khớp
    // được tên bài, mất luôn BGM mặc định của preset mà không báo lỗi gì. Thêm bgmTracks vào
    // dependency để tự khớp lại khi fetch xong; chạy lại với cùng timelineDefaults vô hại.
    const track = bgmTracks.find((t) => t.name === timelineDefaults.bgmPresetName);
    if (track) {
      setSelectedTrack(track.id);
      setUploadedFile(null);
    }
    setShowBgm(true);
  }, [timelineDefaults, bgmTracks]);

  useEffect(() => {
    const vol = volume / 100;
    const main = ttsAudioRef.current;
    const alt = ttsAudioBRef.current;
    if (main && activeTtsIsMain.current) main.volume = vol;
    if (alt && !activeTtsIsMain.current) alt.volume = vol;
    const va = previewARef.current;
    const vb = previewBRef.current;
    if (va) {
      va.muted = false;
      va.volume = vol;
    }
    if (vb) {
      vb.muted = false;
      vb.volume = vol;
    }
    if (!playNarration) {
      main?.pause();
      alt?.pause();
    }
  }, [volume, playNarration]);

  const applySceneMedia = useCallback(async (
    scene: VideoScene,
    opts: { animate: boolean; offset?: number; playing: boolean },
  ) => {
    const ms = opts.animate && transitionSec > 0 ? transitionMs(transitionSec) : 0;
    // Chặn gọi chồng cho MỌI trường hợp, kể cả "Cắt nhanh" (ms=0) — dù không crossfade,
    // incoming.play() vẫn là async nên vẫn có khoảng hở để 2 lệnh gọi tranh nhau đảo cờ
    // frontVideoIsA, khiến video mới thật ra load vào phần tử đang bị ẩn (z-0) còn phần tử
    // hiện z-10 thì đứng hình — trong khi audio không có z-index nên không lộ ra như vậy.
    if (isTransitioningRef.current) return;

    isTransitioningRef.current = true;

    try {
      const vol = volume / 100;
      const offset = opts.offset ?? 0;

      const incomingVideo = frontVideoIsA.current ? previewBRef.current : previewARef.current;
      const outgoingVideo = frontVideoIsA.current ? previewARef.current : previewBRef.current;
      const incomingAudio = activeTtsIsMain.current ? ttsAudioBRef.current : ttsAudioRef.current;
      const outgoingAudio = activeTtsIsMain.current ? ttsAudioRef.current : ttsAudioBRef.current;

      const tasks: Promise<void>[] = [];

      if (scene.videoUrl && incomingVideo) {
        tasks.push(crossfadeVideo(outgoingVideo, incomingVideo, scene.videoUrl, ms, opts.playing, offset));
      }

      if (playNarration && scene.audioUrl && incomingAudio) {
        tasks.push(
          crossfadeAudio(
            opts.animate && ms > 0 ? outgoingAudio : null,
            incomingAudio,
            scene.audioUrl,
            vol,
            ms,
            offset,
          ),
        );
      } else {
        outgoingAudio?.pause();
        incomingAudio?.pause();
      }

      await Promise.all(tasks);

      if (scene.videoUrl && incomingVideo) {
        frontVideoIsA.current = !frontVideoIsA.current;
        setFrontIsA(frontVideoIsA.current);
      }

      if (playNarration && scene.audioUrl && incomingAudio) {
        activeTtsIsMain.current = !activeTtsIsMain.current;
      }

      ttsSceneIdRef.current = scene.id;
      setPlaybackSceneId(scene.id);

      if (!opts.playing) {
        incomingVideo?.pause();
        incomingAudio?.pause();
      }
    } finally {
      isTransitioningRef.current = false;

      // Playhead có thể đã sang cảnh khác trong lúc crossfade — bắt kịp ngay
      if (opts.playing) {
        const at = findSceneAtPlayhead(readyScenes, playheadRef.current);
        if (at && at.id !== scene.id) {
          const catchOffset = Math.max(0, playheadRef.current - at.timeStart);
          void applySceneMedia(at, {
            animate: transitionSec > 0,
            offset: catchOffset,
            playing: true,
          });
        }
      }
    }
  }, [transitionSec, volume, readyScenes, playNarration]);

  const activeSceneForPreview = useMemo(
    () => findSceneAtPlayhead(readyScenes, playhead),
    [readyScenes, playhead],
  );

  const stopPlaybackClock = useCallback(() => {
    if (playRafRef.current != null) {
      cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
    }
  }, []);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      stopPlaybackClock();
      setPlaybackSceneId(null);
      setIsPlaying(false);
      previewARef.current?.pause();
      previewBRef.current?.pause();
      ttsAudioRef.current?.pause();
      ttsAudioBRef.current?.pause();
      return;
    }
    const scene = findSceneAtPlayhead(readyScenes, playhead) ?? readyScenes[0];
    if (!scene?.videoUrl && !scene?.audioUrl) return;
    const offset = Math.max(0, playhead - scene.timeStart);
    setIsPlaying(true);
    void applySceneMedia(scene, { animate: false, offset, playing: true });
  }, [isPlaying, readyScenes, playhead, applySceneMedia, stopPlaybackClock]);

  const isSceneActive = useCallback((scene: VideoScene) => {
    return playhead >= scene.timeStart && playhead < scene.timeEnd;
  }, [playhead]);

  // Đồng hồ playhead — luôn chạy theo durationSeconds từng cảnh, không theo TTS onEnded
  useEffect(() => {
    if (!isPlaying) {
      stopPlaybackClock();
      return;
    }

    playLastTickRef.current = performance.now();

    const tick = (now: number) => {
      const dt = (now - playLastTickRef.current) / 1000;
      playLastTickRef.current = now;

      setPlayhead((p) => {
        const next = p + dt;
        if (next >= totalDuration) {
          stopPlaybackClock();
          setIsPlaying(false);
          setPlaybackSceneId(null);
          return totalDuration;
        }
        return next;
      });

      playRafRef.current = requestAnimationFrame(tick);
    };

    playRafRef.current = requestAnimationFrame(tick);
    return stopPlaybackClock;
  }, [isPlaying, totalDuration, stopPlaybackClock]);

  // Đổi cảnh preview khi playhead sang cảnh mới
  useEffect(() => {
    if (!isPlaying || isTransitioningRef.current) return;

    const scene = findSceneAtPlayhead(readyScenes, playhead);
    if (!scene) return;
    if (scene.id === playbackSceneId) return;

    const offset = Math.max(0, playhead - scene.timeStart);
    void applySceneMedia(scene, {
      animate: transitionSec > 0,
      offset,
      playing: true,
    });
  }, [playhead, isPlaying, readyScenes, playbackSceneId, applySceneMedia, transitionSec]);

  // Giữ playhead đúng cảnh khi timing thay đổi (sửa TTS → duration đổi)
  useEffect(() => {
    const prev = prevScenesRef.current;
    const curr = readyScenes;

    if (prev.length === 0) {
      prevScenesRef.current = curr;
      return;
    }

    if (scenesTimingSignature(prev) === scenesTimingSignature(curr)) return;

    setIsPlaying(false);
    stopPlaybackClock();
    ttsAudioRef.current?.pause();
    ttsAudioBRef.current?.pause();
    setPlaybackSceneId(null);

    const t = playheadRef.current;
    const oldScene = findSceneAtPlayhead(prev, t);
    if (oldScene) {
      const offset = t - oldScene.timeStart;
      const newScene = curr.find((s) => s.id === oldScene.id);
      if (newScene) {
        const clamped = Math.min(
          Math.max(0, offset),
          Math.max(0, newScene.durationSeconds - 0.05),
        );
        setPlayhead(newScene.timeStart + clamped);
        prevScenesRef.current = curr;
        return;
      }
    }

    setPlayhead((p) => Math.min(p, totalDuration));
    prevScenesRef.current = curr;
  }, [readyScenes, totalDuration]);

  // Seek timeline về cảnh vừa sửa ở mục 3
  useEffect(() => {
    if (!focusSceneId) return;
    const scene = readyScenes.find((s) => s.id === focusSceneId);
    if (!scene) return;

    setIsPlaying(false);
    stopPlaybackClock();
    ttsAudioRef.current?.pause();
    ttsAudioBRef.current?.pause();
    setPlaybackSceneId(null);
    ttsSceneIdRef.current = null;
    setPlayhead(scene.timeStart);
    onFocusSceneHandled?.();
  }, [focusSceneId, readyScenes, onFocusSceneHandled]);

  // Seek preview khi dừng — cắt nhanh, không flip layer nếu cùng cảnh
  useEffect(() => {
    if (isPlaying || isTransitioningRef.current) return;
    const scene = findSceneAtPlayhead(readyScenes, playhead);
    if (!scene) return;
    const offset = Math.max(0, playhead - scene.timeStart);

    if (ttsSceneIdRef.current === scene.id) {
      const audio = activeTtsIsMain.current ? ttsAudioRef.current : ttsAudioBRef.current;
      if (audio && scene.audioUrl) audio.currentTime = offset;
      return;
    }

    void applySceneMedia(scene, { animate: false, offset, playing: false });
  }, [playhead, isPlaying, readyScenes, applySceneMedia]);

  // Kéo tay trim 1 đầu clip — chỉ CO LẠI (kéo giãn ra không có tác dụng, xem scene-timeline-edit.ts).
  // pxPerSecond đo lại trực tiếp trên DOM ở MỖI lần di chuột thay vì tính 1 lần lúc bắt đầu kéo,
  // vì bề rộng block co lại ngay khi trim để không bị lệch dần theo các bước kéo sau.
  useEffect(() => {
    if (!trimDrag) return;
    let lastX = trimDrag.startX;

    const handleMove = (e: MouseEvent) => {
      const dxPx = e.clientX - lastX;
      if (dxPx === 0) return;

      const scene = readyScenesRef.current.find((s) => s.id === trimDrag.sceneId);
      const el = sceneBlockRefs.current.get(trimDrag.sceneId);
      if (!scene || !el) return;

      const widthPx = el.getBoundingClientRect().width;
      const pxPerSecond = widthPx / Math.max(0.1, scene.durationSeconds);
      const deltaSeconds = (trimDrag.edge === 'start' ? dxPx : -dxPx) / pxPerSecond;
      if (deltaSeconds <= 0) return;

      lastX = e.clientX;
      setActiveScenes((prev) => trimScene(prev, trimDrag.sceneId, trimDrag.edge, deltaSeconds));
    };

    const handleUp = () => setTrimDrag(null);

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [trimDrag, setActiveScenes]);

  const handleTrimHandleMouseDown = useCallback((e: React.MouseEvent, sceneId: string, edge: TrimEdge) => {
    e.preventDefault();
    e.stopPropagation();
    setTrimDrag({ sceneId, edge, startX: e.clientX });
  }, []);

  const handleSceneDrop = useCallback((targetSceneId: string) => {
    if (draggedSceneId && draggedSceneId !== targetSceneId) {
      setActiveScenes((prev) => reorderScenes(prev, draggedSceneId, targetSceneId));
    }
    setDraggedSceneId(null);
  }, [draggedSceneId, setActiveScenes]);

  /** Chuyển playhead sang đầu cảnh kế tiếp — tiếp tục phát luôn nếu đang phát (giống hệt logic
   *  bấm thẳng vào 1 khối cảnh trên track Video). */
  const nextSceneIndex = activeSceneForPreview
    ? readyScenes.findIndex((s) => s.id === activeSceneForPreview.id) + 1
    : -1;
  const canGoNext = nextSceneIndex >= 0 && nextSceneIndex < readyScenes.length;

  const handleNextScene = useCallback(() => {
    const next = readyScenes[nextSceneIndex];
    if (!next) return;
    setPlayhead(next.timeStart);
    if (isPlaying) {
      setPlaybackSceneId(next.id);
      void applySceneMedia(next, { animate: transitionSec > 0, offset: 0, playing: true });
    }
  }, [readyScenes, nextSceneIndex, isPlaying, applySceneMedia, transitionSec]);

  const validateAndSetAudio = (file: File) => {
    setUploadError(null);
    const okMime = ACCEPTED_AUDIO.includes(file.type);
    const okExt = ACCEPTED_EXT.test(file.name);
    if (!okMime && !okExt) {
      setUploadError(`File "${file.name}" không phải audio hợp lệ. Chấp nhận: MP3, WAV, M4A, OGG.`);
      return;
    }
    const sizeMB = file.size / 1024 / 1024;
    if (sizeMB > MAX_AUDIO_MB) {
      setUploadError(`File quá lớn (${sizeMB.toFixed(1)} MB) — tối đa ${MAX_AUDIO_MB} MB.`);
      return;
    }
    setUploadedFile(file);
    setSelectedTrack(null);
  };

  /**
   * Có file mới chọn trong phiên này → upload lên Storage (bucket `bgm-uploads`), lưu path/tên/
   * volume vào project. Không có file mới nhưng đã có BGM lưu từ trước → chỉ lưu lại volume mới
   * (user chỉ chỉnh thanh trượt, không đổi bài nhạc).
   */
  const handleBgmSave = async () => {
    if (!hasBgm) return;
    setBgmError(null);

    if (!user) {
      setBgmError('Cần đăng nhập để lưu nhạc nền lên cloud — chưa đăng nhập thì phải chọn lại file mỗi lần render.');
      return;
    }

    if (uploadedFile) {
      setBgmSaving(true);
      try {
        await uploadBgm(uploadedFile, bgmVolume);
        setUploadedFile(null);
        setBgmSaved(true);
        setTimeout(() => setBgmSaved(false), 2500);
      } catch (err) {
        setBgmError(toUserMessage(err, 'Lưu nhạc nền thất bại — thử lại.'));
      } finally {
        setBgmSaving(false);
      }
      return;
    }

    if (savedBgmPath) {
      updateBgmVolume(bgmVolume);
      setBgmSaved(true);
      setTimeout(() => setBgmSaved(false), 2500);
    }
  };

  /** Nghe thử 1 bài trong thư viện — bấm lại bài đang phát để dừng */
  const togglePreviewTrack = useCallback((track: BgmLibraryTrack) => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    if (previewingTrackId === track.id) {
      audio.pause();
      setPreviewingTrackId(null);
      return;
    }
    audio.src = track.assetPath;
    void audio.play();
    setPreviewingTrackId(track.id);
  }, [previewingTrackId]);

  useEffect(() => () => previewAudioRef.current?.pause(), []);

  const handleBgmDelete = async () => {
    setBgmError(null);
    setBgmDeleting(true);
    try {
      await deleteBgm();
    } catch (err) {
      setBgmError(toUserMessage(err, 'Xoá nhạc nền thất bại — thử lại.'));
    } finally {
      setBgmDeleting(false);
    }
  };

  const activeBgmLabel = uploadedFile
    ? uploadedFile.name
    : savedBgmPath
      ? (savedBgmFileName ?? 'Đã lưu')
      : selectedTrack !== null
        ? findBgmLibraryTrack(bgmTracks, selectedTrack)?.name ?? ''
        : 'Chưa chọn';

  /**
   * Nguồn BGM thật cho FFmpeg lúc render — File vừa chọn phiên này, bài trong thư viện
   * (public asset hoặc URL Storage, dùng ngay không cần lưu), hoặc signed URL của BGM đã lưu
   * lên cloud.
   */
  const resolveBgmSourceForRender = useCallback(async (): Promise<BgmSource | null> => {
    if (uploadedFile) return uploadedFile;
    const libraryTrack = findBgmLibraryTrack(bgmTracks, selectedTrack);
    if (libraryTrack) return { url: libraryTrack.assetPath, fileName: libraryTrack.fileName };
    if (savedBgmPath) {
      const url = await getBgmSignedUrl(savedBgmPath);
      if (url) return { url, fileName: savedBgmFileName ?? 'bgm.mp3' };
    }
    return null;
  }, [uploadedFile, bgmTracks, selectedTrack, savedBgmPath, savedBgmFileName, getBgmSignedUrl]);

  const handleRender = useCallback(async () => {
    if (readyScenes.length === 0) {
      setRenderError('Chưa có cảnh video hoàn thiện. Hãy tạo cảnh ở mục 3 trước.');
      return;
    }

    setIsRendering(true);
    setRenderError(null);
    setRenderDone(false);
    setRenderProgress(0);
    setRenderMessage('Khởi tạo FFmpeg...');

    try {
      const bgmSource = await resolveBgmSourceForRender();
      const result = await composeVideo({
        scenes: readyScenes,
        bgmFile: bgmSource,
        bgmVolume,
        includeTts: playNarration,
        aspectRatio,
        videoQuality,
        transitionSeconds: transitionSec,
        duckBgm,
        burnCaptions,
        captionFontId,
        onProgress: (pct, msg) => {
          setRenderProgress(pct);
          setRenderMessage(msg);
        },
      });

      downloadBlob(result.blob, result.filename);
      setRenderDone(true);
      setTimeout(() => setRenderDone(false), 4000);

      const supabase = supabaseRef.current;
      if (user && supabase) {
        // Tuỳ chọn "Lưu bản sao lên cloud" — lỗi upload KHÔNG chặn render (video đã tải máy
        // thành công), chỉ log để không phá trải nghiệm chính vì 1 tính năng phụ trợ.
        let filePath: string | undefined;
        if (saveRenderToCloud && projectId) {
          try {
            filePath = await uploadRenderVideo(supabase, user.id, projectId, result.filename, result.blob);
          } catch (err) {
            console.error('[timeline] Lưu video render lên cloud thất bại:', err);
          }
        }
        insertRenderHistory(supabase, user.id, {
          projectId,
          fileName: result.filename,
          filePath,
          fileSizeBytes: result.blob.size,
          durationSeconds: result.durationSeconds,
          status: 'completed',
        }).catch((err) => console.error('[render-history] Ghi lịch sử thất bại:', err));
      }
    } catch (err) {
      const message = toUserMessage(err, 'Render video thất bại — thử lại hoặc giảm số cảnh.');
      setRenderError(message);

      const supabase = supabaseRef.current;
      if (user && supabase) {
        insertRenderHistory(supabase, user.id, {
          projectId,
          fileName: `render-${Date.now()}.mp4`,
          status: 'failed',
          errorMessage: message,
        }).catch((e) => console.error('[render-history] Ghi lịch sử thất bại:', e));
      }
    } finally {
      setIsRendering(false);
    }
  }, [readyScenes, bgmVolume, playNarration, aspectRatio, videoQuality, transitionSec, duckBgm, burnCaptions, captionFontId, resolveBgmSourceForRender, saveRenderToCloud, projectId, user]);

  if (scenes.length === 0) {
    return (
      <section className="space-y-4">
        <h2 className="section-label">
          4. CHỈNH SỬA VIDEO
        </h2>
        <div className="bg-card border border-dashed border-border rounded-2xl p-10 flex flex-col items-center text-center gap-3">
          <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center">
            <Film className="w-7 h-7 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Timeline chưa sẵn sàng</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-md">
              Hoàn thành mục 2 và mục 3 để có danh sách cảnh video. Sau đó dùng FFmpeg ghép cảnh,
              nhạc nền, lời đọc TTS và tải video hoàn chỉnh.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="section-label">
          4. CHỈNH SỬA VIDEO
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
           {readyScenes.length} cảnh · {formatDuration(totalDuration)} · Ghép nhạc · Tải MP4
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl overflow-hidden flex flex-col">
        <audio ref={ttsAudioRef} className="hidden" />
        <audio ref={ttsAudioBRef} className="hidden" />

        {/* Preview + playback */}
        <div className={cn(
          'px-5 py-3 border-b border-border flex gap-4 bg-background/40',
          previewExpanded ? 'flex-col' : 'flex-col sm:flex-row',
        )}>
          <div className={cn(
            'relative aspect-video bg-black rounded-lg overflow-hidden shrink-0',
            previewExpanded ? 'w-full max-w-2xl mx-auto' : 'w-full sm:w-48',
          )}>
            <Button
              type="button"
              variant="icon-ghost"
              onClick={() => setPreviewExpanded((v) => !v)}
              className="absolute top-1 right-1 z-20 p-1.5 bg-black/60 hover:bg-black/80 text-white"
              aria-label={previewExpanded ? 'Thu nhỏ khung xem trước' : 'Phóng to khung xem trước'}
              title={previewExpanded ? 'Thu nhỏ khung xem trước' : 'Phóng to khung xem trước'}
            >
              {previewExpanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </Button>
            {readyScenes.some((s) => s.videoUrl) ? (
              <>
                <video
                  ref={previewARef}
                  className={cn(
                    'absolute inset-0 w-full h-full object-cover',
                    frontIsA ? 'z-10' : 'z-0',
                  )}
                  playsInline
                />
                <video
                  ref={previewBRef}
                  className={cn(
                    'absolute inset-0 w-full h-full object-cover',
                    frontIsA ? 'z-0' : 'z-10',
                  )}
                  playsInline
                />
              </>
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted-foreground">
                <Film className="w-8 h-8 opacity-40" />
              </div>
            )}
            {activeSceneForPreview && (
              <span className="absolute bottom-1 left-1 z-20 text-[10px] bg-black/70 text-white px-1.5 py-0.5 rounded">
                Cảnh {activeSceneForPreview.index}
              </span>
            )}
          </div>

          <div className={cn(
            'flex flex-col gap-2',
            previewExpanded ? 'w-full max-w-2xl mx-auto items-center' : 'flex-1 justify-center',
          )}>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="icon-ghost"
                onClick={() => {
                  stopPlaybackClock();
                  setPlayhead(0);
                  setPlaybackSceneId(null);
                  setIsPlaying(false);
                }}
                className="p-2"
                aria-label="Quay về đầu"
              >
                <SkipBack className="w-4 h-4" />
              </Button>
              <Button
                type="button"
                variant="icon-ghost"
                onClick={togglePlayback}
                disabled={!activeSceneForPreview?.videoUrl && !activeSceneForPreview?.audioUrl}
                className="p-2 disabled:opacity-40"
                aria-label={isPlaying ? 'Dừng' : 'Phát'}
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              </Button>
              <Button
                type="button"
                variant="icon-ghost"
                onClick={handleNextScene}
                disabled={!canGoNext}
                className="p-2 disabled:opacity-30"
                aria-label="Cảnh tiếp theo"
                title="Chuyển tới cảnh tiếp theo"
              >
                <SkipForward className="w-4 h-4" />
              </Button>
              <div className="text-xs font-mono text-foreground ml-2 tabular-nums">
                <span className="text-primary font-semibold">{formatDuration(playhead)}</span>
                <span className="text-muted-foreground"> / {formatDuration(totalDuration)}</span>
              </div>
            </div>
            <div className={cn('flex items-center gap-1.5', !previewExpanded && 'ml-auto sm:ml-0')}>
              <Button type="button" variant="icon-ghost" onClick={() => setZoom((v) => Math.max(10, v - 10))} className="p-1.5" aria-label="Thu nhỏ timeline">
                <ZoomOut className="w-3.5 h-3.5" />
              </Button>
              <input type="range" className="w-20 accent-primary" min="10" max="100" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              <Button type="button" variant="icon-ghost" onClick={() => setZoom((v) => Math.min(100, v + 10))} className="p-1.5" aria-label="Phóng to timeline">
                <ZoomIn className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        </div>

        {/* Timeline tracks */}
        <div className="overflow-x-auto">
          <div className="flex border-b border-border bg-background/50 sticky top-0 z-10 min-w-[600px]">
            <div className="w-28 flex-shrink-0 px-4 py-2 border-r border-border">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Track</span>
            </div>
            <div className="flex-1 flex h-8">
              {timelineMarks.map((s) => (
                <div key={s} className="flex-1 text-center border-r border-border/30 flex items-end pb-1">
                  <span className="text-[10px] text-muted-foreground/60 w-full">{s}s</span>
                </div>
              ))}
            </div>
          </div>

          {/* Video track */}
          <div className="flex border-b border-border min-w-[600px]">
            <div className="w-28 flex-shrink-0 px-4 py-3 border-r border-border bg-background/30">
              <span className="block text-xs font-semibold text-foreground">Video</span>
              <span className="block text-[10px] text-muted-foreground">{readyScenes.length} clips</span>
            </div>
            <div className="flex-1 px-3 py-2.5 flex items-center gap-1.5 overflow-x-auto min-h-[44px]">
              {readyScenes.map((scene) => (
                <div
                  key={scene.id}
                  ref={(el) => {
                    if (el) sceneBlockRefs.current.set(scene.id, el);
                    else sceneBlockRefs.current.delete(scene.id);
                  }}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(e) => {
                    setDraggedSceneId(scene.id);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleSceneDrop(scene.id);
                  }}
                  onDragEnd={() => setDraggedSceneId(null)}
                  onClick={() => {
                    setPlayhead(scene.timeStart);
                    if (isPlaying) {
                      setPlaybackSceneId(scene.id);
                      void applySceneMedia(scene, {
                        animate: transitionSec > 0,
                        offset: 0,
                        playing: true,
                      });
                    }
                  }}
                  style={{ flex: `${scene.durationSeconds} 0 60px` }}
                  className={cn(
                    'relative h-9 min-w-[48px] rounded-lg flex items-center justify-center text-xs font-bold transition-colors cursor-pointer select-none',
                    draggedSceneId === scene.id && 'opacity-40',
                    isSceneActive(scene)
                      ? 'bg-primary/30 border border-primary text-primary'
                      : 'bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 text-primary/80',
                  )}
                  title={`${scene.prompt}${scene.trimmed ? ' — đã trim' : ''} — kéo để đổi thứ tự`}
                >
                  {/* Handle trim đầu clip — kéo sang phải để cắt bớt đầu, không kéo giãn được */}
                  <div
                    onMouseDown={(e) => handleTrimHandleMouseDown(e, scene.id, 'start')}
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-primary/50 rounded-l-lg z-10"
                    title="Kéo để cắt bớt đầu clip"
                  />
                  #{scene.index}
                  {scene.trimmed && <Scissors className="w-2.5 h-2.5 ml-1 opacity-70" />}
                  {/* Handle trim cuối clip — kéo sang trái để cắt bớt cuối, không kéo giãn được */}
                  <div
                    onMouseDown={(e) => handleTrimHandleMouseDown(e, scene.id, 'end')}
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-primary/50 rounded-r-lg z-10"
                    title="Kéo để cắt bớt cuối clip"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Voice / TTS track — chỉ hiện khi bật Lời dẫn riêng */}
          {playNarration && (
            <div className="flex border-b border-border min-w-[600px]">
              <div className="w-28 flex-shrink-0 px-4 py-3 border-r border-border bg-background/30">
                <span className="block text-xs font-semibold text-foreground">Voice (TTS)</span>
                <span className="block text-[10px] text-muted-foreground">
                  {ttsReadyCount}/{readyScenes.length} có audio
                </span>
              </div>
              <div className="flex-1 px-3 py-2.5 flex items-center gap-1.5 overflow-x-auto min-h-[44px]">
                {readyScenes.map((scene) => (
                  <div
                    key={scene.id}
                    style={{ flex: `${scene.durationSeconds} 0 60px` }}
                    className={cn(
                      'h-9 min-w-[48px] rounded-lg px-2 flex items-center gap-1',
                      scene.audioUrl
                        ? 'bg-primary/10 border border-primary/20'
                        : 'bg-orange-500/10 border border-orange-500/20',
                    )}
                    title={scene.audioUrl ? scene.voice : `${scene.voice} (chưa có audio TTS)`}
                  >
                    {scene.audioUrl ? (
                      <Volume2 className="w-3 h-3 text-primary shrink-0" />
                    ) : (
                      <AlertCircle className="w-3 h-3 text-orange-400 shrink-0" />
                    )}
                    <span className={cn(
                      'text-[10px] truncate',
                      scene.audioUrl ? 'text-primary/80' : 'text-orange-400/80',
                    )}>
                      {scene.voice.slice(0, 20)}…
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* BGM track */}
          <div ref={bgmSectionRef} className="flex border-b border-border min-w-[600px]">
            <button
              type="button"
              onClick={() => setShowBgm((v) => !v)}
              className="w-28 flex-shrink-0 px-4 py-3 border-r border-border bg-background/30 text-left hover:bg-muted/20"
            >
              <span className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">Audio / BGM</span>
                {showBgm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </span>
              <span className={cn('block text-[10px] mt-0.5 truncate', hasBgm ? 'text-primary' : 'text-muted-foreground')}>
                {activeBgmLabel}
              </span>
            </button>
            <div className="flex-1 px-3 py-2.5 flex items-center min-h-[44px]">
              {hasBgm ? (
                <div className="flex-1 h-9 bg-gradient-to-r from-green-500/15 to-green-500/25 rounded-lg flex items-center px-3 gap-2">
                  <Music className="w-3.5 h-3.5 text-green-400" />
                  <span className="text-[10px] text-green-400 truncate">{activeBgmLabel}</span>
                </div>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowBgm(true)} className="h-auto p-0 text-xs text-muted-foreground hover:text-primary hover:bg-transparent">
                  <Music className="w-3.5 h-3.5" /> Chọn nhạc nền...
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* BGM panel */}
        {showBgm && (
          <div className="border-t border-border bg-background/30 px-5 py-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4 text-primary" />
                <span className="text-sm font-semibold">Nhạc nền (BGM) — FFmpeg amix</span>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowBgm(false)} className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground hover:bg-transparent">Thu gọn</Button>
            </div>

            {hasSavedBgm && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-primary/30 bg-primary/5">
                <Music className="w-5 h-5 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{savedBgmFileName ?? 'Nhạc nền đã lưu'}</p>
                  <p className="text-xs text-muted-foreground">Đã lưu lên cloud — dùng lại mỗi lần render, không cần tải lại</p>
                </div>
                <Button
                  type="button"
                  variant="icon-danger"
                  onClick={handleBgmDelete}
                  disabled={bgmDeleting}
                  title="Xoá nhạc nền đã lưu"
                  className="shrink-0 p-2 disabled:opacity-40"
                >
                  {bgmDeleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </Button>
              </div>
            )}

            <input ref={fileInputRef} type="file" accept=".mp3,.wav,.ogg,.m4a" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) validateAndSetAudio(f); }} />

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) validateAndSetAudio(f); }}
              className={cn(
                'flex items-center gap-3 px-4 py-3 border-2 border-dashed rounded-xl cursor-pointer',
                uploadedFile ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/40',
              )}
            >
              <Upload className="w-5 h-5 text-muted-foreground shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {uploadedFile ? uploadedFile.name : hasSavedBgm ? 'Tải file khác để thay nhạc nền' : 'Tải MP3 / WAV / OGG'}
                </p>
                <p className="text-xs text-muted-foreground">Tối đa {MAX_AUDIO_MB} MB</p>
              </div>
              {uploadedFile && (
                <Button
                  type="button"
                  variant="icon-danger"
                  onClick={(e) => { e.stopPropagation(); setUploadedFile(null); }}
                  title="Bỏ chọn"
                  className="shrink-0 p-1.5"
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
            {uploadError && <FieldError className="items-center">{uploadError}</FieldError>}
            {bgmError && <FieldError className="items-center">{bgmError}</FieldError>}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase">Thư viện nhạc nền</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-56 overflow-y-auto pr-1">
                {bgmTracks.map((track) => {
                  const isSelected = selectedTrack === track.id;
                  const isPreviewing = previewingTrackId === track.id;
                  return (
                    <div
                      key={track.id}
                      className={cn(
                        'flex items-center gap-1 rounded-lg border pl-3 pr-1 py-1.5',
                        isSelected ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => { setSelectedTrack(isSelected ? null : track.id); setUploadedFile(null); }}
                        title={isSelected ? 'Bỏ chọn bài này' : 'Chọn làm nhạc nền'}
                        className="flex-1 min-w-0 text-left text-xs"
                      >
                        <span className="block truncate font-medium">{track.name}</span>
                        <span className="block truncate text-[10px] text-muted-foreground">{track.mood}</span>
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); togglePreviewTrack(track); }}
                        title={isPreviewing ? 'Dừng nghe thử' : 'Nghe thử'}
                        className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10"
                      >
                        {isPreviewing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>
              {selectedTrack && !uploadedFile && (
                <p className="text-[10px] text-muted-foreground">
                  Đã chọn <span className="text-primary font-medium">{activeBgmLabel}</span> — dùng luôn khi render, không cần tải file.
                </p>
              )}
              <audio ref={previewAudioRef} className="hidden" onEnded={() => setPreviewingTrackId(null)} />
            </div>

            <div className="flex items-center gap-3">
              <Volume2 className="w-4 h-4 text-muted-foreground" />
              <input type="range" min="0" max="100" value={bgmVolume} onChange={(e) => setBgmVolume(Number(e.target.value))} className="flex-1 accent-primary" />
              <span className="text-xs font-mono text-primary w-8">{bgmVolume}%</span>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleBgmSave}
              disabled={bgmSaving || (!uploadedFile && !savedBgmPath)}
              className="ml-auto bg-primary/10 border-primary/30 text-primary hover:text-primary hover:border-primary/30 disabled:opacity-40"
            >
              {bgmSaving ? (
                <><Loader2 className="w-4 h-4 animate-spin" />Đang lưu...</>
              ) : bgmSaved ? (
                <><CheckCircle2 className="w-4 h-4" />Đã lưu nhạc nền</>
              ) : uploadedFile ? (
                'Lưu nhạc nền'
              ) : (
                'Lưu volume'
              )}
            </Button>
          </div>
        )}

        {/* Export options + render */}
        <div className="border-t border-border bg-background/40 px-5 py-4 space-y-4">
          <div className="flex flex-wrap gap-3">
            <label
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card cursor-pointer hover:border-primary/30"
              title="Áp dụng cho cả bản xem trước lẫn file MP4 tải về — timeline sẽ co lại đúng bằng phần crossfade giữa các cảnh."
            >
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium whitespace-nowrap">
                Chuyển cảnh
                <span className="block text-[10px] text-muted-foreground font-normal">Áp dụng cả khi render</span>
              </span>
              <select
                value={transitionSec}
                onChange={(e) => setTransitionSec(Number(e.target.value))}
                className="text-xs bg-background border border-border rounded-md px-2 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
              >
                {SCENE_TRANSITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card cursor-pointer hover:border-primary/30">
              <input
                type="checkbox"
                checked={playNarration}
                onChange={(e) => setPlayNarration(e.target.checked)}
                className="accent-primary"
              />
              <Mic2 className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium">
                Lời dẫn riêng
                <span className="block text-[10px] text-muted-foreground font-normal">
                  {playNarration
                    ? 'Bật — nghe tiếng video + lời dẫn TTS'
                    : 'Tắt — chỉ nghe tiếng trong video'}
                </span>
              </span>
            </label>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-xs text-muted-foreground">
              <Mic2 className="w-4 h-4" />
              {ttsReadyCount > 0
                ? `TTS preview · ${ttsReadyCount}/${readyScenes.length} cảnh`
                : 'Chưa có audio TTS — submit lại mục 2'}
            </div>
            <label
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card cursor-pointer hover:border-primary/30"
              title="Ghép chữ phụ đề từ lời thoại vào video — chọn font ở ô bên cạnh, thiếu file font sẽ tự bỏ qua khi render"
            >
              <input
                type="checkbox"
                checked={burnCaptions}
                onChange={(e) => setBurnCaptions(e.target.checked)}
                className="accent-primary"
              />
              <Captions className="w-4 h-4 text-primary" />
              <span className="text-xs font-medium">
                Phụ đề tự động
                <span className="block text-[10px] text-muted-foreground font-normal">Từ lời thoại từng cảnh</span>
              </span>
            </label>
            {burnCaptions && (
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card">
                <span className="text-xs font-medium whitespace-nowrap">Font phụ đề</span>
                <select
                  value={captionFontId}
                  onChange={(e) => setCaptionFontId(e.target.value)}
                  className="text-xs bg-background border border-border rounded-md px-2 py-0.5 text-foreground focus:outline-none focus:ring-1 focus:ring-primary/30"
                >
                  {CAPTION_FONTS.map((font) => (
                    <option key={font.id} value={font.id}>{font.label}</option>
                  ))}
                </select>
              </label>
            )}
            {hasBgm && (
              <label
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card cursor-pointer hover:border-primary/30"
                title="Tự động hạ volume nhạc nền khi có lời thoại/SFX — tránh nhạc nền lấn tiếng"
              >
                <input
                  type="checkbox"
                  checked={duckBgm}
                  onChange={(e) => setDuckBgm(e.target.checked)}
                  className="accent-primary"
                />
                <Waves className="w-4 h-4 text-primary" />
                <span className="text-xs font-medium">
                  Ducking BGM
                  <span className="block text-[10px] text-muted-foreground font-normal">Tự hạ nhạc khi có thoại</span>
                </span>
              </label>
            )}
            {user && (
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card cursor-pointer hover:border-primary/30">
                <input
                  type="checkbox"
                  checked={saveRenderToCloud}
                  onChange={(e) => setSaveRenderToCloud(e.target.checked)}
                  className="accent-primary"
                />
                <Cloud className="w-4 h-4 text-primary" />
                <span className="text-xs font-medium">
                  Lưu bản sao lên cloud
                  <span className="block text-[10px] text-muted-foreground font-normal">
                    Xem lại ở Cài đặt → Lịch sử render
                  </span>
                </span>
              </label>
            )}
          </div>

          {isRendering && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                  {renderMessage}
                </span>
                <span className="font-mono text-primary">{renderProgress}%</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className="h-full bg-primary transition-all duration-300" style={{ width: `${renderProgress}%` }} />
              </div>
            </div>
          )}

          {renderError && <FieldError className="items-center">{renderError}</FieldError>}

          {renderDone && (
            <p className="flex items-center gap-1.5 text-xs text-green-400">
              <CheckCircle2 className="w-3.5 h-3.5" />Video đã render &amp; tải xuống thành công!
            </p>
          )}

          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-4">
              <span className="text-xs font-mono tabular-nums">
                <span className="text-primary font-bold">{formatDuration(playhead)}</span>
                <span className="text-muted-foreground"> / {formatDuration(totalDuration)}</span>
              </span>
              <div className="flex items-center gap-2">
                <Volume2 className="w-3.5 h-3.5 text-muted-foreground" />
                <input type="range" className="w-16 accent-primary" min="0" max="100" value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
                {readyScenes.length} clips · MP4
              </span>
              <Button
                type="button"
                variant="accent"
                data-render="true"
                onClick={handleRender}
                disabled={isRendering || readyScenes.length === 0}
                className={cn(
                  'rounded-xl font-bold text-xs',
                  renderDone && 'bg-green-600 hover:bg-green-600 text-white',
                )}
              >
                {isRendering ? (
                  <><Loader2 className="w-3.5 h-3.5 animate-spin" />ĐANG RENDER...</>
                ) : renderDone ? (
                  <><CheckCircle2 className="w-3.5 h-3.5" />ĐÃ TẢI XUỐNG</>
                ) : (
                  <><Download className="w-3.5 h-3.5" />RENDER &amp; TẢI VIDEO</>
                )}
              </Button>
            </div>
          </div>

          {/* Scrubber */}
          <div
            className="relative h-4 flex items-center cursor-pointer group"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const pct = (e.clientX - rect.left) / rect.width;
              setPlayhead(Math.max(0, Math.min(totalDuration, pct * totalDuration)));
            }}
          >
            <div className="absolute inset-x-0 h-1 bg-muted rounded-full" />
            <div className="absolute left-0 h-1 bg-primary rounded-full" style={{ width: `${progressPct}%` }} />
            <div className="absolute w-3 h-3 bg-primary rounded-full border-2 border-background -translate-x-1/2" style={{ left: `${progressPct}%` }} />
          </div>
        </div>
      </div>
    </section>
  );
}
