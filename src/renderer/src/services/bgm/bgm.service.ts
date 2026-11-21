import { apiService } from '@/services/api';
import { authHeader } from '@/lib/auth/access-token';

export interface BgmTrackDto {
  id: string;
  name: string;
  mood: string;
  assetUrl: string;
  fileName: string;
}

class BgmService {
  /** GET /api/bgm-tracks — thư viện nhạc nền cho Mục 4 chọn (chỉ bài đang bật) */
  async list(): Promise<BgmTrackDto[]> {
    const data = (await apiService.get('/bgm-tracks', authHeader())) as { tracks: BgmTrackDto[] };
    return data.tracks;
  }
}

export const bgmService = new BgmService();
