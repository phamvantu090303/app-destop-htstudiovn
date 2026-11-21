import type { TtsInput } from '@/lib/pipeline-payload';
import { fetchApi } from '@/services/http';
import { authHeaderAsync } from '@/lib/auth/access-token';

export interface SynthesizeSpeechPayload {
  /** Bỏ trống thì backend tự dùng pool key hệ thống (admin quản lý ở /admin/elevenlabs-keys) */
  apiKey?: string;
  text: string;
  ttsInput: TtsInput;
}

class TtsService {
  /** POST /api/tts/synthesize — ElevenLabs → Blob audio MP3 */
  async synthesize(payload: SynthesizeSpeechPayload): Promise<Blob> {
    const res = await fetchApi('/tts/synthesize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeaderAsync()) },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      let message = `TTS lỗi (${res.status})`;
      try {
        const json = (await res.json()) as { error?: string };
        if (json.error) message = json.error;
      } catch {
        // ignore
      }
      throw new Error(message);
    }

    return res.blob();
  }
}

export const ttsService = new TtsService();
