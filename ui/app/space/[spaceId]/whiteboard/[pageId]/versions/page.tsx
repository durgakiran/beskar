import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Flex, Text, Button, Table, Spinner, Badge } from '@radix-ui/themes';
import { ArrowLeft } from 'lucide-react';
import { getApiV1Base } from 'app/core/http/apiBase';

interface WhiteboardVersion {
  docId: number;
  version: string;
  previewAssetName?: string;
}

export default function WhiteboardVersionsPage() {
  const { spaceId, pageId } = useParams();
  const navigate = useNavigate();
  const [versions, setVersions] = useState<WhiteboardVersion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchVersions = async () => {
      try {
        const res = await fetch(`/api/v1/editor/space/${spaceId}/whiteboard/${pageId}/versions`, {
          credentials: 'include',
        });
        if (res.ok) {
          const json = await res.json();
          setVersions(json.data || []);
        }
      } catch (err) {
        console.error('Failed to fetch versions', err);
      } finally {
        setLoading(false);
      }
    };
    fetchVersions();
  }, [spaceId, pageId]);

  return (
    <div style={{ padding: '2rem', maxWidth: '800px', margin: '0 auto' }}>
      <Flex align="center" gap="3" mb="5">
        <Button variant="ghost" color="gray" onClick={() => navigate(`/space/${spaceId}/view/${pageId}`)}>
          <ArrowLeft size={16} /> Back to Page
        </Button>
        <Text size="5" weight="bold">Whiteboard Version History</Text>
      </Flex>

      {loading ? (
        <Flex justify="center" mt="5"><Spinner size="3" /></Flex>
      ) : (
        <Table.Root variant="surface">
          <Table.Header>
            <Table.Row>
              <Table.ColumnHeaderCell>Preview</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Published At</Table.ColumnHeaderCell>
              <Table.ColumnHeaderCell>Action</Table.ColumnHeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {versions.map((v) => (
              <Table.Row key={v.docId} align="center">
                <Table.Cell>
                  {v.previewAssetName ? (
                    <img
                      src={`${getApiV1Base({ fallbackBase: import.meta.env.VITE_IMAGE_SERVER_URL })}/media/image/${v.previewAssetName}`}
                      alt="Preview"
                      style={{ height: '60px', borderRadius: '4px', border: '1px solid var(--gray-4)' }}
                    />
                  ) : (
                    <Badge color="gray" variant="soft">No Preview</Badge>
                  )}
                </Table.Cell>
                <Table.Cell>
                  <Text size="2">{new Date(v.version).toLocaleString()}</Text>
                </Table.Cell>
                <Table.Cell>
                  <Button
                    size="1"
                    variant="soft"
                    onClick={() => navigate(`/space/${spaceId}/whiteboard/${pageId}/versions/${v.docId}`)}
                  >
                    View
                  </Button>
                </Table.Cell>
              </Table.Row>
            ))}
            {versions.length === 0 && (
              <Table.Row>
                <Table.Cell colSpan={3}>
                  <Text color="gray" size="2">No versions published yet.</Text>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Root>
      )}
    </div>
  );
}
