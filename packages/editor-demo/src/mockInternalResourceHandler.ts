import type {
  InternalResourceHandler,
  InternalResourceMetadata,
  InternalResourceResult,
  InternalResourceType,
} from '@beskar/editor';

const now = Date.now();

const resources: InternalResourceMetadata[] = [
  {
    resourceId: 'doc-roadmap',
    resourceType: 'document',
    title: 'Product Roadmap',
    icon: '📄',
    excerpt: 'A planning document covering milestones, scope decisions, risks, and delivery sequencing for the Beskar workspace.',
    lastEditedAt: new Date(now - 1000 * 60 * 12).toISOString(),
    updatedByName: 'Alice',
  },
  {
    resourceId: 'doc-launch',
    resourceType: 'document',
    title: 'Launch Checklist',
    icon: '✅',
    excerpt: 'Pre-launch validation checklist for editor features, permissions, embeds, attachments, and publishing.',
    lastEditedAt: new Date(now - 1000 * 60 * 90).toISOString(),
    updatedByName: 'Bob',
  },
  {
    resourceId: 'wb-flow',
    resourceType: 'whiteboard',
    title: 'Workspace Flow Diagram',
    icon: '▧',
    excerpt: 'Flow diagram showing page hierarchy, editor blocks, whiteboard routing, and comments.',
    lastEditedAt: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
    updatedByName: 'Mira',
  },
  {
    resourceId: 'wb-architecture',
    resourceType: 'whiteboard',
    title: 'Embed Architecture',
    icon: '▧',
    excerpt: 'Whiteboard sketch of internal and external embed data flow.',
    lastEditedAt: new Date(now - 1000 * 60 * 60 * 26).toISOString(),
    updatedByName: 'Kiran',
  },
];

function toResult(resource: InternalResourceMetadata): InternalResourceResult {
  return {
    resourceId: resource.resourceId,
    resourceType: resource.resourceType,
    title: resource.title,
    icon: resource.icon,
    lastEditedAt: resource.lastEditedAt,
  };
}

export const mockInternalResourceHandler: InternalResourceHandler = {
  appBaseUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173',
  async searchResources(query: string, resourceType: InternalResourceType) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    const normalized = query.trim().toLowerCase();
    return resources
      .filter((resource) => resource.resourceType === resourceType)
      .filter((resource) => !normalized || resource.title.toLowerCase().includes(normalized))
      .map(toResult);
  },
  async getResourceMetadata(resourceId: string, resourceType: InternalResourceType) {
    await new Promise((resolve) => setTimeout(resolve, 120));
    return resources.find((resource) => resource.resourceId === resourceId && resource.resourceType === resourceType) ?? null;
  },
  navigateToResource(resourceId: string, resourceType: InternalResourceType) {
    console.log('[mockInternalResourceHandler] navigateToResource', resourceType, resourceId);
    window.alert(`Navigate to ${resourceType}: ${resourceId}`);
  },
};
