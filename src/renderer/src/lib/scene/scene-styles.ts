// ─── Phong cách hình ảnh cho cảnh — dùng chung input-section + video-item-modal ─

export interface SceneStyle {
  id: string;
  label: string;
  labelVi: string;
  emoji: string;
  desc: string;
}

export const SCENE_STYLES: SceneStyle[] = [
  { id: 'cinematic',       label: 'Cinematic',        labelVi: 'Điện ảnh',           emoji: '🎥', desc: 'Chân thực, điện ảnh' },
  { id: 'cartoon-finance', label: 'Cartoon',           labelVi: 'Hoạt hình',          emoji: '📊', desc: 'Nền trắng, dễ hiểu' },
  { id: '2d-explainer',   label: '2D Animation',      labelVi: 'Hoạt hình 2D',       emoji: '🎬', desc: 'Explainer video' },
  { id: 'dark-fantasy',   label: 'Dark Fantasy',      labelVi: 'Fantasy tối',        emoji: '🌑', desc: 'Gothic, huyền bí' },
  { id: 'watercolor',     label: 'Watercolor',        labelVi: 'Màu nước',           emoji: '🎨', desc: 'Màu nước nhẹ nhàng' },
  { id: 'flat-design',    label: 'Flat Design',       labelVi: 'Thiết kế phẳng',     emoji: '⬜', desc: 'Phẳng, tối giản' },
  { id: 'anime',          label: 'Anime / Manga',     labelVi: 'Hoạt hình Nhật',     emoji: '🇯🇵', desc: 'Phong cách Nhật' },
  { id: 'cyberpunk',      label: 'Cyberpunk',         labelVi: 'Tương lai',          emoji: '🌆', desc: 'Sci-Fi tương lai' },
  { id: 'oil-painting',   label: 'Oil Painting',      labelVi: 'Tranh sơn dầu',     emoji: '🖌️', desc: 'Sơn dầu cổ điển' },
  { id: 'chalk-dark',     label: 'Chalk / Sketch',    labelVi: 'Phác thảo',          emoji: '✏️', desc: 'Nền tối, phác thảo' },
  { id: 'renaissance',    label: 'Renaissance',       labelVi: 'Phục hưng',          emoji: '🖼️', desc: 'Caravaggio style' },
  { id: 'comic',          label: 'Comic / Pop Art',   labelVi: 'Truyện tranh',       emoji: '💥', desc: 'Truyện tranh' },
];

/** Nhãn hiển thị trên UI — ví dụ: Cinematic (Điện ảnh) */
export function formatSceneStyleDisplayLabel(style: Pick<SceneStyle, 'label' | 'labelVi'> | string): string {
  if (typeof style === 'string') {
    const found = SCENE_STYLES.find((s) => s.id === style || s.label === style);
    return found ? `${found.label} (${found.labelVi})` : style;
  }
  return `${style.label} (${style.labelVi})`;
}

export function resolveSceneStyleLabel(sceneStyleId: string): string {
  return SCENE_STYLES.find((s) => s.id === sceneStyleId)?.label ?? sceneStyleId;
}
