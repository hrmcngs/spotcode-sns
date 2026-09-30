import { renderTaskTemplates, bindTaskTemplates } from './task-templates.js';
import { currentUser } from '../auth.js';
import { selectedTaskRepos, tasksHidden } from '../display-prefs.js';
import { fetchJson, isRateLimited } from '../language-stats.js';
import { t } from '../i18n.js';
import { ART_TYPES, loadTaskArt, renderTaskArt } from '../task-art.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const repositories = () => [...new Set(selectedTaskRepos())].filter(repo => /^[\w.-]+\/[\w.-]+$/.test(repo));
const refreshers = new WeakMap();
// Returning from GitHub reflects newly created/closed Issues without a page reload.
if (typeof window !== 'undefined') window.addEventListener('focus', () => {
  const panel = document.querySelector('.project-art');
  if (panel && !panel.querySelector('[data-art-refresh]')?.disabled) refreshers.get(panel)?.();
});

export function renderProjectArt() {
  if (tasksHidden()) return '';
  const repos = repositories();
  if (!repos.length) return '';
  return `<section class="project-art" aria-label="${t('art.title')}">
    <h3>${t('art.title')}</h3>
    <p>${t('art.hint')}</p>
    <div class="project-art__controls">
      <label>${t('art.project')}<select data-art-repo>${repos.map(repo => `<option>${escape(repo)}</option>`).join('')}</select></label>
      <label>${t('art.design')}<select data-art-type>${ART_TYPES.map(type => `<option value="${type}">${t('art.' + type)}</option>`).join('')}</select></label>
      <button type="button" class="btn btn--ghost" data-art-refresh>${t('art.refresh')}</button>
    </div>
    <div data-art-result aria-live="polite"></div>
    <form data-art-create class="project-art__controls">
      <label>${t('art.task')}<input name="title" required maxlength="256"></label>
      <label>${t('art.assignee')}<input name="assignee" required pattern="[A-Za-z0-9][A-Za-z0-9-]{0,38}" placeholder="octocat"></label>
      <button class="btn btn--ghost" type="submit">${t('art.create')}</button>
    </form>
    <p class="project-art__note">${t('art.note')}</p>
    ${renderTaskTemplates()}
  </section>`;
}

export function hydrateProjectArt() {
  const panel = document.querySelector('.project-art');
  if (!panel || panel.dataset.bound) return;
  panel.dataset.bound = '1';
  bindTaskTemplates(panel);
  const repoSelect = panel.querySelector('[data-art-repo]');
  const typeSelect = panel.querySelector('[data-art-type]');
  const refresh = panel.querySelector('[data-art-refresh]');
  const result = panel.querySelector('[data-art-result]');
  const owner = currentUser()?.id;
  let generation = 0;
  let data = null;
  const key = () => 'spotcode:project-art:' + owner + ':' + repoSelect.value;
  const restoreDesign = () => {
    try { typeSelect.value = localStorage.getItem(key()) || 'tree'; } catch { typeSelect.value = 'tree'; }
    if (!ART_TYPES.includes(typeSelect.value)) typeSelect.value = 'tree';
  };
  const paint = () => {
    if (!data) return;
    const percent = data.total ? Math.floor(data.completed / data.total * 100) : 0;
    result.innerHTML = `<div class="project-art__display">
      ${renderTaskArt(typeSelect.value, data.completed, data.total)}
      <div><strong>${data.completed} / ${data.total} · ${percent}%</strong>
        <p>${t(data.total && data.completed === data.total ? 'art.finished' : data.total ? 'art.progress' : 'art.empty')}</p>
        <progress value="${data.completed}" max="${data.total || 1}" aria-label="${t('art.progress')}"></progress>
      </div></div>
      ${data.open.length ? `<ul class="project-art__tasks">${data.open.map(issue =>
        `<li><a href="https://github.com/${escape(issue.repo)}/issues/${Number(issue.number)}" target="_blank" rel="noopener noreferrer">#${Number(issue.number)} ${escape(issue.title)}</a><span>${escape(issue.assignees.map(user => '@' + user.login).join(', '))}</span></li>`
      ).join('')}</ul>` : ''}`;
  };
  const load = async () => {
    const version = ++generation;
    const repo = repoSelect.value;
    const selection = JSON.stringify(repositories());
    const valid = () => panel.isConnected && version === generation && currentUser()?.id === owner &&
      !tasksHidden() && selection === JSON.stringify(repositories());
    data = null;
    result.textContent = t('art.loading');
    refresh.disabled = true;
    const request = async url => {
      if (!valid()) throw new Error('SCOPE_CHANGED');
      if (isRateLimited()) throw new Error('RATE_LIMIT');
      const response = await fetchJson(url, 15000);
      if (!valid()) throw new Error('SCOPE_CHANGED');
      return response;
    };
    try {
      const next = await loadTaskArt([repo], request);
      if (!valid()) return;
      data = next;
      paint();
    } catch (error) {
      if (valid()) result.textContent = t(error.message === 'PUBLIC_REPOSITORY_REQUIRED' ? 'art.public_only' : 'art.error');
    } finally {
      if (version === generation) refresh.disabled = false;
    }
  };
  repoSelect.addEventListener('change', () => { restoreDesign(); load(); });
  typeSelect.addEventListener('change', () => {
    try { localStorage.setItem(key(), typeSelect.value); } catch {}
    paint();
  });
  refresh.addEventListener('click', load);
  refreshers.set(panel, load);
  panel.querySelector('[data-art-create]').addEventListener('submit', event => {
    event.preventDefault();
    if (currentUser()?.id !== owner || !repositories().includes(repoSelect.value)) return;
    const form = event.currentTarget;
    const title = form.elements.title.value.trim();
    if (!title) { form.elements.title.focus(); return; }
    const query = new URLSearchParams({ title, assignees: form.elements.assignee.value.trim(),
      body: '**spotcode表示**: する\n\n- [ ] ' + title });
    window.open('https://github.com/' + repoSelect.value + '/issues/new?' + query, '_blank', 'noopener,noreferrer');
  });
  restoreDesign();
  load();
}
