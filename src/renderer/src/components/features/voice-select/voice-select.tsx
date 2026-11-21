'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Loader2, Square, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { voicesService } from '@/services/voices/voices.service';
import { getApiKey, API_KEY_IDS } from '@/lib/api-keys/api-keys-store';
import { getVoicePreviewText, voicePreviewCacheKey } from '@/lib/tts/voice-preview';
import { ttsService } from '@/services/tts/tts.service';
import { toUserMessage } from '@/lib/error-messages';

interface VoiceSelectProps {
  value: string;
  onChange: (value: string) => void;
  language: string;
  voiceSpeed?: number;
  options?: readonly [string, string][];
  id?: string;
  selectClassName?: string;
  compact?: boolean;
}

export function VoiceSelect({
  value,
  onChange,
  language,
  voiceSpeed = 1,
  options,
  id,
  selectClassName,
  compact = false,
}: VoiceSelectProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());
  const objectUrlsRef = useRef<string[]>([]);

  const [previewing, setPreviewing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Không có ai truyền `options` sẵn (mọi nơi dùng VoiceSelect đều để mặc định) — tự fetch danh
  // sách giọng do admin quản lý (/admin/voices) thay vì mảng cứng VOICE_OPTIONS cũ.
  const [fetchedOptions, setFetchedOptions] = useState<[string, string][]>([]);
  useEffect(() => {
    if (options) return;
    voicesService
      .list()
      .then((voices) => setFetchedOptions(voices.map((v): [string, string] => [v.value, v.label])))
      .catch((err) => console.error('[voice-select] Tải danh sách giọng thất bại:', err));
  }, [options]);
  const effectiveOptions = options ?? fetchedOptions;

  const stopPreview = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
    }
    setPreviewing(false);
  }, []);

  useEffect(() => () => {
    stopPreview();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current = [];
    cacheRef.current.clear();
  }, [stopPreview]);

  useEffect(() => {
    stopPreview();
  }, [value, language, voiceSpeed, stopPreview]);

  const handlePreview = useCallback(async () => {
    setError(null);

    if (previewing) {
      stopPreview();
      return;
    }

    const apiKey = getApiKey(API_KEY_IDS.elevenlabs);
    if (!apiKey) {
      setError('Chưa có API key ElevenLabs — vào Cài đặt → API Keys.');
      return;
    }

    const cacheKey = voicePreviewCacheKey(value, language, voiceSpeed);
    let objectUrl = cacheRef.current.get(cacheKey);

    setLoading(true);
    try {
      if (!objectUrl) {
        const blob = await ttsService.synthesize({
          apiKey,
          text: getVoicePreviewText(language),
          ttsInput: { voice: value, language, voiceSpeed },
        });
        objectUrl = URL.createObjectURL(blob);
        cacheRef.current.set(cacheKey, objectUrl);
        objectUrlsRef.current.push(objectUrl);
      }

      const audio = audioRef.current;
      if (!audio) return;

      audio.src = objectUrl;
      await audio.play();
      setPreviewing(true);
    } catch (err) {
      setError(toUserMessage(err, 'Không phát được giọng mẫu — thử lại.'));
      stopPreview();
    } finally {
      setLoading(false);
    }
  }, [value, language, voiceSpeed, previewing, stopPreview]);

  const select = (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'w-full px-3 py-2.5 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-primary/50 focus:ring-1 focus:ring-primary/20 transition-colors',
        compact && 'px-2.5 py-2 text-xs',
        selectClassName,
      )}
    >
      {effectiveOptions.map(([v, l]) => (
        <option key={v} value={v}>{l}</option>
      ))}
    </select>
  );

  const previewIcon = loading ? (
    <Loader2 className="w-3.5 h-3.5 animate-spin" />
  ) : previewing ? (
    <Square className="w-3.5 h-3.5 fill-current" />
  ) : (
    <Volume2 className="w-3.5 h-3.5" />
  );

  const previewButtonClass = cn(
    'inline-flex items-center justify-center gap-2 rounded-lg border text-xs font-medium transition-colors disabled:opacity-50 shrink-0',
    previewing
      ? 'border-primary/40 bg-primary/10 text-primary hover:bg-primary/15'
      : 'border-border bg-card/60 text-muted-foreground hover:border-primary/30 hover:text-foreground hover:bg-primary/5',
  );

  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      {compact ? (
        // Toolbar ngang (VideoSettingsBar) — nút icon-only nằm CẠNH dropdown, cùng chiều cao
        // với các field khác trong hàng, tránh riêng ô này cao hơn hẳn (bản trước xếp full-
        // width bên dưới, làm lệch hàng).
        <div className="flex items-stretch gap-1.5">
          {select}
          <Button
            type="button"
            variant="outline"
            onClick={() => void handlePreview()}
            disabled={loading}
            title={previewing ? 'Dừng nghe thử' : 'Nghe thử giọng đã chọn'}
            aria-label={previewing ? 'Dừng nghe thử' : 'Nghe thử giọng đã chọn'}
            className={cn(previewButtonClass, 'w-8 p-0')}
          >
            {previewIcon}
          </Button>
        </div>
      ) : (
        <>
          {select}
          <Button
            type="button"
            variant="outline"
            onClick={() => void handlePreview()}
            disabled={loading}
            title={previewing ? 'Dừng nghe thử' : 'Nghe thử giọng đã chọn'}
            className={cn(previewButtonClass, 'w-full py-2.5')}
          >
            {previewIcon}
            <span>{previewing ? 'Dừng nghe thử' : 'Nghe thử giọng mẫu'}</span>
          </Button>
        </>
      )}

      {error && (
        <p className="flex items-start gap-1 text-[11px] text-destructive leading-relaxed">
          <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
          <span>{error}</span>
        </p>
      )}

      <audio
        ref={audioRef}
        className="hidden"
        onEnded={() => setPreviewing(false)}
      />
    </div>
  );
}
