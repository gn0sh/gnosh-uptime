// A tiny YAML-subset parser for linting our own workflow files (no
// dependencies, ADR-0001). Supports: block maps, block lists of scalars or
// maps, block scalars (| and >), quoted and plain scalars, `{}` and `[]`,
// and comments. Anything else throws, so the lint never silently misreads a
// workflow: if a workflow needs more YAML than this, extend the parser.

function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s.trimEnd();
}

function scalar(raw, lineNo) {
  const s = raw.trim();
  if (s === '{}') return {};
  if (s === '[]') return [];
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^".*"$/.test(s)) return JSON.parse(s);
  if (/^[[{]/.test(s)) throw new Error(`line ${lineNo}: flow collections are not supported: ${s}`);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null' || s === '~' || s === '') return null;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

/** Returns { value, runBlocks } where runBlocks lists every `run:` value with its line. */
export function parseYaml(text) {
  const lines = text.split('\n').map((raw, i) => ({ raw, no: i + 1 }));
  const runBlocks = [];
  let i = 0;
  const indentOf = (s) => s.length - s.trimStart().length;
  const skipBlank = () => {
    while (i < lines.length && stripComment(lines[i].raw).trim() === '') i++;
  };

  function blockScalar(parentIndent, style) {
    const out = [];
    let ind = null;
    while (i < lines.length) {
      const { raw } = lines[i];
      if (raw.trim() === '') { out.push(''); i++; continue; }
      const n = indentOf(raw);
      if (n <= parentIndent) break;
      if (ind === null) ind = n;
      out.push(raw.slice(Math.min(ind, n)));
      i++;
    }
    while (out.length && out[out.length - 1] === '') out.pop();
    return style === '|' ? out.join('\n') + '\n' : out.join(' ') + '\n';
  }

  function parseValueAfterKey(rest, keyIndent, key, lineNo) {
    const v = stripComment(rest).trim();
    if (v === '|' || v === '>' || v === '|-' || v === '>-') {
      i++;
      const s = blockScalar(keyIndent, v[0]);
      if (key === 'run') runBlocks.push({ line: lineNo, text: s });
      return s;
    }
    if (v === '') {
      i++;
      skipBlank();
      if (i >= lines.length) return null;
      const n = indentOf(lines[i].raw);
      const isList = lines[i].raw.trimStart().startsWith('- ');
      if (n > keyIndent || (isList && n === keyIndent)) return parseNode(n);
      return null;
    }
    i++;
    const val = scalar(v, lineNo);
    if (key === 'run') runBlocks.push({ line: lineNo, text: String(rest.trim()) });
    return val;
  }

  function parseMap(indent, first = null) {
    const obj = {};
    const handle = (content, lineNo) => {
      const m = /^([A-Za-z0-9_.\-/]+|'[^']*'|"[^"]*"):(?:\s(.*))?$/.exec(content);
      if (!m) throw new Error(`line ${lineNo}: cannot parse "${content}"`);
      const key = scalar(m[1], lineNo);
      if (Object.hasOwn(obj, key)) throw new Error(`line ${lineNo}: duplicate key ${key}`);
      obj[key] = parseValueAfterKey(m[2] ?? '', indent, key, lineNo);
    };
    if (first) handle(first.content, first.no);
    for (;;) {
      skipBlank();
      if (i >= lines.length) break;
      const { raw, no } = lines[i];
      const n = indentOf(raw);
      if (n < indent) break;
      if (n > indent) throw new Error(`line ${no}: unexpected indentation`);
      const content = stripComment(raw).trim();
      if (content.startsWith('- ')) break;
      handle(content, no);
    }
    return obj;
  }

  function parseList(indent) {
    const arr = [];
    for (;;) {
      skipBlank();
      if (i >= lines.length) break;
      const { raw, no } = lines[i];
      const n = indentOf(raw);
      const content = stripComment(raw).trim();
      if (n !== indent || !content.startsWith('- ')) break;
      const item = content.slice(2);
      if (/^([A-Za-z0-9_.\-/]+|'[^']*'|"[^"]*"):(\s|$)/.test(item)) {
        arr.push(parseMap(indent + 2, { content: item, no }));
      } else {
        arr.push(scalar(item, no));
        i++;
      }
    }
    return arr;
  }

  function parseNode(indent) {
    skipBlank();
    const content = stripComment(lines[i].raw).trim();
    return content.startsWith('- ') ? parseList(indent) : parseMap(indent);
  }

  skipBlank();
  const value = parseNode(0);
  skipBlank();
  if (i < lines.length) throw new Error(`line ${lines[i].no}: unparsed content`);
  return { value, runBlocks };
}
