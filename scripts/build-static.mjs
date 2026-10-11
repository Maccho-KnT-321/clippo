import { mkdir, copyFile } from 'node:fs/promises';

// Only application assets are published; test media and project backups stay local.
const assets = [
  'index.html', 'favicon.svg', 'styles.css', 'creative.css',
  'mobile-workspace.css', 'product.css', 'mobile-editor.css', 'reference-mobile.css', 'flow-mobile.css',
  'app.js', 'beat-maker.js', 'editing.js', 'engine.js',
  'import-media.js', 'mobile-editor.js', 'mobile-dock.js', 'music-library.js',
  'project-store.js', 'project-archive.js', 'recovery-ui.js', 'templates.js', 'timeline.js', 'auto-edit.js', 'export-support.js',
  'selection.js', 'story-planner.js', 'finishing.js', 'project-review.js', 'looks.js',
  'reliable-export.js', 'export-audio.js', 'vendor/mediabunny/mediabunny.js',
  'vendor/mediabunny/LICENSE', 'vendor/mediabunny/NOTICE.md'
];
await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
await Promise.all(assets.map(async name => {
  const destination=new URL(`../dist/${name}`,import.meta.url);
  await mkdir(new URL('.',destination),{recursive:true});
  await copyFile(new URL(`../${name}`,import.meta.url),destination);
}));
console.log(`Built ${assets.length} static application assets.`);
