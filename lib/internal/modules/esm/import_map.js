'use strict';
const { isURL, URL } = require('internal/url');
const { ObjectEntries, ObjectKeys, SafeMap, ArrayIsArray } = primordials;
const { codes: { ERR_INVALID_IMPORT_MAP } } = require('internal/errors');

class ImportMap {
  #baseURL;
  imports = new SafeMap();
  scopes = new SafeMap();

  constructor(raw, baseURL) {
    this.#baseURL = baseURL;
    processImportMap(this, this.#baseURL, raw);
  }

  get baseURL() {
    return this.#baseURL;
  }

  resolve(specifier, parentURL = this.baseURL) {
    // Process scopes
    for (const { 0: prefix, 1: mapping } of this.scopes) {
      let mappedSpecifier = mapping.get(specifier);
      if (parentURL.pathname.startsWith(prefix.pathname) && mappedSpecifier) {
        if (!isURL(mappedSpecifier)) {
          mappedSpecifier = new URL(mappedSpecifier, this.baseURL);
          mapping.set(specifier, mappedSpecifier);
        }
        specifier = mappedSpecifier;
        break;
      }
    }

    let spec = specifier;
    if (isURL(specifier)) {
      spec = specifier.pathname;
    }
    let importMapping = this.imports.get(spec);
    if (importMapping) {
      if (!isURL(importMapping)) {
        importMapping = new URL(importMapping, this.baseURL);
        this.imports.set(spec, importMapping);
      }
      return importMapping;
    }

    return specifier;
  }
}

function processImportMap(importMap, baseURL, raw) {
  // Validation and normalization
  if (typeof raw.imports !== 'object' || ArrayIsArray(raw.imports)) {
    throw new ERR_INVALID_IMPORT_MAP('top level key "imports" is required and must be a plain object');
  }
  if (typeof raw.scopes !== 'object' || ArrayIsArray(raw.scopes)) {
    throw new ERR_INVALID_IMPORT_MAP('top level key "scopes" is required and must be a plain object');
  }

  // Normalize imports
  for (const { 0: specifier, 1: mapping } of ObjectEntries(raw.imports)) {
    if (!specifier || typeof specifier !== 'string') {
      throw new ERR_INVALID_IMPORT_MAP('module specifier keys must be non-empty strings');
    }
    if (!mapping || typeof mapping !== 'string') {
      throw new ERR_INVALID_IMPORT_MAP('module specifier values must be non-empty strings');
    }
    if (specifier.endsWith('/') && !mapping.endsWith('/')) {
      throw new ERR_INVALID_IMPORT_MAP('module specifier values for keys ending with / must also end with /');
    }

    importMap.imports.set(specifier, mapping);
  }

  // Normalize scopes
  // Sort the keys according to spec and add to the map in order
  // which preserves the sorted map requirement
  const sortedScopes = ObjectKeys(raw.scopes).sort().reverse();
  for (let scope of sortedScopes) {
    const _scopeMap = raw.scopes[scope];
    if (!scope || typeof scope !== 'string') {
      throw new ERR_INVALID_IMPORT_MAP('import map scopes keys must be non-empty strings');
    }
    if (!_scopeMap || typeof _scopeMap !== 'object') {
      throw new ERR_INVALID_IMPORT_MAP(`scope values must be plain objects (${scope} is ${typeof _scopeMap})`);
    }

    // Normalize scope
    scope = new URL(scope, baseURL);

    const scopeMap = new SafeMap();
    for (const { 0: specifier, 1: mapping } of ObjectEntries(_scopeMap)) {
      if (specifier.endsWith('/') && !mapping.endsWith('/')) {
        throw new ERR_INVALID_IMPORT_MAP('module specifier values for keys ending with / must also end with /');
      }
      scopeMap.set(specifier, mapping);
    }

    importMap.scopes.set(scope, scopeMap);
  }

  return importMap;
}

module.exports = {
  ImportMap,
};
