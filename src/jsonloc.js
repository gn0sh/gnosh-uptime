// A small strict JSON parser that remembers the line of every value and gives
// plain-language errors for common mistakes (decision: config is JSON, and
// validate reports plain-language errors with line numbers).
//
// parseJson(text) -> { value, lines: Map<path, line>, duplicates: Array<{path, line}> }
// throws JsonSyntaxError { line, column, message } on invalid JSON.
// Paths are dot-joined keys and indexes: "targets", "targets.3", "targets.3.url".

export class JsonSyntaxError extends Error {
  constructor(message, line, column) {
    super(message);
    this.name = 'JsonSyntaxError';
    this.line = line;
    this.column = column;
  }
}

export function parseJson(text) {
  const src = String(text).replace(/^﻿/, '');
  let i = 0;
  const lines = new Map();
  const duplicates = [];

  function pos(at = i) {
    let line = 1;
    let col = 1;
    for (let k = 0; k < at && k < src.length; k++) {
      if (src[k] === '\n') {
        line++;
        col = 1;
      } else {
        col++;
      }
    }
    return { line, col };
  }

  function err(message, at = i) {
    const p = pos(at);
    throw new JsonSyntaxError(message, p.line, p.col);
  }

  function skipSpace() {
    for (;;) {
      const c = src[i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
        i++;
      } else if (c === '/' && (src[i + 1] === '/' || src[i + 1] === '*')) {
        err('Comments (// or /* */) are not allowed in this file. Remove the comment.');
      } else {
        return;
      }
    }
  }

  function describe(c) {
    if (c === undefined) return 'the end of the file';
    if (c === '\n' || c === '\r') return 'the end of a line';
    return `"${c}"`;
  }

  function parseValue(path) {
    skipSpace();
    lines.set(path, pos().line);
    const c = src[i];
    if (c === '{') return parseObject(path);
    if (c === '[') return parseArray(path);
    if (c === '"') return parseString();
    if (c === "'") err('Use double quotes ("), not single quotes (\').');
    if (c === '-' || (c >= '0' && c <= '9')) return parseNumber();
    for (const [word, val] of [['true', true], ['false', false], ['null', null]]) {
      if (src.startsWith(word, i)) {
        i += word.length;
        return val;
      }
    }
    if (c === undefined) err('The file ends too early. A closing } or ] may be missing.');
    if (c === '}' || c === ']') err(`A value is missing before ${describe(c)}. If there is a comma just before it, remove that comma.`);
    if (c === ',') err('There is an extra comma, or a value is missing before this comma.');
    err('Text must be in double quotes, like "My site". A quote mark may be missing.');
  }

  function parseString() {
    const start = i;
    i++; // opening quote
    let out = '';
    for (;;) {
      const c = src[i];
      if (c === undefined || c === '\n' || c === '\r') {
        err('This text is missing its closing double quote (").', start);
      }
      if (c === '"') {
        i++;
        return out;
      }
      if (c === '\\') {
        const e = src[i + 1];
        const map = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
        if (e in map) {
          out += map[e];
          i += 2;
        } else if (e === 'u' && /^[0-9a-fA-F]{4}$/.test(src.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(src.slice(i + 2, i + 6), 16));
          i += 6;
        } else {
          err('A backslash (\\) in text must be written as two backslashes (\\\\).');
        }
        continue;
      }
      if (c < ' ') err('Text contains a tab or another invisible character. Remove it.');
      out += c;
      i++;
    }
  }

  function parseNumber() {
    const m = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?/.exec(src.slice(i));
    if (!m) err('This number is not written correctly. Use plain digits, like 10.');
    i += m[0].length;
    return Number(m[0]);
  }

  function parseArray(path) {
    i++; // [
    const arr = [];
    skipSpace();
    if (src[i] === ']') {
      i++;
      return arr;
    }
    for (;;) {
      arr.push(parseValue(`${path}.${arr.length}`));
      skipSpace();
      const c = src[i];
      if (c === ',') {
        const commaAt = i;
        i++;
        skipSpace();
        if (src[i] === ']') err('There is an extra comma after the last item in a list. Remove it.', commaAt);
        continue;
      }
      if (c === ']') {
        i++;
        return arr;
      }
      if (c === undefined) err('The file ends too early. A closing ] may be missing.');
      err(`A comma is missing between two items in a list (found ${describe(c)}).`);
    }
  }

  function parseObject(path) {
    i++; // {
    const obj = {};
    skipSpace();
    if (src[i] === '}') {
      i++;
      return obj;
    }
    for (;;) {
      skipSpace();
      const c = src[i];
      if (c === "'") err('Use double quotes ("), not single quotes (\').');
      if (c === undefined) err('The file ends too early. A closing } may be missing.');
      if (c !== '"') err('Each setting name must be in double quotes, like "name".');
      const keyLine = pos().line;
      const key = parseString();
      skipSpace();
      if (src[i] !== ':') err(`A colon (:) is missing after "${key}".`);
      i++;
      const childPath = path === '' ? key : `${path}.${key}`;
      if (Object.prototype.hasOwnProperty.call(obj, key)) duplicates.push({ path: childPath, line: keyLine });
      const value = parseValue(childPath);
      Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
      skipSpace();
      const d = src[i];
      if (d === ',') {
        const commaAt = i;
        i++;
        skipSpace();
        if (src[i] === '}') err('There is an extra comma after the last setting in a { } block. Remove it.', commaAt);
        continue;
      }
      if (d === '}') {
        i++;
        return obj;
      }
      if (d === undefined) err('The file ends too early. A closing } may be missing.');
      err(`A comma is missing between two settings (found ${describe(d)}).`);
    }
  }

  skipSpace();
  if (i >= src.length) err('The file is empty.');
  const value = parseValue('');
  skipSpace();
  if (i < src.length) err('There is extra text after the end of the settings. Everything must be inside one { }.');
  return { value, lines, duplicates };
}
