// Mock API for comments in demo
import type { Comment, ReactionSummary } from '@beskar/editor';

// Add commentType to Comment interface for demo
interface CommentWithType extends Comment {
  commentType: 'inline' | 'page_end';
}

interface Reaction {
  id: string;
  commentId: string;
  userId: string;
  emoji: string;
  createdAt: string;
}

const mockComments: CommentWithType[] = [];
const mockReactions: Reaction[] = [];
let nextId = 1;
let nextReactionId = 1;

// Mock user
export const mockUser = {
  id: 'user-1',
  name: 'Demo User',
  email: 'demo@example.com',
};

export const mockCommentAPI = {
  async createComment(request: {
    commentType: 'inline' | 'page_end';
    commentText: string;
    parentCommentId?: string;
    isDraft?: boolean;
  }): Promise<CommentWithType> {
    const comment: CommentWithType = {
      id: `comment-${nextId++}`,
      authorId: mockUser.id,
      authorName: mockUser.name,
      authorEmail: mockUser.email,
      commentText: request.commentText,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      edited: false,
      resolved: false,
      parentCommentId: request.parentCommentId,
      commentType: request.commentType,
    };
    mockComments.push(comment);
    return comment;
  },

  async getComments(): Promise<CommentWithType[]> {
    return [...mockComments];
  },

  async updateComment(commentId: string, commentText: string): Promise<CommentWithType> {
    const comment = mockComments.find((c) => c.id === commentId);
    if (!comment) {
      throw new Error('Comment not found');
    }
    comment.commentText = commentText;
    comment.updatedAt = new Date().toISOString();
    comment.edited = true;
    return { ...comment };
  },

  async deleteComment(commentId: string): Promise<void> {
    const index = mockComments.findIndex((c) => c.id === commentId);
    if (index === -1) {
      throw new Error('Comment not found');
    }
    // Remove comment and all its replies
    const toRemove = [commentId];
    const findReplies = (parentId: string) => {
      mockComments.forEach((c) => {
        if (c.parentCommentId === parentId) {
          toRemove.push(c.id);
          findReplies(c.id);
        }
      });
    };
    findReplies(commentId);
    toRemove.forEach((id) => {
      const idx = mockComments.findIndex((c) => c.id === id);
      if (idx !== -1) {
        mockComments.splice(idx, 1);
      }
    });
  },

  async resolveComment(commentId: string, resolved: boolean): Promise<CommentWithType> {
    const comment = mockComments.find((c) => c.id === commentId);
    if (!comment) {
      throw new Error('Comment not found');
    }
    comment.resolved = resolved;
    comment.updatedAt = new Date().toISOString();
    return { ...comment };
  },

  // Reaction methods
  async addReaction(commentId: string, emoji: string): Promise<void> {
    // Validate inputs
    if (!commentId || !emoji) {
      return;
    }
    
    // Check if reaction already exists
    const existing = mockReactions.find(
      (r) => r.commentId === commentId && r.userId === mockUser.id && r.emoji === emoji
    );
    if (existing) {
      return; // Already reacted
    }
    
    // Add reaction with explicit commentId
    mockReactions.push({
      id: `reaction-${nextReactionId++}`,
      commentId: commentId,
      userId: mockUser.id,
      emoji: emoji,
      createdAt: new Date().toISOString(),
    });
  },

  async removeReaction(commentId: string, emoji: string): Promise<void> {
    const index = mockReactions.findIndex(
      (r) => r.commentId === commentId && r.userId === mockUser.id && r.emoji === emoji
    );
    if (index !== -1) {
      mockReactions.splice(index, 1);
    }
  },

  async getReactions(commentId: string): Promise<ReactionSummary[]> {
    if (!commentId) {
      return [];
    }
    
    // Filter reactions strictly by commentId - only return reactions for this specific comment
    const reactions = mockReactions.filter((r) => r.commentId === commentId);
    
    // Group by emoji
    const grouped = new Map<string, Reaction[]>();
    reactions.forEach((r) => {
      if (!grouped.has(r.emoji)) {
        grouped.set(r.emoji, []);
      }
      grouped.get(r.emoji)!.push(r);
    });

    // Convert to ReactionSummary
    return Array.from(grouped.entries()).map(([emoji, reactionList]) => ({
      emoji,
      count: reactionList.length,
      userIds: reactionList.map((r) => r.userId),
      hasReacted: reactionList.some((r) => r.userId === mockUser.id),
    }));
  },
};

