const DEFAULT_DATA = {
  groups: [],
  bookmarks: []
};

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
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      // 先检查 sync 是否有数据
      const syncResult = await chrome.storage.sync.get('bookmarkData');
      if (syncResult.bookmarkData) {
        data = syncResult.bookmarkData;
      } else {
        // sync 为空，尝试从 local 迁移
        const localResult = await chrome.storage.local.get('bookmarkData');
        if (localResult.bookmarkData) {
          data = localResult.bookmarkData;
          // 迁到 sync 后清除 local
          await chrome.storage.local.remove('bookmarkData');
          await chrome.storage.sync.set({ bookmarkData: data });
          toast('数据已从本地迁移到云端同步');
        } else {
          data = JSON.parse(JSON.stringify(DEFAULT_DATA));
        }
      }
    } else if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      const result = await chrome.storage.local.get('bookmarkData');
      data = result.bookmarkData || JSON.parse(JSON.stringify(DEFAULT_DATA));
    } else {
      const raw = localStorage.getItem('bookmarkData');
      data = raw ? JSON.parse(raw) : JSON.parse(JSON.stringify(DEFAULT_DATA));
    }
  } catch {
    data = JSON.parse(JSON.stringify(DEFAULT_DATA));
  }
  if (!data.groups) data.groups = [];
  if (!data.bookmarks) data.bookmarks = [];
}

async function saveData() {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      await chrome.storage.sync.set({ bookmarkData: data });
    } else {
      localStorage.setItem('bookmarkData', JSON.stringify(data));
    }
  } catch (e) {
    if (e.message && (e.message.includes('QUOTA') || e.message.includes('quota'))) {
      toast('同步存储已满，请导出备份后清理部分书签');
    } else {
      console.error('save failed', e);
    }
  }
  render();
}

// ---- Data helpers ----
function getGroup(id) {
  return data.groups.find(g => g.id === id);
}

function getBookmarksByGroup(groupId) {
  if (groupId === 'all') return data.bookmarks;
  return data.bookmarks.filter(b => b.groupId === groupId);
}

function getFilteredBookmarks() {
  const q = $('#searchInput').value.trim().toLowerCase();
  let list = getBookmarksByGroup(currentGroupId);
  if (q) {
    list = list.filter(b => b.name.toLowerCase().includes(q) || (b.tags && b.tags.some(t => t.toLowerCase().includes(q))));
  }
  return list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function getGroupCount(groupId) {
  if (groupId === 'all') return data.bookmarks.length;
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
      <span class="group-count">${data.bookmarks.filter(b => !b.groupId || !getGroup(b.groupId)).length}</span>
    </div>
  `;
  for (const g of data.groups) {
    const count = getGroupCount(g.id);
    const active = currentGroupId === g.id;
    html += `
      <div class="group-item ${active ? 'active' : ''}" data-id="${g.id}">
        <div class="group-name"><span>📁 ${g.name}</span></div>
        <div class="group-actions">
          <button class="rename-btn" data-id="${g.id}" title="重命名">✏️</button>
          <button class="delete-btn" data-id="${g.id}" title="删除">🗑</button>
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
        return `https://www.google.com/s2/favicons?domain=${u.hostname}&sz=32`;
      } catch { return ''; }
    })();
    const date = b.createdAt ? new Date(b.createdAt).toLocaleDateString('zh-CN') : '';

    html += `
      <div class="bookmark-card" data-id="${b.id}" data-group-id="${b.groupId}">
        <div class="card-actions">
          <button class="card-edit-btn" data-id="${b.id}" title="编辑">✏️</button>
          <button class="card-delete-btn" data-id="${b.id}" title="删除">🗑</button>
        </div>
        <div class="card-top">
          ${favicon ? `<img class="card-favicon" src="${favicon}" alt="" loading="lazy">` : ''}
          <a class="card-title" href="${b.url}" target="_blank" rel="noopener noreferrer" title="${b.name}">${b.name}</a>
        </div>
        <div class="card-url"><a href="${b.url}" target="_blank" rel="noopener noreferrer">${hostname}</a></div>
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
    sel.innerHTML += `<option value="${g.id}">${g.name}</option>`;
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

  let finalUrl = url;
  if (!/^https?:\/\//i.test(url)) {
    finalUrl = 'https://' + url;
  }

  if (editingId) {
    const b = data.bookmarks.find(x => x.id === editingId);
    if (b) {
      b.name = name;
      b.url = finalUrl;
      b.groupId = groupId;
      b.notes = notes;
      b.tags = tags;
    }
    toast('书签已更新');
  } else {
    data.bookmarks.push({
      id: uid(),
      name,
      url: finalUrl,
      groupId,
      notes,
      tags,
      createdAt: Date.now()
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

  if (editingId) {
    const g = data.groups.find(x => x.id === editingId);
    if (g) g.name = name;
    toast('分组已重命名');
  } else {
    data.groups.push({ id: uid(), name });
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
function exportData() {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bookmark-hub-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  toast('导出成功');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const imported = JSON.parse(e.target.result);
      if (!imported.bookmarks || !imported.groups) {
        toast('无效的 JSON 格式');
        return;
      }
      // Merge: add imported groups and bookmarks, skip duplicates by id
      const existingIds = new Set(data.bookmarks.map(b => b.id));
      const existingGroupIds = new Set(data.groups.map(g => g.id));
      for (const g of imported.groups) {
        if (!existingGroupIds.has(g.id)) {
          data.groups.push(g);
        }
      }
      for (const b of imported.bookmarks) {
        if (!existingIds.has(b.id)) {
          data.bookmarks.push(b);
        }
      }
      toast(`导入成功: ${imported.bookmarks.length} 个书签`);
      closeModal('import');
      saveData();
    } catch {
      toast('导入失败：文件格式错误');
    }
  };
  reader.readAsText(file);
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
  $('#exportBtn').addEventListener('click', () => { $('#dropdownMenu').classList.remove('show'); exportData(); });
  $('#resetBtn').addEventListener('click', () => {
    $('#dropdownMenu').classList.remove('show');
    if (confirm('确定要清空所有数据吗？此操作不可恢复！')) {
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

  // Save group modal
  // (already handled above)
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  render();
  setupEventListeners();
});
