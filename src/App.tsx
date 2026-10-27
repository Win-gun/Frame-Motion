import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Expand,
  Film,
  ImagePlus,
  Layers,
  LoaderCircle,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  SkipBack,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { FloatingPhoto } from './video/FloatingPhoto';
import { createRecipe, getTimeline } from './shared/recipe';
import { exifKeys, type ExifKey, type RenderJob, type VideoRecipe } from './shared/types';
import { useEditor } from './store';
import { enqueueRecipeBatches } from './shared/batch';

const presetLabels = {
  soft: 'Soft Reveal',
  gallery: 'Gallery Lift',
  shutter: 'Shutter Reveal',
  cinematic: 'Cinematic Push',
  still: 'Still',
};
const presetDescriptions = {
  soft: '柔和渐入，轻盈呈现',
  gallery: '缓缓升起，空间浮现',
  shutter: '快门一瞬，定格作品',
  cinematic: '缓慢推进，沉浸构图',
  still: '保留完整、静止画面',
};
const fieldLabels: Record<ExifKey, string> = {
  focalLength: '焦距',
  aperture: '光圈',
  shutter: '快门',
  iso: 'ISO',
  camera: '相机型号',
  lens: '镜头名称',
  equivalent: '35mm 等效焦距',
  date: '拍摄时间',
};
const statusLabels: Record<RenderJob['status'], string> = {
  queued: '等待中',
  bundling: '准备渲染',
  rendering: '逐帧渲染',
  encoding: '编码中',
  done: '已完成',
  failed: '导出失败',
  cancelled: '已取消',
};
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  const body = await res.json().catch(() => ({ error: '服务返回了无效响应' }));
  if (!res.ok) throw new Error(body.error || body.errors?.join('；') || `请求失败 (${res.status})`);
  return body;
}
function IconButton({
  label,
  children,
  onClick,
  active = false,
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`icon-button ${active ? 'active' : ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Section({
  title,
  en,
  children,
  open = false,
}: {
  title: string;
  en: string;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details className="section" open={open}>
      <summary>
        <span>
          {title}
          <small>{en}</small>
        </span>
        <ChevronDown size={14} />
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
}
function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  suffix = '',
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="slider-field">
      <div className="field-label">
        <label>{label}</label>
        <div className="number-unit">
          <input
            aria-label={`${label}数值`}
            type="number"
            min={min}
            max={max}
            step={step}
            value={Number(value.toFixed(3))}
            onChange={(e) => {
              if (e.target.value !== '')
                onChange(Math.max(min, Math.min(max, Number(e.target.value))));
            }}
          />
          <span>{suffix}</span>
        </div>
      </div>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
}) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <span className="select-wrap">
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map(([v, t]) => (
            <option key={v} value={v}>
              {t}
            </option>
          ))}
        </select>
        <ChevronDown size={12} />
      </span>
    </label>
  );
}
function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="toggle-field">
      <span>{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle" />
    </label>
  );
}
function Timeline({
  recipe,
  frame,
  seek,
  update,
}: {
  recipe: VideoRecipe;
  frame: number;
  seek: (f: number) => void;
  update: (fn: (r: VideoRecipe) => VideoRecipe) => void;
}) {
  const t = getTimeline(recipe);
  const duration = t.durationInFrames / recipe.fps;
  const track = useRef<HTMLDivElement>(null);
  const beginDrag = (e: React.PointerEvent, kind: 'scrub' | 'intro' | 'outro' | 'metadata') => {
    e.preventDefault();
    e.stopPropagation();
    const box = track.current!.getBoundingClientRect();
    const move = (event: PointerEvent | React.PointerEvent) => {
      const f = Math.round(
        Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)) * (t.durationInFrames - 1),
      );
      if (kind === 'scrub') seek(f);
      else
        update((r) => {
          if (kind === 'intro') r.timeline.introDuration = f / r.fps;
          if (kind === 'outro') r.timeline.outroDuration = (t.durationInFrames - f) / r.fps;
          if (kind === 'metadata') r.timeline.metadataDelay = f / r.fps;
          return r;
        });
    };
    move(e);
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
  };
  const ticks = Array.from(
    { length: Math.min(9, Math.ceil(duration) + 1) },
    (_, i) => (i * duration) / Math.min(8, Math.ceil(duration)),
  );
  return (
    <div className="timeline">
      <div className="timeline-heading">
        <span>
          <Layers size={13} /> 动画时间轴
        </span>
        <span className="timeline-legend">
          <i className="intro-dot" />
          入场
          <i className="hold-dot" />
          作品展示
          <i className="outro-dot" />
          收尾
        </span>
        <span className="hint">拖动边界调整时长</span>
      </div>
      <div className="timeline-grid">
        <div className="track-labels">
          <span>时间</span>
          <span>
            <Film size={12} /> 作品
          </span>
          <span>
            <SlidersHorizontal size={12} /> 参数
          </span>
        </div>
        <div className="tracks" ref={track} onPointerDown={(e) => beginDrag(e, 'scrub')}>
          <div className="ruler">
            {ticks.map((s, i) => (
              <span key={i} style={{ left: `${(s / duration) * 100}%` }}>
                {s.toFixed(1)}s
              </span>
            ))}
          </div>
          <div className="photo-track" style={{ backgroundImage: `url("${recipe.image.src}")` }}>
            <div
              className="phase intro"
              style={{ width: `${(t.introFrames / t.durationInFrames) * 100}%` }}
            >
              <span>入场</span>
            </div>
            <div
              className="phase hold"
              style={{
                left: `${(t.introFrames / t.durationInFrames) * 100}%`,
                right: `${(t.outroFrames / t.durationInFrames) * 100}%`,
              }}
            >
              <span>{(t.holdFrames / recipe.fps).toFixed(2)}s · 完整展示</span>
            </div>
            <div
              className="phase outro"
              style={{ width: `${(t.outroFrames / t.durationInFrames) * 100}%` }}
            >
              <span>{recipe.timeline.exit === 'hold' ? '保持' : '淡出'}</span>
            </div>
            <button
              aria-label="拖动入场边界"
              className="boundary"
              style={{ left: `${(t.introFrames / t.durationInFrames) * 100}%` }}
              onPointerDown={(e) => beginDrag(e, 'intro')}
            />
            <button
              aria-label="拖动出场边界"
              className="boundary"
              style={{ left: `${(1 - t.outroFrames / t.durationInFrames) * 100}%` }}
              onPointerDown={(e) => beginDrag(e, 'outro')}
            />
          </div>
          <div className="metadata-track">
            <div
              className="metadata-clip"
              style={{
                left: `${(t.metadataDelayFrames / t.durationInFrames) * 100}%`,
                width: `${(Math.max(1, t.metadataFrames) / t.durationInFrames) * 100}%`,
              }}
              onPointerDown={(e) => beginDrag(e, 'metadata')}
              title="拖动调整参数出现时间"
            >
              <span>参数淡入</span>
            </div>
          </div>
          <div
            className="playhead"
            style={{ left: `${(frame / Math.max(1, t.durationInFrames - 1)) * 100}%` }}
          >
            <i />
          </div>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const { recipes, selectedId, projectName, add, select, update, remove, applyAll, rename } =
    useEditor();
  const recipe = recipes.find((r) => r.image.id === selectedId);
  const player = useRef<PlayerRef>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previewArea = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [guides, setGuides] = useState(false);
  const [expandedPreview, setExpandedPreview] = useState(false);
  const [importing, setImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [jobs, setJobs] = useState<RenderJob[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportBatch, setExportBatch] = useState(false);
  const [inspector, setInspector] = useState<'design' | 'timing'>('design');
  const [previewSize, setPreviewSize] = useState({ width: 480, height: 540 });
  const [zoom, setZoom] = useState('fit');
  const [customRatio, setCustomRatio] = useState('9:16');
  const [showHelp, setShowHelp] = useState(false);
  const [playingOutput, setPlayingOutput] = useState<string | null>(null);
  const [connected, setConnected] = useState(true);
  const timeline = recipe ? getTimeline(recipe) : null;
  useEffect(() => {
    if (!exportOpen && !showHelp) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>('[role="dialog"]');
    const selector = 'button:not(:disabled),a[href],input,select,[tabindex="0"]';
    modal?.querySelector<HTMLElement>(selector)?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExportOpen(false);
        setShowHelp(false);
      }
      if (e.key === 'Tab' && modal) {
        const items = Array.from(modal.querySelectorAll<HTMLElement>(selector)).filter(
          (el) => el.getClientRects().length > 0,
        );
        const first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', keydown);
    return () => {
      window.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [exportOpen, showHelp]);
  useEffect(() => {
    let cancelled = false;
    api<{ photos: VideoRecipe['image'][] }>('/api/demo')
      .then((data) => {
        if (!cancelled) add(data.photos, true);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [add]);
  useEffect(() => {
    if (!toast) return;
    const timeout = setTimeout(() => setToast(''), 4000);
    return () => clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    let alive = true;
    const refresh = () =>
      api<{ jobs: RenderJob[] }>('/api/jobs')
        .then((data) => {
          if (alive) {
            setJobs(data.jobs);
            setConnected(true);
          }
        })
        .catch(() => {
          if (alive) setConnected(false);
        });
    void refresh();
    const interval = setInterval(refresh, 1000);
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, []);
  useEffect(() => {
    if (!previewArea.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setPreviewSize({
        width: Math.max(160, entry.contentRect.width - 96),
        height: Math.max(180, entry.contentRect.height - 48),
      });
    });
    observer.observe(previewArea.current);
    return () => observer.disconnect();
  }, [loading]);
  useEffect(() => {
    const ref = player.current;
    if (!ref) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => setFrame(detail.frame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    ref.addEventListener('frameupdate', onFrame);
    ref.addEventListener('play', onPlay);
    ref.addEventListener('pause', onPause);
    ref.addEventListener('ended', onPause);
    return () => {
      ref.removeEventListener('frameupdate', onFrame);
      ref.removeEventListener('play', onPlay);
      ref.removeEventListener('pause', onPause);
      ref.removeEventListener('ended', onPause);
    };
  }, [Boolean(recipe), loading]);
  useEffect(() => {
    if (recipe) {
      const target = Math.min(
        player.current?.getCurrentFrame() || Math.round(recipe.fps * 1.5),
        getTimeline(recipe).durationInFrames - 1,
      );
      player.current?.seekTo(target);
      setFrame(target);
    }
  }, [selectedId, recipe?.durationSeconds, recipe?.fps, loading]);
  const toggleFullscreen = () => {
    if (expandedPreview) {
      setExpandedPreview(false);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    } else {
      setExpandedPreview(true);
      const editor = previewArea.current?.parentElement;
      if (editor?.requestFullscreen) void editor.requestFullscreen().catch(() => {});
    }
  };
  useEffect(() => {
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpandedPreview(false);
    };
    let enteredNative = false;
    const changed = () => {
      if (document.fullscreenElement) enteredNative = true;
      else if (enteredNative) setExpandedPreview(false);
    };
    window.addEventListener('keydown', escape);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      window.removeEventListener('keydown', escape);
      document.removeEventListener('fullscreenchange', changed);
    };
  }, []);
  const togglePlay = useCallback(() => {
    if (!player.current) return;
    player.current.toggle();
  }, []);
  const seek = useCallback((f: number) => {
    player.current?.seekTo(f);
    setFrame(f);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,select,textarea,button') || exportOpen) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      }
      if (recipe && (e.code === 'ArrowRight' || e.code === 'ArrowLeft')) {
        e.preventDefault();
        seek(
          Math.max(
            0,
            Math.min(
              getTimeline(recipe).durationInFrames - 1,
              (player.current?.getCurrentFrame() || 0) + (e.code === 'ArrowRight' ? 1 : -1),
            ),
          ),
        );
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [recipe, togglePlay, seek, exportOpen]);
  const importFiles = async (files: FileList | File[]) => {
    if (!files.length) return;
    setImporting(true);
    setError('');
    const form = new FormData();
    Array.from(files).forEach((file) => form.append('photos', file));
    try {
      const result = await api<{ photos: VideoRecipe['image'][]; errors?: string[] }>(
        '/api/import',
        { method: 'POST', body: form },
      );
      add(result.photos);
      setToast(`已导入 ${result.photos.length} 张照片`);
      if (result.errors?.length) setError(result.errors.join('；'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };
  useEffect(() => {
    if (recipe) setCustomRatio(recipe.canvasRatio);
  }, [recipe?.canvasRatio]);
  const startExport = async (batch = exportBatch, retryRecipe?: VideoRecipe) => {
    const chosen = retryRecipe ? [retryRecipe] : batch ? recipes : recipe ? [recipe] : [];
    if (!chosen.length) return;
    setExporting(true);
    setError('');
    try {
      const accepted = await enqueueRecipeBatches(
        chosen,
        async (batch) =>
          (
            await api<{ jobs: RenderJob[] }>('/api/jobs', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ recipes: batch }),
            })
          ).jobs,
        (added) => {
          setJobs((previous) => [
            ...added,
            ...previous.filter((j) => !added.some((n) => n.id === j.id)),
          ]);
          setExportOpen(true);
        },
      );
      setToast(`已加入 ${accepted} 个导出任务`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  };
  const cancelJob = async (id: string) => {
    try {
      await api(`/api/jobs/${id}/cancel`, { method: 'POST' });
      const result = await api<{ jobs: RenderJob[] }>('/api/jobs');
      setJobs(result.jobs);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const deleteJob = async (id: string) => {
    try {
      await api(`/api/jobs/${id}`, { method: 'DELETE' });
      setJobs((items) => items.filter((j) => j.id !== id));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const activeJobs = jobs.filter((j) => !['done', 'failed', 'cancelled'].includes(j.status));
  const finished = jobs.filter((j) => j.status === 'done');
  const setNested = <
    K extends 'timeline' | 'backgroundStyle' | 'photoLayout' | 'typography' | 'exportSettings',
  >(
    group: K,
    key: keyof VideoRecipe[K],
    value: unknown,
  ) =>
    update((r) => {
      (r[group] as Record<string, unknown>)[key as string] = value;
      return r;
    });
  const currentSeconds = recipe ? frame / recipe.fps : 0;
  const secondsText = (v: number) =>
    `${Math.floor(v / 60)
      .toString()
      .padStart(2, '0')}:${(v % 60).toFixed(2).padStart(5, '0')}`;
  const fitScale = recipe
    ? Math.min(previewSize.width / recipe.videoWidth, previewSize.height / recipe.videoHeight)
    : 1;
  const scale = fitScale * (zoom === 'fit' ? 1 : Number(zoom));
  return (
    <div
      className="app-shell"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          void importFiles(e.dataTransfer.files);
        }
      }}
    >
      <input
        ref={fileInput}
        className="hidden"
        type="file"
        accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif"
        multiple
        onChange={(e) => {
          if (e.target.files) void importFiles(e.target.files);
        }}
      />
      <header className="app-header">
        <a className="brand" href="/" aria-label="Frame Motion 首页">
          <span className="brand-mark">
            <i />
            <i />
          </span>
          <span>
            frame<span className="brand-light">motion</span>
            <small>LOCAL STUDIO</small>
          </span>
        </a>
        <span className="header-divider" />
        <div className="project-heading">
          <input
            aria-label="项目名称"
            value={projectName}
            onChange={(e) => rename(e.target.value)}
          />
          <span className="session-label">
            <i />
            本地工作区
          </span>
        </div>
        <div className="header-actions">
          <button
            className="button quiet import-top"
            onClick={() => fileInput.current?.click()}
            disabled={importing}
          >
            {importing ? <LoaderCircle className="spin" size={14} /> : <ImagePlus size={15} />}
            导入照片
          </button>
          <button
            className="button export-button"
            onClick={() => setExportOpen(true)}
            disabled={!recipe}
          >
            <ArrowUpFromLine size={15} />
            导出视频
            <ChevronDown size={12} />
          </button>
        </div>
      </header>
      <div className="workspace">
        <aside className="assets-panel">
          <div className="panel-heading">
            <span>
              照片素材 <small>{String(recipes.length).padStart(2, '0')}</small>
            </span>
            <IconButton
              label="添加照片"
              onClick={() => fileInput.current?.click()}
              disabled={importing}
            >
              <Plus size={16} />
            </IconButton>
          </div>
          <div className="asset-list">
            {recipes.map((r, index) => (
              <div
                key={r.image.id}
                className={`asset ${selectedId === r.image.id ? 'selected' : ''}`}
              >
                <button className="asset-select" onClick={() => select(r.image.id)}>
                  <div className="asset-image">
                    <img src={r.image.src} alt={r.image.name} />
                    <span className="asset-index">{String(index + 1).padStart(2, '0')}</span>
                    {selectedId === r.image.id && (
                      <span className="asset-check">
                        <Check size={11} />
                      </span>
                    )}
                    <span className="asset-duration">{r.durationSeconds.toFixed(1)}s</span>
                  </div>
                  <span className="asset-title">{r.image.name}</span>
                  <span className="asset-meta">
                    <i className={r.image.exif.hasExif ? 'exif-dot' : 'manual-dot'} />
                    {r.image.exif.hasExif
                      ? 'EXIF 已读取'
                      : r.image.id.startsWith('demo-')
                        ? '手动示例参数'
                        : Object.values(r.exif.values).some(Boolean)
                          ? '手动参数'
                          : '可手动填写参数'}
                    <span>
                      {r.image.width} × {r.image.height}
                    </span>
                  </span>
                </button>
                <button
                  className="remove-photo"
                  aria-label={`移除 ${r.image.name}`}
                  title="从项目移除"
                  onClick={() => remove(r.image.id)}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              className="add-asset"
              onClick={() => fileInput.current?.click()}
              disabled={importing}
            >
              {importing ? (
                <LoaderCircle size={20} className="spin" />
              ) : (
                <Plus size={22} strokeWidth={1} />
              )}
              <span>{importing ? '正在本地处理…' : '添加照片'}</span>
              <small>JPG · PNG · HEIC</small>
            </button>
          </div>
          <div className="assets-bottom">
            <button
              className="apply-all"
              disabled={!recipe || recipes.length < 2}
              onClick={() => {
                applyAll();
                setToast('当前设计已应用到全部照片，各自 EXIF 已保留');
              }}
            >
              <Copy size={13} />
              应用当前设计到全部
            </button>
            <div className="local-note">
              <ShieldCheck size={12} />
              <span>照片与渲染，始终留在本机</span>
            </div>
          </div>
        </aside>
        <main className={`editor ${expandedPreview ? 'preview-expanded' : ''}`}>
          <div className="preview-toolbar">
            <div>
              <span className="eyebrow">实时预览</span>
              <span className="toolbar-dot">/</span>
              <span className="preview-title">Floating Photo Reveal</span>
            </div>
            <div className="toolbar-right">
              <IconButton label="安全边距辅助线" onClick={() => setGuides(!guides)} active={guides}>
                <span className="guide-icon" />
              </IconButton>
              <select
                aria-label="预览缩放"
                className="zoom-select"
                value={zoom}
                onChange={(e) => setZoom(e.target.value)}
              >
                <option value="fit">适应窗口</option>
                <option value="0.75">75% 适应</option>
                <option value="1.25">125% 适应</option>
              </select>
              <IconButton
                label={expandedPreview ? '退出全屏预览' : '全屏预览'}
                onClick={toggleFullscreen}
                active={expandedPreview}
                disabled={!recipe}
              >
                <Expand size={15} />
              </IconButton>
            </div>
          </div>
          <div className="preview-area" ref={previewArea}>
            {loading ? (
              <div className="empty-state">
                <LoaderCircle className="spin" size={24} />
                <p>正在准备本地工作区</p>
              </div>
            ) : recipe ? (
              <>
                <div className="canvas-dimension top">
                  {recipe.canvasRatio}
                  <span>·</span>
                  {recipe.videoWidth} × {recipe.videoHeight}
                </div>
                <div
                  className="preview-frame"
                  style={{ width: recipe.videoWidth * scale, height: recipe.videoHeight * scale }}
                >
                  <Player
                    ref={player}
                    component={FloatingPhoto}
                    initialFrame={Math.min(
                      Math.round(recipe.fps * 1.5),
                      timeline!.durationInFrames - 1,
                    )}
                    inputProps={{ recipe }}
                    durationInFrames={timeline!.durationInFrames}
                    compositionWidth={recipe.videoWidth}
                    compositionHeight={recipe.videoHeight}
                    fps={recipe.fps}
                    loop={loop}
                    controls={false}
                    clickToPlay={false}
                    style={{ width: '100%', height: '100%' }}
                  />
                  {guides && (
                    <div className="safe-guides" aria-label="安全边距，仅预览可见">
                      <span>SAFE AREA</span>
                    </div>
                  )}
                </div>
                <div className="preview-caption">
                  <span className="small-diamond" />
                  作品先于一切
                  <span className="caption-rule" />
                  <span>FLOATING PHOTO REVEAL</span>
                </div>
              </>
            ) : (
              <div className="empty-state">
                <ImagePlus size={32} strokeWidth={1} />
                <h2>让静止的作品，有了呼吸。</h2>
                <p>导入一张照片，开始制作成片展示视频</p>
                <button className="button export-button" onClick={() => fileInput.current?.click()}>
                  导入照片
                </button>
              </div>
            )}
          </div>
          <div className="transport">
            <div className="transport-left">
              <span className="live-indicator" />
              逐帧预览<span className="transport-fps">{recipe?.fps || 30} FPS</span>
            </div>
            <div className="transport-controls">
              <IconButton
                label="从头播放"
                onClick={() => {
                  seek(0);
                  player.current?.play();
                }}
                disabled={!recipe}
              >
                <SkipBack size={14} />
              </IconButton>
              <IconButton
                label="上一帧"
                onClick={() => seek(Math.max(0, frame - 1))}
                disabled={!recipe}
              >
                <ChevronRight size={15} style={{ transform: 'rotate(180deg)' }} />
              </IconButton>
              <button
                className="play-button"
                aria-label={playing ? '暂停' : '播放'}
                onClick={togglePlay}
                disabled={!recipe}
              >
                {playing ? (
                  <Pause size={15} fill="currentColor" />
                ) : (
                  <Play size={15} fill="currentColor" />
                )}
              </button>
              <IconButton
                label="下一帧"
                onClick={() => seek(Math.min(timeline!.durationInFrames - 1, frame + 1))}
                disabled={!recipe}
              >
                <ChevronRight size={15} />
              </IconButton>
              <IconButton label="循环播放" onClick={() => setLoop(!loop)} active={loop}>
                <RefreshCw size={14} />
              </IconButton>
            </div>
            <div className="timecode">
              <strong>{secondsText(currentSeconds)}</strong>
              <span>/</span>
              {secondsText(timeline && recipe ? timeline.durationInFrames / recipe.fps : 0)}
            </div>
          </div>
          {recipe ? (
            <Timeline recipe={recipe} frame={frame} seek={seek} update={update} />
          ) : (
            <div className="timeline empty-timeline" />
          )}
        </main>
        <aside className="inspector">
          <div className="inspector-tabs">
            <button
              className={inspector === 'design' ? 'selected' : ''}
              onClick={() => setInspector('design')}
            >
              画面设计
            </button>
            <button
              className={inspector === 'timing' ? 'selected' : ''}
              onClick={() => setInspector('timing')}
            >
              时间与动画
            </button>
            <SlidersHorizontal size={14} />
          </div>
          {recipe && (
            <div className="inspector-content">
              {inspector === 'design' ? (
                <>
                  <div className="template-block">
                    <div className="eyebrow">
                      展示模板 <span>01 / 01</span>
                    </div>
                    <div
                      className="template-preview"
                      style={{ backgroundColor: recipe.backgroundStyle.color }}
                    >
                      <img className="template-blur" src={recipe.image.backgroundSrc} />
                      <img className="template-photo" src={recipe.image.src} />
                      <span>
                        Floating Photo
                        <br />
                        <em>Reveal</em>
                      </span>
                      <i>
                        <Check size={12} />
                      </i>
                    </div>
                    <div className="template-foot">
                      <span>悬浮画框</span>
                      <span>EDITORIAL COLLECTION</span>
                    </div>
                  </div>
                  <Section title="画布" en="CANVAS" open>
                    <div className="ratio-options">
                      {['9:16', '16:9', '4:5', '1:1'].map((r) => (
                        <button
                          key={r}
                          className={recipe.canvasRatio === r ? 'selected' : ''}
                          onClick={() => update((c) => ({ ...c, canvasRatio: r }))}
                        >
                          <span className={`ratio-symbol ratio-${r.replace(':', '-')}`} />
                          {r}
                        </button>
                      ))}
                    </div>
                    <label className="custom-ratio">
                      <span>自定义比例</span>
                      <input
                        aria-label="自定义比例"
                        placeholder="例如 3:2"
                        value={customRatio}
                        onChange={(e) => setCustomRatio(e.target.value)}
                        onBlur={() => {
                          if (/^\d+(\.\d+)?:\d+(\.\d+)?$/.test(customRatio)) {
                            const [a, b] = customRatio.split(':').map(Number);
                            if (a / b >= 0.2 && a / b <= 5)
                              update((r) => ({ ...r, canvasRatio: customRatio }));
                            else setError('画面宽高比需在 1:5 至 5:1 之间');
                          } else setError('请输入有效比例，例如 3:2');
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                        }}
                      />
                    </label>
                    <Select
                      label="输出分辨率"
                      value={recipe.exportSettings.resolution}
                      options={['720p', '1080p', '2K', '4K'].map((v) => [
                        v,
                        v === '1080p' ? '1080p · Full HD' : v,
                      ])}
                      onChange={(v) => setNested('exportSettings', 'resolution', v)}
                    />
                    <div className="resolution-note">
                      {recipe.videoWidth} × {recipe.videoHeight} px
                    </div>
                  </Section>
                  <Section title="照片" en="PHOTO" open>
                    <Select
                      label="图文布局"
                      value={recipe.photoLayout.arrangement ?? 'auto'}
                      options={[
                        ['auto', '自动 · 横屏竖图左右排列'],
                        ['stacked', '上下排列'],
                        ['photo-left', '照片在左 · 文字在右'],
                        ['photo-right', '照片在右 · 文字在左'],
                      ]}
                      onChange={(v) => setNested('photoLayout', 'arrangement', v)}
                    />
                    <Slider
                      label="主体尺寸"
                      value={recipe.photoLayout.size}
                      min={10}
                      max={200}
                      suffix="%"
                      onChange={(v) => setNested('photoLayout', 'size', v)}
                      hint="100% 为布局基准尺寸；继续放大可超出画布边缘。"
                    />
                    <div className="two-fields">
                      <Slider
                        label="水平位置"
                        value={recipe.photoLayout.x}
                        min={-100}
                        max={100}
                        suffix="%"
                        onChange={(v) => setNested('photoLayout', 'x', v)}
                      />
                      <Slider
                        label="垂直位置"
                        value={recipe.photoLayout.y}
                        min={-100}
                        max={100}
                        suffix="%"
                        onChange={(v) => setNested('photoLayout', 'y', v)}
                      />
                    </div>
                    <p className="hint">位置以画布宽高为基准。0% 为当前布局的默认位置。</p>
                    <button
                      className="button quiet full-width reset-layout"
                      onClick={() =>
                        update((r) => ({
                          ...r,
                          photoLayout: {
                            ...r.photoLayout,
                            arrangement: 'auto',
                            size: 90,
                            x: 0,
                            y: 0,
                          },
                        }))
                      }
                    >
                      <RotateCcw size={12} />
                      重置构图
                    </button>
                    <Select
                      label="照片适配"
                      value={recipe.photoLayout.fit}
                      options={[
                        ['contain', '完整显示 · 保留原比例'],
                        ['cover', '填充画框 · 允许裁切'],
                      ]}
                      onChange={(v) => setNested('photoLayout', 'fit', v)}
                    />
                    <Slider
                      label="圆角"
                      value={recipe.photoLayout.radius}
                      max={40}
                      suffix="px"
                      onChange={(v) => setNested('photoLayout', 'radius', v)}
                    />
                    <Slider
                      label="空间阴影"
                      value={recipe.photoLayout.shadow * 100}
                      max={100}
                      suffix="%"
                      onChange={(v) => setNested('photoLayout', 'shadow', v / 100)}
                    />
                    <Slider
                      label="边缘描线"
                      value={recipe.photoLayout.border}
                      max={4}
                      step={0.1}
                      suffix="px"
                      onChange={(v) => setNested('photoLayout', 'border', v)}
                    />
                    <Slider
                      label="轻微悬浮"
                      value={recipe.photoLayout.float * 100}
                      max={100}
                      suffix="%"
                      onChange={(v) => setNested('photoLayout', 'float', v / 100)}
                    />
                  </Section>
                  <Section title="背景" en="BACKGROUND" open>
                    <Select
                      label="背景模式"
                      value={recipe.backgroundStyle.mode}
                      options={[
                        ['static', 'Static Blur · 静态模糊'],
                        ['drift', 'Gentle Drift · 缓慢游移'],
                        ['wave', 'Atmospheric Wave · 氛围波动'],
                        ['breathe', 'Breathing Light · 呼吸光线'],
                      ]}
                      onChange={(v) => setNested('backgroundStyle', 'mode', v)}
                    />
                    <Toggle
                      label="背景运动"
                      checked={recipe.backgroundStyle.enabled}
                      onChange={(v) => setNested('backgroundStyle', 'enabled', v)}
                    />
                    <Slider
                      label="高斯模糊"
                      value={recipe.backgroundStyle.blur}
                      max={80}
                      suffix="px"
                      onChange={(v) => setNested('backgroundStyle', 'blur', v)}
                    />
                    <Slider
                      label="图片不透明度"
                      value={recipe.backgroundStyle.opacity * 100}
                      min={0}
                      max={100}
                      suffix="%"
                      onChange={(v) => setNested('backgroundStyle', 'opacity', v / 100)}
                    />
                    <Slider
                      label="背景暗化"
                      value={recipe.backgroundStyle.darken * 100}
                      max={70}
                      suffix="%"
                      onChange={(v) => setNested('backgroundStyle', 'darken', v / 100)}
                    />
                    <label className="color-field">
                      <span>底色</span>
                      <input
                        type="color"
                        aria-label="背景底色"
                        value={recipe.backgroundStyle.color}
                        onChange={(e) => setNested('backgroundStyle', 'color', e.target.value)}
                      />
                      <code>{recipe.backgroundStyle.color.toUpperCase()}</code>
                      <button
                        title="使用照片推荐色"
                        aria-label="使用照片推荐色"
                        onClick={() => setNested('backgroundStyle', 'color', recipe.image.color)}
                      >
                        <RotateCcw size={12} />
                      </button>
                    </label>
                    <Slider
                      label="背景缩放"
                      value={recipe.backgroundStyle.scale * 100}
                      min={110}
                      max={150}
                      suffix="%"
                      onChange={(v) => setNested('backgroundStyle', 'scale', v / 100)}
                    />
                    <Slider
                      label="运动速度"
                      value={recipe.backgroundStyle.speed}
                      min={0.1}
                      max={3}
                      step={0.1}
                      suffix="×"
                      onChange={(v) => setNested('backgroundStyle', 'speed', v)}
                    />
                    <Slider
                      label="运动强度"
                      value={recipe.backgroundStyle.intensity * 100}
                      max={100}
                      suffix="%"
                      onChange={(v) => setNested('backgroundStyle', 'intensity', v / 100)}
                    />
                    <Slider
                      label="运动方向"
                      value={recipe.backgroundStyle.direction}
                      max={360}
                      suffix="°"
                      onChange={(v) => setNested('backgroundStyle', 'direction', v)}
                    />
                    <Toggle
                      label="循环背景运动"
                      checked={recipe.backgroundStyle.loop}
                      onChange={(v) => setNested('backgroundStyle', 'loop', v)}
                    />
                  </Section>
                  <Section title="摄影参数" en="METADATA">
                    <div className="exif-status">
                      <span className={recipe.image.exif.hasExif ? 'exif-dot' : 'manual-dot'} />
                      {recipe.image.exif.hasExif ? '已读取原始 EXIF' : '未检测到 EXIF，可手动填写'}
                      <button
                        aria-label="恢复原始 EXIF"
                        title="恢复原始 EXIF"
                        onClick={() =>
                          update((r) => {
                            r.exif.values = { ...r.image.exif.values };
                            return r;
                          })
                        }
                      >
                        <RotateCcw size={12} />
                      </button>
                    </div>
                    {exifKeys.map((key) => (
                      <div className="exif-field" key={key}>
                        <input
                          type="checkbox"
                          aria-label={`显示${fieldLabels[key]}`}
                          checked={recipe.exif.enabled[key]}
                          onChange={(e) =>
                            update((r) => {
                              r.exif.enabled[key] = e.target.checked;
                              return r;
                            })
                          }
                        />
                        <label>
                          <span>{fieldLabels[key]}</span>
                          <input
                            aria-label={fieldLabels[key]}
                            value={recipe.exif.values[key]}
                            placeholder="未填写"
                            onChange={(e) =>
                              update((r) => {
                                r.exif.values[key] = e.target.value;
                                r.exif.enabled[key] = true;
                                return r;
                              })
                            }
                          />
                        </label>
                        <button
                          title={`恢复${fieldLabels[key]}`}
                          aria-label={`恢复${fieldLabels[key]}`}
                          onClick={() =>
                            update((r) => {
                              r.exif.values[key] = r.image.exif.values[key];
                              return r;
                            })
                          }
                        >
                          <RotateCcw size={11} />
                        </button>
                      </div>
                    ))}
                  </Section>
                  <Section title="文字排版" en="TYPOGRAPHY">
                    <Select
                      label="字体"
                      value={recipe.typography.font}
                      options={[
                        ['sans', '系统无衬线'],
                        ['mono', '等宽数字'],
                      ]}
                      onChange={(v) => setNested('typography', 'font', v)}
                    />
                    <Slider
                      label="字号"
                      value={recipe.typography.size}
                      min={18}
                      max={56}
                      suffix="px"
                      onChange={(v) => setNested('typography', 'size', v)}
                    />
                    <Slider
                      label="字距"
                      value={recipe.typography.letterSpacing}
                      min={0}
                      max={6}
                      step={0.1}
                      suffix="px"
                      onChange={(v) => setNested('typography', 'letterSpacing', v)}
                    />
                    <Select
                      label="对齐"
                      value={recipe.typography.align}
                      options={[
                        ['left', '左对齐'],
                        ['center', '居中'],
                        ['right', '右对齐'],
                      ]}
                      onChange={(v) => setNested('typography', 'align', v)}
                    />
                    <Select
                      label="分隔符"
                      value={recipe.typography.separator}
                      options={[
                        ['·', '·  间隔点'],
                        ['/', '/  斜线'],
                        ['—', '—  短横线'],
                      ]}
                      onChange={(v) => setNested('typography', 'separator', v)}
                    />
                    <label className="color-field">
                      <span>文字颜色</span>
                      <input
                        type="color"
                        aria-label="文字颜色"
                        value={recipe.typography.color}
                        onChange={(e) => setNested('typography', 'color', e.target.value)}
                      />
                      <code>{recipe.typography.color}</code>
                    </label>
                    <Slider
                      label="文字垂直偏移"
                      value={recipe.typography.offset}
                      min={-80}
                      max={80}
                      suffix="px"
                      onChange={(v) => setNested('typography', 'offset', v)}
                    />
                  </Section>
                </>
              ) : (
                <>
                  <div className="timing-intro">
                    <span className="eyebrow">为作品留一点时间</span>
                    <h2>Motion, with restraint.</h2>
                    <p>细微的运动，完整的观看。</p>
                  </div>
                  <Section title="视频时长" en="DURATION" open>
                    <Slider
                      label="总时长"
                      value={recipe.durationSeconds}
                      min={1}
                      max={60}
                      step={0.1}
                      suffix="s"
                      onChange={(v) => update((r) => ({ ...r, durationSeconds: v }))}
                    />
                    <Select
                      label="帧率"
                      value={String(recipe.fps)}
                      options={[24, 25, 30, 60].map((v) => [String(v), `${v} fps`])}
                      onChange={(v) => update((r) => ({ ...r, fps: Number(v) }))}
                    />
                    <div className="frame-summary">
                      <span>实际输出</span>
                      <strong>
                        {timeline!.durationInFrames} 帧 ·{' '}
                        {(timeline!.durationInFrames / recipe.fps).toFixed(3)}s
                      </strong>
                    </div>
                    <button
                      className="tutorial-preset"
                      onClick={() => {
                        const image = recipe.image,
                          exif = recipe.exif;
                        const preset = createRecipe(image);
                        preset.durationSeconds = 3.5;
                        update(() => ({ ...preset, exif }));
                        setToast('已应用 Tutorial Insert · 3.5秒 / 30fps / 1080×1920');
                      }}
                    >
                      <Film size={13} />
                      <span>
                        Tutorial Insert<small>3.5s · 9:16 · 30fps · 保持末帧</small>
                      </span>
                      <ChevronRight size={14} />
                    </button>
                  </Section>
                  <Section title="入场动画" en="REVEAL" open>
                    <div className="motion-presets">
                      {Object.entries(presetLabels).map(([key, label]) => (
                        <button
                          key={key}
                          className={recipe.motionPreset === key ? 'selected' : ''}
                          onClick={() =>
                            update((r) => ({
                              ...r,
                              motionPreset: key as VideoRecipe['motionPreset'],
                            }))
                          }
                        >
                          <span className={`motion-symbol motion-${key}`}>
                            <i />
                          </span>
                          <span>
                            {label}
                            <small>{presetDescriptions[key as keyof typeof presetLabels]}</small>
                          </span>
                          {recipe.motionPreset === key && <Check size={13} />}
                        </button>
                      ))}
                    </div>
                    <Slider
                      label="入场时长"
                      value={recipe.timeline.introDuration}
                      max={Math.min(10, recipe.durationSeconds / 2)}
                      step={0.05}
                      suffix="s"
                      onChange={(v) => setNested('timeline', 'introDuration', v)}
                    />
                    <Select
                      label="缓动曲线"
                      value={recipe.timeline.easing}
                      options={[
                        ['ease-out', '柔和减速 · Ease out'],
                        ['spring', '克制弹簧 · Spring'],
                        ['linear', '线性 · Linear'],
                      ]}
                      onChange={(v) => setNested('timeline', 'easing', v)}
                    />
                  </Section>
                  <Section title="展示与收尾" en="HOLD & EXIT" open>
                    <div className="frame-summary">
                      <span>完整展示时长 · 自动分配</span>
                      <strong>{(timeline!.holdFrames / recipe.fps).toFixed(2)}s</strong>
                    </div>
                    <Slider
                      label="收尾时长"
                      value={recipe.timeline.outroDuration}
                      max={Math.min(10, recipe.durationSeconds / 2)}
                      step={0.05}
                      suffix="s"
                      onChange={(v) => setNested('timeline', 'outroDuration', v)}
                    />
                    <Select
                      label="结束方式"
                      value={recipe.timeline.exit}
                      options={[
                        ['hold', '保持最终画面'],
                        ['fade', '整体淡出至底色'],
                        ['background', '仅背景淡出'],
                      ]}
                      onChange={(v) => setNested('timeline', 'exit', v)}
                    />
                  </Section>
                  <Section title="参数出现" en="METADATA TIMING" open>
                    <Slider
                      label="出现延迟"
                      value={recipe.timeline.metadataDelay}
                      max={Math.max(0, recipe.durationSeconds - 0.1)}
                      step={0.05}
                      suffix="s"
                      onChange={(v) => setNested('timeline', 'metadataDelay', v)}
                    />
                    <Slider
                      label="淡入时长"
                      value={recipe.timeline.metadataDuration}
                      max={Math.min(5, recipe.durationSeconds)}
                      step={0.05}
                      suffix="s"
                      onChange={(v) => setNested('timeline', 'metadataDuration', v)}
                    />
                  </Section>
                  <Section title="快门闪白" en="SHUTTER">
                    <Toggle
                      label="启用快门闪白"
                      checked={recipe.timeline.shutter}
                      onChange={(v) => setNested('timeline', 'shutter', v)}
                    />
                    <Slider
                      label="闪白时长"
                      value={recipe.timeline.shutterDuration}
                      min={0.03}
                      max={0.3}
                      step={0.01}
                      suffix="s"
                      onChange={(v) => setNested('timeline', 'shutterDuration', v)}
                    />
                    <Slider
                      label="闪白强度"
                      value={recipe.timeline.shutterIntensity * 100}
                      max={100}
                      suffix="%"
                      onChange={(v) => setNested('timeline', 'shutterIntensity', v / 100)}
                    />
                  </Section>
                </>
              )}
              <div className="inspector-end">
                <span>FRAME MOTION</span>
                <small>Made for the frame.</small>
              </div>
            </div>
          )}
        </aside>
      </div>
      <footer className="statusbar">
        <span>
          <i className="status-dot" />
          {connected ? '本地引擎' : '本地服务已断开'}
          {activeJobs.length ? ` · ${activeJobs.length} 个任务正在处理` : connected ? '就绪' : ''}
        </span>
        <span className="status-shortcuts">
          <kbd>Space</kbd>播放 / 暂停<span>·</span>
          <kbd>← →</kbd>逐帧
        </span>
        <button onClick={() => setShowHelp(true)}>
          使用说明 <span>?</span>
        </button>
      </footer>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
      {error && (
        <div className="error-toast" role="alert">
          <span>{error}</span>
          <button aria-label="关闭错误" onClick={() => setError('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {exportOpen && recipe && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setExportOpen(false);
          }}
        >
          <section
            className="export-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
          >
            <div className="modal-heading">
              <div>
                <span className="eyebrow">THE FINISHED FRAME</span>
                <h2 id="export-title">把作品带进时间轴。</h2>
              </div>
              <IconButton label="关闭导出面板" onClick={() => setExportOpen(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <div className="export-layout">
              <div className="export-settings">
                <div className="export-still">
                  <img src={recipe.image.src} alt="待导出照片" />
                  <span>
                    {recipe.canvasRatio} / {recipe.exportSettings.resolution}
                  </span>
                </div>
                <Toggle
                  label={`批量导出全部 ${recipes.length} 张`}
                  checked={exportBatch}
                  onChange={setExportBatch}
                />
                <Select
                  label="视频格式"
                  value={recipe.exportSettings.codec}
                  options={[
                    ['h264', 'MP4 · H.264'],
                    ['prores', 'MOV · Apple ProRes 422'],
                  ]}
                  onChange={(v) => setNested('exportSettings', 'codec', v)}
                />
                <Select
                  label="分辨率"
                  value={recipe.exportSettings.resolution}
                  options={['720p', '1080p', '2K', '4K'].map((v) => [v, v])}
                  onChange={(v) => setNested('exportSettings', 'resolution', v)}
                />
                <Slider
                  label="编码画质"
                  value={recipe.exportSettings.quality}
                  min={40}
                  max={100}
                  suffix="%"
                  onChange={(v) => setNested('exportSettings', 'quality', v)}
                  hint="数值越高，画质和文件体积越高。ProRes 使用固定画质。"
                />
                <p className="export-spec">
                  {recipe.videoWidth} × {recipe.videoHeight} · {recipe.fps} fps · 无声
                  <br />
                  {timeline!.durationInFrames} 帧 ·{' '}
                  {(timeline!.durationInFrames / recipe.fps).toFixed(3)}s
                  {exportBatch && (
                    <>
                      <br />
                      批量任务使用每张照片当前的独立设置
                    </>
                  )}
                </p>
                <button
                  className="button export-button full-width"
                  disabled={exporting}
                  onClick={() => void startExport()}
                >
                  {exporting ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <ArrowUpFromLine size={15} />
                  )}
                  {exporting
                    ? '提交中…'
                    : exportBatch
                      ? `导出 ${recipes.length} 个视频`
                      : '导出当前视频'}
                </button>
              </div>
              <div className="export-jobs">
                <div className="jobs-heading">
                  <span>
                    导出队列 <small>{jobs.length}</small>
                  </span>
                  {activeJobs.length > 0 && (
                    <button
                      onClick={() => void Promise.all(activeJobs.map((j) => cancelJob(j.id)))}
                    >
                      取消未完成
                    </button>
                  )}
                </div>
                {jobs.length === 0 ? (
                  <div className="jobs-empty">
                    <Film size={28} strokeWidth={1} />
                    <p>完成的作品，下一站是剪辑时间轴。</p>
                    <small>本地逐帧渲染 · 无水印 · 无声</small>
                  </div>
                ) : (
                  <div className="jobs-list">
                    {jobs.map((job) => (
                      <div className={`job job-${job.status}`} key={job.id}>
                        <div className="job-heading">
                          <img src={job.recipe.image.src} alt="" />
                          <div>
                            <strong>{job.name}</strong>
                            <small>
                              {job.recipe.videoWidth} × {job.recipe.videoHeight} · {job.recipe.fps}
                              fps · {job.recipe.durationSeconds}s
                            </small>
                          </div>
                          <span>{statusLabels[job.status]}</span>
                        </div>
                        <div className="job-progress">
                          <i
                            style={{ width: `${Math.max(0, Math.min(1, job.progress)) * 100}%` }}
                          />
                        </div>
                        <div className="job-detail">
                          <span>
                            {job.status === 'done'
                              ? '可下载至本机'
                              : job.status === 'failed'
                                ? job.error
                                : job.status === 'cancelled'
                                  ? '任务已停止'
                                  : `${Math.round(job.progress * 100)}% · 剩余 ${Math.max(0, job.totalFrames - job.renderedFrames)} 帧`}
                          </span>
                          {job.status === 'done' ? (
                            <a href={job.url || `/api/jobs/${job.id}/download`} download>
                              <ArrowDownToLine size={12} />
                              下载
                            </a>
                          ) : ['failed', 'cancelled'].includes(job.status) ? (
                            <button onClick={() => void startExport(false, job.recipe)}>
                              <RotateCcw size={12} />
                              重试
                            </button>
                          ) : (
                            <button onClick={() => void cancelJob(job.id)}>
                              <X size={12} />
                              取消
                            </button>
                          )}
                        </div>
                        {job.status === 'done' && job.recipe.exportSettings.codec === 'h264' && (
                          <button
                            className="preview-output"
                            onClick={() =>
                              setPlayingOutput(playingOutput === job.id ? null : job.id)
                            }
                          >
                            <Play size={11} />
                            {playingOutput === job.id ? '收起成片' : '播放成片'}
                          </button>
                        )}
                        {playingOutput === job.id && job.status === 'done' && (
                          <video
                            className="output-video"
                            src={`/api/jobs/${job.id}/preview`}
                            controls
                            autoPlay
                            muted
                            playsInline
                            preload="metadata"
                            aria-label={`导出成片 ${job.name}`}
                          />
                        )}
                        {['done', 'failed', 'cancelled'].includes(job.status) && (
                          <button
                            className="delete-job"
                            aria-label={`移除任务 ${job.name}`}
                            title="移除任务并清理此导出文件"
                            onClick={() => void deleteJob(job.id)}
                          >
                            <Trash2 size={11} />
                            移除任务
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {finished.length > 1 && (
                  <a
                    className="zip-download"
                    href={`/api/download.zip?ids=${finished
                      .slice(0, 100)
                      .map((j) => j.id)
                      .join(',')}`}
                    download
                  >
                    <ArrowDownToLine size={14} />
                    打包下载 {Math.min(100, finished.length)} 个成片 · ZIP
                  </a>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <ShieldCheck size={12} />
              全部处理在这台 Mac 上完成。导出后可直接插入剪辑时间轴。
            </div>
          </section>
        </div>
      )}
      {showHelp && (
        <div
          className="modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowHelp(false);
          }}
        >
          <section className="help-modal" role="dialog" aria-modal="true" aria-label="使用说明">
            <div className="modal-heading">
              <h2>从照片，到动态成片。</h2>
              <IconButton label="关闭使用说明" onClick={() => setShowHelp(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <ol>
              <li>导入 JPG、PNG 或 HEIC，摄影参数自动读取；缺失时在「摄影参数」中填写。</li>
              <li>选择画布、调整照片和背景。在「时间与动画」设置时长，也可拖动时间轴边界。</li>
              <li>按空格播放，方向键逐帧查看。安全线仅用于预览。</li>
              <li>点击导出，等待本地渲染完成后下载 MP4。多张照片可批量导出并 ZIP 打包。</li>
            </ol>
            <p>
              示例照片的摄影参数为手动演示值。项目配置保存在此浏览器；照片缓存与导出任务由本地服务管理。清理本地工作区会同时移除已导入素材。
            </p>
          </section>
        </div>
      )}
    </div>
  );
}
