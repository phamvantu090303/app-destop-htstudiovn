import { apiService } from '@/services/api';
import { authHeader } from '@/lib/auth/access-token';

export interface VoiceOptionDto {
  value: string;
  label: string;
}

class VoicesService {
  /** GET /api/voices — danh sách giọng cho dropdown "Chọn giọng" (chỉ giọng đang bật) */
  async list(): Promise<VoiceOptionDto[]> {
    const data = (await apiService.get('/voices', authHeader())) as { voices: VoiceOptionDto[] };
    return data.voices;
  }
}

export const voicesService = new VoicesService();
