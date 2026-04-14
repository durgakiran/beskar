import React from 'react';
import { FiFile, FiPaperclip, FiX } from 'react-icons/fi';
import type {
  AttachmentAPIHandler,
  AttachmentUploadResult,
  CommentReply,
  CommentReplyAttachment,
  CommentThread,
} from '../types';

export function formatCommentRelativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const s = Math.floor(diff / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (s < 10) return 'just now';
  if (s < 60) return 'less than a minute ago';
  if (m < 60) return `${m} minute${m > 1 ? 's' : ''} ago`;
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`;
  return `${d} day${d > 1 ? 's' : ''} ago`;
}

export function getCommentInitials(name: string | null): string {
  if (!name) return '?';
  return name.split(' ').map((p) => p[0]).join('').toUpperCase().slice(0, 2);
}

export function CommentAvatar({
  name,
  size = 'default',
}: {
  name: string | null;
  size?: 'default' | 'small';
}) {
  return (
    <div
      className={`ctc-avatar ${size === 'small' ? 'ctc-avatar--small' : ''}`}
      title={name ?? 'Deleted user'}
    >
      {getCommentInitials(name)}
    </div>
  );
}

export function getQuotedText(thread: CommentThread): string {
  return thread.anchor?.quotedText || (thread as any).quotedText || 'Unknown text';
}

export function splitOpeningReply(thread: CommentThread): {
  opening: CommentReply | null;
  followUps: CommentReply[];
} {
  const [first, ...rest] = thread.replies;
  if (!first) return { opening: null, followUps: [] };
  if (first.authorId === thread.createdBy) {
    return { opening: first, followUps: rest };
  }
  return { opening: null, followUps: thread.replies };
}

export function readFilesFromInputEvent(
  e: React.ChangeEvent<HTMLInputElement>,
): File[] {
  return e.target.files ? Array.from(e.target.files) : [];
}

export function buildReplyAttachments(files: File[]): CommentReplyAttachment[] {
  return files.map((file) => ({
    attachmentId: `att-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    url: URL.createObjectURL(file),
  }));
}

export function attachmentUploadResultToCommentAttachment(
  result: AttachmentUploadResult,
): CommentReplyAttachment {
  return {
    attachmentId: result.attachmentId,
    fileName: result.fileName,
    fileSize: result.fileSize,
    mimeType: result.mimeType,
    url: result.url,
  };
}

export async function uploadCommentAttachments(
  handler: AttachmentAPIHandler,
  files: File[],
): Promise<{
  uploaded: CommentReplyAttachment[];
  failedFiles: string[];
}> {
  const results = await Promise.allSettled(files.map((file) => handler.uploadAttachment(file)));

  const uploaded: CommentReplyAttachment[] = [];
  const failedFiles: string[] = [];

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      uploaded.push(attachmentUploadResultToCommentAttachment(result.value));
      return;
    }
    failedFiles.push(files[index]?.name ?? `file-${index + 1}`);
  });

  return { uploaded, failedFiles };
}

export function CommentAttachmentPills({
  attachments,
  files,
  editable = false,
  scrollable = false,
  onRemoveAttachment,
  onRemoveFile,
}: {
  attachments?: CommentReplyAttachment[];
  files?: File[];
  editable?: boolean;
  scrollable?: boolean;
  onRemoveAttachment?: (attachmentId: string) => void;
  onRemoveFile?: (index: number) => void;
}) {
  const hasAttachments = !!attachments?.length;
  const hasFiles = !!files?.length;

  if (!hasAttachments && !hasFiles) return null;

  return (
    <div className={`ctc-attachments ${scrollable ? 'ctc-attachments--scrollable' : ''}`}>
      {attachments?.map((att) =>
        editable ? (
          <span key={att.attachmentId} className="ctc-attachment-pill ctc-attachment-pill--editable">
            <FiFile size={11} />
            {att.fileName}
            <button
              type="button"
              className="ctc-attachment-remove-btn"
              onClick={() => onRemoveAttachment?.(att.attachmentId)}
              title={`Remove ${att.fileName}`}
            >
              <FiX size={11} />
            </button>
          </span>
        ) : (
          <a
            key={att.attachmentId}
            href={att.url}
            download={att.fileName}
            className="ctc-attachment-pill"
            title={`Download ${att.fileName}`}
            target="_blank"
            rel="noreferrer"
          >
            <FiFile size={11} />
            {att.fileName}
          </a>
        ),
      )}
      {files?.map((file, i) => (
        <span key={`${file.name}-${i}`} className="ctc-attachment-pill ctc-attachment-pill--new">
          <FiPaperclip size={11} />
          {file.name}
          <button
            type="button"
            className="ctc-attachment-remove-btn"
            onClick={() => onRemoveFile?.(i)}
            title={`Remove ${file.name}`}
          >
            <FiX size={11} />
          </button>
        </span>
      ))}
    </div>
  );
}
