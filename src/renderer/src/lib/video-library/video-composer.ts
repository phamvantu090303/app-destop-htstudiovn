// ─── Ghép cảnh + BGM → xuất MP4 (FFmpeg.wasm client-side) ──────────────────

import type { VideoScene } from "@/lib/scene/scenes";
import { recalculateSceneTimings } from "@/lib/scene/scenes";
import { createScenePlaceholderVideo } from "@/lib/scene/scene-video-placeholder";
import { getVideoDurationSeconds } from "@/lib/scene/scene-video-duration";
import { fetchFile, getFFmpeg } from "@/lib/video-library/ffmpeg-client";
import {
  resolveExportDimensions,
  scalePadFilter,
  type ExportDimensions,
} from "@/lib/video-library/video-export-format";
import { buildTransitionPlan } from "@/lib/video-library/video-transition-plan";
import {
  loadCaptionFont,
  buildCaptionText,
  captionDrawtextFilter,
  resolveCaptionFont,
} from "@/lib/video-library/video-captions";

/**
 * Nguồn BGM cho FFmpeg — `File` khi user vừa chọn trong phiên này, hoặc `{ url, fileName }`
 * khi phục hồi từ nhạc nền đã lưu Storage ở lần trước (chỉ có signed URL, chưa có File thật
 * trong bộ nhớ — xem TimelineEditor.buildBgmSource()).
 */
export type BgmSource = File | { url: string; fileName: string };

export interface VideoRenderOptions {
  scenes: VideoScene[];
  bgmFile?: BgmSource | null;
  bgmVolume?: number;
  /** true = trộn track TTS với audio gốc video; false = chỉ audio gốc trong file video */
  includeTts?: boolean;
  /** Tỷ lệ khung hình project ('16:9' | '9:16' | '1:1') — quyết định kích thước xuất thật */
  aspectRatio?: string;
  /** Chất lượng video đã chọn lúc generate ('720p' | '1080p' | ...) */
  videoQuality?: string;
  /** Độ dài crossfade giữa các cảnh khi xuất (giây) — 0 = cắt cứng. Đồng bộ với lựa chọn "Chuyển cảnh" trên timeline. */
  transitionSeconds?: number;
  /** true = tự hạ volume BGM khi có thoại/SFX (sidechaincompress) — mặc định bật, chỉ có tác dụng khi có bgmFile */
  duckBgm?: boolean;
  /** true = burn phụ đề từ scene.voice vào video — cần có font tại public/fonts/, thiếu font sẽ tự bỏ qua */
  burnCaptions?: boolean;
  /** id font phụ đề — xem CAPTION_FONTS trong video-captions.ts, mặc định 'be-vietnam-pro' */
  captionFontId?: string;
  onProgress?: (percent: number, message: string) => void;
}

export interface VideoRenderResult {
  blob: Blob;
  filename: string;
  durationSeconds: number;
}

type FFmpegInstance = Awaited<ReturnType<typeof getFFmpeg>>;

/** Lọc cảnh success/edited và tính lại timing trước khi render */
function readyScenes(scenes: VideoScene[]): VideoScene[] {
  return recalculateSceneTimings(
    scenes.filter((s) => s.status === "success" || s.status === "edited"),
  );
}

/**
 * Đo lại thời lượng THẬT của video từng cảnh — video Veo/Kie trả về không nhất thiết khớp
 * chính xác con số đã "xin" lúc generate. durationSeconds của cảnh có video thật giờ LUÔN
 * lấy đúng bằng độ dài thật này (không phải con số dự kiến ban đầu nữa) — vì ensureSceneClip
 * bên dưới không còn cắt/loop video thật nữa, nên mọi chỗ khác (audio track, phụ đề, tổng
 * thời lượng) phải tính theo đúng con số thật này để không bị lệch.
 *
 * Cảnh đã `trimmed` (user tự kéo trim/split ở Timeline mục 4) BỎ QUA bước đo lại này — nếu
 * không, durationSeconds sẽ bị ghi đè về độ dài gốc, "hoàn tác" trim của user ngay khi render.
 */
async function withRealVideoDurations(
  scenes: VideoScene[],
): Promise<VideoScene[]> {
  return Promise.all(
    scenes.map(async (s) => {
      if (!s.videoUrl || s.trimmed) return s;
      try {
        const real = await getVideoDurationSeconds(s.videoUrl);
        return { ...s, durationSeconds: real };
      } catch {
        // Không đo được (blob lỗi, CORS...) — giữ nguyên durationSeconds đã có, không chặn render.
        return s;
      }
    }),
  );
}

/**
 * Đo lại thời lượng THẬT của 1 file đã ghi trong FS ảo FFmpeg bằng chính FFmpeg (`-i` không kèm
 * output — luôn "lỗi" vì thiếu output nhưng vẫn in dòng `Duration: HH:MM:SS.ff` ra log trước khi
 * thoát). Đáng tin hơn `<video>.duration` của trình duyệt — 1 số MP4/WebM (đặc biệt file trả về
 * từ Veo/Kie) có header duration không chính xác, khiến `<video>.duration` lệch vài trăm ms so
 * với số khung hình thật sự đọc được — xem lý do dùng ở cuối ensureSceneClip() bên dưới.
 */
async function probeClipDurationSeconds(
  ffmpeg: FFmpegInstance,
  fileName: string,
): Promise<number | null> {
  let found: number | null = null;
  const onLog = ({ message }: { message: string }) => {
    if (found !== null) return;
    const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(message);
    if (m) found = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  };
  ffmpeg.on("log", onLog);
  try {
    await ffmpeg.exec(["-i", fileName]).catch(() => undefined);
  } finally {
    ffmpeg.off("log", onLog);
  }
  return found;
}

interface SceneClip {
  outName: string;
  /** Thời lượng THẬT đã đo lại từ chính clip đã chuẩn hoá (không phải số "dự kiến" ban đầu) */
  durationSeconds: number;
}

/** Chuẩn hóa clip cảnh → MP4 H.264 qua FFmpeg (placeholder nếu thiếu videoUrl). Giữ audio native (Veo SFX) nếu có. */
async function ensureSceneClip(
  ffmpeg: FFmpegInstance,
  scene: VideoScene,
  index: number,
  dims: ExportDimensions,
  aspectRatio: string,
  videoQuality: string,
  captionsReady: boolean,
): Promise<SceneClip> {
  const outName = `clip_${index}.mp4`;
  const inName = `input_${index}.webm`;

  // Placeholder (chưa có video thật) là clip TỰ TẠO — cố ý khớp đúng durationSeconds. Video
  // THẬT chưa trim thì giữ NGUYÊN VẸN toàn bộ độ dài gốc, không cắt không loop — chỉ chuẩn
  // hoá định dạng (codec/độ phân giải/fps) để ghép nối tin cậy được với các cảnh khác. Video
  // THẬT đã trim (kéo tay ở Timeline mục 4) thì seek tới `trimStartSeconds` rồi cắt đúng
  // `durationSeconds` hiện tại (đã bị trim).
  const hasRealVideo = Boolean(scene.videoUrl);
  let sourceUrl = scene.videoUrl;
  if (!sourceUrl) {
    sourceUrl = await createScenePlaceholderVideo(
      scene,
      videoQuality,
      aspectRatio,
    );
  }

  await ffmpeg.writeFile(inName, await fetchFile(sourceUrl));

  // scale+pad giữ nguyên tỷ lệ gốc của clip (không kéo méo) — khớp đúng aspectRatio project
  // (16:9/9:16/1:1) thay vì luôn ép về khung ngang mặc định.
  const filters = [scalePadFilter(dims.width, dims.height)];
  let captionFileName: string | null = null;
  if (captionsReady) {
    const captionText = buildCaptionText(scene.voice, dims.width, dims.height);
    if (captionText) {
      captionFileName = `caption_${index}.txt`;
      await ffmpeg.writeFile(captionFileName, captionText);
      filters.push(captionDrawtextFilter(captionFileName, dims.height));
    }
  }

  const trimStart = scene.trimStartSeconds ?? 0;
  const needsCut = !hasRealVideo || Boolean(scene.trimmed);

  // Input options (phải đứng NGAY TRƯỚC `-i` mà chúng áp dụng) tách riêng khỏi output options
  // (-vf/-c:v/...) — xem lý do ở nhánh catch bên dưới.
  const inputArgs = [
    ...(hasRealVideo ? [] : ["-stream_loop", "-1"]),
    ...(hasRealVideo && trimStart > 0 ? ["-ss", String(trimStart)] : []),
    "-i",
    inName,
  ];
  const outputArgs = [
    "-vf",
    filters.join(","),
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-r",
    "30",
    ...(needsCut ? ["-t", String(scene.durationSeconds)] : []),
  ];

  // Ưu tiên giữ audio gốc (SFX Veo). Không có track audio → thêm silent.
  try {
    await ffmpeg.exec([
      ...inputArgs,
      ...outputArgs,
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-ar",
      "44100",
      "-ac",
      "2",
      outName,
    ]);
  } catch {
    // BẮT BUỘC khai đủ 2 `-i` (input gốc + anullsrc) TRƯỚC mọi output option (-vf/-c:v/-map/...).
    // Trước đây output options nằm CHEN GIỮA 2 input — verify trực tiếp bằng ffmpeg thật cho thấy
    // thứ tự đó khiến ffmpeg hiểu nhầm `-vf` là input option của anullsrc và NÉM LỖI ("you are
    // trying to apply an input option to an output file or vice versa"), tức là bất kỳ cảnh nào
    // thiếu track audio gốc (Veo trả về video-only) sẽ làm hỏng cả lượt render.
    await ffmpeg.exec([
      ...inputArgs,
      "-f",
      "lavfi",
      "-i",
      "anullsrc=channel_layout=stereo:sample_rate=44100",
      ...outputArgs,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-shortest",
      outName,
    ]);
  }

  await ffmpeg.deleteFile(inName);
  if (captionFileName) await ffmpeg.deleteFile(captionFileName);

  // Đo lại thời lượng THẬT của clip vừa ghi — KHÔNG dùng scene.durationSeconds (số "dự kiến",
  // đo bằng <video>.duration của trình duyệt trên file GỐC trước khi qua FFmpeg) để tính offset
  // crossfade. 2 số này có thể lệch (vài chục–vài trăm ms, tuỳ file Veo/Kie trả về) — verify trực
  // tiếp bằng FFmpeg thật cho thấy CHỈ CẦN lệch ~0.5s là xfade đã hết khung hình của clip trước
  // giữa chừng đoạn fade, khiến hiệu ứng "gãy" thành cắt cứng gần như ngay lập tức thay vì mờ dần
  // mượt — đúng triệu chứng user báo cáo. Dùng số đo thật loại bỏ hẳn nguồn lệch này.
  const measured = await probeClipDurationSeconds(ffmpeg, outName);
  const durationSeconds = measured ?? scene.durationSeconds;

  return { outName, durationSeconds };
}

interface CombinedTimeline {
  /** Tên file MP4 đã ghép toàn bộ cảnh (video + audio SFX gốc) */
  outName: string;
  /** Tổng thời lượng thật sau khi co lại vì crossfade (nếu có) */
  totalDuration: number;
  /** Mốc bắt đầu thật của mỗi cảnh trên timeline đã co lại — dùng đặt lại track lời thoại */
  starts: number[];
}

/**
 * Ghép các clip cảnh → 1 video liền mạch. transitionSeconds <= 0 (hoặc chỉ 1 clip) dùng
 * `concat` filter thường (nhanh, không tốn re-encode nhiều). transitionSeconds > 0 dùng
 * `xfade`/`acrossfade` chain — crossfade THẬT trong file xuất (không chỉ preview), timeline
 * co lại đúng bằng phần chồng lấn giữa các cảnh liền kề.
 */
async function concatWithTransitions(
  ffmpeg: FFmpegInstance,
  clipNames: string[],
  durations: number[],
  transitionSeconds: number,
): Promise<CombinedTimeline> {
  const plan = buildTransitionPlan(durations, transitionSeconds);
  const n = clipNames.length;
  const starts = plan.entries.map((e) => e.start);

  const noCrossfade = n <= 1 || plan.pairDurations.every((d) => d <= 0);

  if (noCrossfade) {
    const listContent = clipNames.map((name) => `file '${name}'`).join("\n");
    await ffmpeg.writeFile("concat.txt", listContent);
    await ffmpeg.exec([
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      "concat.txt",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "192k",
      "combined.mp4",
    ]);
    await ffmpeg.deleteFile("concat.txt");
    for (const name of clipNames) await ffmpeg.deleteFile(name);
    return {
      outName: "combined.mp4",
      totalDuration: plan.totalDuration,
      starts,
    };
  }

  const inputArgs = clipNames.flatMap((name) => ["-i", name]);
  const filterParts: string[] = [];
  let prevV = "0:v";
  let prevA = "0:a";

  for (let i = 1; i < n; i++) {
    const d = plan.pairDurations[i - 1];
    const curV = `${i}:v`;
    const curA = `${i}:a`;
    const outV = `v${i}`;
    const outA = `a${i}`;

    if (d > 0) {
      const offset = Math.max(0, plan.entries[i].start);
      filterParts.push(
        `[${prevV}][${curV}]xfade=transition=fade:duration=${d.toFixed(3)}:offset=${offset.toFixed(3)}[${outV}]`,
      );
      filterParts.push(
        `[${prevA}][${curA}]acrossfade=d=${d.toFixed(3)}:c1=tri:c2=tri[${outA}]`,
      );
    } else {
      // Cặp này không đủ điều kiện crossfade (clip quá ngắn) — nối cứng, không mất khung hình.
      filterParts.push(
        `[${prevV}][${prevA}][${curV}][${curA}]concat=n=2:v=1:a=1[${outV}][${outA}]`,
      );
    }

    prevV = outV;
    prevA = outA;
  }

  await ffmpeg.exec([
    ...inputArgs,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    `[${prevV}]`,
    "-map",
    `[${prevA}]`,
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "combined.mp4",
  ]);

  for (const name of clipNames) await ffmpeg.deleteFile(name);
  return { outName: "combined.mp4", totalDuration: plan.totalDuration, starts };
}

/**
 * Ghép TTS từng cảnh → 1 track AAC, đặt đúng mốc `starts[i]` (adelay + amix) thay vì nối
 * cứng liên tiếp — bắt buộc khi có crossfade vì timeline đã co lại, nối cứng sẽ khiến lời
 * thoại lệch dần về cuối video theo số điểm chuyển cảnh.
 */
async function buildVoiceTrack(
  ffmpeg: FFmpegInstance,
  timeline: VideoScene[],
  /** Thời lượng THẬT từng cảnh đã đo lại sau khi chuẩn hoá (xem ensureSceneClip) — PHẢI dùng
   * số này thay vì scene.durationSeconds, nếu không track lời thoại sẽ dài/ngắn hơn đúng video
   * của cảnh đó (lệch giống lỗi crossfade lệch offset — cùng gốc: số "dự kiến" khác số thật). */
  realDurations: number[],
  starts: number[],
  totalDuration: number,
): Promise<string | null> {
  const voiceScenes = timeline
    .map((scene, i) => ({ scene, i }))
    .filter(({ scene }) => Boolean(scene.audioUrl));

  if (voiceScenes.length === 0) return null;

  const inputArgs: string[] = [];
  const filterParts: string[] = [];
  const labels: string[] = [];

  for (let k = 0; k < voiceScenes.length; k++) {
    const { scene, i } = voiceScenes[k];
    const inName = `voice_in_${i}.mp3`;
    await ffmpeg.writeFile(inName, await fetchFile(scene.audioUrl!));
    inputArgs.push("-i", inName);

    // Pad/trim TTS đúng thời lượng THẬT của cảnh rồi delay tới đúng mốc `starts[i]` trên
    // timeline đã co lại — tránh audio ngắn/dài hơn cảnh làm lệch các cảnh phía sau.
    const sceneDuration = realDurations[i] ?? scene.durationSeconds;
    const delayMs = Math.max(0, Math.round(starts[i] * 1000));
    const label = `vc${k}`;
    filterParts.push(
      `[${k}:a]apad=whole_dur=${sceneDuration},atrim=0:${sceneDuration},adelay=${delayMs}|${delayMs}[${label}]`,
    );
    labels.push(`[${label}]`);
  }

  // normalize=0 — các đoạn lời thoại gần như không chồng lấn thời gian, không cần tự hạ
  // volume theo số lượng input như amix mặc định (sẽ làm lời thoại nghe nhỏ dần khi nhiều cảnh).
  filterParts.push(
    `${labels.join("")}amix=inputs=${labels.length}:duration=longest:normalize=0[voiceout]`,
  );

  await ffmpeg.exec([
    ...inputArgs,
    "-filter_complex",
    filterParts.join(";"),
    "-map",
    "[voiceout]",
    "-t",
    String(totalDuration),
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-ar",
    "44100",
    "-ac",
    "2",
    "voice_track.aac",
  ]);

  for (const { i } of voiceScenes) await ffmpeg.deleteFile(`voice_in_${i}.mp3`);
  return "voice_track.aac";
}

/** Ghép các cảnh + BGM → xuất blob MP4 client-side */
export async function composeVideo(
  options: VideoRenderOptions,
): Promise<VideoRenderResult> {
  const {
    scenes,
    bgmFile,
    bgmVolume = 30,
    includeTts = true,
    aspectRatio = "16:9",
    videoQuality = "720p",
    transitionSeconds = 0,
    duckBgm = true,
    burnCaptions = false,
    captionFontId,
    onProgress,
  } = options;

  const filteredScenes = readyScenes(scenes);
  if (filteredScenes.length === 0) {
    throw new Error(
      "Không có cảnh video hoàn thiện để render. Hãy tạo cảnh ở mục 3 trước.",
    );
  }

  const dims = resolveExportDimensions(aspectRatio, videoQuality);

  onProgress?.(1, "Đang kiểm tra thời lượng thật của từng cảnh...");
  // Nâng durationSeconds đúng bằng độ dài THẬT nếu video dài hơn dự kiến — rồi tính lại
  // timeStart/timeEnd theo con số đã đúng này, để phụ đề/audio/tổng thời lượng khớp thật.
  const timeline = recalculateSceneTimings(
    await withRealVideoDurations(filteredScenes),
  );

  onProgress?.(2, "Đang tải FFmpeg...");
  const ffmpeg = await getFFmpeg();

  // Tiến trình thật theo % ffmpeg báo cáo cho từng bước (thay vì đoán qua log) — mỗi bước
  // được cấp 1 khoảng % cố định, progress nội bộ của exec() ánh xạ tuyến tính vào khoảng đó.
  // ffmpeg là singleton dùng lại giữa các lần render (xem ffmpeg-client.ts) — PHẢI gỡ listener
  // này ở finally, nếu không lần render sau sẽ bị listener cũ chồng lên gọi nhầm stage/label.
  let stageStart = 0;
  let stageWeight = 0;
  let stageLabel = "";
  const handleProgress = ({ progress }: { progress: number }) => {
    const clamped = Math.max(
      0,
      Math.min(1, Number.isFinite(progress) ? progress : 0),
    );
    onProgress?.(Math.round(stageStart + clamped * stageWeight), stageLabel);
  };
  ffmpeg.on("progress", handleProgress);
  const setStage = (start: number, end: number, label: string) => {
    stageStart = start;
    stageWeight = end - start;
    stageLabel = label;
    onProgress?.(start, label);
  };

  try {
    let captionsReady = false;
    if (burnCaptions) {
      const captionFont = resolveCaptionFont(captionFontId);
      captionsReady = await loadCaptionFont(ffmpeg, captionFont);
      if (!captionsReady) {
        onProgress?.(
          8,
          `Bỏ qua phụ đề — thiếu file font tại public${captionFont.assetPath}...`,
        );
      }
    }

    const clipNames: string[] = [];
    // Thời lượng THẬT từng clip (đo lại sau khi chuẩn hoá qua FFmpeg — xem ensureSceneClip),
    // KHÔNG dùng scene.durationSeconds (số đo bằng <video>.duration trên file GỐC, có thể lệch
    // vài trăm ms với 1 số file Veo/Kie) để tính offset crossfade — dùng số dự kiến từng khiến
    // xfade hết khung hình giữa chừng đoạn fade, hiệu ứng "gãy" thành cắt cứng gần như ngay lập
    // tức thay vì mờ dần mượt.
    const durations: number[] = [];
    for (let i = 0; i < timeline.length; i++) {
      setStage(
        8 + Math.round((i / timeline.length) * 37),
        8 + Math.round(((i + 1) / timeline.length) * 37),
        `Chuẩn hóa cảnh ${i + 1}/${timeline.length}...`,
      );
      const clip = await ensureSceneClip(
        ffmpeg,
        timeline[i],
        i,
        dims,
        aspectRatio,
        videoQuality,
        captionsReady,
      );
      clipNames.push(clip.outName);
      durations.push(clip.durationSeconds);
    }

    setStage(
      45,
      60,
      transitionSeconds > 0
        ? "Ghép cảnh + crossfade..."
        : "Ghép các cảnh video...",
    );
    const { outName, totalDuration, starts } = await concatWithTransitions(
      ffmpeg,
      clipNames,
      durations,
      transitionSeconds,
    );
    let currentVideo = outName;

    setStage(
      60,
      72,
      includeTts
        ? "Tạo track lời thoại TTS..."
        : "Bỏ qua TTS — dùng audio trong video...",
    );
    const voiceTrack = includeTts
      ? await buildVoiceTrack(
          ffmpeg,
          timeline,
          durations,
          starts,
          totalDuration,
        )
      : null;

    setStage(
      72,
      84,
      voiceTrack
        ? "Trộn lời dẫn TTS với tiếng gốc video..."
        : "Giữ nguyên âm thanh trong video...",
    );
    if (voiceTrack) {
      await ffmpeg.exec([
        "-i",
        currentVideo,
        "-i",
        voiceTrack,
        "-filter_complex",
        "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=2[aout]",
        "-map",
        "0:v:0",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-t",
        String(totalDuration),
        "video_with_audio.mp4",
      ]);
      await ffmpeg.deleteFile(voiceTrack);
    } else {
      // "Lời dẫn riêng" TẮT (hoặc không có audio TTS nào) — giữ nguyên audio gốc trong video.
      await ffmpeg.exec([
        "-i",
        currentVideo,
        "-c",
        "copy",
        "-t",
        String(totalDuration),
        "video_with_audio.mp4",
      ]);
    }

    await ffmpeg.deleteFile(currentVideo);
    currentVideo = "video_with_audio.mp4";

    if (bgmFile) {
      setStage(84, 95, "Trộn nhạc nền (BGM)...");
      const bgmFileName =
        bgmFile instanceof File ? bgmFile.name : bgmFile.fileName;
      const bgmName =
        "bgm_input" + (bgmFileName.match(/\.(\w+)$/)?.[0] ?? ".mp3");
      const bgmBytes =
        bgmFile instanceof File
          ? await fetchFile(bgmFile)
          : await fetchFile(bgmFile.url);
      await ffmpeg.writeFile(bgmName, bgmBytes);

      const vol = Math.max(0, Math.min(100, bgmVolume)) / 100;

      // duckBgm — BGM tự hạ volume khi có thoại/SFX (sidechaincompress lấy [0:a] làm trigger)
      // thay vì trộn cố định 1 mức volume suốt video — tránh nhạc nền lấn tiếng lời dẫn.
      const bgmFilter = duckBgm
        ? `[1:a]volume=${vol},apad=whole_dur=${totalDuration}[bgmvol];[bgmvol][0:a]sidechaincompress=threshold=0.05:ratio=8:attack=5:release=300:makeup=1[bgmduck];[0:a][bgmduck]amix=inputs=2:duration=first:dropout_transition=2[aout]`
        : `[1:a]volume=${vol},apad=whole_dur=${totalDuration}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=2[aout]`;

      await ffmpeg.exec([
        "-i",
        currentVideo,
        "-i",
        bgmName,
        "-filter_complex",
        bgmFilter,
        "-map",
        "0:v",
        "-map",
        "[aout]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "final.mp4",
      ]);

      await ffmpeg.deleteFile(bgmName);
      await ffmpeg.deleteFile(currentVideo);
      currentVideo = "final.mp4";
    } else {
      await ffmpeg.exec(["-i", currentVideo, "-c", "copy", "final.mp4"]);
      await ffmpeg.deleteFile(currentVideo);
      currentVideo = "final.mp4";
    }

    setStage(95, 99, "Xuất file video...");
    const data = await ffmpeg.readFile(currentVideo);
    await ffmpeg.deleteFile(currentVideo);

    const bytes =
      data instanceof Uint8Array
        ? data
        : new TextEncoder().encode(String(data));
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "video/mp4" });
    const timestamp = new Date()
      .toISOString()
      .slice(0, 19)
      .replace(/[:T]/g, "-");

    onProgress?.(100, "Hoàn tất!");

    return {
      blob,
      filename: `ai-video-studio-${timestamp}.mp4`,
      durationSeconds: totalDuration,
    };
  } finally {
    ffmpeg.off("progress", handleProgress);
  }
}

/** Tải blob xuống máy qua thẻ `<a download>` tạm */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
