import React from 'react';
import { FiAlertCircle, FiCheck, FiRefreshCw, FiX } from 'react-icons/fi';
import type { Vec2 } from '@durgakiran/glideline';
import { useGlideboardController } from './GlideboardContext.js';
import { wbTheme } from './theme.js';
import type {
  GlideboardAssetErrorCategory,
  GlideboardAssetImportRequest,
  GlideboardAssetImportStatus,
} from './types.js';
import { useSignalValue } from './useSignalValue.js';

export const GLIDEBOARD_ASSET_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
export const ASSET_IMPORT_SUCCESS_DISMISS_MS = 5_000;
export const ASSET_IMPORT_CANCELLED_DISMISS_MS = 10_000;
export const ASSET_IMPORT_FAILURE_DISMISS_MS = 30_000;

export interface AssetImportNotice {
  readonly id: string;
  readonly name: string;
  readonly category: GlideboardAssetErrorCategory;
  readonly message: string;
  readonly recoveryMessage?: string;
  readonly correlationToken: string;
}

export function createAssetImportCorrelationToken(): string {
  return crypto.randomUUID();
}

export class AssetFileValidationError extends Error {
  constructor(
    readonly category: GlideboardAssetErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = 'AssetFileValidationError';
  }
}

const RECOVERY_MESSAGES: Record<GlideboardAssetErrorCategory, string> = {
  'invalid-content': 'Choose a valid image file and try again.',
  'unsupported-format': 'Use a PNG, JPEG, WebP, or SVG file.',
  'limit-exceeded': 'Choose a smaller image and try again.',
	storage: 'Check available storage, then retry.',
	network: 'Check your connection, then retry.',
	'rate-limit': 'Wait for the retry period, then try again.',
  permission: 'Request edit access to import this image.',
  conflict: 'Refresh the board before retrying this import.',
  'not-found': 'Choose the source file again.',
  unavailable: 'Configure asset storage or import an SVG instead.',
  unknown: 'Retry the import or choose the file again.',
};

export function getAssetFileError(
  file: Pick<File, 'name' | 'size' | 'type'>,
  limits: {
    readonly maxSvgBytes: number;
    readonly maxRasterBytes: number;
    readonly supportedMimeTypes: readonly string[];
  },
): AssetFileValidationError | null {
  const mimeType = file.type.toLowerCase();
  if (!limits.supportedMimeTypes.includes(mimeType)) {
    return new AssetFileValidationError(
      'unsupported-format',
      `${file.name || 'This file'} is not a supported image type.`,
    );
  }
  if (file.size <= 0) {
    return new AssetFileValidationError('invalid-content', `${file.name || 'This file'} is empty.`);
  }
  const maximum = mimeType === 'image/svg+xml' ? limits.maxSvgBytes : limits.maxRasterBytes;
  if (file.size > maximum) {
    return new AssetFileValidationError(
      'limit-exceeded',
      `${file.name || 'This file'} exceeds the ${formatBytes(maximum)} limit.`,
    );
  }
  return null;
}

export async function readAssetImportRequest(
  file: File,
  point: Vec2,
  limits: {
    readonly maxSvgBytes: number;
    readonly maxRasterBytes: number;
    readonly supportedMimeTypes: readonly string[];
  },
  correlationToken = createAssetImportCorrelationToken(),
): Promise<GlideboardAssetImportRequest> {
  const validationError = getAssetFileError(file, limits);
  if (validationError) throw validationError;
  if (file.type.toLowerCase() === 'image/svg+xml') {
    return { kind: 'svg', source: await file.text(), name: file.name, point, correlationToken };
  }
  return {
    kind: 'raster',
    bytes: new Uint8Array(await file.arrayBuffer()),
    declaredMimeType: file.type.toLowerCase(),
    name: file.name,
    point,
    correlationToken,
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function statusLabel(status: GlideboardAssetImportStatus, progress: number): string {
  if (status === 'uploading') return `Uploading ${Math.round(progress * 100)}%`;
  return status[0]!.toUpperCase() + status.slice(1);
}

function sentence(message: string): string {
  return /[.!?]$/.test(message.trim()) ? message : `${message}.`;
}

export function AssetImportPanel({
  notices,
  onDismissNotice,
}: {
  notices: readonly AssetImportNotice[];
  onDismissNotice: (id: string) => void;
}) {
  const controller = useGlideboardController();
  const jobs = useSignalValue(controller.assetImportJobsSignal) ?? [];
  const previousAnnouncementRef = React.useRef('');
  const [announcement, setAnnouncement] = React.useState('');
  const [manuallyClosed, setManuallyClosed] = React.useState(false);
  const panelStateKey = [
    ...jobs.map(job => `${job.id}:${job.status}:${job.attempt}`),
    ...notices.map(notice => notice.id),
  ].join('|');

  React.useEffect(() => {
    const latest = jobs[jobs.length - 1];
    const next = latest
      ? `${latest.name ?? 'Image'}: ${statusLabel(latest.status, latest.progress)}`
      : notices[notices.length - 1]?.message ?? '';
    if (next && next !== previousAnnouncementRef.current) {
      previousAnnouncementRef.current = next;
      setAnnouncement(next);
    }
  }, [jobs, notices]);

  React.useEffect(() => {
    setManuallyClosed(false);
  }, [panelStateKey]);

  React.useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (const job of jobs) {
      const delay = job.status === 'complete'
        ? ASSET_IMPORT_SUCCESS_DISMISS_MS
        : job.status === 'error'
          ? ASSET_IMPORT_FAILURE_DISMISS_MS
          : job.status === 'cancelled'
            ? ASSET_IMPORT_CANCELLED_DISMISS_MS
            : null;
      if (delay !== null) timers.push(setTimeout(() => controller.dismissAssetImport(job.id), delay));
    }
    for (const notice of notices) {
      timers.push(setTimeout(() => onDismissNotice(notice.id), ASSET_IMPORT_FAILURE_DISMISS_MS));
    }
    return () => timers.forEach(timer => clearTimeout(timer));
  }, [controller, jobs, notices, onDismissNotice]);

  if ((jobs.length === 0 && notices.length === 0) || manuallyClosed) return null;

  const retry = (id: string) => {
    try {
      void controller.retryAssetImport(id).result.catch(() => undefined);
    } catch {
      // The job signal is authoritative; a stale action disappears on the next render.
    }
  };

  return (
    <aside
      id={controller.domId('asset-import-panel')}
      data-glideboard-role="asset-import-panel"
      aria-label="Image imports"
      aria-busy={jobs.some(job => job.status === 'queued' || job.status === 'uploading')}
      style={{
        position: 'absolute', right: 12, bottom: 54, zIndex: 110,
        width: 340, maxWidth: 'calc(100% - 24px)', maxHeight: 'min(320px, calc(100% - 78px))',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        background: wbTheme.surface, border: `1px solid ${wbTheme.border}`,
        borderRadius: 8, boxShadow: wbTheme.shadow, color: wbTheme.text,
        fontFamily: 'inherit',
      }}
      onPointerDown={event => event.stopPropagation()}
    >
      <div style={{ minHeight: 42, padding: '6px 8px 6px 12px', display: 'flex', alignItems: 'center', gap: 8, borderBottom: `1px solid ${wbTheme.border}`, fontSize: 12, fontWeight: 650 }}>
        <span style={{ flex: 1 }}>Image imports</span>
        <ActionButton label="Close image imports" onClick={() => setManuallyClosed(true)}><FiX size={14} /></ActionButton>
      </div>
      <div style={{ overflowY: 'auto', padding: 8 }}>
        {jobs.map(job => (
          <div key={job.id} data-import-status={job.status} data-asset-import-correlation={job.correlationToken} style={{ padding: '8px 4px', borderBottom: `1px solid ${wbTheme.border}` }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              {job.status === 'complete' ? <FiCheck aria-hidden size={15} color={wbTheme.accentText} /> : null}
              {job.status === 'error' ? <FiAlertCircle aria-hidden size={15} color={wbTheme.dangerText} /> : null}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div title={job.name} style={{ fontSize: 11, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {job.name ?? (job.kind === 'svg' ? 'SVG image' : 'Raster image')}
                </div>
                <div style={{ marginTop: 2, fontSize: 10, color: job.status === 'error' ? wbTheme.dangerText : wbTheme.textSoft }}>
                  {statusLabel(job.status, job.progress)}
                </div>
              </div>
              {(job.status === 'queued' || job.status === 'uploading') ? (
                <ActionButton label="Cancel import" onClick={() => controller.cancelAssetImport(job.id)}><FiX size={14} /></ActionButton>
              ) : null}
              {((job.status === 'error' && job.error?.retryable) || job.status === 'cancelled') ? (
                <ActionButton label="Retry import" onClick={() => retry(job.id)}><FiRefreshCw size={13} /></ActionButton>
              ) : null}
              {(job.status === 'complete' || job.status === 'error' || job.status === 'cancelled') ? (
                <ActionButton label="Dismiss import" onClick={() => controller.dismissAssetImport(job.id)}><FiX size={14} /></ActionButton>
              ) : null}
            </div>
            {(job.status === 'queued' || job.status === 'uploading') ? (
              <progress aria-label={`Progress for ${job.name ?? 'image'}`} value={job.progress} max={1} style={{ width: '100%', height: 4, marginTop: 7, display: 'block' }} />
            ) : null}
            {job.error ? (
              <div style={{ marginTop: 6, fontSize: 10, lineHeight: 1.4, color: wbTheme.textMuted }}>
                {sentence(job.error.message)} {RECOVERY_MESSAGES[job.error.category]}
              </div>
            ) : null}
          </div>
        ))}
        {notices.map(notice => (
          <div
            key={notice.id}
            data-glideboard-role="asset-import-rejected"
            data-asset-import-name={notice.name}
            data-asset-import-correlation={notice.correlationToken}
            data-import-status="error"
            role="alert"
            style={{ display: 'flex', gap: 8, padding: '8px 4px', alignItems: 'flex-start' }}
          >
            <FiAlertCircle aria-hidden size={15} color={wbTheme.dangerText} style={{ flex: '0 0 auto' }} />
            <div style={{ flex: 1, minWidth: 0, fontSize: 10, lineHeight: 1.4 }}>
              <strong style={{ display: 'block', fontSize: 11 }}>{notice.name}</strong>
              {sentence(notice.message)} {notice.recoveryMessage ?? RECOVERY_MESSAGES[notice.category]}
            </div>
            <ActionButton label="Dismiss message" onClick={() => onDismissNotice(notice.id)}><FiX size={14} /></ActionButton>
          </div>
        ))}
      </div>
      <div aria-live="polite" aria-atomic="true" style={visuallyHidden}>{announcement}</div>
    </aside>
  );
}

function ActionButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} style={{
      width: 28, height: 28, flex: '0 0 auto', display: 'grid', placeItems: 'center', padding: 0,
      borderRadius: 4, border: `1px solid ${wbTheme.border}`, background: wbTheme.surfaceMuted,
      color: wbTheme.textMuted, cursor: 'pointer',
    }}>{children}</button>
  );
}

const visuallyHidden: React.CSSProperties = {
  position: 'absolute', width: 1, height: 1, padding: 0, margin: -1,
  overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0,
};
