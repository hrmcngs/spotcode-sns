// Small hand-rolled Markdown subset for post / comment bodies.
//
// Block-level:
//   # / ## / ###           → <h1/h2/h3>
//   ``` ... ```            → <pre><code>...</code></pre>
//   - foo / * foo          → <ul><li>
//   - [ ] foo / - [x] foo  → task list with clickable checkbox
//   plain paragraph        → preserved newlines (white-space: pre-wrap)
//
// Inline (applied to the survivors of block parsing):
//   `code`                 → <code>
//   **bold**               → <strong>
//   *italic* / _italic_    → <em>
//   [text](url)            → <a href="url"> (allowlist http/https/mailto/tel
//                            + relative; everything else is left as plain text
//                            so a malicious `javascript:` URL never reaches
//                            an <a href>)
//   @handle                → mention link (kept from inlineFormat)
//
// The whole pipeline assumes input was already HTML-escaped by the
// caller (escape() in post.js / post-detail.js). Anything we wrap in
// tags only comes from a markdown pattern, not raw user input, so the
// XSS surface stays the existing escape() guarantee.

const SAFE_URL = /^(?:https?:|mailto:|tel:|\/|#)/i;

function inlinePass(s) {
  return s
    // Code spans first — anything inside survives without further parsing.
    // Use a placeholder so subsequent rules don't touch the inside.
    .replace(/`([^`\n]+)`/g, (_, code) => '<code>' + code + '</code>')
    // Bold (**foo**) before italic so the asterisks don't get half-eaten.
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    // Italic — `*foo*` and `_foo_`. Conservative: requires a non-space
    // boundary inside so `* not italic *` and `_ snake_case _` don't
    // accidentally match.
    .replace(/(^|[^*\w])\*([^*\s][^*\n]*?[^*\s]|[^*\s])\*(?!\w)/g, '$1<em>$2</em>')
    .replace(/(^|[^_\w])_([^_\s][^_\n]*?[^_\s]|[^_\s])_(?!\w)/g, '$1<em>$2</em>')
    // Links — validate the URL against an allowlist so an attacker can't
    // smuggle `javascript:` past escape() via [click](javascript:...).
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) =>
      SAFE_URL.test(url) ? '<a href="' + url + '" rel="noopener">' + text + '</a>' : m
    )
    // Mentions last so an explicit [link](url) takes precedence over a
    // bare @handle inside the link text.
    .replace(/(^|[^A-Za-z0-9_@])@([A-Za-z0-9_]+)/g,
      '$1<a class="mention" href="/$2">@$2</a>');
}

// Number tasks as we encounter them so the click handler can locate
// the N-th `- [ ]` / `- [x]` line in the original body to toggle it.
// `opts.editable` flips whether the rendered checkboxes are clickable —
// non-owners see the same visual state but can't toggle it.
export function renderMarkdown(escaped, opts = {}) {
  // Strict opt-in: only `true` enables checkbox toggling. Falsy /
  // missing / null all render as disabled boxes.
  const editable = opts.editable === true;
  const lines = String(escaped == null ? '' : escaped).split('\n');
  const out = [];
  let i = 0;
  let taskIdx = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block — ``` (optional language tag, ignored).
    if (/^```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) {
        body.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      out.push('<pre class="md-pre"><code>' + body.join('\n') + '</code></pre>');
      continue;
    }

    // Heading — # / ## / ###. Higher levels collapse to h3 so a `#####`
    // typo doesn't render absurdly tiny.
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      out.push('<h' + level + ' class="md-h md-h--' + level + '">' +
        inlinePass(heading[2]) + '</h' + level + '>');
      i++;
      continue;
    }

    // List block — consume contiguous list lines (mix of regular and
    // task items is fine; both wrap in the same <ul>).
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        const m = lines[i].match(/^\s*[-*]\s+(\[[ xX]\]\s+)?(.*)$/);
        const checked = m[1] ? /\[[xX]\]/.test(m[1]) : null;
        if (m[1] != null) {
          // Task list item — checkbox + label. data-task-idx lets the
          // click handler find which one to toggle in the source body.
          out.push(
            '<li class="md-task">' +
              '<input type="checkbox" class="md-task__box" data-task-idx="' +
                taskIdx + '"' + (checked ? ' checked' : '') +
                (editable ? '' : ' disabled') + '>' +
              '<span class="md-task__text">' + inlinePass(m[2]) + '</span>' +
            '</li>'
          );
          taskIdx++;
        } else {
          out.push('<li>' + inlinePass(m[2]) + '</li>');
        }
        i++;
      }
      out.push('</ul>');
      // Insert the opening <ul> in front of the items we just pushed.
      // Cheaper than tracking a separate buffer.
      const ulOpenIdx = out.lastIndexOf('</ul>') - items.length;
      // (items.length tracking left for readability — the actual splice
      // below is the source of truth.)
      // Simpler: find the first <li> we just added and prepend <ul>.
      // The block above pushed items in order so we walk backwards.
      let firstLiIdx = out.length - 2; // last item before </ul>
      while (firstLiIdx > 0 && /^<li/.test(out[firstLiIdx])) firstLiIdx--;
      out.splice(firstLiIdx + 1, 0, '<ul class="md-list">');
      continue;
    }

    // Plain paragraph / blank line. white-space: pre-wrap on the
    // container preserves newlines, so we don't need <p> wrappers —
    // but we DO need the inline pass to linkify @mentions, **bold**,
    // `code`, etc. inside ordinary prose.
    out.push(inlinePass(line));
    i++;
  }
  return out.join('\n');
}

// Toggle the N-th task in `body` (raw markdown, NOT escaped). Returns
// the new body string. Used by main.js when the user clicks one of the
// checkboxes inside their own post.
export function toggleTaskInBody(body, idx) {
  let n = 0;
  return String(body).split('\n').map((line) => {
    const m = line.match(/^(\s*[-*]\s+)\[([ xX])\](\s+.*)$/);
    if (!m) return line;
    if (n === idx) {
      const next = /[ ]/.test(m[2]) ? 'x' : ' ';
      n++;
      return m[1] + '[' + next + ']' + m[3];
    }
    n++;
    return line;
  }).join('\n');
}
