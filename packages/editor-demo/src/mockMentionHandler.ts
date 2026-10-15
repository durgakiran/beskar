import type { MentionDetailsOptions, MentionHandler, MentionUser, MentionUserDetails } from '@beskar/editor';

const mockProfiles: MentionUserDetails[] = [
  { id: 'user-alex', label: 'Alex Morgan', email: 'alex.morgan@example.com', spaceRole: 'editor', avatarUrl: '/mention-avatar.svg' },
  { id: 'user-priya', label: 'Priya Shah', email: 'priya.shah@example.com', spaceRole: 'admin', avatarUrl: null },
  { id: 'user-sam', label: 'Sam Lee', email: 'sam.lee@example.com', spaceRole: 'viewer', avatarUrl: null },
];
export const mockMentionUsers: MentionUser[] = mockProfiles.map(({ id, label }) => ({ id, label }));
let samDetailsFailed = false;

function profileDelay(options?: MentionDetailsOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    const signal = options?.signal;
    const abort = () => {
      clearTimeout(timer);
      reject(new DOMException('Request aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, 450);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

export const mockMentionHandler: MentionHandler = {
  async searchUsers(query) {
    await new Promise(resolve => setTimeout(resolve, 150));
    return mockMentionUsers.filter(user => user.label.toLowerCase().includes(query.toLowerCase()));
  },
  async resolveUser(id) {
    return mockMentionUsers.find(user => user.id === id) ?? null;
  },
  async getUserDetails(id, options) {
    await profileDelay(options);
    // Demonstrates a temporary directory outage and the card's Retry action.
    if (id === 'user-sam' && !samDetailsFailed) {
      samDetailsFailed = true;
      throw new Error('Mock directory temporarily unavailable');
    }
    return mockProfiles.find(user => user.id === id) ?? null;
  },
};
