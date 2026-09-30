import { t } from '../i18n.js';

const escape = value => String(value).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function taskTemplates() {
  const visible = '**spotcode表示**: する';
  const checklist = '\n\n## ' + t('templates.todo') + '\n- [ ] TODO 1\n- [ ] TODO 2\n\n## ' + t('templates.details') + '\n';
  const basic = '**期限**: YYYY-MM-DD\n' + visible + checklist;
  return [
    { id: 'basic', body: basic },
    { id: 'timed', body: '**期限**: YYYY-MM-DD HH:MM\n' + visible + checklist },
    { id: 'submission', body: '**提出期限**: YYYY-MM-DD HH:MM\n' + visible + checklist },
    { id: 'visible', body: visible },
    { id: 'hidden', body: '**spotcode表示**: しない' },
    { id: 'github', body: '---\nname: Task\nabout: Issue task template\ntitle: ""\nlabels: ["task"]\nassignees: []\n---\n\n' + basic },
    { id: 'date_plain', body: '期限: YYYY-MM-DD' },
    { id: 'date_bold', body: '**期限**: YYYY-MM-DD' },
    { id: 'date_due', body: 'Due: YYYY-MM-DD' },
    { id: 'date_deadline', body: 'Deadline: YYYY-MM-DDTHH:MM' },
    { id: 'date_japanese', body: '締切: YYYY年MM月DD日' },
    { id: 'date_by', body: 'by YYYY/MM/DD HH:MM' },
  ];
}

export function renderTaskTemplates() {
  return `<details class="task-templates"><summary>${t('templates.title')}</summary>
    <p>${t('templates.hint')}</p>
    <div class="task-templates__grid">${taskTemplates().map(({ id, body }) => `<article class="task-templates__item">
      <h4>${t('templates.' + id)}</h4>
      ${id === 'github' ? '<p><code>.github/ISSUE_TEMPLATE/task.md</code></p>' : ''}
      <textarea readonly rows="${Math.min(8, body.split('\n').length + 1)}" aria-label="${t('templates.' + id)}" spellcheck="false">${escape(body)}</textarea>
      <button type="button" class="btn btn--ghost" data-copy-template aria-label="${t('templates.' + id)}: ${t('templates.copy')}">${t('templates.copy')}</button>
      <span role="status" data-copy-status></span>
    </article>`).join('')}</div></details>`;
}

export function bindTaskTemplates(root = document) {
  root.querySelectorAll('[data-copy-template]').forEach(button => {
    if (button.dataset.bound) return;
    button.dataset.bound = '1';
    button.addEventListener('click', async () => {
      const item = button.closest('.task-templates__item');
      const field = item.querySelector('textarea');
      const status = item.querySelector('[data-copy-status]');
      button.disabled = true;
      status.textContent = '';
      try {
        await navigator.clipboard.writeText(field.value);
        status.textContent = t('templates.copied');
      } catch {
        // Preserve line breaks and provide a selectable fallback without dialogs.
        field.focus();
        field.select();
        field.setSelectionRange(0, field.value.length);
        status.textContent = t('templates.manual');
      } finally {
        button.disabled = false;
      }
    });
  });
}
