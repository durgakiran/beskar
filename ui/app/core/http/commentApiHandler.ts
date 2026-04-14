import { get, post } from './call';
import type { CommentAPIHandler, CommentThread, CommentReply, CommentReplyAttachment } from '@durgakiran/editor';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

const mapBackendAttachment = (a: any): CommentReplyAttachment => ({
  attachmentId: a.id,
  url: a.url,
  fileName: a.fileName,
  mimeType: a.mimeType,
  fileSize: a.fileSize,
});

const mapBackendReply = (r: any): CommentReply => ({
  ...r,
  authorId: r.author?.id || null,
  authorName: r.author?.name || "Deleted User",
  attachments: (r.attachments || []).map(mapBackendAttachment),
});

const mapBackendThread = (t: any): CommentThread => ({
  ...t,
  createdBy: t.createdBy?.id || null,
  createdByName: t.createdBy?.name || "Deleted User",
  resolvedBy: t.resolvedBy?.id || null,
  replies: (t.replies || []).map(mapBackendReply)
});

/**
 * Creates an implementation of CommentAPIHandler that interacts with the backend.
 * Uses custom get/post wrapper helpers for standard requests and native fetch for 
 * DELETE requests to allow cookie-based auth integration.
 */
export function makeCommentApiHandler(documentId: string): CommentAPIHandler {
  return {
    getThreads: async (docIdToFetch) => {
      const target = docIdToFetch || documentId;
      if (!target) return [];
      const response = await get(`${BASE_URL}/api/v1/comment/documents/${target}/threads`);
      return (response.data.data as any[]).map(mapBackendThread);
    },

    createThread: async (docId, commentId, anchor, body, attachments) => {
      const response = await post(
        `${BASE_URL}/api/v1/comment/documents/${docId}/threads`,
        {
          commentId,
          anchor,
          publishedVisible: anchor.versionHint === 'published',
          body,
          attachmentIds: (attachments || []).map((a) => a.attachmentId),
        },
        {}
      );
      return mapBackendThread(response.data.data);
    },

    resolveThread: async (threadId) => {
      // call.ts doesn't export patch, but `post` accepts a generic header/config object,
      // but if the axios instance restricts it, we can force the patch HTTP method.
      // Wait, `post` in call.ts takes (path, body, headerOptions, axiosConfig?).
      // We can pass { method: "PATCH" } via axiosConfig? Wait, axios.post always does POST.
      // So let's use standard fetch here as well, since axios.post forces the POST method!
      // Actually, since we need PATCH, and call.ts lacks a `patch` export, let's use fetch.
      const res = await fetch(`${BASE_URL}/api/v1/comment/threads/${threadId}/resolve`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${localStorage.getItem("access_token")}`
        },
        credentials: "include"
      });
      if (!res.ok) throw new Error(`Resolving failed: ${res.status}`);
      const json = await res.json();
      return mapBackendThread(json.data);
    },

    unresolveThread: async (threadId) => {
      const res = await fetch(`${BASE_URL}/api/v1/comment/threads/${threadId}/unresolve`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${localStorage.getItem("access_token")}`
        },
        credentials: "include"
      });
      if (!res.ok) throw new Error(`Unresolving failed: ${res.status}`);
      const json = await res.json();
      return mapBackendThread(json.data);
    },

    orphanThread: async (threadId) => {
      const res = await fetch(`${BASE_URL}/api/v1/comment/threads/${threadId}/orphan`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${localStorage.getItem("access_token")}`
        },
        credentials: "include"
      });
      if (!res.ok) throw new Error(`Orphaning failed: ${res.status}`);
      const json = await res.json();
      return mapBackendThread(json.data);
    },

    deleteThread: async (threadId) => {
      const res = await fetch(`${BASE_URL}/api/v1/comment/threads/${threadId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // Relies on session cookies for auth
      });
      if (!res.ok) throw new Error(`Delete thread failed with status: ${res.status}`);
    },

    addReply: async (threadId, body, attachments) => {
      const response = await post(
        `${BASE_URL}/api/v1/comment/threads/${threadId}/replies`,
        { body, attachmentIds: (attachments || []).map((a) => a.attachmentId) },
        {}
      );
      return mapBackendReply(response.data.data);
    },

    editReply: async (replyId, body, attachments) => {
      const res = await fetch(`${BASE_URL}/api/v1/comment/replies/${replyId}`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${localStorage.getItem("access_token")}`
        },
        body: JSON.stringify({ body, attachmentIds: (attachments || []).map((a) => a.attachmentId) }),
        credentials: "include"
      });
      if (!res.ok) throw new Error(`Edit reply failed: ${res.status}`);
      const json = await res.json();
      return mapBackendReply(json.data);
    },

    deleteReply: async (replyId) => {
      const res = await fetch(`${BASE_URL}/api/v1/comment/replies/${replyId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include", // Relies on session cookies for auth
      });
      if (!res.ok) throw new Error(`Delete reply failed with status: ${res.status}`);
    },
  };
}
