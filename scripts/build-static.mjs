import { mkdir, copyFile } from 'node:fs/promises';

// Only application assets are published; test media and project backups stay local.
const assets = [
  'index.html', 'favicon.svg', 'styles.css', 'creative.css',
  'mobile-workspace.css', 'product.css', 'mobile-editor.css', 'reference-mobile.css',
  'app.js', 'beat-maker.js', 'editing.js', 'engine.js',
  'import-media.js', 'mobile-editor.js', 'mobile-dock.js', 'music-library.js',
  'project-store.js', 'recovery-ui.js', 'templates.js', 'timeline.js', 'auto-edit.js', 'export-support.js',
  'selection.js', 'story-planner.js', 'finishing.js', 'project-review.js'
];
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await Promise.all(assets.map(name => copyFile(
  new URL(`../${name}`, import.meta.url),
  new URL(`../dist/${name}`, import.meta.url)
)));
console.log(`Built ${assets.length} static application assets.`);
