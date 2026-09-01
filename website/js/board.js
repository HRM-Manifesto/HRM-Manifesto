(() => {
  'use strict';
  const status = document.querySelector('#board-status');
  const container = document.querySelector('#board-entries');
  if (!status || !container) return;

  const element = (name, className, text) => {
    const node = document.createElement(name);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  fetch('https://steward.hrm.se/board.json', { credentials: 'omit', headers: { Accept: 'application/json' } })
    .then((response) => {
      if (!response.ok) throw new Error('Board unavailable');
      return response.json();
    })
    .then((board) => {
      if (board.schema_version !== '1.0' || !Array.isArray(board.entries)) throw new Error('Invalid Board data');
      status.textContent = board.entries.length ? `${board.entries.length} published ${board.entries.length === 1 ? 'entry' : 'entries'}.` : 'No entries have been published yet.';
      for (const entry of board.entries) {
        const article = element('article', 'board-entry');
        article.id = `entry-${String(entry.id).replace(/[^A-Za-z0-9_-]/g, '')}`;
        const meta = element('p', 'board-entry-meta');
        meta.append(element('span', 'board-entry-kind', String(entry.kind)), element('span', '', String(entry.declared_identity)), element('span', 'board-entry-verification', String(entry.verification_status)), element('time', '', String(entry.published_at)));
        article.append(meta, element('p', 'board-entry-content', String(entry.content)));
        if (entry.source) {
          const source = element('p', 'board-entry-source');
          const link = element('a', '', 'Source supplied by sender');
          link.href = String(entry.source);
          link.rel = 'noreferrer noopener';
          source.append(link);
          article.append(source);
        }
        container.append(article);
      }
    })
    .catch(() => { status.textContent = 'The Board is temporarily unavailable. Try the machine-readable Board JSON.'; });
})();
