import type { JSONContent } from '@tiptap/core';
import { buildPdfDefinition, pdfFileName, type PdfExportOptions } from './definition';
export { buildPdfDefinition, pdfFileName, safePdfLink } from './definition';
export type { PdfExportOptions } from './definition';

/** Client-only, loaded through the separate /pdf entry point on demand. */
export async function createDocumentPdf(doc: JSONContent, options: PdfExportOptions) {
  const snapshot = JSON.parse(JSON.stringify(doc)) as JSONContent;
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts'),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  const result = await buildPdfDefinition(snapshot, { ...options, renderMath: options.renderMath ?? renderEquation });
  const blob = await pdfMake.createPdf(result.definition).getBlob();
  return { blob, fileName: pdfFileName(options.title), warnings: result.warnings };
}

let mathRenderer: Promise<(latex: string, display: boolean) => { svg: string; width: number; height: number }> | undefined;
async function renderEquation(latex: string, display: boolean) {
  mathRenderer ??= Promise.all([
    import('mathjax-full/js/mathjax.js'), import('mathjax-full/js/input/tex.js'),
    import('mathjax-full/js/output/svg.js'), import('mathjax-full/js/adaptors/liteAdaptor.js'),
    import('mathjax-full/js/handlers/html.js'), import('mathjax-full/js/input/tex/AllPackages.js'),
  ]).then(([{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }, { AllPackages }]) => {
    const adaptor = liteAdaptor();
    RegisterHTMLHandler(adaptor);
    const document = mathjax.document('', { InputJax: new TeX({ packages: AllPackages.filter(name => !['require', 'autoload', 'html'].includes(name)) }), OutputJax: new SVG({ fontCache: 'none' }) });
    return (latex: string, display: boolean) => {
      const node = document.convert(latex, { display });
      const svgNode = adaptor.firstChild(node) as Parameters<typeof adaptor.getAttribute>[0];
      const viewBox = adaptor.getAttribute(svgNode, 'viewBox').split(/\s+/).map(Number);
      const width = Math.max(1, viewBox[2] * 0.012);
      const height = Math.max(1, viewBox[3] * 0.012);
      adaptor.setAttribute(svgNode, 'width', String(width));
      adaptor.setAttribute(svgNode, 'height', String(height));
      const svg = adaptor.outerHTML(svgNode).replace(/currentColor/g, '#20242b');
      if (svg.includes('data-mml-node="merror"')) throw new Error('Invalid equation');
      return { svg, width, height };
    };
  }).catch(error => { mathRenderer = undefined; throw error; });
  return (await mathRenderer)(latex, display);
}
