/** Layout checks exercised by the browser fixture against the rebuilt package. */
export function checkEditorStyles() {
  const failures: string[] = [];
  let checks = 0;
  const check = (condition: boolean, message: string) => { checks++; if (!condition) failures.push(message); };
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-fixture] .ProseMirror'));
  check(roots.length === 4, 'All four editors are mounted');
  const css = (node: Element) => getComputedStyle(node);
  for (const root of roots) {
    const label = root.closest('[data-fixture]')!.getAttribute('data-fixture');
    const hr = root.querySelector('hr')!;
    const above = hr.getBoundingClientRect().top - hr.previousElementSibling!.getBoundingClientRect().bottom;
    const below = hr.nextElementSibling!.getBoundingClientRect().top - hr.getBoundingClientRect().bottom;
    check(Math.abs(above - 16) < 1 && Math.abs(below - 16) < 1, `${label}: divider has 16px spacing on both sides`);
    check(css(root.querySelector('pre')!).borderRadius === '8px', `${label}: code radius is independent of block metadata`);
    const sizes = [1, 2, 3, 4, 5, 6].map(n => parseFloat(css(root.querySelector(`h${n}`)!).fontSize));
    check(sizes.every((size, i) => i === 0 || size < sizes[i - 1]), `${label}: heading scale stays distinct`);
    check(css(root.querySelector('p')!).lineHeight === '26px', `${label}: shared paragraph line-height`);
    for (const selector of ['.toc-list', '.child-pages-tree']) {
      const s = css(root.querySelector(selector)!);
      check(s.marginTop === '0px' && s.marginBottom === '0px' && s.listStyleType === 'none', `${label}: ${selector} is isolated from prose lists`);
    }
    check(css(root.querySelector('ul[data-editor-list]')!).listStyleType === 'disc', `${label}: document bullets retained`);
    check(css(root.querySelector('ul[data-editor-list] ul[data-editor-list]')!).listStyleType === 'circle', `${label}: nested bullets retained`);
    check(css(root.querySelector('.editor-column h2')!).marginTop === '0px', `${label}: first column heading has no leading gap`);
    check(root.scrollWidth <= root.clientWidth + 1, `${label}: no horizontal content overflow`);
  }
  for (const index of [0, 2]) {
    const edit = roots[index], view = roots[index + 1];
    if (!edit || !view) continue;
    for (const selector of ['p', 'h1', 'h2', 'h3', 'pre', '.toc-list', '.child-pages-tree']) {
      const a = css(edit.querySelector(selector)!), b = css(view.querySelector(selector)!);
      check(['fontSize', 'fontFamily', 'lineHeight', 'marginTop', 'marginBottom', 'padding', 'borderRadius', 'color', 'backgroundColor'].every(key => a[key as keyof CSSStyleDeclaration] === b[key as keyof CSSStyleDeclaration]), `Pair ${index}: ${selector} matches edit/view`);
    }
    const a = edit.querySelector('.image-caption-input')!, b = view.querySelector('.image-caption-readonly')!;
    check(css(a).color === css(b).color && css(a).lineHeight === css(b).lineHeight && Math.abs(a.getBoundingClientRect().height - b.getBoundingClientRect().height) < 1, `Pair ${index}: captions match color, wrapping and height`);
  }
  return { checks, passed: checks - failures.length, failures };
}
