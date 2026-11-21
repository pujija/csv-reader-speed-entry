// Fast exact-match drop-in for csv-reader 1.0.0 (make.fun).
//
// Returns exactly what csv-reader's readCsv returns for every input
// {text, header}: {columns, rows, errors}. Same broken-row policy:
// a U+FEFF at the very start is dropped; a record ends at LF or CRLF and a
// line left with no characters is no record; outside quotes a CR not
// followed by LF is dropped (stray_cr); a field that opens with a quote
// runs to the next quote that is not doubled, "" inside it one quote and
// each CRLF or lone CR inside it read as LF; what follows its closing
// quote, up to the next comma or line break, is appended as it stands
// (quote_junk, when the field ends); a quote that never closes is a
// literal character and the text after it is read again as unquoted
// (unterminated_quote); a quote inside an unquoted field is literal.
// Fields stay strings, never trimmed or converted. columns is the first
// record when header is true, else null; rows holds the records after it,
// each padded (short_row, with fields: its field count) or cut (long_row,
// with extra: the cut fields) to the first record's width. Each error is
// {code, line, row}, in the order met, a record's short_row or long_row
// when it ends: line the 1-based line its record starts on, row its
// record's index in rows, null for the header.
//
// Speed comes from jumping between delimiters instead of reading a
// character at a time: unquoted fields are found with one regex scan for
// the next of , CR LF and sliced out whole; quoted fields are found with
// indexOf for the closing quote and sliced out whole unless they hold a
// doubled quote or a line break, in which case only that field is rebuilt
// piece by piece. Nothing is kept from one run() call to the next.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** Any CR or LF inside a quoted field's slice. */
const HAS_BREAK = /[\r\n]/;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // Fast path: no quotes and no CRs anywhere. Lines split on LF, fields
  // on commas; the only errors possible are short_row / long_row.
  if (text.indexOf('"', pos) === -1 && text.indexOf('\r', pos) === -1) {
    const lines = (pos === 0 ? text : text.slice(pos)).split('\n');
    for (let li = 0; li < lines.length; li++) {
      const l = lines[li];
      if (l === '') continue; // a line left with no characters is no record
      const fields = l.split(',');
      if (width < 0) width = fields.length;
      if (header && columns === null) {
        columns = fields;
        continue;
      }
      const row = rows.length;
      if (fields.length < width) {
        errors.push({ code: 'short_row', line: li + 1, row, fields: fields.length });
        while (fields.length < width) fields.push('');
      } else if (fields.length > width) {
        errors.push({ code: 'long_row', line: li + 1, row, extra: fields.splice(width) });
      }
      rows.push(fields);
    }
    return { columns: header ? (columns ?? []) : null, rows, errors };
  }

  // General path: the record being read, its start line and its index in rows.
  let recordLine = 1;
  let recordRow = null;

  /** The next of , CR LF from pos, or null past the end of the text. */
  const sep = /[,\r\n]/g;

  function err(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field from pos, with `init` as its starting value.
  // A CR not followed by LF is dropped (stray_cr) and the scan goes on.
  // Returns {value, ended, added}: added counts the characters kept.
  // Fast lane: the next comma or LF bounds the field; the slice is then
  // checked for a CR (a CRLF ending, or a stray CR inside). Only when a
  // CR is present does the field fall back to the regex scan.
  function readUnquoted(init) {
    let value = init;
    const initLen = init.length;
    while (true) {
      const iComma = text.indexOf(',', pos);
      const iLF = text.indexOf('\n', pos);
      let k = -1;
      let kind = -1; // 0 comma, 1 LF
      if (iComma !== -1) {
        k = iComma;
        kind = 0;
      }
      if (iLF !== -1 && (k === -1 || iLF < k)) {
        k = iLF;
        kind = 1;
      }
      if (k === -1) {
        // No comma or LF left: the tail may still hold stray CRs.
        return readUnquotedTail(value, initLen);
      }
      const seg = text.slice(pos, k);
      if (seg.indexOf('\r') === -1) {
        value += seg;
        pos = k + 1;
        if (kind === 0) return { value, ended: COMMA, added: value.length - initLen };
        line += 1;
        return { value, ended: LINE_BREAK, added: value.length - initLen };
      }
      // A CR sits before the comma/LF: re-scan this field with the regex.
      return readUnquotedSlow(value, initLen);
    }
  }

  // Regex scan for an unquoted field (tail with no comma/LF, or a field
  // holding a CR). `value` is the field so far; scanning resumes at pos.
  function readUnquotedSlow(value, initLen) {
    while (true) {
      sep.lastIndex = pos;
      const m = sep.exec(text);
      if (m === null) {
        value += text.slice(pos, n);
        pos = n;
        return { value, ended: END, added: value.length - initLen };
      }
      const k = m.index;
      const c = m[0];
      if (c === ',') {
        value += text.slice(pos, k);
        pos = k + 1;
        return { value, ended: COMMA, added: value.length - initLen };
      }
      if (c === '\n') {
        value += text.slice(pos, k);
        pos = k + 1;
        line += 1;
        return { value, ended: LINE_BREAK, added: value.length - initLen };
      }
      if (text.charCodeAt(k + 1) === 10) {
        value += text.slice(pos, k);
        pos = k + 2;
        line += 1;
        return { value, ended: LINE_BREAK, added: value.length - initLen };
      }
      value += text.slice(pos, k);
      pos = k + 1;
      err('stray_cr');
    }
  }

  function readUnquotedTail(value, initLen) {
    return readUnquotedSlow(value, initLen);
  }

  // Builds the value of a quoted field spanning [start, q): "" is one
  // quote, each CRLF or lone CR inside it is one LF. Counts the line
  // breaks it meets into `line`. Only used when the field is not clean.
  function buildQuotedValue(start, q) {
    let v = '';
    let s = start;
    while (true) {
      const kq = text.indexOf('"', s);
      const kr = text.indexOf('\r', s);
      const kl = text.indexOf('\n', s);
      let k = -1;
      let kind = -1; // 0 doubled quote, 1 CR, 2 LF
      if (kq !== -1 && kq < q) {
        k = kq;
        kind = 0;
      }
      if (kr !== -1 && kr < q && (k === -1 || kr < k)) {
        k = kr;
        kind = 1;
      }
      if (kl !== -1 && kl < q && (k === -1 || kl < k)) {
        k = kl;
        kind = 2;
      }
      if (k === -1) {
        v += text.slice(s, q);
        break;
      }
      v += text.slice(s, k);
      if (kind === 0) {
        v += '"';
        s = k + 2;
      } else if (kind === 1) {
        v += '\n';
        line += 1;
        s = k + (text.charCodeAt(k + 1) === 10 ? 2 : 1);
      } else {
        v += '\n';
        line += 1;
        s = k + 1;
      }
    }
    return v;
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    pos += 1;
    // The closing quote: the next quote that is not doubled.
    let q = text.indexOf('"', pos);
    let doubled = false;
    while (q !== -1 && text.charCodeAt(q + 1) === 34) {
      doubled = true;
      q = text.indexOf('"', q + 2);
    }
    if (q === -1) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      err('unterminated_quote');
      return readUnquoted('"');
    }
    let value;
    if (!doubled) {
      value = text.slice(pos, q);
      if (HAS_BREAK.test(value)) value = buildQuotedValue(pos, q);
    } else {
      value = buildQuotedValue(pos, q);
    }
    pos = q + 1;
    if (pos >= n) return { value, ended: END, added: 0 };
    const c = text.charCodeAt(pos);
    if (c === 44) {
      pos += 1;
      return { value, ended: COMMA, added: 0 };
    }
    if (c === 10) {
      pos += 1;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    if (c === 13 && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: LINE_BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) err('quote_junk');
    return junk;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
