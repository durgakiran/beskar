import type { CommentThread, CommentReply, CommentAPIHandler, CommentReplyAttachment } from '@beskar/editor';

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const STORAGE_KEY = 'beskar-editor-demo:threads:v1';

// ─── In-memory store ──────────────────────────────────────────────────────────
const threadsStore = new Map<string, CommentThread>();
const repliesStore = new Map<string, CommentReply>();

// ─── Seed data ────────────────────────────────────────────────────────────────
const seedThread1: CommentThread = {
  id: 'seed-thread-1',
  documentId: 'demo-document',
  commentId: 'seed-comment-1',
  anchor: {
    // "A plain paragraph with bold, italic..." — highlights the word "bold"
    quotedText: 'bold',
    prefixText: 'paragraph with ',
    suffixText: ', ',
    blockId: 'init-para-1',
    start: 22,
    end: 26,
    versionHint: 'published',
  },
  publishedVisible: true,
  createdBy: 'user-alice',
  createdByName: 'Alice',
  createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(), // 10 min ago
  orphaned: false,
  replies: [
    {
      id: 'reply-1',
      threadId: 'seed-thread-1',
      authorId: 'user-bob',
      authorName: 'Bob',
      body: 'Agreed, this looks great!',
      createdAt: new Date(Date.now() - 1000 * 60 * 5).toISOString(), // 5 min ago
    },
  ],
};

const seedThread2: CommentThread = {
  id: 'seed-thread-2',
  documentId: 'demo-document',
  commentId: 'seed-comment-2',
  anchor: {
    // "Ordered item two" — highlights "item two"
    quotedText: 'item two',
    prefixText: 'Ordered ',
    suffixText: '',
    blockId: 'init-ol-p2',
    start: 8,
    end: 16,
    versionHint: 'published',
  },
  publishedVisible: true,
  createdBy: null,
  createdByName: null, // Simulate deleted user
  createdAt: new Date(Date.now() - 1000 * 60 * 60).toISOString(), // 1 hr ago
  orphaned: false,
  replies: [],
};


function seedThreads(): CommentThread[] {
  return [seedThread1, seedThread2];
}

function writeThreads(threads: CommentThread[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

function hydrateStores(threads: CommentThread[]) {
  threadsStore.clear();
  repliesStore.clear();

  threads.forEach((thread) => {
    threadsStore.set(thread.id, thread);
    thread.replies.forEach((reply) => repliesStore.set(reply.id, reply));
  });
}

function loadThreads(): CommentThread[] {
  if (typeof window === 'undefined') {
    return seedThreads();
  }

  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = seedThreads();
    writeThreads(seeded);
    return seeded;
  }

  try {
    const parsed = JSON.parse(raw) as CommentThread[];
    if (!Array.isArray(parsed)) throw new Error('Stored threads are not an array');
    return parsed;
  } catch (error) {
    console.warn('[mockCommentHandler] Failed to parse stored threads, resetting to seed data', error);
    const seeded = seedThreads();
    writeThreads(seeded);
    return seeded;
  }
}

function persistCurrentThreads() {
  writeThreads(Array.from(threadsStore.values()));
}

hydrateStores(loadThreads());

export function resetMockCommentStorage() {
  const seeded = seedThreads();
  hydrateStores(seeded);
  writeThreads(seeded);
}

// ─── Mock Handler ─────────────────────────────────────────────────────────────
export const mockCommentHandler: CommentAPIHandler = {
  async getThreads(documentId: string): Promise<CommentThread[]> {
    await delay(300);
    return Array.from(threadsStore.values()).filter((t) => t.documentId === documentId);
  },

  async createThread(
    documentId: string,
    commentId: string,
    anchor: any,
    body: string,
    attachments?: CommentReplyAttachment[],
  ): Promise<CommentThread> {
    await delay(300);
    const threadId = crypto.randomUUID();
    const replyId = crypto.randomUUID();
    const now = new Date().toISOString();

    const reply: CommentReply = {
      id: replyId,
      threadId,
      authorId: 'current-user',
      authorName: 'You',
      body,
      createdAt: now,
      attachments: attachments?.length ? attachments : undefined,
    };

    const thread: CommentThread = {
      id: threadId,
      documentId,
      commentId,
      anchor,
      publishedVisible: true,
      createdBy: 'current-user',
      createdByName: 'You',
      createdAt: now,
      orphaned: false,
      replies: [reply],
    };

    threadsStore.set(threadId, thread);
    repliesStore.set(replyId, reply);
    persistCurrentThreads();
    console.log('[mockCommentHandler] createThread', thread);
    return thread;
  },


  async resolveThread(threadId: string): Promise<CommentThread> {
    await delay(300);
    const thread = threadsStore.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const resolved: CommentThread = {
      ...thread,
      resolvedBy: 'current-user',
      resolvedAt: new Date().toISOString(),
    };
    threadsStore.set(threadId, resolved);
    persistCurrentThreads();
    console.log('[mockCommentHandler] resolveThread', threadId);
    return resolved;
  },

  async unresolveThread(threadId: string): Promise<CommentThread> {
    await delay(300);
    const thread = threadsStore.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const unresolved: CommentThread = {
      ...thread,
      resolvedBy: null,
      resolvedAt: null,
    };
    threadsStore.set(threadId, unresolved);
    persistCurrentThreads();
    console.log('[mockCommentHandler] unresolveThread', threadId);
    return unresolved;
  },

  async orphanThread(threadId: string): Promise<CommentThread> {
    await delay(300);
    const thread = threadsStore.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const orphaned: CommentThread = {
      ...thread,
      orphaned: true,
    };
    threadsStore.set(threadId, orphaned);
    persistCurrentThreads();
    console.log('[mockCommentHandler] orphanThread', threadId);
    return orphaned;
  },

  async updateThreadAnchor(threadId: string, anchor: any): Promise<void> {
    const thread = threadsStore.get(threadId);
    if (!thread) return; // Thread may have been deleted; silently ignore
    threadsStore.set(threadId, { ...thread, anchor });
    persistCurrentThreads();
    console.log('[mockCommentHandler] updateThreadAnchor', threadId, anchor.quotedText);
  },

  async deleteThread(threadId: string): Promise<void> {
    await delay(300);
    threadsStore.delete(threadId);
    // Remove associated replies
    Array.from(repliesStore.values())
      .filter((r: CommentReply) => r.threadId === threadId)
      .forEach((r: CommentReply) => repliesStore.delete(r.id));
    persistCurrentThreads();
    console.log('[mockCommentHandler] deleteThread', threadId);
  },

  async addReply(threadId: string, body: string, attachments?: CommentReplyAttachment[]): Promise<CommentReply> {
    await delay(300);
    const thread = threadsStore.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);
    const replyId = crypto.randomUUID();
    const reply: CommentReply = {
      id: replyId,
      threadId,
      authorId: 'current-user',
      authorName: 'You',
      body,
      createdAt: new Date().toISOString(),
      attachments,
    };
    // Immutable update — UI state often holds the same object reference as the store;
    // mutating replies[] in place would duplicate when the client also does [...replies, reply].
    const nextThread: CommentThread = {
      ...thread,
      replies: [...thread.replies, reply],
    };
    threadsStore.set(threadId, nextThread);
    repliesStore.set(replyId, reply);
    persistCurrentThreads();
    console.log('[mockCommentHandler] addReply', reply);
    return reply;
  },

  async editReply(replyId: string, body: string, attachments?: CommentReplyAttachment[]): Promise<CommentReply> {
    await delay(300);
    const reply = repliesStore.get(replyId);
    if (!reply) throw new Error(`Reply not found: ${replyId}`);
    const edited: CommentReply = {
      ...reply,
      body,
      editedAt: new Date().toISOString(),
      // If attachments provided, replace; otherwise keep existing
      attachments: attachments !== undefined ? attachments : reply.attachments,
    };
    repliesStore.set(replyId, edited);
    // Update in thread too
    const thread = threadsStore.get(edited.threadId);
    if (thread) {
      const idx = thread.replies.findIndex((r) => r.id === replyId);
      if (idx !== -1) {
        const nextReplies = thread.replies.map((r, i) => (i === idx ? edited : r));
        threadsStore.set(edited.threadId, { ...thread, replies: nextReplies });
      }
    }
    persistCurrentThreads();
    console.log('[mockCommentHandler] editReply', edited);

    return edited;
  },

  async deleteReply(replyId: string): Promise<void> {
    await delay(300);
    const reply = repliesStore.get(replyId);
    if (!reply) throw new Error(`Reply not found: ${replyId}`);
    repliesStore.delete(replyId);
    const thread = threadsStore.get(reply.threadId);
    if (thread) {
      threadsStore.set(reply.threadId, {
        ...thread,
        replies: thread.replies.filter((r) => r.id !== replyId),
      });
    }
    persistCurrentThreads();
    console.log('[mockCommentHandler] deleteReply', replyId);
  },
};
