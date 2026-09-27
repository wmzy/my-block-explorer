// Shipped PWA asset contract: everything the browser needs to install the
// app must actually exist in public/ with honest dimensions. The PNG
// sizes are read from the IHDR header (dependency-free ground truth), not
// trusted from the manifest's own "sizes" strings.

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../public');

type ManifestIcon = {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
};

type Manifest = {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: ManifestIcon[];
};

const readManifest = (): Manifest =>
  JSON.parse(readFileSync(join(publicDir, 'manifest.webmanifest'), 'utf8')) as Manifest;

// PNG layout: 8-byte signature, then chunk header (4 length + 4 type);
// IHDR's width/height are the first 8 payload bytes → offsets 16/20.
const pngSize = (path: string): { width: number; height: number } => {
  const buf = readFileSync(path);
  expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG signature
  expect(buf.toString('ascii', 12, 16)).toBe('IHDR');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
};

describe('PWA assets', () => {
  it('ships a manifest with relative scope/start_url (subpath-deployable)', () => {
    const manifest = readManifest();
    // '.' keeps the manifest valid both at '/' and '/my-block-explorer/'
    // (VITE_BASE builds): relative URLs resolve against the manifest URL.
    expect(manifest.start_url).toBe('.');
    expect(manifest.scope).toBe('.');
    expect(manifest.display).toBe('standalone');
    expect(manifest.name.length).toBeGreaterThan(0);
    expect(manifest.short_name.length).toBeGreaterThan(0);
  });

  it('declares icons that exist with honest dimensions and purposes', () => {
    const manifest = readManifest();
    const purposes = new Set<string>();
    for (const icon of manifest.icons) {
      const path = join(publicDir, icon.src);
      expect(existsSync(path), `${icon.src} exists`).toBe(true);
      const [width, height] = icon.sizes.split('x').map(part => Number.parseInt(part, 10));
      expect(pngSize(path)).toEqual({ width, height });
      for (const purpose of (icon.purpose ?? '').split(' ')) {
        if (purpose.length > 0) purposes.add(purpose);
      }
    }
    // Installability: Chrome needs a ≥192px "any" icon and a maskable one.
    expect(purposes).toContain('any');
    expect(purposes).toContain('maskable');
  });

  it('ships the service worker and favicon at the deploy root', () => {
    expect(existsSync(join(publicDir, 'sw.js'))).toBe(true);
    expect(existsSync(join(publicDir, 'favicon.svg'))).toBe(true);
  });

  it('links installability metadata from index.html', () => {
    const html = readFileSync(resolve(publicDir, '..', 'index.html'), 'utf8');
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('name="theme-color"');
    expect(html).toContain('rel="apple-touch-icon"');
  });

  it('ships the apple-touch-icon at 180×180', () => {
    expect(pngSize(join(publicDir, 'apple-touch-icon.png'))).toEqual({
      width: 180,
      height: 180,
    });
  });
});
