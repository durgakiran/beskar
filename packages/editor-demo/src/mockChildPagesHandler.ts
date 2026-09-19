import type { ChildPageResult, ChildPagesHandler } from '@beskar/editor';

const childPages: ChildPageResult[] = [
  {
    pageId: 'child-editor-rollout',
    title: 'Editor Rollout Plan',
    children: [
      {
        pageId: 'child-editor-rollout-testing',
        title: 'Rollout Testing Notes',
        children: [
          {
            pageId: 'child-editor-rollout-testing-browser',
            title: 'Browser Verification',
          },
        ],
      },
    ],
  },
  {
    pageId: 'child-embed-notes',
    title: 'Embed Provider Notes',
  },
  {
    pageId: 'child-release-risks',
    title: 'Release Risks',
  },
];

export const mockChildPagesHandler: ChildPagesHandler = {
  async getPageHierarchy() {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return childPages;
  },
  navigateToChildPage(pageId: string) {
    console.log('[mockChildPagesHandler] navigateToChildPage', pageId);
    window.alert(`Navigate to child page: ${pageId}`);
  },
};
