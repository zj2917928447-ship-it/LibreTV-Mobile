'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  decodeSubtitleBytes,
  formatVttTimestamp,
  parseSubtitleCues,
  type SubtitleCue,
} from '@/lib/subtitles';
import type { SubtitleTrack } from '@/lib/types';
import { cn } from '@/lib/utils';

export type SubtitleSize = 'sm' | 'md' | 'lg' | 'xl';

export interface SubtitleState {
  activeKey: string;
  localText: string;
  localName: string;
  remoteLoadedText: string;
  offset: number;
  size: SubtitleSize;
}

function isMostlyForeignSubtitle(cues: readonly SubtitleCue[]): boolean {
  if (cues.length === 0) return false;
  const sample = cues
    .slice(0, 40)
    .map((c) => c.text)
    .join(' ');
  const cjkCount = (sample.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const latinCount = (sample.match(/[A-Za-z]/g) ?? []).length;
  return latinCount >= 10 && cjkCount / (cjkCount + latinCount) < 0.2;
}

function serializeCuesToVtt(cues: readonly SubtitleCue[]): string {
  if (cues.length === 0) return 'WEBVTT\n\n';
  const body = cues
    .map((c, idx) => `${idx + 1}\n${formatVttTimestamp(c.start)} --> ${formatVttTimestamp(c.end)}\n${c.text}`)
    .join('\n\n');
  return `WEBVTT\n\n${body}\n`;
}

/** 管理当前视频的中文字幕状态：当源自带字幕中存在中文时自动优先选中 */
export function useSubtitleController(remoteTracks?: SubtitleTrack[], resetIdentity?: string) {
  const [state, setState] = useState<SubtitleState>({
    activeKey: 'off',
    localText: '',
    localName: '',
    remoteLoadedText: '',
    offset: 0,
    size: 'md',
  });

  useEffect(() => {
    if (!remoteTracks || remoteTracks.length === 0) {
      setState((prev) => ({
        ...prev,
        activeKey: prev.activeKey === 'local' ? 'local' : 'off',
        remoteLoadedText: '',
        offset: 0,
      }));
      return;
    }
    const zhIndex = remoteTracks.findIndex((t) => t.lang.toLowerCase().startsWith('zh'));
    const defaultIndex = zhIndex >= 0 ? zhIndex : 0;
    setState((prev) => ({
      ...prev,
      activeKey: prev.activeKey === 'local' ? 'local' : String(defaultIndex),
      remoteLoadedText: '',
      offset: 0,
    }));
  }, [remoteTracks, resetIdentity]);

  return { state, setState };
}

interface SubtitleControlPanelProps {
  remoteTracks?: SubtitleTrack[];
  state: SubtitleState;
  onChange: (next: SubtitleState) => void;
  onToast?: (msg: string) => void;
}

export function SubtitleControlPanel({
  remoteTracks = [],
  state,
  onChange,
  onToast,
}: SubtitleControlPanelProps) {
  const [open, setOpen] = useState(false);
  const [translatingProgress, setTranslatingProgress] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const translateAbortRef = useRef<AbortController | null>(null);

  useEffect(() => () => translateAbortRef.current?.abort(), []);

  const currentSourceText =
    state.activeKey === 'local'
      ? state.localText
      : state.activeKey !== 'off'
        ? state.remoteLoadedText
        : '';

  const parsedSourceCues = useMemo(
    () => (currentSourceText ? parseSubtitleCues(currentSourceText, 0) : []),
    [currentSourceText]
  );
  const canTranslateForeign = useMemo(
    () => isMostlyForeignSubtitle(parsedSourceCues),
    [parsedSourceCues]
  );

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      onToast?.('字幕文件过大（上限 5MB）');
      return;
    }
    try {
      const buffer = await file.arrayBuffer();
      const decoded = decodeSubtitleBytes(new Uint8Array(buffer));
      if (!decoded.trim()) {
        onToast?.('字幕文件内容为空');
        return;
      }
      onChange({
        ...state,
        activeKey: 'local',
        localText: decoded,
        localName: file.name,
        offset: 0,
      });
      onToast?.(`已加载字幕：${file.name}`);
    } catch {
      onToast?.('读取本地字幕失败，请确认格式为 .srt / .vtt / .ass');
    }
  };

  const runAutoTranslate = async (bilingual: boolean) => {
    if (parsedSourceCues.length === 0) return;
    translateAbortRef.current?.abort();
    const controller = new AbortController();
    translateAbortRef.current = controller;
    setTranslatingProgress(1);

    const workingCues: SubtitleCue[] = parsedSourceCues.map((c) => ({ ...c }));
    const batchSize = 35;
    let changedTotal = 0;

    try {
      for (let start = 0; start < workingCues.length; start += batchSize) {
        if (controller.signal.aborted) return;
        const slice = workingCues.slice(start, start + batchSize);
        const res = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lines: slice.map((c) => c.text.replace(/\n+/g, ' ')) }),
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { translations?: string[]; translatedCount?: number };
        const translatedLines = data.translations ?? [];
        changedTotal += data.translatedCount ?? 0;

        for (let i = 0; i < slice.length; i++) {
          const zh = (translatedLines[i] || '').trim();
          const orig = slice[i].text.trim();
          if (zh && zh !== orig) {
            workingCues[start + i] = {
              ...workingCues[start + i],
              text: bilingual ? `${zh}\n${orig}` : zh,
            };
          }
        }

        const pct = Math.min(100, Math.round(((start + slice.length) / workingCues.length) * 100));
        setTranslatingProgress(pct);
        // 渐进实时刷新画面字幕：首批发回后观众立即可见中文字幕，无需等整部电影翻完
        onChange({
          ...state,
          activeKey: 'local',
          localName: bilingual ? '自动汉化（中英双语）' : '自动汉化（简体中文）',
          localText: serializeCuesToVtt(workingCues),
        });
      }
      if (changedTotal > 0) {
        onToast?.(`字幕汉化完成（共翻译 ${changedTotal} 句台词）`);
      } else {
        onToast?.('翻译服务暂忙，请稍后重试或加载本地中文字幕');
      }
    } catch {
      if (!controller.signal.aborted) {
        onToast?.('字幕自动汉化中断，已保留已完成部分');
      }
    } finally {
      if (translateAbortRef.current === controller) {
        setTranslatingProgress(null);
      }
    }
  };

  const hasActive = state.activeKey !== 'off';
  const activeBadge =
    state.activeKey === 'local'
      ? state.localName || '本地字幕'
      : state.activeKey !== 'off' && remoteTracks[Number(state.activeKey)]
        ? remoteTracks[Number(state.activeKey)].label
        : '';

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".srt,.vtt,.ass,.ssa,text/vtt,text/plain"
        className="hidden"
        onChange={(e) => void handleFileChange(e)}
      />
      <button
        type="button"
        className={cn('btn-ghost btn-sm', (open || hasActive) && 'bg-chip text-content')}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title="切换内置字幕、一键自动汉化外文字幕，或导入本地 .srt/.vtt/.ass 字幕"
      >
        中文字幕{activeBadge ? ` (${activeBadge})` : remoteTracks.length > 0 ? ` (${remoteTracks.length})` : ''}
      </button>

      {open && (
        <div className="w-full mt-2 rounded-lg border border-line bg-surface-raised p-3 text-xs space-y-2.5 animate-fade-in">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-content">字幕与自动汉化面板</span>
            <div className="flex flex-wrap items-center gap-1.5">
              {canTranslateForeign && translatingProgress === null && (
                <>
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => void runAutoTranslate(true)}
                  >
                    一键汉化（中英双语）
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm text-accent"
                    onClick={() => void runAutoTranslate(false)}
                  >
                    一键汉化（纯中文）
                  </button>
                </>
              )}
              {translatingProgress !== null && (
                <button
                  type="button"
                  className="btn-ghost btn-sm text-warning"
                  onClick={() => {
                    translateAbortRef.current?.abort();
                    setTranslatingProgress(null);
                  }}
                >
                  正在汉化字幕 {translatingProgress}%（点击停止）
                </button>
              )}
              <button
                type="button"
                className={cn(canTranslateForeign ? 'btn-ghost btn-sm' : 'btn-primary btn-sm')}
                onClick={() => fileInputRef.current?.click()}
              >
                导入本地字幕 (.srt/.vtt/.ass)
              </button>
              {hasActive && (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => onChange({ ...state, activeKey: 'off' })}
                >
                  关闭字幕
                </button>
              )}
            </div>
          </div>

          {(remoteTracks.length > 0 || state.localText) && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-faint shrink-0">字幕轨道：</span>
              <button
                type="button"
                className={cn(
                  'chip',
                  state.activeKey === 'off' ? 'bg-accent/15 text-accent font-medium' : 'text-muted hover:text-content'
                )}
                onClick={() => onChange({ ...state, activeKey: 'off' })}
              >
                关闭
              </button>
              {remoteTracks.map((track, idx) => {
                const key = String(idx);
                return (
                  <button
                    key={`${track.lang}-${idx}`}
                    type="button"
                    className={cn(
                      'chip',
                      state.activeKey === key ? 'bg-accent/15 text-accent font-medium' : 'text-muted hover:text-content'
                    )}
                    onClick={() => onChange({ ...state, activeKey: key })}
                  >
                    {track.label}
                  </button>
                );
              })}
              {state.localText && (
                <button
                  type="button"
                  className={cn(
                    'chip',
                    state.activeKey === 'local' ? 'bg-accent/15 text-accent font-medium' : 'text-muted hover:text-content'
                  )}
                  onClick={() => onChange({ ...state, activeKey: 'local' })}
                >
                  {state.localName || '本地/已汉化字幕'}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1 border-t border-line">
            <div className="flex items-center gap-1.5">
              <span className="text-faint">字号：</span>
              {([
                ['sm', '小'],
                ['md', '中'],
                ['lg', '大'],
                ['xl', '特大'],
              ] as const).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={cn(
                    'chip',
                    state.size === id ? 'bg-accent/15 text-accent font-medium' : 'text-muted hover:text-content'
                  )}
                  onClick={() => onChange({ ...state, size: id })}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1.5">
              <span className="text-faint">时间轴：</span>
              <button
                type="button"
                className="btn-ghost btn-sm !px-2"
                onClick={() => onChange({ ...state, offset: Math.round((state.offset - 0.5) * 10) / 10 })}
              >
                -0.5s
              </button>
              <span className="min-w-[44px] text-center text-content font-mono">
                {state.offset > 0 ? `+${state.offset.toFixed(1)}s` : `${state.offset.toFixed(1)}s`}
              </span>
              <button
                type="button"
                className="btn-ghost btn-sm !px-2"
                onClick={() => onChange({ ...state, offset: Math.round((state.offset + 0.5) * 10) / 10 })}
              >
                +0.5s
              </button>
              {state.offset !== 0 && (
                <button
                  type="button"
                  className="text-accent hover:underline ml-1"
                  onClick={() => onChange({ ...state, offset: 0 })}
                >
                  归零
                </button>
              )}
            </div>
          </div>

          <p className="text-[11px] text-faint">
            若影片仅附带英文字幕，点击「一键汉化」即可实时生成中英双语或纯中文字幕；导入本地字幕自动兼容 UTF-8 与 GBK 中文编码。
          </p>
        </div>
      )}
    </>
  );
}
