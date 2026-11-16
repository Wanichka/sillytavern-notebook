import { getCurrentUserHandle } from '../../../user.js';
import { KEY, uid, emptyNotebook, sanitize, plainText, validateNotebook, mergeNotebook } from './model.js';
import { translate } from './i18n.js';

const context = SillyTavern.getContext();
const backupKey = `${KEY}:${getCurrentUserHandle()}`;
const languageKey = `${backupKey}:language`;
let language = 'ru';
try {
    if (localStorage.getItem(languageKey) === 'en') language = 'en';
} catch { /* keep the default when storage is unavailable */ }

const t = (key, values) => translate(language, key, values);
function parseNotebook(value) {
    if (typeof value === 'string') {
        try { value = JSON.parse(value); }
        catch { throw new Error(t('badJson')); }
    }
    return validateNotebook(value, t);
}

let data = emptyNotebook(t('notes')), activeTab, query = '', showTrash = false, dirty = false, clock = 0;
let remoteConflict = false, storageBroken = false;
const startupErrors = [];
function readState(value, label) {
    if (!value) return null;
    try { return parseNotebook(value); }
    catch (error) { startupErrors.push(`${label}: ${error.message}`); return null; }
}
const serverData = readState(context.extensionSettings[KEY], t('tavernSettings'));
let browserData = null;
try { browserData = readState(localStorage.getItem(backupKey), t('browserCopy')); }
catch (error) { storageBroken = true; startupErrors.push(t('storageBlocked')); }
data = browserData && (!serverData || browserData.updatedAt > serverData.updatedAt) ? browserData : serverData || data;
activeTab = data.tabs[0].id;
clock = data.updatedAt;

const make = (tag, cls = '', text = '') => {
    const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
};
function setLabel(node, label) {
    node.title = label;
    node.setAttribute('aria-label', label);
}
function button(label, icon, handler, text = '') {
    const node = make('button', 'wnb-button'); node.type = 'button'; setLabel(node, label);
    if (icon) { const i = make('i', `fa-solid fa-${icon}`); i.setAttribute('aria-hidden', 'true'); node.append(i); }
    if (text) node.append(document.createTextNode(text));
    node.addEventListener('click', handler); return node;
}
const panel = make('section'); panel.id = 'wnb-panel'; panel.setAttribute('aria-label', 'Notebook');
panel.style.display = 'none';
const header = make('header', 'wnb-header');
header.append(make('strong', 'wnb-brand', '✦ Notebook'));
const controls = make('div', 'wnb-actions');
const closeButton = button(t('closeNotebook'), 'xmark', closePanel);
closeButton.classList.add('wnb-standalone');
const manageTabsButton = button(t('manageTabs'), 'sliders', manageTabs);
const languageButton = button(t('switchLanguage'), '', switchLanguage);
controls.append(languageButton, manageTabsButton, closeButton); header.append(controls);
const tabs = make('nav', 'wnb-tabs'); tabs.setAttribute('aria-label', t('notebookTabs')); tabs.setAttribute('role', 'tablist');
const tabsRow = make('div', 'wnb-tabs-row');
const addTabButton = button(t('addTab'), 'plus', addTab); addTabButton.classList.add('wnb-add-tab');
tabsRow.append(tabs, addTabButton);
const tools = make('div', 'wnb-tools');
const search = make('input'); search.type = 'search'; search.placeholder = t('searchAll'); search.setAttribute('aria-label', t('searchAllLabel'));
search.addEventListener('input', () => { query = search.value.trim().toLocaleLowerCase(); renderNotes(); });
const newButton = button(t('addNote'), 'plus', addNote, t('note'));
tools.append(search, newButton);
const list = make('div', 'wnb-list'); list.id = 'wnb-notes'; list.setAttribute('role', 'tabpanel');
const footer = make('footer', 'wnb-footer');
let statusKey = 'saved';
const status = make('span', 'wnb-status', t(statusKey)); status.setAttribute('role', 'status');
function setStatus(key) { statusKey = key; status.textContent = t(key); }
status.title = t('saveHint');
const trashButton = button(t('trash'), 'trash-can', () => { showTrash = !showTrash; render(); });
const exportButton = button(t('exportNotebook'), 'download', () => download());
const importButton = button(t('importNotebook'), 'upload', () => fileInput.click());
footer.append(status, exportButton, importButton, trashButton);
const fileInput = make('input'); fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.hidden = true;
fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; fileInput.value = ''; if (!file) return;
    try {
        if (file.size > 5 * 1024 * 1024) throw new Error(t('fileTooLarge'));
        const imported = parseNotebook(await file.text());
        const { dialog, body, finish } = modal(t('importNotebook'));
        body.append(make('p', '', t('importCounts', { tabs: imported.tabs.length, notes: imported.notes.length, trash: imported.trash.length })));
        body.append(make('p', '', t('importHint')));
        body.append(button(t('addToNotes'), 'plus', () => {
            try { data = parseNotebook(mergeNotebook(data, imported)); activeTab = data.tabs[0].id; showTrash = false; changed(); render(); finish(); }
            catch (error) { notify(error.message, true); }
        }, t('add')));
        body.append(button(t('replaceNotebook'), 'rotate', () => {
            if (!confirm(t('confirmReplace'))) return;
            download(); data = imported; activeTab = data.tabs[0].id; showTrash = false; changed(); render(); finish();
        }, t('replace')));
        dialog.showModal();
    } catch (error) { notify(error.message, true); }
});
panel.append(header, tabsRow, tools, list, footer, fileInput);
const launcher = button(t('openNotebook'), 'book-open', togglePanel); launcher.id = 'wnb-launcher';
launcher.setAttribute('aria-controls', panel.id); launcher.setAttribute('aria-expanded', 'false');
document.body.append(panel, launcher);
const fitLauncher = setupLauncherDrag();
updateLauncherState();
const menu = document.getElementById('extensionsMenu');
let menuItem;
if (menu) {
    // Tavern styles its menu rows as divs with an icon and a text span.
    // The panel button helper is intentionally scoped to the panel/dialogs.
    const item = make('div', 'list-group-item flex-container flexGap5 interactable');
    item.id = 'wnb-menu-button'; item.tabIndex = 0; item.setAttribute('role', 'button');
    item.setAttribute('aria-label', t('openNotebook'));
    const icon = make('i', 'fa-solid fa-book-open extensionsMenuExtensionButton'); icon.setAttribute('aria-hidden', 'true');
    item.append(icon, make('span', '', 'Notebook'));
    item.addEventListener('click', openPanel);
    item.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault(); event.stopPropagation(); item.click();
    });
    menuItem = item;
    menu.append(item);
}

function applyLanguage() {
    panel.lang = language;
    const nextLanguage = language === 'ru' ? 'en' : 'ru';
    languageButton.lang = nextLanguage;
    languageButton.textContent = nextLanguage.toUpperCase();
    setLabel(languageButton, t('switchLanguage'));
    setLabel(manageTabsButton, t('manageTabs'));
    setLabel(closeButton, t('closeNotebook'));
    tabs.setAttribute('aria-label', t('notebookTabs'));
    setLabel(addTabButton, t('addTab'));
    search.placeholder = t('searchAll');
    search.setAttribute('aria-label', t('searchAllLabel'));
    setLabel(newButton, t('addNote'));
    newButton.lastChild.textContent = t('note');
    setStatus(statusKey);
    status.title = t('saveHint');
    setLabel(exportButton, t('exportNotebook'));
    setLabel(importButton, t('importNotebook'));
    trashButton.setAttribute('aria-label', t('trash'));
    menuItem?.setAttribute('aria-label', t('openNotebook'));
    updateLauncherState();
    render();
}

function switchLanguage() {
    language = language === 'ru' ? 'en' : 'ru';
    try { localStorage.setItem(languageKey, language); }
    catch { /* still switch for this page */ }
    applyLanguage();
}

function notify(message, error = false) {
    const node = make('div', `wnb-toast${error ? ' wnb-error' : ''}`, message); node.setAttribute('role', error ? 'alert' : 'status');
    (document.querySelector('dialog.wnb-dialog[open]') || document.body).append(node); setTimeout(() => node.remove(), error ? 9000 : 2300);
}
function changed() {
    data.updatedAt = Math.max(Date.now(), clock + 1); clock = data.updatedAt; dirty = true;
    save();
}
function save() {
    if (remoteConflict) { setStatus('tabConflict'); return; }
    try {
        localStorage.setItem(backupKey, JSON.stringify(data));
        storageBroken = false; dirty = false; setStatus('saved');
    } catch (error) { storageBroken = true; setStatus('notSaved'); }
    context.extensionSettings[KEY] = structuredClone(data);
    try { context.saveSettingsDebounced(); }
    catch (error) { setStatus('notSynced'); }
}
window.addEventListener('beforeunload', event => {
    if (dirty || storageBroken || remoteConflict) { event.preventDefault(); event.returnValue = ''; }
});
// Do not silently overwrite work edited in another browser tab.
window.addEventListener('storage', event => {
    if (event.key !== backupKey || !event.newValue) return;
    try {
        const incoming = parseNotebook(event.newValue);
        if (incoming.updatedAt <= data.updatedAt) return;
        if (document.querySelector('dialog.wnb-dialog[open]') || dirty) {
            remoteConflict = true; setStatus('changedElsewhere');
            notify(t('conflictHint'), true);
        } else { data = incoming; clock = data.updatedAt; context.extensionSettings[KEY] = structuredClone(data); render(); }
    } catch (error) { notify(t('cannotReadChanges'), true); }
});
status.tabIndex = 0;
function resolveConflict() {
    if (!remoteConflict) { if (storageBroken) { save(); if (storageBroken) notify(t('exportOnFailure'), true); } return; }
    if (document.querySelector('dialog.wnb-dialog[open]')) { notify(t('closeEditorFirst')); return; }
    const { dialog, body, finish } = modal(t('twoCopies'));
    body.append(make('p', '', t('chooseCopy')));
    body.append(button(t('loadOtherCopy'), '', () => {
        try { const incoming = parseNotebook(localStorage.getItem(backupKey)); download(); data = incoming; remoteConflict = false; changed(); render(); finish(); }
        catch (error) { notify(error.message, true); }
    }, t('useOtherTab')));
    body.append(button(t('saveMyChanges'), '', () => {
        try { const incoming = parseNotebook(localStorage.getItem(backupKey)); download(incoming); clock = Math.max(clock, incoming.updatedAt); remoteConflict = false; changed(); finish(); }
        catch (error) { notify(error.message, true); }
    }, t('keepMyChanges')));
    dialog.showModal();
}
status.addEventListener('click', resolveConflict);
status.addEventListener('keydown', event => { if (event.key === 'Enter') resolveConflict(); });
function download(value = data) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = make('a'); a.href = url;
    a.download = `notebook-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function renderTabs() {
    if (!data.tabs.some(tab => tab.id === activeTab)) activeTab = data.tabs[0].id;
    tabs.replaceChildren();
    for (const tab of data.tabs) {
        const b = button(tab.title || t('untitled'), '', () => { activeTab = tab.id; showTrash = false; query = ''; search.value = ''; render(); }, tab.title || t('untitled'));
        b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(tab.id === activeTab && !showTrash)); b.setAttribute('aria-controls', list.id);
        tabs.append(b);
    }
}
function addTab() {
    const title = prompt(t('newTabTitle'), t('newTab')); if (title === null) return;
    if (data.tabs.length >= 100) { notify(t('tabLimit'), true); return; }
    const tab = { id: uid(), title: title.trim().slice(0, 200) || t('newTab') };
    data.tabs.push(tab); activeTab = tab.id; showTrash = false; query = ''; search.value = '';
    changed(); render(); tabs.scrollLeft = tabs.scrollWidth;
}
function render() { renderTabs(); renderNotes(); }
function renderNotes() {
    const scroll = list.scrollTop; list.replaceChildren();
    trashButton.classList.toggle('wnb-selected', showTrash);
    trashButton.title = showTrash ? t('backToNotes') : t('trashCount', { count: data.trash.length });
    newButton.disabled = showTrash;
    const source = showTrash ? data.trash : data.notes;
    const visible = source.filter(note => (showTrash || query || note.tabId === activeTab) &&
        (!query || `${note.title}\n${plainText(note.html)}`.toLocaleLowerCase().includes(query)));
    if (showTrash) list.append(make('p', 'wnb-hint', t('trashHint')));
    if (query) list.append(make('p', 'wnb-hint', t('resultCount', { count: visible.length }) + (showTrash ? '' : t('allTabs'))));
    if (!visible.length) list.append(make('p', 'wnb-empty', query ? t('noResults') : showTrash ? t('emptyTrash') : t('emptyNotebook')));
    for (const note of visible) {
        const card = make('article', 'wnb-card'); card.dataset.note = note.id;
        const top = make('div', 'wnb-card-header');
        const title = button(note.collapsed ? t('expandNote') : t('collapseNote'), note.collapsed ? 'chevron-right' : 'chevron-down', () => { note.collapsed = !note.collapsed; changed(); renderNotes(); }, note.title || t('untitled'));
        title.classList.add('wnb-note-title'); title.setAttribute('aria-expanded', String(!note.collapsed)); top.append(title);
        if (showTrash) {
            top.append(button(t('restoreNote'), 'rotate-left', () => {
                data.trash = data.trash.filter(n => n.id !== note.id); delete note.deletedAt;
                if (!data.tabs.some(tab => tab.id === note.tabId)) note.tabId = data.tabs[0].id;
                data.notes.push(note); changed(); renderNotes();
            }));
            top.append(button(t('deleteForever'), 'trash-can', () => {
                if (confirm(t('confirmDeleteNote', { title: note.title || t('untitled') }))) { data.trash = data.trash.filter(n => n.id !== note.id); changed(); renderNotes(); }
            }));
        } else {
            top.append(button(t('copyNote'), 'copy', () => copyNote(note)));
            top.append(button(t('editNote'), 'pen', () => editNote(note)));
        }
        card.append(top);
        if (query) card.append(make('small', 'wnb-note-tab', data.tabs.find(tab => tab.id === note.tabId)?.title || t('notes')));
        const content = make('div', 'wnb-rich wnb-note-body'); content.innerHTML = note.html; content.hidden = note.collapsed;
        card.append(content); list.append(card);
    }
    list.scrollTop = scroll;
}
async function copyNote(note) {
    const text = plainText(note.html);
    try { await navigator.clipboard.writeText(text); notify(t('copied')); }
    catch (error) {
        const textarea = make('textarea'); textarea.value = text; textarea.style.cssText = 'position:fixed;left:-10000px;top:0';
        const owner = document.querySelector('dialog.wnb-dialog[open]') || document.body;
        const previous = document.activeElement; owner.append(textarea); textarea.select();
        let copied = false; try { copied = document.execCommand('copy'); } catch { /* manual fallback below */ }
        textarea.remove(); previous?.focus();
        if (copied) notify(t('copied'));
        else { const { dialog, body } = modal(t('copyText')); const field = make('textarea'); field.value = text; field.readOnly = true; field.className = 'wnb-copy-field'; body.append(make('p', '', t('clipboardBlocked')), field); dialog.showModal(); field.select(); }
    }
}
function modal(title) {
    const dialog = make('dialog', 'wnb-dialog'); dialog.lang = language; const heading = make('header', 'wnb-dialog-header');
    heading.append(make('strong', 'wnb-brand', title)); const actions = make('div', 'wnb-actions');
    const finish = () => { dialog.close(); render(); };
    actions.append(button(t('closeEditor'), 'xmark', finish)); heading.append(actions);
    const body = make('div', 'wnb-dialog-body'); dialog.append(heading, body); document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); render(); });
    // Tavern keyboard shortcuts must not submit a message while typing a note.
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('keyup', event => event.stopPropagation());
    return { dialog, body, actions, finish };
}
function addNote() {
    if (data.notes.length + data.trash.length >= 10000) { notify(t('noteLimit'), true); return; }
    const note = { id: uid(), tabId: activeTab, title: '', html: '', collapsed: false };
    data.notes.push(note); changed(); renderNotes(); editNote(note);
}
function editNote(note) {
    const { dialog, body, actions, finish } = modal(t('note')); dialog.classList.add('wnb-editor-dialog');
    const maximize = button(t('expandEditor'), 'expand', () => {
        dialog.classList.toggle('wnb-fullscreen'); const full = dialog.classList.contains('wnb-fullscreen');
        maximize.setAttribute('aria-label', full ? t('shrinkEditor') : t('expandEditor')); maximize.title = maximize.getAttribute('aria-label');
    }); actions.prepend(maximize);
    const title = make('input', 'wnb-title-input'); title.placeholder = t('noteTitle'); title.maxLength = 200; title.value = note.title; title.setAttribute('aria-label', t('noteTitle'));
    const editor = make('div', 'wnb-rich wnb-editor'); editor.contentEditable = 'true'; editor.role = 'textbox'; editor.setAttribute('aria-label', t('noteText')); editor.setAttribute('aria-multiline', 'true'); editor.spellcheck = true; editor.dataset.placeholder = t('noteTextPlaceholder'); editor.innerHTML = note.html;
    const toolbar = make('div', 'wnb-format'); toolbar.setAttribute('aria-label', t('formatting'));
    const saved = make('span', 'wnb-hint', t('saved')); saved.setAttribute('role', 'status');
    const capture = () => {
        note.html = sanitize(editor.innerHTML); note.title = title.value; changed(); saved.textContent = status.textContent;
    };
    title.addEventListener('input', capture); editor.addEventListener('input', capture);
    let range = null;
    function rememberSelection() {
        const selection = getSelection();
        if (selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) range = selection.getRangeAt(0).cloneRange();
    }
    const selectionListener = () => { if (dialog.open) rememberSelection(); };
    document.addEventListener('selectionchange', selectionListener);
    dialog.addEventListener('close', () => document.removeEventListener('selectionchange', selectionListener), { once: true });
    function format(command, value) {
        editor.focus();
        if (range && editor.contains(range.commonAncestorContainer)) { const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); }
        document.execCommand('styleWithCSS', false, true);
        document.execCommand(command, false, value); rememberSelection(); capture();
    }
    for (const [label, icon, command] of [[t('bold'), 'bold', 'bold'], [t('italic'), 'italic', 'italic'], [t('underline'), 'underline', 'underline'], [t('bullets'), 'list-ul', 'insertUnorderedList'], [t('numbers'), 'list-ol', 'insertOrderedList'], [t('clearFormatting'), 'eraser', 'removeFormat']]) {
        const b = button(label, icon, () => format(command)); b.addEventListener('mousedown', e => { rememberSelection(); e.preventDefault(); }); toolbar.append(b);
    }
    for (const [label, command, initial] of [[t('textColor'), 'foreColor', '#92caa0'], [t('highlightColor'), 'hiliteColor', '#66513c']]) {
        const holder = make('label', 'wnb-color', label); const color = make('input'); color.type = 'color'; color.value = initial; color.setAttribute('aria-label', label);
        color.addEventListener('pointerdown', rememberSelection); color.addEventListener('input', () => format(command, color.value)); holder.append(color); toolbar.append(holder);
    }
    editor.addEventListener('paste', event => {
        event.preventDefault(); rememberSelection();
        // Plain text paste keeps literal <tags> and {{macros}} intact and strips foreign styles.
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain')); capture();
    });
    editor.addEventListener('drop', event => event.preventDefault());
    const bottom = make('div', 'wnb-editor-footer');
    const select = make('select'); select.setAttribute('aria-label', t('noteTab'));
    for (const tab of data.tabs) { const option = make('option', '', tab.title || t('untitled')); option.value = tab.id; select.append(option); }
    select.value = note.tabId; select.addEventListener('change', () => { note.tabId = select.value; changed(); });
    function moveNote(delta) {
        const siblings = data.notes.filter(n => n.tabId === note.tabId); const target = siblings[siblings.indexOf(note) + delta]; if (!target) return;
        const a = data.notes.indexOf(note), b = data.notes.indexOf(target); [data.notes[a], data.notes[b]] = [data.notes[b], data.notes[a]]; changed(); notify(t('orderChanged'));
    }
    bottom.append(select, button(t('moveUp'), 'arrow-up', () => moveNote(-1)), button(t('moveDown'), 'arrow-down', () => moveNote(1)), button(t('copyNote'), 'copy', () => copyNote(note)), button(t('moveToTrash'), 'trash-can', () => {
        data.notes = data.notes.filter(n => n.id !== note.id); note.deletedAt = Date.now(); data.trash.unshift(note); changed(); finish();
    }), saved, button(t('done'), 'check', finish, t('done')));
    body.append(title, toolbar, editor, bottom); dialog.showModal(); (note.title ? editor : title).focus();
}
function manageTabs() {
    const { dialog, body } = modal(t('notebookTabs'));
    function draw() {
        body.replaceChildren(make('p', 'wnb-hint', t('organizeTabsHint')));
        data.tabs.forEach((tab, index) => {
            const row = make('div', 'wnb-tab-row'); const name = make('input'); name.value = tab.title; name.maxLength = 200; name.setAttribute('aria-label', t('tabTitle'));
            name.addEventListener('input', () => { tab.title = name.value; changed(); renderTabs(); });
            row.append(name);
            for (const [delta, label, icon] of [[-1, t('tabLeft'), 'arrow-left'], [1, t('tabRight'), 'arrow-right']]) {
                const b = button(label, icon, () => { [data.tabs[index], data.tabs[index + delta]] = [data.tabs[index + delta], tab]; changed(); draw(); renderTabs(); });
                b.disabled = !data.tabs[index + delta]; row.append(b);
            }
            const remove = button(t('deleteTab'), 'trash-can', () => {
                if (!confirm(t('confirmDeleteTab', { title: tab.title }))) return;
                data.tabs = data.tabs.filter(t => t.id !== tab.id);
                for (const note of [...data.notes, ...data.trash]) if (note.tabId === tab.id) note.tabId = data.tabs[0].id;
                changed(); draw(); render();
            }); remove.disabled = data.tabs.length === 1; row.append(remove); body.append(row);
        });
    }
    draw(); dialog.showModal();
}
function openPanel() {
    if (panel.dataset.rptDocked === 'true' && window.WaniRoleplayTools?.open('notebook')) return;
    panel.style.display = 'flex'; fitWindow(); updateLauncherState();
}
function closePanel() {
    panel.style.display = 'none'; updateLauncherState();
}
function togglePanel() {
    if (panel.dataset.rptDocked === 'true') { openPanel(); return; }
    if (panel.style.display === 'none') openPanel(); else closePanel();
}
function updateLauncherState() {
    const open = panel.style.display !== 'none';
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? t('closeNotebook') : t('openNotebook'));
    launcher.title = open ? t('closeDrag') : t('openDrag');
    launcher.classList.toggle('wnb-open', open);
}
function setupLauncherDrag() {
    const key = `${backupKey}:launcher`;
    let gesture = null, suppressClick = false;
    function position(left, top) {
        const width = launcher.offsetWidth || 44, height = launcher.offsetHeight || 44;
        const x = Math.max(8, Math.min(left, innerWidth - width - 8));
        const y = Math.max(36, Math.min(top, innerHeight - height - 8));
        launcher.style.left = `${x}px`; launcher.style.top = `${y}px`;
        launcher.style.right = 'auto'; launcher.style.bottom = 'auto';
    }
    function savePosition() {
        const rect = launcher.getBoundingClientRect();
        try { localStorage.setItem(key, JSON.stringify({ left: rect.left, top: rect.top })); }
        catch { notify(t('cannotSavePosition'), true); }
    }
    try {
        const saved = JSON.parse(localStorage.getItem(key));
        if (Number.isFinite(saved?.left) && Number.isFinite(saved?.top)) position(saved.left, saved.top);
    } catch { /* use the default position */ }
    // Capture prevents the synthetic click at the end of a drag from toggling the window.
    launcher.addEventListener('click', event => {
        const dragged = suppressClick; suppressClick = false;
        if (dragged && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
    launcher.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary) return;
        const rect = launcher.getBoundingClientRect();
        gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, moved: false };
        suppressClick = false; launcher.setPointerCapture(event.pointerId);
    });
    launcher.addEventListener('pointermove', event => {
        if (!gesture || event.pointerId !== gesture.id) return;
        const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
        if (!gesture.moved && Math.hypot(dx, dy) < 5) return;
        gesture.moved = true; suppressClick = true;
        launcher.classList.add('wnb-dragging'); position(gesture.left + dx, gesture.top + dy);
    });
    function finish(event) {
        if (!gesture || event.pointerId !== gesture.id) return;
        const moved = gesture.moved; gesture = null; launcher.classList.remove('wnb-dragging');
        if (launcher.hasPointerCapture(event.pointerId)) launcher.releasePointerCapture(event.pointerId);
        if (moved) savePosition();
        // Captured touch gestures do not consistently synthesize a click.
        // Handle a stationary touch here and consume a possible compatibility click.
        if (!moved && event.type === 'pointerup' && event.pointerType === 'touch') {
            suppressClick = true; togglePanel();
        }
    }
    launcher.addEventListener('pointerup', finish); launcher.addEventListener('pointercancel', finish);
    launcher.addEventListener('lostpointercapture', finish);
    const fit = () => {
        if (!launcher.getClientRects().length) return;
        const rect = launcher.getBoundingClientRect(); position(rect.left, rect.top);
    };
    window.addEventListener('resize', fit);
    return fit;
}
function fitWindow() {
    if (panel.dataset.rptDocked === 'true') return;
    const rect = panel.getBoundingClientRect(); if (!rect.width) return;
    panel.style.width = `${Math.min(Math.max(320, rect.width), innerWidth - 16)}px`;
    panel.style.height = `${Math.min(Math.max(300, rect.height), innerHeight - 48)}px`;
    panel.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - panel.offsetWidth - 8))}px`;
    panel.style.top = `${Math.max(36, Math.min(rect.top, innerHeight - panel.offsetHeight - 8))}px`;
    panel.style.right = 'auto'; panel.style.bottom = 'auto';
}
let geometryTimer;
function saveGeometry() {
    clearTimeout(geometryTimer); geometryTimer = setTimeout(() => {
        if (panel.dataset.rptDocked === 'true' || panel.style.display === 'none') return;
        const r = panel.getBoundingClientRect();
        try { localStorage.setItem(`${backupKey}:window`, JSON.stringify({ left: r.left, top: r.top, width: r.width, height: r.height })); } catch { /* notebook save status handles storage errors */ }
    }, 250);
}
try {
    const geometry = JSON.parse(localStorage.getItem(`${backupKey}:window`));
    for (const property of ['left', 'top', 'width', 'height']) if (Number.isFinite(geometry?.[property])) panel.style[property] = `${geometry[property]}px`;
} catch { /* use CSS defaults */ }
header.addEventListener('pointerdown', event => {
    if (panel.dataset.rptDocked === 'true' || event.button !== 0 || event.target.closest('button')) return;
    const rect = panel.getBoundingClientRect(), x = event.clientX, y = event.clientY;
    header.setPointerCapture(event.pointerId);
    const move = ev => {
        panel.style.left = `${Math.max(8, Math.min(innerWidth - rect.width - 8, rect.left + ev.clientX - x))}px`;
        panel.style.top = `${Math.max(36, Math.min(innerHeight - rect.height - 8, rect.top + ev.clientY - y))}px`;
        panel.style.right = 'auto'; panel.style.bottom = 'auto';
    };
    const up = () => { header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', up); header.removeEventListener('pointercancel', up); saveGeometry(); };
    header.addEventListener('pointermove', move); header.addEventListener('pointerup', up); header.addEventListener('pointercancel', up);
});
new ResizeObserver(saveGeometry).observe(panel);
window.addEventListener('resize', fitWindow);
function connect() {
    const host = window.WaniRoleplayTools; if (host?.version !== 1) return;
    host.register({ id: 'notebook', title: 'Notebook', element: panel, launcher, controls, display: 'flex', minHeight: 230,
        defaultPage: { id: 'notebook', name: t('notebookPage') },
        onMount() { panel.style.resize = 'none'; },
        onRelease() { panel.style.resize = ''; fitWindow(); fitLauncher(); updateLauncherState(); },
    });
}
window.addEventListener('wani-roleplay-tools:ready', connect);
applyLanguage(); connect();
if (startupErrors.length) {
    setStatus('readError');
    notify(`${startupErrors.join(' ')} ${t('recoveryHint')}`, true);
} else {
    // Recover newer browser changes after a server interruption.
    save();
}
