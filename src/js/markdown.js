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
    // `url` arrives already escape()'d (input was HTML-escaped before
    // markdown ran), so the `"` inside is `&quot;` — safe to inject
    // into a quoted attribute. `target="_blank"` + `rel="noopener
    // noreferrer"` cuts off the reverse-tabnabbing path.
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (m, text, url) =>
      SAFE_URL.test(url)
        ? '<a href="' + url + '" target="_blank" rel="noopener noreferrer">' + text + '</a>'
        : m
    )
    // Mentions last so an explicit [link](url) takes precedence over a
    // bare @handle inside the link text.
    .replace(/(^|[^A-Za-z0-9_@-])@([A-Za-z0-9_][A-Za-z0-9_-]*)/g,
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
        const m = lines[i].match(/^\s*[-*]\s+(\[[ xX]\]\s+)?([\s\S]*)$/);
        // Safety net: the while test above uses a looser regex; if
        // something makes the stricter capture form fail (e.g. odd
        // Unicode whitespace, `.` not spanning CR), fall through to
        // an inline-only render for this line rather than crashing.
        if (!m) {
          out.push('<li>' + inlinePass(lines[i]) + '</li>');
          i++;
          continue;
        }
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
      // Walk backwards from the last item (out.length - 2 = the item
      // just before </ul>) as long as it's still an <li>. The `>= 0`
      // bound is critical: `> 0` would leave a stray <li> at index 0
      // uncovered when the list is the very first block in the body,
      // and <ul> would end up spliced AFTER it, producing an empty
      // <ul></ul>.
      let firstLiIdx = out.length - 2;
      while (firstLiIdx >= 0 && /^<li/.test(out[firstLiIdx])) firstLiIdx--;
      out.splice(firstLiIdx + 1, 0, '<ul class="md-list">');
      continue;
    }

    // Ordered list — `1.` `2.` … Same block-consuming shape as the
    // dash list above; wraps its collected items in an <ol> at the
    // end. Individual item numbering is left to the browser's default
    // (start=first parsed number so a mid-list "3." looks right).
    const ordFirst = line.match(/^\s*(\d+)[.)]\s+([\s\S]*)$/);
    if (ordFirst) {
      const startNum = ordFirst[1];
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^\s*\d+[.)]\s+([\s\S]*)$/);
        if (!m) break;
        items.push('<li>' + inlinePass(m[1]) + '</li>');
        i++;
      }
      out.push('<ol class="md-list md-list--ord" start="' + startNum + '">' + items.join('') + '</ol>');
      continue;
    }

    // Blockquote — one or more contiguous `>` lines merge into a
    // single <blockquote>. Inner leading `>` is stripped; the
    // resulting text goes through the inline pass so @mentions /
    // links inside a quote still work.
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push('<blockquote class="md-quote">' + inlinePass(buf.join('\n')) + '</blockquote>');
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
