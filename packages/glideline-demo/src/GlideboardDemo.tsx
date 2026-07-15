import React from 'react';
import { createSvgPathShape, Glideboard, type GlideboardHandle } from '@durgakiran/glideboard';
import type { GlideDocument } from '@durgakiran/glideline';

const STORAGE_KEY = 'glideline-whiteboard-v1';
const SESSION_KEY = 'glideline-whiteboard-demo';

// Official AWS Lambda architecture icon path from AWS's April 2026 icon package.
// Source: https://aws.amazon.com/architecture/icons/
const AWS_LAMBDA_PATH = 'M28.0075352 66 L15.5907274 66 L29.3235885 37.296 L35.5460249 50.106 L28.0075352 66 Z M30.2196674 34.553 C30.0512768 34.208 29.7004629 33.989 29.3175745 33.989 L29.3145676 33.989 C28.9286723 33.99 28.5778583 34.211 28.4124746 34.558 L13.097944 66.569 C12.9495999 66.879 12.9706487 67.243 13.1550766 67.534 C13.3374998 67.824 13.6582439 68 14.0020416 68 L28.6420072 68 C29.0299071 68 29.3817234 67.777 29.5481094 67.428 L37.563706 50.528 C37.693006 50.254 37.6920037 49.937 37.5586944 49.665 L30.2196674 34.553 Z M64.9953491 66 L52.6587274 66 L32.866809 24.57 C32.7014253 24.222 32.3486067 24 31.9617091 24 L23.8899822 24 L23.8990031 14 L39.7197081 14 L59.4204149 55.429 C59.5857986 55.777 59.9386172 56 60.3255148 56 L64.9953491 56 L64.9953491 66 Z M65.9976745 54 L60.9599868 54 L41.25928 12.571 C41.0938963 12.223 40.7410777 12 40.3531778 12 L22.89768 12 C22.3453987 12 21.8963569 12.447 21.8953545 12.999 L21.884329 24.999 C21.884329 25.265 21.9885708 25.519 22.1780103 25.707 C22.3654452 25.895 22.6200358 26 22.8866544 26 L31.3292417 26 L51.1221625 67.43 C51.2885485 67.778 51.6393624 68 52.02626 68 L65.9976745 68 C66.5519605 68 67 67.552 67 67 L67 55 C67 54.448 66.5519605 54 65.9976745 54 Z';

function scaleAbsolutePath(path: string, scaleX: number, scaleY: number): string {
  const tokens = path.match(/[MLCZ]|-?(?:\d+\.?\d*|\.\d+)/g) ?? [];
  const parameterCounts: Record<string, number> = { M: 2, L: 2, C: 6, Z: 0 };
  const output: string[] = [];
  let index = 0;

  while (index < tokens.length) {
    const command = tokens[index++]!;
    output.push(command);
    const count = parameterCounts[command];
    if (count === undefined) throw new Error(`Unsupported SVG command: ${command}`);
    for (let parameter = 0; parameter < count; parameter++) {
      const value = Number(tokens[index++]);
      output.push(String(value * (parameter % 2 === 0 ? scaleX : scaleY)));
    }
  }

  return output.join(' ');
}

const { plugin: awsLambdaPlugin } = createSvgPathShape({
  type: 'aws-lambda',
  defaultSize: { w: 120, h: 120 },
  defaultColor: 'orange',
  defaultFillStyle: 'solid',
  getPathD: (w, h) => scaleAbsolutePath(AWS_LAMBDA_PATH, w / 80, h / 80),
});

function loadInitialDocument(): GlideDocument | null {
  if (typeof window === 'undefined') return null;
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as GlideDocument;
  } catch (error) {
    console.warn('[GlideboardDemo] Failed to restore session:', error);
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export default function GlideboardDemo() {
  const boardRef = React.useRef<GlideboardHandle | null>(null);
  const initialDocument = React.useMemo(() => loadInitialDocument(), []);

  return (
    <div style={{ height: 'calc(100vh - 42px)', position: 'relative' }}>
      <button
        id="demo-tool-aws-lambda"
        onClick={() => boardRef.current?.setCurrentTool('aws-lambda')}
        style={{
          position: 'absolute', top: 12, left: 84, zIndex: 200,
          padding: '8px 12px', borderRadius: 8, border: '1px solid #ed7100',
          background: '#fff7ed', color: '#9a3412', fontWeight: 700, cursor: 'pointer',
        }}
      >
        AWS Lambda
      </button>
      <Glideboard
        ref={boardRef}
        sessionKey={SESSION_KEY}
        initialDocument={initialDocument}
        initialDocumentDisposition={initialDocument
          ? { kind: 'local-recovery', recoveryCheckpoint: STORAGE_KEY }
          : undefined}
        debugApiKey="__GLIDELINE_WHITEBOARD__"
        customShapes={[awsLambdaPlugin]}
        onDocumentChange={(document) => {
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
        }}
        pendingSaveOnUnmount="flush"
      />
    </div>
  );
}
