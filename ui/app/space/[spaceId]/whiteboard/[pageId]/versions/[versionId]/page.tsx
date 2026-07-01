import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Flex, Text, Button, Spinner } from '@radix-ui/themes';
import { ArrowLeft } from 'lucide-react';
import { Glideboard } from '@durgakiran/glideboard';

export default function WhiteboardVersionViewPage() {
  const { spaceId, pageId, versionId } = useParams();
  const navigate = useNavigate();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVersion = async () => {
      try {
        const res = await fetch(`/api/v1/editor/space/${spaceId}/whiteboard/${pageId}/version/${versionId}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const json = await res.json();
          setContent(json.data?.data || null);
        }
      } catch (err) {
        console.error('Failed to fetch version', err);
      } finally {
        setLoading(false);
      }
    };
    fetchVersion();
  }, [spaceId, pageId, versionId]);

  return (
    <Flex direction="column" style={{ height: '100vh', overflow: 'hidden' }}>
      <Flex align="center" gap="3" p="3" style={{ borderBottom: '1px solid var(--gray-4)', background: 'var(--color-panel)' }}>
        <Button variant="ghost" color="gray" onClick={() => navigate(`/space/${spaceId}/whiteboard/${pageId}/versions`)}>
          <ArrowLeft size={16} /> Back to History
        </Button>
        <Text size="3" weight="bold">Historical Version (Read-Only)</Text>
      </Flex>

      <Flex flexGrow="1" style={{ position: 'relative' }}>
        {loading ? (
          <Flex align="center" justify="center" style={{ width: '100%', height: '100%' }}>
            <Spinner size="3" />
          </Flex>
        ) : content ? (
          <Glideboard
            initialDocument={content}
            readOnly={true}
          />
        ) : (
          <Flex align="center" justify="center" style={{ width: '100%', height: '100%' }}>
            <Text color="red">Failed to load whiteboard data.</Text>
          </Flex>
        )}
      </Flex>
    </Flex>
  );
}
