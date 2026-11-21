'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import {
  Sidebar, MobileNav, MobileSidebarDrawer, usePersistedSidebarCollapsed,
  type AppView, type CreativeToolId,
} from '@/components/layout/sidebar';
import { Header } from '@/components/layout/header';
import { AppBackground } from '@/components/layout/app-background';
import { SITE_NAME, LOGO_URL } from '@/lib/home-theme';
import { Button } from '@/components/ui/button';
import { useAppToast } from '@/components/ui/toast';
import { InputSection, type TabId } from '@/components/features/input-section';
import { CharacterMaster, type CharacterMasterHandle } from '@/components/features/character-master';
import {
  SceneGallery, MasterCastPanel, SceneQuickActions,
  type SceneGalleryHandle, type SceneToolbarState,
} from '@/components/features/scene-gallery';
import { TimelineEditor } from '@/components/features/timeline-editor';
import { ApiKeysManagement } from '@/components/features/api-keys-management';
import { PaymentView } from '@/components/features/payment';
import { TransactionHistoryView } from '@/components/features/transaction-history';
import { VideoLogView } from '@/components/features/video-log';
import { RenderHistorySettings } from '@/components/features/settings/render-history-settings';
import { PresetScriptModal } from '@/components/features/preset-script-modal';
import { SavedScriptsPanel } from '@/components/features/saved-scripts';
import { VideoLibraryView } from '@/components/features/video-library/video-library-view';
import { VideoSwitcher } from '@/components/features/video-library/video-switcher';
import type { PresetScript } from '@/lib/preset/preset-scripts';
import type { SavedScript } from '@/lib/saved-scripts/saved-scripts';
import { generateScriptId, deriveTitle } from '@/lib/saved-scripts/saved-scripts';
import type { SavedCharacter } from '@/lib/character/saved-characters';
import type { SourceImageItem } from '@/lib/video-library/video-library';
import type { DirectVeoScenePersistData } from '@/components/features/direct-veo';
import { VideoLibraryProvider, useVideoLibrary } from '@/contexts/video-library-context';
import { VeoModelsProvider } from '@/contexts/veo-models-context';
import { ProjectSettingsProvider, type VideoSettings } from '@/contexts/project-settings-context';
import { useAuth } from '@/contexts/auth-context';
import { GoogleIcon } from '@/components/features/settings/general-settings';
import { createClient } from '@/lib/supabase/client';
import {
  fetchRemoteSavedScripts,
  insertRemoteSavedScript,
  updateRemoteSavedScript,
  deleteRemoteSavedScript,
} from '@/lib/saved-scripts/saved-scripts-remote';

const viewTitles: Record<AppView, string> = {
  'video-library': 'Kho video',
  'video-detail': 'HTStudio',
  'api-keys': 'API Keys',
  payment: 'Thanh toán',
  'transaction-history': 'Lịch sử thanh toán',
  'video-log': 'Nhật Ký',
  'render-history': 'Lịch sử render',
};

/** Trạng thái mặc định của SceneQuickActions trước khi SceneGallery báo cáo lần đầu (không
 * có cảnh nào để chọn/tạo lại/lưu) — mọi nút disabled cho tới khi có báo cáo thật. */
const DEFAULT_SCENE_TOOLBAR_STATE: SceneToolbarState = {
  selectedCount: 0,
  totalCount: 0,
  errorCount: 0,
  regeneratableCount: 0,
  allSelected: false,
  isRegenerating: false,
  unsavedCount: 0,
  isSaving: false,
};

function VideoDetailView({
  activeTool,
  setActiveTool,
  focusVoiceSpeedKey,
  focusSceneStyleKey,
  focusContentKey,
  setFocusContentKey,
  focusBgmKey,
  setFocusBgmKey,
  selectedPreset,
  setSelectedPreset,
  characterSectionRef,
  inputSectionRef,
  sceneSectionRef,
  timelineSectionRef,
  characterMasterRef,
  savedScripts,
  savedScriptsSectionRef,
  onSaveScript,
  onUpdateScript,
  onDeleteScript,
  scrollToRef,
  onBack,
}: {
  activeTool: CreativeToolId | null;
  setActiveTool: (v: CreativeToolId | null) => void;
  focusVoiceSpeedKey: number;
  focusSceneStyleKey: number;
  focusContentKey: number;
  setFocusContentKey: React.Dispatch<React.SetStateAction<number>>;
  focusBgmKey: number;
  setFocusBgmKey: React.Dispatch<React.SetStateAction<number>>;
  selectedPreset: PresetScript | null;
  setSelectedPreset: (p: PresetScript | null) => void;
  characterSectionRef: React.RefObject<HTMLDivElement | null>;
  inputSectionRef: React.RefObject<HTMLDivElement | null>;
  sceneSectionRef: React.RefObject<HTMLDivElement | null>;
  timelineSectionRef: React.RefObject<HTMLDivElement | null>;
  characterMasterRef: React.RefObject<CharacterMasterHandle | null>;
  savedScripts: SavedScript[];
  savedScriptsSectionRef: React.RefObject<HTMLDivElement | null>;
  onSaveScript: (
    content: string,
    meta: { language: string; sceneCount: string; voice: string; aspectRatio: string; sceneDuration: string; videoQuality?: string },
  ) => void;
  onUpdateScript: (script: SavedScript) => void;
  onDeleteScript: (id: string) => void;
  scrollToRef: (ref: React.RefObject<HTMLDivElement | null>) => void;
  onBack: () => void;
}) {
  const {
    activeItem,
    setActiveScenes,
    setActiveTimelineFocus,
    syncSettingsForItem,
    applyPresetToActive,
    applyPresetAsDemo,
    updateActiveItem,
    confirmLinkGeneration,
    confirmSceneGeneration,
    saveActiveSceneVideos,
    deleteSceneStorageAssets,
    ensureGenerationInputs,
  } = useVideoLibrary();

  const appToast = useAppToast();
  /** Theo dõi status TRƯỚC ĐÓ của từng item (không phải nội dung message) — chỉ toast khi status
   *  vừa CHUYỂN sang 'error' (1 lượt thử mới thất bại). Tránh toast lại khi re-render/chuyển tab
   *  qua lại, nhưng vẫn toast đúng ở mỗi lượt "Chạy" mới dù message thất bại giống hệt lần trước
   *  (vd vẫn thiếu credit y hệt) — status luôn đi qua 'analyzing'/'generating' giữa 2 lần lỗi. */
  const prevStatusRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const prevStatus = prevStatusRef.current.get(activeItem.id);
    prevStatusRef.current.set(activeItem.id, activeItem.status);
    if (activeItem.status !== 'error' || !activeItem.errorMessage) return;
    if (prevStatus === 'error') return;
    appToast.manager.add({
      title: activeItem.errorMessage,
      type: 'error',
      timeout: 8000,
      actionProps: {
        children: 'Thử lại — về mục 2 để tạo lại kịch bản',
        onClick: () => scrollToRef(inputSectionRef),
      },
    });
  }, [activeItem.id, activeItem.status, activeItem.errorMessage, appToast, scrollToRef, inputSectionRef]);

  const [applyKey, setApplyKey] = useState(0);
  /** Chỉ hiện khung Character Master khi tạo video từ tab "Tự nhập nội dung" (text). null = chưa chọn cách nhập */
  const [activeInputTab, setActiveInputTab] = useState<TabId | null>('text');

  // SceneQuickActions render ở Header/VideoSettingsBar (nhánh cây khác với SceneGallery) —
  // gọi hành động qua ref, đọc trạng thái nút (disabled/spinner) qua state được báo cáo lại.
  const sceneGalleryRef = useRef<SceneGalleryHandle>(null);
  const [sceneToolbarState, setSceneToolbarState] = useState<SceneToolbarState>(DEFAULT_SCENE_TOOLBAR_STATE);

  const handleContentChange = useCallback((inputContent: string) => {
    updateActiveItem({ inputContent });
  }, [updateActiveItem]);

  /** Chốt khoá "Nguồn nội dung" ngay lần chọn đầu tiên (item chưa từng có initialInputType) */
  const handleInputTypeLocked = useCallback((tab: TabId) => {
    updateActiveItem({ initialInputType: tab });
  }, [updateActiveItem]);

  const handleLinkChange = useCallback((linkUrl: string, linkDescription: string) => {
    updateActiveItem({ linkUrl, linkDescription });
  }, [updateActiveItem]);

  const handleImageMasterBriefChange = useCallback((imageMasterBrief: string) => {
    updateActiveItem({ imageMasterBrief });
  }, [updateActiveItem]);

  const handleImageModeChange = useCallback((imageMode: 'multi' | 'single') => {
    updateActiveItem({ imageMode });
  }, [updateActiveItem]);

  const handleImagesMetaChange = useCallback((sourceImages: SourceImageItem[]) => {
    updateActiveItem({ sourceImages });
  }, [updateActiveItem]);

  const handleDirectVeoChange = useCallback((directVeoScenes: DirectVeoScenePersistData[], directVeoGlobalContext: string) => {
    updateActiveItem({ directVeoScenes, directVeoGlobalContext });
  }, [updateActiveItem]);

  const handleCharactersChange = useCallback((characters: SavedCharacter[]) => {
    updateActiveItem({ characters });
  }, [updateActiveItem]);

  const handleApplySavedScript = useCallback((script: SavedScript) => {
    updateActiveItem({
      appliedInput: {
        content: script.content,
        language: script.meta.language,
        sceneCount: script.meta.sceneCount,
        voice: script.meta.voice,
        aspectRatio: script.meta.aspectRatio ?? '16:9',
        sceneDuration: script.meta.sceneDuration ?? '6',
        videoQuality: script.meta.videoQuality ?? '720p',
      },
      inputContent: script.content,
    });
    setApplyKey((k) => k + 1);
    setFocusContentKey((k) => k + 1);
    setTimeout(() => scrollToRef(inputSectionRef), 100);
  }, [updateActiveItem, setFocusContentKey, scrollToRef, inputSectionRef]);

  const handleSettingsChange = useCallback((settings: VideoSettings) => {
    syncSettingsForItem(activeItem.id, settings);
  }, [syncSettingsForItem, activeItem.id]);

  const handleJumpToScenes = useCallback(() => {
    scrollToRef(sceneSectionRef);
  }, [scrollToRef, sceneSectionRef]);

  return (
    <ProjectSettingsProvider
      projectKey={activeItem.id}
      initialSettings={activeItem.settings}
      onSettingsChange={handleSettingsChange}
    >
      <div className="flex flex-1 flex-col overflow-hidden min-h-0">
        <Header
          title={viewTitles['video-detail']}
          showVideoSettings
          onBackClick={onBack}
          titleExtra={
            <div className="flex items-center gap-2 min-w-0">
              <VideoSwitcher />
              {(activeItem.status === 'generating' || activeItem.status === 'analyzing') && (
                <span className="text-[10px] text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">Đang chạy</span>
              )}
              {activeItem.status === 'error' && (
                <span className="text-[10px] text-destructive bg-destructive/10 px-2 py-0.5 rounded-full shrink-0">Lỗi</span>
              )}
            </div>
          }
          videoSettingsExtra={
            <SceneQuickActions
              {...sceneToolbarState}
              onSceneAction={(action) => sceneGalleryRef.current?.sceneAction(action)}
              onBulkAction={(action) => sceneGalleryRef.current?.bulkAction(action)}
            />
          }
        />

        <div className="flex-1 overflow-y-auto min-w-0">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6 space-y-8 pb-24 md:pb-6">
            {activeInputTab === 'text' && (
              <div ref={characterSectionRef}>
                <CharacterMaster
                  key={activeItem.id}
                  ref={characterMasterRef}
                  initialCharacters={activeItem.characters}
                  onCharactersChange={handleCharactersChange}
                />
              </div>
            )}

            <div ref={inputSectionRef}>
              <InputSection
                key={activeItem.id}
                projectId={activeItem.id}
                presetData={activeItem.appliedInput}
                presetKey={applyKey}
                initialContent={activeItem.inputContent}
                initialInputType={activeItem.initialInputType}
                locked={Boolean(activeItem.initialInputType)}
                onInputTypeLocked={handleInputTypeLocked}
                imageModeLocked={activeItem.status !== 'draft'}
                onContentChange={handleContentChange}
                savedLinkUrl={activeItem.linkUrl}
                savedLinkDescription={activeItem.linkDescription}
                onLinkChange={handleLinkChange}
                savedImageMasterBrief={activeItem.imageMasterBrief}
                onImageMasterBriefChange={handleImageMasterBriefChange}
                savedImageMode={activeItem.imageMode}
                onImageModeChange={handleImageModeChange}
                savedSourceImages={activeItem.sourceImages}
                onImagesMetaChange={handleImagesMetaChange}
                savedDirectVeoScenes={activeItem.directVeoScenes}
                savedDirectVeoGlobalContext={activeItem.directVeoGlobalContext}
                onDirectVeoChange={handleDirectVeoChange}
                onSaveScript={onSaveScript}
                onJumpToScenes={handleJumpToScenes}
                focusVoiceSpeedKey={focusVoiceSpeedKey}
                focusSceneStyleKey={focusSceneStyleKey}
                focusContentKey={focusContentKey}
                characterMasterRef={characterMasterRef}
                onActiveTabChange={setActiveInputTab}
              />
            </div>

            {savedScripts.length > 0 && (
              <div ref={savedScriptsSectionRef}>
                <section className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="section-label">
                      2.5. KỊCH BẢN ĐÃ LƯU ({savedScripts.length})
                    </h2>
                    <span className="text-xs text-muted-foreground">
                      Chọn để dùng lại · Sửa · Xóa
                    </span>
                  </div>
                  <SavedScriptsPanel
                    scripts={savedScripts}
                    onApply={handleApplySavedScript}
                    onUpdate={onUpdateScript}
                    onDelete={onDeleteScript}
                  />
                </section>
              </div>
            )}

            <div ref={sceneSectionRef} className="space-y-4">
              {activeItem.inputType === 'link' && (
                <MasterCastPanel
                  prompt={activeItem.masterCastPrompt ?? ''}
                  onPromptChange={(masterCastPrompt) => updateActiveItem({ masterCastPrompt })}
                  imageDataUrl={activeItem.masterCastImageDataUrl}
                  projectId={activeItem.id}
                  onImageChange={(masterCastImageDataUrl, masterCastImagePath) =>
                    updateActiveItem({ masterCastImageDataUrl, masterCastImagePath })}
                  onConfirm={activeItem.pendingLinkReview
                    ? (imageDataUrl) => confirmLinkGeneration(activeItem.id, imageDataUrl)
                    : undefined}
                />
              )}
              <SceneGallery
                ref={sceneGalleryRef}
                scenes={activeItem.scenes}
                onScenesChange={setActiveScenes}
                ttsInput={activeItem.ttsInput}
                veoInput={activeItem.veoInput}
                projectId={activeItem.id}
                projectStatus={activeItem.status}
                onSaveVideos={saveActiveSceneVideos}
                onDeleteScenes={deleteSceneStorageAssets}
                onSceneFocus={setActiveTimelineFocus}
                onToolbarStateChange={setSceneToolbarState}
                layout={activeItem.inputType === 'link' ? 'rows' : 'grid'}
                awaitingGenerationConfirm={Boolean(
                  (activeItem.pendingLinkReview || activeItem.status === 'generating')
                  && activeItem.inputType !== 'link',
                )}
                onConfirmGeneration={
                  activeItem.pendingLinkReview && activeItem.inputType !== 'link'
                    ? () => { void confirmSceneGeneration(activeItem.id); }
                    : undefined
                }
                onEnsureGenerationInputs={() => ensureGenerationInputs(activeItem.id)}
              />
            </div>

            <div ref={timelineSectionRef}>
              <TimelineEditor
                key={activeItem.id}
                scenes={activeItem.scenes}
                focusBgmKey={focusBgmKey}
                timelineDefaults={activeItem.timelineDemo}
                projectId={activeItem.id}
                aspectRatio={activeItem.veoInput?.aspectRatio}
                videoQuality={activeItem.veoInput?.videoQuality}
                savedBgmPath={activeItem.bgmPath}
                savedBgmFileName={activeItem.bgmFileName}
                savedBgmVolume={activeItem.bgmVolume}
                focusSceneId={activeItem.timelineFocusSceneId}
                onFocusSceneHandled={() => setActiveTimelineFocus(null)}
              />
            </div>
          </div>
        </div>
      </div>

      <PresetScriptModal
        preset={selectedPreset}
        onClose={() => setSelectedPreset(null)}
        onApply={(preset) => {
          setSelectedPreset(null);
          characterMasterRef.current?.applyDemoCharacters(preset.characters);
          applyPresetToActive(preset.input, preset.timeline);
          setApplyKey((k) => k + 1);
          setTimeout(() => scrollToRef(inputSectionRef), 100);
        }}
        onApplyDemo={(preset) => {
          setSelectedPreset(null);
          characterMasterRef.current?.applyDemoCharacters(preset.characters);
          const started = applyPresetAsDemo(preset);
          setApplyKey((k) => k + 1);
          if (started) {
            setTimeout(() => scrollToRef(sceneSectionRef), 150);
          }
        }}
      />
    </ProjectSettingsProvider>
  );
}

/** Lý do disable dùng chung cho Timeline/Danh sách cảnh khi video active chưa có cảnh nào —
 *  xem giải trình ở báo cáo audit: app luôn có sẵn 1 project (không có state "chưa có project"
 *  để disable theo đúng nghĩa đen), nên thay bằng điều kiện thực tế tương đương: chưa có cảnh
 *  nào được tạo thì 2 mục này dẫn tới section rỗng — disable + tooltip giải thích thay vì để
 *  user bấm vào rồi ngỡ ngàng. */
const NO_SCENES_REASON = 'Chưa có cảnh nào — vào Mục 2 (Nhập nội dung) để tạo trước.';

/** Cầu nối lấy `activeItem` từ VideoLibraryContext cho Sidebar — Sidebar/MobileSidebarDrawer
 *  nằm ngay trong cây của VideoLibraryProvider nhưng component `Page` (nơi render Provider)
 *  thì không, nên không thể gọi useVideoLibrary() trực tiếp trong Page. Tách 1 component nhỏ
 *  render-prop ở đây thay vì kéo toàn bộ layout Page vào trong Provider (rủi ro refactor lớn
 *  không cần thiết cho 1 giá trị nhỏ). */
function SidebarDisabledToolsGate({
  children,
}: {
  children: (disabledTools: Partial<Record<CreativeToolId, string>> | undefined) => React.ReactNode;
}) {
  const { activeItem } = useVideoLibrary();
  const disabledTools = activeItem.scenesTotal > 0
    ? undefined
    : { 'scene-gallery': NO_SCENES_REASON, timeline: NO_SCENES_REASON } as const;
  return <>{children(disabledTools)}</>;
}

export default function Page() {
  const { user, loading: authLoading, signingIn, signInWithGoogle } = useAuth();
  const supabaseRef = useRef(createClient());
  const scriptsSyncedForUserRef = useRef<string | null>(null);

  const [currentView, setCurrentView] = useState<AppView>('video-library');
  const [activeMenuId, setActiveMenuId] = useState('video-library');
  const [activeTool, setActiveTool] = useState<CreativeToolId | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, toggleSidebarCollapsed] = usePersistedSidebarCollapsed();
  const [selectedPreset, setSelectedPreset] = useState<PresetScript | null>(null);
  const [savedScripts, setSavedScripts] = useState<SavedScript[]>([]);
  const savedScriptsSectionRef = useRef<HTMLDivElement>(null);

  // Có tài khoản đăng nhập → tải "Kịch bản đã lưu" từ Supabase (mục này trước giờ
  // không hề persist, luôn rỗng lại sau F5 — giờ đồng bộ theo tài khoản Google).
  useEffect(() => {
    if (!user) {
      scriptsSyncedForUserRef.current = null;
      return;
    }
    if (scriptsSyncedForUserRef.current === user.id) return;
    const supabase = supabaseRef.current;
    if (!supabase) return;

    scriptsSyncedForUserRef.current = user.id;
    fetchRemoteSavedScripts(supabase, user.id)
      .then(setSavedScripts)
      .catch((err) => console.error('[saved-scripts] Tải Supabase thất bại:', err));
  }, [user]);

  const [focusVoiceSpeedKey, setFocusVoiceSpeedKey] = useState(0);
  const [focusSceneStyleKey, setFocusSceneStyleKey] = useState(0);
  const [focusContentKey, setFocusContentKey] = useState(0);
  const [focusBgmKey, setFocusBgmKey] = useState(0);

  const characterSectionRef = useRef<HTMLDivElement>(null);
  const inputSectionRef = useRef<HTMLDivElement>(null);
  const sceneSectionRef = useRef<HTMLDivElement>(null);
  const timelineSectionRef = useRef<HTMLDivElement>(null);
  const characterMasterRef = useRef<CharacterMasterHandle>(null);

  const scrollToRef = useCallback((ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleSaveScript = useCallback((
    content: string,
    meta: { language: string; sceneCount: string; voice: string; aspectRatio: string; sceneDuration: string; videoQuality?: string },
  ) => {
    const now = new Date().toISOString();
    const newScript: SavedScript = {
      id: generateScriptId(),
      title: deriveTitle(content),
      content,
      meta,
      createdAt: now,
      updatedAt: now,
    };
    setSavedScripts((prev) => [newScript, ...prev]);
    setTimeout(() => savedScriptsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);

    const supabase = supabaseRef.current;
    if (user && supabase) {
      insertRemoteSavedScript(supabase, user.id, newScript).catch((err) =>
        console.error('[saved-scripts] Lưu Supabase thất bại:', err),
      );
    }
  }, [user]);

  const handleUpdateScript = useCallback((updated: SavedScript) => {
    setSavedScripts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));

    const supabase = supabaseRef.current;
    if (user && supabase) {
      updateRemoteSavedScript(supabase, updated).catch((err) =>
        console.error('[saved-scripts] Cập nhật Supabase thất bại:', err),
      );
    }
  }, [user]);

  const handleDeleteScript = useCallback((id: string) => {
    setSavedScripts((prev) => prev.filter((s) => s.id !== id));

    const supabase = supabaseRef.current;
    if (user && supabase) {
      deleteRemoteSavedScript(supabase, id).catch((err) =>
        console.error('[saved-scripts] Xóa Supabase thất bại:', err),
      );
    }
  }, [user]);

  const handleMenuClick = (menuId: string, view: AppView) => {
    setActiveMenuId(menuId);
    setCurrentView(view);
    setSidebarOpen(false);
    setActiveTool(null);
  };

  const handleOpenVideoDetail = useCallback(() => {
    setCurrentView('video-detail');
    setActiveMenuId('video-library');
    setActiveTool(null);
    setSidebarOpen(false);
  }, []);

  const handleToolClick = (toolId: CreativeToolId) => {
    setCurrentView('video-detail');
    setActiveMenuId('video-library');
    setSidebarOpen(false);

    setActiveTool(null);

    switch (toolId) {
      case 'character': setTimeout(() => scrollToRef(characterSectionRef), 50); break;
      case 'content': setFocusContentKey((k) => k + 1); setTimeout(() => scrollToRef(inputSectionRef), 50); break;
      case 'scene-gallery': setTimeout(() => scrollToRef(sceneSectionRef), 50); break;
      case 'timeline': setTimeout(() => scrollToRef(timelineSectionRef), 50); break;
      case 'voice-speed': setFocusVoiceSpeedKey((k) => k + 1); setTimeout(() => scrollToRef(inputSectionRef), 50); break;
      case 'scene-style': setFocusSceneStyleKey((k) => k + 1); setTimeout(() => scrollToRef(inputSectionRef), 50); break;
      case 'background-music': setFocusBgmKey((k) => k + 1); setTimeout(() => scrollToRef(timelineSectionRef), 50); break;
    }
  };

  const handlePresetSelect = (preset: PresetScript) => {
    setCurrentView('video-detail');
    setActiveMenuId('video-library');
    setSidebarOpen(false);
    setSelectedPreset(preset);
  };

  // Bắt buộc đăng nhập mới dùng được app — API Key và toàn bộ dữ liệu giờ lưu theo tài
  // khoản Supabase (không còn chế độ khách/localStorage), nên chặn hẳn UI chính tại đây.
  if (authLoading) {
    return (
      <div className="relative isolate flex h-screen items-center justify-center bg-background">
        <AppBackground darkOverlay />
        <Loader2 className="w-6 h-6 animate-spin text-white/80" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative isolate flex h-screen items-center justify-center px-4">
        <AppBackground darkOverlay />
        <div className="w-full max-w-sm bg-card/90 backdrop-blur-md border border-border rounded-2xl p-8 text-center space-y-5 shadow-2xl">
          {/* eslint-disable-next-line @next/next/no-img-element -- unoptimized:true toàn app (next.config.mjs) */}
          <img src={LOGO_URL} alt={SITE_NAME} className="h-12 w-auto object-contain mx-auto" />
          <div>
            <h1 className="text-lg font-semibold text-foreground">Đăng nhập để tiếp tục</h1>
            <p className="text-sm text-muted-foreground mt-1.5">
              Cần đăng nhập bằng Google để dùng HTStudio — API Key và video của bạn được lưu an toàn theo tài khoản.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={() => signInWithGoogle()}
            loading={signingIn}
            className="w-full py-2.5 bg-background hover:border-primary/40 hover:bg-muted/30"
          >
            {!signingIn && <GoogleIcon className="w-4 h-4" />}
            {signingIn ? 'Đang chuyển tới Google...' : 'Đăng nhập bằng Google'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <VideoLibraryProvider>
      <VeoModelsProvider>
        <div className="flex h-screen bg-background overflow-hidden">
          <SidebarDisabledToolsGate>
            {(disabledTools) => (
              <>
                <div className="hidden md:flex shrink-0">
                  <Sidebar
                    activeMenuId={activeMenuId}
                    activeTool={activeTool}
                    collapsed={sidebarCollapsed}
                    onToggleCollapse={toggleSidebarCollapsed}
                    onMenuClick={handleMenuClick}
                    onToolClick={handleToolClick}
                    onPresetSelect={handlePresetSelect}
                    disabledTools={disabledTools}
                  />
                </div>

                <MobileSidebarDrawer
                  open={sidebarOpen}
                  onClose={() => setSidebarOpen(false)}
                  activeView={currentView}
                  activeMenuId={activeMenuId}
                  activeTool={activeTool}
                  onMenuClick={handleMenuClick}
                  onToolClick={handleToolClick}
                  onPresetSelect={handlePresetSelect}
                  disabledTools={disabledTools}
                />
              </>
            )}
          </SidebarDisabledToolsGate>

          <div id="main-content" tabIndex={-1} className="relative isolate flex-1 flex flex-col overflow-hidden min-w-0 outline-none">
            <AppBackground opacity={35} />
            {currentView === 'video-detail' ? (
              <VideoDetailView
                activeTool={activeTool}
                setActiveTool={setActiveTool}
                focusVoiceSpeedKey={focusVoiceSpeedKey}
                focusSceneStyleKey={focusSceneStyleKey}
                focusContentKey={focusContentKey}
                setFocusContentKey={setFocusContentKey}
                focusBgmKey={focusBgmKey}
                setFocusBgmKey={setFocusBgmKey}
                selectedPreset={selectedPreset}
                setSelectedPreset={setSelectedPreset}
                characterSectionRef={characterSectionRef}
                inputSectionRef={inputSectionRef}
                sceneSectionRef={sceneSectionRef}
                timelineSectionRef={timelineSectionRef}
                characterMasterRef={characterMasterRef}
                savedScripts={savedScripts}
                savedScriptsSectionRef={savedScriptsSectionRef}
                onSaveScript={handleSaveScript}
                onUpdateScript={handleUpdateScript}
                onDeleteScript={handleDeleteScript}
                scrollToRef={scrollToRef}
                onBack={() => setCurrentView('video-library')}
              />
            ) : (
              <>
                <Header
                  title={viewTitles[currentView]}
                  onMenuOpen={() => setSidebarOpen(true)}
                />
                <div className="flex-1 overflow-y-auto">
                  <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-6">
                    {currentView === 'video-library' && <VideoLibraryView onOpenDetail={handleOpenVideoDetail} />}
                    {currentView === 'api-keys' && <ApiKeysManagement />}
                    {currentView === 'payment' && <PaymentView />}
                    {currentView === 'transaction-history' && <TransactionHistoryView />}
                    {currentView === 'video-log' && <VideoLogView />}
                    {currentView === 'render-history' && <RenderHistorySettings />}
                  </div>
                </div>
              </>
            )}
          </div>

          <MobileNav
            activeView={currentView}
            onMenuClick={handleMenuClick}
            onMenuOpen={() => setSidebarOpen(true)}
          />
        </div>
      </VeoModelsProvider>
    </VideoLibraryProvider>
  );
}
