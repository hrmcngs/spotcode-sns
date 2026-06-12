import { renderFileBadge } from './file-size-viz.js';
import { statusBadge }     from './status-badges.js';
import { renderGrass }     from './grass.js';
import { renderMapPlaceholder } from './map.js';
import { renderIdeaForm }  from './idea-post.js';

const app = document.getElementById('app');
const sample = [
  { id: 'shibuya', lat: 35.659, lng: 139.700, ideaCount: 3 },
  { id: 'akihabara', lat: 35.702, lng: 139.774, ideaCount: 7 },
];
const counts = {};
for (let i = 0; i < 12; i++) {
  const d = new Date(); d.setDate(d.getDate() - i * 3);
  counts[d.toISOString().slice(0, 10)] = Math.floor(Math.random() * 10);
}

app.innerHTML = [
  '<h2>Files</h2>',
  renderFileBadge('main.js', 1843),
  renderFileBadge('huge-bundle.js', 84100),
  '<h2 style="margin-top:1.6rem">Status</h2>',
  statusBadge('active'),
  ' ',
  statusBadge('wip'),
  '<h2 style="margin-top:1.6rem">Activity</h2>',
  renderGrass(counts),
  renderMapPlaceholder(sample),
  '<h2 style="margin-top:1.6rem">Post an idea</h2>',
  renderIdeaForm('shibuya'),
].join('');
