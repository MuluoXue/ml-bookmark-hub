const DEFAULT_DATA = {
  groups: [],
  bookmarks: []
};

const APP_NAME = 'ML Bookmark Hub';
const DATA_VERSION = 1;

let data = null;
let currentGroupId = 'all';
let editingId = null;
let editingType = null;

const $ = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toast(msg) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2000);
}

// ---- Storage ----
async function loadData() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const localResult = await chrome.storage.local.get('bookmarkData');
      if (localResult.bookmarkData) {
        data = normalizeData(localResult.bookmarkData).data;
      } else if (chrome.storage.sync) {
        const syncResult = await chrome.storage.sync.get('bookmarkData');
        if (syncResult.bookmarkData) {
          data = normalizeData(syncResult.bookmarkData).data;
          await chrome.storage.local.set({ bookmarkData: data });
          toast('旧云端数据已迁移到本地存储');
        } else {
          data = JSON.parse(JSON.stringify(DEFAULT_DATA));
        }
      } else {
        data = JSON.parse(JSON.stringify(DEFAULT_DATA));
      }
    } else {
      const raw = localStorage.getItem('bookmarkData');
      data = raw ? normalizeData(JSON.parse(raw)).data : JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  } catch (e) {
    console.error('load failed', e);
    data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
}

async function saveData() {
  data = normalizeData(data).data;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ bookmarkData: data });
    } else {
      localStorage.setItem('bookmarkData', JSON.stringify(data));
    }
  } catch (e) {
    console.error('save failed', e);
    toast('本地保存失败，请导出备份后检查浏览器存储空间');
  }
  render();
}

// ---- Data helpers ----
function extractData(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.groups) || Array.isArray(raw.bookmarks)) return raw;
  if (raw.data && typeof raw.data === 'object') return raw.data;
  return null;
}

function normalizeData(raw) {
  const source = extractData(raw) || DEFAULT_DATA;
  const now = Date.now();
  const stats = { invalidGroups: 0, invalidBookmarks: 0 };
  const groupIds = new Set();
  const groups = [];

  for (const g of Array.isArray(source.groups) ? source.groups : []) {
    const name = String(g && g.name ? g.name : '').trim();
    if (!name) {
      stats.invalidGroups++;
      continue;
    }
    let id = String(g.id || uid());
    if (groupIds.has(id)) id = uid();
    groupIds.add(id);
    groups.push({
      id,
      name,
      createdAt: Number(g.createdAt) || now,
      updatedAt: Number(g.updatedAt) || Number(g.createdAt) || now
    });
  }

  const bookmarks = [];
  const bookmarkIds = new Set();
  for (const b of Array.isArray(source.bookmarks) ? source.bookmarks : []) {
    const name = String(b && (b.name || b.title) ? (b.name || b.title) : '').trim();
    const url = normalizeUrl(b && b.url);
    if (!name || !url) {
      stats.invalidBookmarks++;
      continue;
    }
    let id = String(b.id || uid());
    if (bookmarkIds.has(id)) id = uid();
    bookmarkIds.add(id);
    const groupId = b.groupId && groupIds.has(String(b.groupId)) ? String(b.groupId) : '';
    const tags = Array.isArray(b.tags)
      ? b.tags.map(t => String(t).trim()).filter(Boolean)
      : String(b.tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const createdAt = Number(b.createdAt) || now;
    bookmarks.push({
      id,
      name,
      url,
      groupId,
      notes: String(b.notes || ''),
      tags: [...new Set(tags)],
      createdAt,
      updatedAt: Number(b.updatedAt) || createdAt
    });
  }

  return { data: { groups, bookmarks }, stats };
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const withProtocol = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  try {
    const parsed = new URL(withProtocol);
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    return parsed.href;
  } catch {
    return '';
  }
}

function isSameText(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function normalizeUrlKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    return parsed.href.replace(/\/$/, '').toLowerCase();
  } catch {
    return String(url || '').trim().toLowerCase();
  }
}

function escapeAttr(str) {
  return escapeHtml(str)
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

function getGroup(id) {
  return data.groups.find(g => g.id === id);
}

function getBookmarksByGroup(groupId) {
  if (groupId === 'all') return data.bookmarks;
  if (groupId === 'uncategorized') return data.bookmarks.filter(b => !b.groupId || !getGroup(b.groupId));
  return data.bookmarks.filter(b => b.groupId === groupId);
}

function getFilteredBookmarks() {
  const q = $('#searchInput').value.trim().toLowerCase();
  let list = getBookmarksByGroup(currentGroupId);
  if (q) {
    list = list.filter(b => [
      b.name,
      b.url,
      b.notes,
      ...(b.tags || [])
    ].some(v => String(v || '').toLowerCase().includes(q)));
  }
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function getGroupCount(groupId) {
  if (groupId === 'all') return data.bookmarks.length;
  if (groupId === 'uncategorized') return data.bookmarks.filter(b => !b.groupId || !getGroup(b.groupId)).length;
  return data.bookmarks.filter(b => b.groupId === groupId).length;
}

// ---- Render ----
function render() {
  renderGroups();
  renderBookmarks();
  renderContentHeader();
}

function renderGroups() {
  const el = $('#groupList');
  let html = `
    <div class="group-item ${currentGroupId === 'all' ? 'active' : ''}" data-id="all">
      <div class="group-name"><span>📂 全部</span></div>
      <span class="group-count">${data.bookmarks.length}</span>
    </div>
    <div class="group-item ${currentGroupId === 'uncategorized' ? 'active' : ''}" data-id="uncategorized">
      <div class="group-name"><span>📄 未分类</span></div>
      <span class="group-count">${getGroupCount('uncategorized')}</span>
    </div>
  `;
  for (const g of data.groups) {
    const count = getGroupCount(g.id);
    const active = currentGroupId === g.id;
    html += `
      <div class="group-item ${active ? 'active' : ''}" data-id="${escapeAttr(g.id)}">
        <div class="group-name"><span>📁 ${escapeHtml(g.name)}</span></div>
        <div class="group-actions">
          <button class="rename-btn" data-id="${escapeAttr(g.id)}" title="重命名">✏️</button>
          <button class="delete-btn" data-id="${escapeAttr(g.id)}" title="删除">🗑</button>
        </div>
        <span class="group-count">${count}</span>
      </div>
    `;
  }
  el.innerHTML = html;
}

function renderBookmarks() {
  const grid = $('#bookmarkGrid');
  const empty = $('#emptyState');
  const list = getFilteredBookmarks();

  if (list.length === 0) {
    grid.innerHTML = '';
    grid.style.display = 'none';
    empty.style.display = 'flex';
    return;
  }

  grid.style.display = 'grid';
  empty.style.display = 'none';

  let html = '';
  for (const b of list) {
    const group = getGroup(b.groupId);
    const groupName = group ? group.name : '未分类';
    const hostname = (() => {
      try { return new URL(b.url).hostname; } catch { return b.url; }
    })();
    const favicon = (() => {
      try {
        const u = new URL(b.url);
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=32`;
      } catch { return ''; }
    })();
    const date = b.createdAt ? new Date(b.createdAt).toLocaleDateString('zh-CN') : '';

    html += `
      <div class="bookmark-card" data-id="${escapeAttr(b.id)}" data-group-id="${escapeAttr(b.groupId || '')}">
        <div class="card-actions">
          <button class="card-edit-btn" data-id="${escapeAttr(b.id)}" title="编辑">✏️</button>
          <button class="card-delete-btn" data-id="${escapeAttr(b.id)}" title="删除">🗑</button>
        </div>
        <div class="card-top">
          ${favicon ? `<img class="card-favicon" src="${escapeAttr(favicon)}" alt="" loading="lazy">` : ''}
          <a class="card-title" href="${escapeAttr(b.url)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(b.name)}">${escapeHtml(b.name)}</a>
        </div>
        <div class="card-url"><a href="${escapeAttr(b.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostname)}</a></div>
        <div class="card-notes">${b.notes ? escapeHtml(b.notes) : ''}</div>
        ${b.tags && b.tags.length ? `<div class="card-tags">${b.tags.map(t => `<span class="card-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
        <div class="card-meta">
          <span class="card-group-tag">${escapeHtml(groupName)}</span>
          ${date ? `<span class="card-date">${date}</span>` : ''}
        </div>
      </div>
    `;
  }
  grid.innerHTML = html;
}

function renderContentHeader() {
  const title = $('#groupTitle');
  const count = $('#bookmarkCount');
  const list = getFilteredBookmarks();
  let name = '全部书签';
  if (currentGroupId === 'uncategorized') {
    name = '未分类';
  } else if (currentGroupId !== 'all') {
    const g = getGroup(currentGroupId);
    if (g) name = g.name;
  }
  title.textContent = name;
  count.textContent = `${list.length} 个书签`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Bookmarks CRUD ----
function openBookmarkModal(data_) {
  editingType = 'bookmark';
  editingId = data_ ? data_.id : null;
  const title = $('#bookmarkModalTitle');
  title.textContent = editingId ? '编辑书签' : '新建书签';
  $('#bookmarkName').value = data_ ? data_.name : '';
  $('#bookmarkUrl').value = data_ ? data_.url : '';
  $('#bookmarkNotes').value = data_ ? data_.notes || '' : '';
  $('#bookmarkTags').value = data_ && data_.tags ? data_.tags.join(', ') : '';
  const sel = $('#bookmarkGroup');
  sel.innerHTML = '<option value="">未分类</option>';
  for (const g of data.groups) {
    sel.innerHTML += `<option value="${escapeAttr(g.id)}">${escapeHtml(g.name)}</option>`;
  }
  if (data_ && data_.groupId) sel.value = data_.groupId;
  else if (currentGroupId !== 'all' && currentGroupId !== 'uncategorized') sel.value = currentGroupId;
  $('#bookmarkModalOverlay').classList.add('show');
  $('#bookmarkName').focus();
}

function saveBookmark() {
  const name = $('#bookmarkName').value.trim();
  const url = $('#bookmarkUrl').value.trim();
  const groupId = $('#bookmarkGroup').value;
  const notes = $('#bookmarkNotes').value.trim();
  const tags = $('#bookmarkTags').value.trim().split(',').map(t => t.trim()).filter(Boolean);

  if (!name) { toast('请输入书签名称'); return; }
  if (!url) { toast('请输入链接地址'); return; }

  const finalUrl = normalizeUrl(url);
  if (!finalUrl) { toast('请输入有效的 http/https 链接'); return; }

  const now = Date.now();
  if (editingId) {
    const b = data.bookmarks.find(x => x.id === editingId);
    if (b) {
      b.name = name;
      b.url = finalUrl;
      b.groupId = groupId;
      b.notes = notes;
      b.tags = [...new Set(tags)];
      b.updatedAt = now;
    }
    toast('书签已更新');
  } else {
    data.bookmarks.push({
      id: uid(),
      name,
      url: finalUrl,
      groupId,
      notes,
      tags: [...new Set(tags)],
      createdAt: now,
      updatedAt: now
    });
    toast('书签已添加');
  }

  closeModal('bookmark');
  saveData();
}

// ---- Groups CRUD ----
function openGroupModal(data_) {
  editingType = 'group';
  editingId = data_ ? data_.id : null;
  const title = $('#groupModalTitle');
  title.textContent = editingId ? '重命名分组' : '新建分组';
  $('#groupName').value = data_ ? data_.name : '';
  $('#groupModalOverlay').classList.add('show');
  $('#groupName').focus();
}

function saveGroup() {
  const name = $('#groupName').value.trim();
  if (!name) { toast('请输入分组名称'); return; }
  const duplicate = data.groups.some(g => g.id !== editingId && isSameText(g.name, name));
  if (duplicate) { toast('已存在同名分组'); return; }
  if (['全部', '未分类'].some(reserved => isSameText(reserved, name))) {
    toast('不能使用系统分组名称');
    return;
  }

  const now = Date.now();
  if (editingId) {
    const g = data.groups.find(x => x.id === editingId);
    if (g) {
      g.name = name;
      g.updatedAt = now;
    }
    toast('分组已重命名');
  } else {
    data.groups.push({ id: uid(), name, createdAt: now, updatedAt: now });
    toast('分组已创建');
  }

  closeModal('group');
  saveData();
}

function deleteGroup(id) {
  if (!confirm('确定要删除此分组吗？分组内的书签将变为未分类。')) return;
  data.bookmarks.forEach(b => { if (b.groupId === id) b.groupId = ''; });
  data.groups = data.groups.filter(g => g.id !== id);
  if (currentGroupId === id) currentGroupId = 'all';
  toast('分组已删除');
  saveData();
}

function deleteBookmark(id) {
  if (!confirm('确定要删除此书签吗？')) return;
  data.bookmarks = data.bookmarks.filter(b => b.id !== id);
  toast('书签已删除');
  saveData();
}

// ---- Modal ----
function closeModal(type) {
  $(`#${type}ModalOverlay`).classList.remove('show');
  editingId = null;
  editingType = null;
}

// ---- Import / Export ----
function buildExportPayload() {
  return {
    version: DATA_VERSION,
    app: APP_NAME,
    exportedAt: new Date().toISOString(),
    groups: data.groups,
    bookmarks: data.bookmarks
  };
}

function exportData(filenamePrefix = 'bookmark-hub') {
  const json = JSON.stringify(buildExportPayload(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `${filenamePrefix}-${timestamp}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const parsed = JSON.parse(e.target.result);
      const normalized = normalizeData(parsed);
      const imported = normalized.data;
      if (!extractData(parsed)) {
        toast('无效的 JSON 格式');
        $('#importFileInput').value = '';
        return;
      }

      exportData('bookmark-hub-before-import');

      const stats = mergeImportedData(imported);
      const skipped = stats.skippedBookmarks + stats.skippedGroups;
      const invalid = normalized.stats.invalidBookmarks + normalized.stats.invalidGroups;
      toast(`导入完成：新增 ${stats.addedBookmarks} 个书签，跳过 ${skipped} 项，无效 ${invalid} 项`);
      closeModal('import');
      $('#importFileInput').value = '';
      saveData();
    } catch (err) {
      console.error('import failed', err);
      toast('导入失败：文件格式错误');
      $('#importFileInput').value = '';
    }
  };
  reader.readAsText(file);
}

function mergeImportedData(imported) {
  const stats = { addedGroups: 0, skippedGroups: 0, addedBookmarks: 0, skippedBookmarks: 0 };
  const groupIdMap = new Map();

  for (const group of imported.groups) {
    const sameName = data.groups.find(g => isSameText(g.name, group.name));
    if (sameName) {
      groupIdMap.set(group.id, sameName.id);
      stats.skippedGroups++;
      continue;
    }

    let id = group.id;
    if (data.groups.some(g => g.id === id)) id = uid();
    groupIdMap.set(group.id, id);
    data.groups.push({ ...group, id });
    stats.addedGroups++;
  }

  const existingUrlKeys = new Set(data.bookmarks.map(b => normalizeUrlKey(b.url)));
  for (const bookmark of imported.bookmarks) {
    const urlKey = normalizeUrlKey(bookmark.url);
    if (existingUrlKeys.has(urlKey)) {
      stats.skippedBookmarks++;
      continue;
    }

    let id = bookmark.id;
    const sameId = data.bookmarks.find(b => b.id === id);
    if (sameId) {
      const sameContent = isSameText(sameId.name, bookmark.name) && normalizeUrlKey(sameId.url) === urlKey;
      if (sameContent) {
        stats.skippedBookmarks++;
        continue;
      }
      id = uid();
    }

    const mappedGroupId = bookmark.groupId ? groupIdMap.get(bookmark.groupId) || bookmark.groupId : '';
    const groupId = mappedGroupId && data.groups.some(g => g.id === mappedGroupId) ? mappedGroupId : '';
    data.bookmarks.push({ ...bookmark, id, groupId });
    existingUrlKeys.add(urlKey);
    stats.addedBookmarks++;
  }

  return stats;
}

// ---- Init & Events ----
function setupEventListeners() {
  // Add bookmark
  $('#addBookmarkBtn').addEventListener('click', () => openBookmarkModal());

  // Dropdown menu
  $('#moreBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    $('#dropdownMenu').classList.toggle('show');
  });
  document.addEventListener('click', () => $('#dropdownMenu').classList.remove('show'));

  // Dropdown actions
  $('#addGroupBtn').addEventListener('click', () => { $('#dropdownMenu').classList.remove('show'); openGroupModal(); });
  $('#addGroupBtnSide').addEventListener('click', () => openGroupModal());
  $('#importBtn').addEventListener('click', () => { $('#dropdownMenu').classList.remove('show'); $('#importModalOverlay').classList.add('show'); });
  $('#exportBtn').addEventListener('click', () => { $('#dropdownMenu').classList.remove('show'); exportData(); toast('导出成功'); });
  $('#resetBtn').addEventListener('click', () => {
    $('#dropdownMenu').classList.remove('show');
    if (confirm('确定要清空所有数据吗？此操作不可恢复，建议先导出备份。')) {
      if (confirm('再次确认：清空所有书签和分组数据？')) {
        data = JSON.parse(JSON.stringify(DEFAULT_DATA));
        currentGroupId = 'all';
        saveData();
        toast('已清空所有数据');
      }
    }
  });

  // Search
  const searchInput = $('#searchInput');
  searchInput.addEventListener('input', () => {
    $('#clearSearchBtn').style.display = searchInput.value ? 'block' : 'none';
    render();
  });
  $('#clearSearchBtn').addEventListener('click', () => {
    searchInput.value = '';
    $('#clearSearchBtn').style.display = 'none';
    render();
    searchInput.focus();
  });

  // Group list delegation
  $('#groupList').addEventListener('click', (e) => {
    const item = e.target.closest('.group-item');
    if (item && !e.target.closest('.group-actions')) {
      currentGroupId = item.dataset.id;
      render();
    }
    const renameBtn = e.target.closest('.rename-btn');
    if (renameBtn) {
      const g = data.groups.find(x => x.id === renameBtn.dataset.id);
      if (g) openGroupModal(g);
    }
    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
      deleteGroup(deleteBtn.dataset.id);
    }
  });

  // Bookmark grid delegation
  $('#bookmarkGrid').addEventListener('click', (e) => {
    const card = e.target.closest('.bookmark-card');
    if (!card) return;
    const editBtn = e.target.closest('.card-edit-btn');
    if (editBtn) {
      const b = data.bookmarks.find(x => x.id === editBtn.dataset.id);
      if (b) openBookmarkModal(b);
      return;
    }
    const deleteBtn = e.target.closest('.card-delete-btn');
    if (deleteBtn) {
      deleteBookmark(deleteBtn.dataset.id);
      return;
    }
    if (e.target.closest('a')) return;
    const id = card.dataset.id;
    const b = data.bookmarks.find(x => x.id === id);
    if (b) window.open(b.url, '_blank');
  });

  // Modal events
  for (const type of ['bookmark', 'group', 'import']) {
    $(`#${type}ModalClose`).addEventListener('click', () => closeModal(type));
    $(`#${type}ModalCancel`).addEventListener('click', () => closeModal(type));
    $(`#${type}ModalOverlay`).addEventListener('click', (e) => {
      if (e.target === $(`#${type}ModalOverlay`)) closeModal(type);
    });
  }

  $('#bookmarkModalConfirm').addEventListener('click', saveBookmark);
  $('#groupModalConfirm').addEventListener('click', saveGroup);
  $('#importModalConfirm').addEventListener('click', () => {
    const file = $('#importFileInput').files[0];
    if (!file) { toast('请选择文件'); return; }
    importData(file);
  });

  // Keyboard shortcuts
  $('#bookmarkName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#bookmarkUrl').focus(); });
  $('#bookmarkUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveBookmark(); });
  $('#groupName').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveGroup(); });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      for (const type of ['bookmark', 'group', 'import']) {
        if ($(`#${type}ModalOverlay`).classList.contains('show')) closeModal(type);
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      $('#searchInput').focus();
    }
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  render();
  setupEventListeners();
});
