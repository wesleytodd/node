// Flags: --expose-internals

import { spawnPromisified } from '../common/index.mjs';
import fixtures from '../common/fixtures.js';
import tmpdir from '../common/tmpdir.js';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { execPath } from 'node:process';
import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import http from 'node:http';
import import_map from 'internal/modules/esm/import_map';
const { ImportMap } = import_map;
import binding from 'internal/test/binding';
const { primordials: { SafeMap, JSONStringify } } = binding;

const importMapFixtureRoot = fixtures.path('es-module-loaders', 'importmaps');
const entryPoint = pathToFileURL(path.resolve(importMapFixtureRoot, 'index.mjs'));
const getImportMapPathURL = (name) => {
  return pathToFileURL(path.resolve(importMapFixtureRoot, name + '.json'));
};
const getImportMap = async (name) => {
  const url = getImportMapPathURL(name);
  const rawMap = await import(url, { with: { type: 'json' } });
  return new ImportMap(rawMap.default, url);
};

describe('Import Maps', { concurrency: true }, () => {
  tmpdir.refresh();
  it('processImportMap - simple importmap', async () => {
    const importMap = await getImportMap('simple');
    assert.deepStrictEqual(importMap.imports, new SafeMap(Object.entries({
      foo: './node_modules/foo/index.mjs'
    })));
    const expectedScopes = new SafeMap();
    const fooScopeKey = new URL(importMap.baseURL, pathToFileURL('node_modules/foo'));
    const fooScopeMap = new SafeMap(Object.entries({
      bar: './baz.mjs'
    }));
    expectedScopes.set(fooScopeKey, fooScopeMap);
    assert.deepStrictEqual(importMap.scopes, expectedScopes);
  });

  it('processImportMap - invalid importmap', async () => {
    assert.rejects(
      getImportMap('invalid'),
      /^Error \[ERR_INVALID_IMPORT_MAP\]: Invalid import map: top level key "imports" is required and must be a plain object$/
    );
    assert.rejects(
      getImportMap('missing-scopes'),
      /^Error \[ERR_INVALID_IMPORT_MAP\]: Invalid import map: top level key "scopes" is required and must be a plain object$/
    );
    assert.rejects(
      getImportMap('array-imports'),
      /^Error \[ERR_INVALID_IMPORT_MAP\]: Invalid import map: top level key "imports" is required and must be a plain object$/
    );
  });

  it('resolve - empty importmap', async () => {
    const importMap = await getImportMap('empty');
    const spec = importMap.resolve('test');
    assert.strictEqual(spec, 'test');
  });

  it('resolve - simple importmap', async () => {
    const importMap = await getImportMap('simple');
    assert.strictEqual(
      importMap.resolve('foo').pathname,
      new URL('node_modules/foo/index.mjs', entryPoint).pathname
    );
    assert.strictEqual(
      importMap.resolve('bar', new URL('node_modules/foo/index.mjs', entryPoint)).pathname,
      new URL('baz.mjs', entryPoint).pathname
    );
    assert.strictEqual(importMap.resolve('bar'), 'bar');
  });

  it('resolve - nested scopes', async () => {
    const importMap = await getImportMap('unordered-scopes');
    assert.strictEqual(
      importMap.resolve('zed', new URL('node_modules/bar', entryPoint)).pathname,
      new URL('node_modules/bar/node_modules/zed/index.mjs', entryPoint).pathname
    );
    assert.strictEqual(
      importMap.resolve('zed', new URL('node_modules/bar/node_modules/zed', entryPoint)).pathname,
      new URL('baz.mjs', entryPoint).pathname
    );
  });

  it('resolve - data url', async () => {
    const importMap = await getImportMap('dataurl');
    assert.strictEqual(
      importMap.resolve('foo').href,
      'data:text/javascript,export default () => \'data\''
    );
  });

  it('should pass --experimental-import-map', async () => {
    const importMapPath = fixtures.path('es-module-loaders/importmaps/simple.json');
    const { code, signal, stdout, stderr } = await spawnPromisified(execPath, [
      '--experimental-import-map', importMapPath,
      entryPoint.pathname,
    ], {
      cwd: fixtures.path('es-module-loaders/importmaps'),
    });

    assert.strictEqual(code, 0, stderr);
    assert.strictEqual(stdout, 'baz\n');
    assert.strictEqual(signal, null);
  });

  it('should throw on startup on invalid import map', async () => {
    const importMapPath = fixtures.path('es-module-loaders/importmaps/invalid.json');
    const { code, signal, stdout, stderr } = await spawnPromisified(execPath, [
      '--experimental-import-map', importMapPath,
      entryPoint.pathname,
    ], {
      cwd: fixtures.path('es-module-loaders/importmaps'),
    });

    assert.strictEqual(code, 1);
    assert.strictEqual(signal, null);
    assert.strictEqual(stdout, '');
    assert(stderr.includes('Invalid import map: top level key "imports" is required'));
  });

  it('should handle import maps with absolute paths', async () => {
    const importMapPath = path.resolve(tmpdir.path, 'absolute.json');
    await writeFile(importMapPath, JSONStringify({
      imports: {
        foo: fixtures.path('es-module-loaders/importmaps/node_modules/foo/index.mjs'),
        [fixtures.path('es-module-loaders/importmaps/baz.mjs')]: fixtures.path('es-module-loaders/importmaps/qux.mjs'),
      },
      scopes: {
        [fixtures.path('es-module-loaders/importmaps/node_modules/foo')]: {
          bar: fixtures.path('es-module-loaders/importmaps/baz.mjs'),
        }
      }
    }));

    const { code, signal, stdout, stderr } = await spawnPromisified(execPath, [
      '--experimental-import-map', importMapPath,
      entryPoint.pathname,
    ], {
      cwd: fixtures.path('es-module-loaders/importmaps'),
    });

    assert.strictEqual(code, 0, stderr);
    assert.strictEqual(signal, null);
    assert.strictEqual(stdout, 'qux\n');
  });

  it('should handle import maps with data urls', async () => {
    const importMapPath = getImportMapPathURL('dataurl').pathname;
    const { code, signal, stdout, stderr } = await spawnPromisified(execPath, [
      '--experimental-import-map', importMapPath,
      entryPoint.pathname,
    ], {
      cwd: importMapFixtureRoot,
    });

    assert.strictEqual(code, 0, stderr);
    assert.strictEqual(signal, null);
    assert.strictEqual(stdout, 'data\n');
  });

  it('should handle http imports', async () => {
    const server = http.createServer((req, res) => {
      res
        .writeHead(200, { 'Content-Type': 'application/javascript' })
        .end('export default () => \'http\'');
    });
    await (new Promise((resolve, reject) => {
      server.listen((err) => {
        if (err) return reject(err);
        resolve();
      });
    }));
    const { port } = server.address();

    const importMapPath = path.resolve(tmpdir.path, 'http.json');
    await writeFile(importMapPath, JSONStringify({
      imports: {
        foo: `http://localhost:${port}`
      },
      scopes: {}
    }));

    const { code, signal, stdout, stderr } = await spawnPromisified(execPath, [
      '--experimental-network-imports',
      '--experimental-import-map', importMapPath,
      entryPoint.pathname,
    ], {
      cwd: importMapFixtureRoot,
    });

    server.close();
    assert.strictEqual(code, 0, stderr);
    assert.strictEqual(signal, null);
    assert.strictEqual(stdout, 'http\n');
  });
});
