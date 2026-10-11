// Picture It · P3 Maths — entry point.
// One blank page: "+ Add a question" opens a box, a screenshot goes in, the AI reads the
// question (multiple choice or free response) and builds a little app for it, and Save
// keeps just the question and the app. All of that lives in board.js.

// Every local import carries ?v=<version>. Bump it on each release so browsers
// never mix a new index.html with old cached modules.
import { APP_VERSION, showToast } from './core.js?v=1.5.2';
import { initBoard, onBlocksSaved, getBoardBlocks, setBoardBlocks } from './board.js?v=1.5.2';
import { initCloud } from './cloud.js?v=1.5.2';

function start() {
  const badge = document.getElementById('versionBadge');
  if (badge) badge.textContent = APP_VERSION;
  try {
    initBoard({
      listEl: document.getElementById('blocks'),
      addBtn: document.getElementById('addQuestion'),
      emptyEl: document.getElementById('emptyNote'),
    });
  } catch (error) {
    console.error('The page failed to start', error);
    showToast('The page could not start. Please refresh.', 'error');
    return;
  }
  try {
    initCloud({ getBlocks: getBoardBlocks, setBlocks: setBoardBlocks, onChange: onBlocksSaved });
  } catch (error) {
    console.warn('Cloud save could not start; the board is kept on this device', error);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
