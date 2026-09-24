import { useState, useEffect } from 'react';
import GlideboardDemo from './GlideboardDemo';
import Phase5Demo from './Phase5Demo';
import Phase4Demo from './Phase4Demo';
import Phase1Demo from './Phase1Demo';
import CameraDemo from './CameraDemo';
import PluginDemo from './PluginDemo';
import RBushDemo from './RBushDemo';
import ShapesDemo from './ShapesDemo';
import Phase3Demo from './Phase3Demo';
import CollaborationDemo from './CollaborationDemo';

const TABS = [
  { id: 'whiteboard', label: '🎨 Whiteboard',         component: GlideboardDemo },
  { id: 'collaboration', label: 'Collaboration',       component: CollaborationDemo },
  { id: 'phase5',     label: 'Phase 5 — Performance', component: Phase5Demo },
  { id: 'phase4',     label: 'Phase 4 — Arrows',      component: Phase4Demo  },
  { id: 'phase3',     label: 'Phase 3 — Tools',       component: Phase3Demo  },
  { id: 'rbush',      label: 'Phase 2.4 — RBush',     component: RBushDemo  },
  { id: 'shapes',     label: 'Phase 2.3 — Shapes',    component: ShapesDemo },
  { id: 'plugin',     label: 'Phase 2.2 — Plugins',   component: PluginDemo },
  { id: 'camera',     label: 'Phase 2.1 — Camera',    component: CameraDemo },
  { id: 'phase1',     label: 'Phase 1 — Store',       component: Phase1Demo },
] as const;

type TabId = typeof TABS[number]['id'];

function getInitialTab(): TabId {
  const hash = window.location.hash.replace('#', '');
  return (TABS.find(t => t.id === hash)?.id ?? 'whiteboard') as TabId;
}

export default function App() {
  const [active, setActive] = useState<TabId>(getInitialTab);

  useEffect(() => {
    const handler = () => {
      const hash = window.location.hash.replace('#', '');
      const found = TABS.find(t => t.id === hash);
      if (found) setActive(found.id);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);

  const ActiveComponent = TABS.find(t => t.id === active)!.component;

  return (
    <div style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
      {/* Tab bar */}
      <div style={{ background: '#1e1e2e', borderBottom: '1px solid #313244', padding: '0 24px', display: 'flex', gap: 4, overflowX: 'auto' }}>
        {TABS.map(tab => (
          <a
            key={tab.id}
            href={`#${tab.id}`}
            onClick={() => setActive(tab.id)}
            style={{
              padding: '12px 16px',
              fontSize: 13,
              fontWeight: active === tab.id ? 700 : 400,
              color: active === tab.id ? '#89b4fa' : '#6c7086',
              borderBottom: active === tab.id ? '2px solid #89b4fa' : '2px solid transparent',
              textDecoration: 'none',
              whiteSpace: 'nowrap',
              transition: 'color 0.15s',
            }}
          >
            {tab.label}
          </a>
        ))}
      </div>

      {/* Active page */}
      <ActiveComponent />
    </div>
  );
}
