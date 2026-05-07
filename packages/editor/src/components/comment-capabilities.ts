import type { CommentReply, CommentThread } from '../types';

export function canResolveThread(thread: CommentThread): boolean {
  return thread.capabilities?.canResolve === true;
}

export function canUnresolveThread(thread: CommentThread): boolean {
  return thread.capabilities?.canUnresolve === true;
}

export function canDeleteThread(thread: CommentThread): boolean {
  return thread.capabilities?.canDeleteThread === true;
}

export function canReplyToThread(thread: CommentThread): boolean {
  return thread.capabilities?.canReply === true;
}

export function canEditOpeningReply(thread: CommentThread): boolean {
  return thread.capabilities?.canEditOpeningReply === true;
}

export function canDeleteOpeningReply(thread: CommentThread): boolean {
  return thread.capabilities?.canDeleteOpeningReply === true;
}

export function canEditReply(reply: CommentReply): boolean {
  return reply.capabilities?.canEditReply === true;
}

export function canDeleteReply(reply: CommentReply): boolean {
  return reply.capabilities?.canDeleteReply === true;
}
