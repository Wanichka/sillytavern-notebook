import { getCurrentUserHandle } from '../../../user.js';
import { KEY, uid, emptyNotebook, sanitize, plainText, validateNotebook, mergeNotebook } from './model.js';

const context = SillyTavern.getContext();
const backupKey = `${KEY}:${getCurrentUserHandle()}`;
let data = emptyNotebook(), activeTab, query = '', showTrash = false, dirty = false, clock = 0;
let remoteConflict = false, storageBroken = false;
const startupErrors = [];
function readState(value, label) {
    if (!value) return null;
    try { return validateNotebook(typeof value === 'string' ? JSON.parse(value) : value); }
    catch (error) { startupErrors.push(`${label}: ${error.message}`); return null; }
}
const serverData = readState(context.extensionSettings[KEY], 'Настройки Tavern');
let browserData = null;
try { browserData = readState(localStorage.getItem(backupKey), 'Копия в браузере'); }
catch (error) { storageBroken = true; startupErrors.push('Браузер запретил локальное сохранение.'); }
data = browserData && (!serverData || browserData.updatedAt > serverData.updatedAt) ? browserData : serverData || data;
activeTab = data.tabs[0].id;
clock = data.updatedAt;

const make = (tag, cls = '', text = '') => {
    const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
};
function button(label, icon, handler, text = '') {
    const node = make('button', 'wnb-button'); node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
    if (icon) { const i = make('i', `fa-solid fa-${icon}`); i.setAttribute('aria-hidden', 'true'); node.append(i); }
    if (text) node.append(document.createTextNode(text));
    node.addEventListener('click', handler); return node;
}
const panel = make('section'); panel.id = 'wnb-panel'; panel.setAttribute('aria-label', 'Wani Notebook');
panel.style.display = 'none';
const header = make('header', 'wnb-header');
header.append(make('strong', 'wnb-brand', '✦ Notebook'));
const controls = make('div', 'wnb-actions');
const closeButton = button('Закрыть блокнот', 'xmark', () => { panel.style.display = 'none'; });
closeButton.classList.add('wnb-standalone');
controls.append(button('Управление вкладками', 'sliders', manageTabs), closeButton); header.append(controls);
const tabs = make('nav', 'wnb-tabs'); tabs.setAttribute('aria-label', 'Вкладки блокнота'); tabs.setAttribute('role', 'tablist');
const tabsRow = make('div', 'wnb-tabs-row');
const addTabButton = button('Добавить вкладку', 'plus', addTab); addTabButton.classList.add('wnb-add-tab');
tabsRow.append(tabs, addTabButton);
const tools = make('div', 'wnb-tools');
const search = make('input'); search.type = 'search'; search.placeholder = 'Поиск по всем заметкам…'; search.setAttribute('aria-label', 'Поиск по всем заметкам');
search.addEventListener('input', () => { query = search.value.trim().toLocaleLowerCase(); renderNotes(); });
const newButton = button('Добавить заметку', 'plus', addNote, 'Заметка');
tools.append(search, newButton);
const list = make('div', 'wnb-list'); list.id = 'wnb-notes'; list.setAttribute('role', 'tabpanel');
const footer = make('footer', 'wnb-footer');
const status = make('span', 'wnb-status', 'Сохранено'); status.setAttribute('role', 'status');
status.title = 'Локальная копия в этом браузере. Синхронизация с настройками Tavern выполняется отдельно.';
const trashButton = button('Корзина', 'trash-can', () => { showTrash = !showTrash; render(); });
footer.append(status, button('Экспорт блокнота', 'download', () => download()), button('Импорт блокнота', 'upload', () => fileInput.click()), trashButton);
const fileInput = make('input'); fileInput.type = 'file'; fileInput.accept = '.json,application/json'; fileInput.hidden = true;
fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0]; fileInput.value = ''; if (!file) return;
    try {
        if (file.size > 5 * 1024 * 1024) throw new Error('Максимальный размер файла — 5 МБ.');
        const imported = validateNotebook(JSON.parse(await file.text()));
        const { dialog, body, finish } = modal('Импорт блокнота');
        body.append(make('p', '', `Вкладок: ${imported.tabs.length}. Заметок: ${imported.notes.length}. В корзине: ${imported.trash.length}.`));
        body.append(make('p', '', 'Добавление создаст отдельные вкладки. Перед заменой будет скачана копия текущего блокнота.'));
        body.append(button('Добавить к моим заметкам', 'plus', () => {
            try { data = validateNotebook(mergeNotebook(data, imported)); activeTab = data.tabs[0].id; showTrash = false; changed(); render(); finish(); }
            catch (error) { notify(error.message, true); }
        }, 'Добавить'));
        body.append(button('Заменить блокнот', 'rotate', () => {
            if (!confirm('Заменить весь блокнот, включая корзину? Текущая копия будет скачана перед заменой.')) return;
            download(); data = imported; activeTab = data.tabs[0].id; showTrash = false; changed(); render(); finish();
        }, 'Заменить'));
        dialog.showModal();
    } catch (error) { notify(error.message, true); }
});
panel.append(header, tabsRow, tools, list, footer, fileInput);
const launcher = button('Открыть Wani Notebook', 'book-open', openPanel, 'Notebook'); launcher.id = 'wnb-launcher';
document.body.append(panel, launcher);
const menu = document.getElementById('extensionsMenu');
if (menu) menu.append(button('Открыть Wani Notebook', 'book-open', openPanel, 'Wani Notebook'));

function notify(message, error = false) {
    const node = make('div', `wnb-toast${error ? ' wnb-error' : ''}`, message); node.setAttribute('role', error ? 'alert' : 'status');
    (document.querySelector('dialog.wnb-dialog[open]') || document.body).append(node); setTimeout(() => node.remove(), error ? 9000 : 2300);
}
function changed() {
    data.updatedAt = Math.max(Date.now(), clock + 1); clock = data.updatedAt; dirty = true;
    save();
}
function save() {
    if (remoteConflict) { status.textContent = 'Конфликт вкладок'; return; }
    try {
        localStorage.setItem(backupKey, JSON.stringify(data));
        storageBroken = false; dirty = false; status.textContent = 'Сохранено';
    } catch (error) { storageBroken = true; status.textContent = 'Не сохранено локально'; }
    context.extensionSettings[KEY] = structuredClone(data);
    try { context.saveSettingsDebounced(); }
    catch (error) { status.textContent = 'Нет синхронизации'; }
}
window.addEventListener('beforeunload', event => {
    if (dirty || storageBroken || remoteConflict) { event.preventDefault(); event.returnValue = ''; }
});
// Do not silently overwrite work edited in another browser tab.
window.addEventListener('storage', event => {
    if (event.key !== backupKey || !event.newValue) return;
    try {
        const incoming = validateNotebook(JSON.parse(event.newValue));
        if (incoming.updatedAt <= data.updatedAt) return;
        if (document.querySelector('dialog.wnb-dialog[open]') || dirty) {
            remoteConflict = true; status.textContent = 'Изменено в другой вкладке';
            notify('Блокнот изменён в другой вкладке браузера. Закрой редактор и нажми на статус сохранения, чтобы выбрать копию.', true);
        } else { data = incoming; clock = data.updatedAt; context.extensionSettings[KEY] = structuredClone(data); render(); }
    } catch (error) { notify('Не удалось прочитать изменения из другой вкладки.', true); }
});
status.tabIndex = 0;
function resolveConflict() {
    if (!remoteConflict) { if (storageBroken) { save(); if (storageBroken) notify('Локальная копия не записывается. Экспортируй блокнот в файл.', true); } return; }
    if (document.querySelector('dialog.wnb-dialog[open]')) { notify('Сначала закрой редактор.'); return; }
    const { dialog, body, finish } = modal('Две копии блокнота');
    body.append(make('p', '', 'Выбери, какую копию оставить. Другая копия будет скачана в файл.'));
    body.append(button('Загрузить изменения из другой вкладки', '', () => {
        try { const incoming = validateNotebook(JSON.parse(localStorage.getItem(backupKey))); download(); data = incoming; remoteConflict = false; changed(); render(); finish(); }
        catch (error) { notify(error.message, true); }
    }, 'Использовать другую вкладку'));
    body.append(button('Сохранить мои изменения', '', () => {
        try { const incoming = validateNotebook(JSON.parse(localStorage.getItem(backupKey))); download(incoming); clock = Math.max(clock, incoming.updatedAt); remoteConflict = false; changed(); finish(); }
        catch (error) { notify(error.message, true); }
    }, 'Оставить мои изменения'));
    dialog.showModal();
}
status.addEventListener('click', resolveConflict);
status.addEventListener('keydown', event => { if (event.key === 'Enter') resolveConflict(); });
function download(value = data) {
    const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), a = make('a'); a.href = url;
    a.download = `wani-notebook-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function renderTabs() {
    if (!data.tabs.some(tab => tab.id === activeTab)) activeTab = data.tabs[0].id;
    tabs.replaceChildren();
    for (const tab of data.tabs) {
        const b = button(tab.title || 'Без названия', '', () => { activeTab = tab.id; showTrash = false; query = ''; search.value = ''; render(); }, tab.title || 'Без названия');
        b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(tab.id === activeTab && !showTrash)); b.setAttribute('aria-controls', list.id);
        tabs.append(b);
    }
}
function addTab() {
    const title = prompt('Название новой вкладки', 'Новая вкладка'); if (title === null) return;
    if (data.tabs.length >= 100) { notify('Достигнут предел: 100 вкладок.', true); return; }
    const tab = { id: uid(), title: title.trim().slice(0, 200) || 'Новая вкладка' };
    data.tabs.push(tab); activeTab = tab.id; showTrash = false; query = ''; search.value = '';
    changed(); render(); tabs.scrollLeft = tabs.scrollWidth;
}
function render() { renderTabs(); renderNotes(); }
function renderNotes() {
    const scroll = list.scrollTop; list.replaceChildren();
    trashButton.classList.toggle('wnb-selected', showTrash);
    trashButton.title = showTrash ? 'Вернуться к заметкам' : `Корзина (${data.trash.length})`;
    newButton.disabled = showTrash;
    const source = showTrash ? data.trash : data.notes;
    const visible = source.filter(note => (showTrash || query || note.tabId === activeTab) &&
        (!query || `${note.title}\n${plainText(note.html)}`.toLocaleLowerCase().includes(query)));
    if (showTrash) list.append(make('p', 'wnb-hint', 'Корзина · заметки хранятся до удаления вручную'));
    if (query) list.append(make('p', 'wnb-hint', `Найдено: ${visible.length}${showTrash ? '' : ' · во всех вкладках'}`));
    if (!visible.length) list.append(make('p', 'wnb-empty', query ? 'Ничего не найдено.' : showTrash ? 'Корзина пуста.' : 'Добавь первую заметку: команду, расписание или важную деталь.'));
    for (const note of visible) {
        const card = make('article', 'wnb-card'); card.dataset.note = note.id;
        const top = make('div', 'wnb-card-header');
        const title = button(note.collapsed ? 'Раскрыть заметку' : 'Свернуть заметку', note.collapsed ? 'chevron-right' : 'chevron-down', () => { note.collapsed = !note.collapsed; changed(); renderNotes(); }, note.title || 'Без названия');
        title.classList.add('wnb-note-title'); title.setAttribute('aria-expanded', String(!note.collapsed)); top.append(title);
        if (showTrash) {
            top.append(button('Восстановить заметку', 'rotate-left', () => {
                data.trash = data.trash.filter(n => n.id !== note.id); delete note.deletedAt;
                if (!data.tabs.some(tab => tab.id === note.tabId)) note.tabId = data.tabs[0].id;
                data.notes.push(note); changed(); renderNotes();
            }));
            top.append(button('Удалить навсегда', 'trash-can', () => {
                if (confirm(`Удалить «${note.title || 'Без названия'}» навсегда?`)) { data.trash = data.trash.filter(n => n.id !== note.id); changed(); renderNotes(); }
            }));
        } else {
            top.append(button('Копировать текст заметки', 'copy', () => copyNote(note)));
            top.append(button('Редактировать заметку', 'pen', () => editNote(note)));
        }
        card.append(top);
        if (query) card.append(make('small', 'wnb-note-tab', data.tabs.find(tab => tab.id === note.tabId)?.title || 'Заметки'));
        const content = make('div', 'wnb-rich wnb-note-body'); content.innerHTML = note.html; content.hidden = note.collapsed;
        card.append(content); list.append(card);
    }
    list.scrollTop = scroll;
}
async function copyNote(note) {
    const text = plainText(note.html);
    try { await navigator.clipboard.writeText(text); notify('Текст скопирован'); }
    catch (error) {
        const textarea = make('textarea'); textarea.value = text; textarea.style.cssText = 'position:fixed;left:-10000px;top:0';
        const owner = document.querySelector('dialog.wnb-dialog[open]') || document.body;
        const previous = document.activeElement; owner.append(textarea); textarea.select();
        let copied = false; try { copied = document.execCommand('copy'); } catch { /* manual fallback below */ }
        textarea.remove(); previous?.focus();
        if (copied) notify('Текст скопирован');
        else { const { dialog, body } = modal('Скопировать текст'); const field = make('textarea'); field.value = text; field.readOnly = true; field.className = 'wnb-copy-field'; body.append(make('p', '', 'Браузер запретил буфер обмена. Нажми Ctrl+C для выделенного текста.'), field); dialog.showModal(); field.select(); }
    }
}
function modal(title) {
    const dialog = make('dialog', 'wnb-dialog'); const heading = make('header', 'wnb-dialog-header');
    heading.append(make('strong', 'wnb-brand', title)); const actions = make('div', 'wnb-actions');
    const finish = () => { dialog.close(); render(); };
    actions.append(button('Закрыть редактор', 'xmark', finish)); heading.append(actions);
    const body = make('div', 'wnb-dialog-body'); dialog.append(heading, body); document.body.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); render(); });
    // Tavern keyboard shortcuts must not submit a message while typing a note.
    dialog.addEventListener('keydown', event => event.stopPropagation());
    dialog.addEventListener('keyup', event => event.stopPropagation());
    return { dialog, body, actions, finish };
}
function addNote() {
    if (data.notes.length + data.trash.length >= 10000) { notify('Достигнут предел: 10 000 заметок.', true); return; }
    const note = { id: uid(), tabId: activeTab, title: '', html: '', collapsed: false };
    data.notes.push(note); changed(); renderNotes(); editNote(note);
}
function editNote(note) {
    const { dialog, body, actions, finish } = modal('Заметка'); dialog.classList.add('wnb-editor-dialog');
    const maximize = button('Развернуть редактор', 'expand', () => {
        dialog.classList.toggle('wnb-fullscreen'); const full = dialog.classList.contains('wnb-fullscreen');
        maximize.setAttribute('aria-label', full ? 'Уменьшить редактор' : 'Развернуть редактор'); maximize.title = maximize.getAttribute('aria-label');
    }); actions.prepend(maximize);
    const title = make('input', 'wnb-title-input'); title.placeholder = 'Название заметки'; title.maxLength = 200; title.value = note.title; title.setAttribute('aria-label', 'Название заметки');
    const editor = make('div', 'wnb-rich wnb-editor'); editor.contentEditable = 'true'; editor.role = 'textbox'; editor.setAttribute('aria-label', 'Текст заметки'); editor.setAttribute('aria-multiline', 'true'); editor.spellcheck = true; editor.innerHTML = note.html;
    const toolbar = make('div', 'wnb-format'); toolbar.setAttribute('aria-label', 'Форматирование');
    const saved = make('span', 'wnb-hint', 'Сохранено'); saved.setAttribute('role', 'status');
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
    for (const [label, icon, command] of [['Жирный', 'bold', 'bold'], ['Курсив', 'italic', 'italic'], ['Подчёркивание', 'underline', 'underline'], ['Маркированный список', 'list-ul', 'insertUnorderedList'], ['Нумерованный список', 'list-ol', 'insertOrderedList'], ['Сбросить оформление', 'eraser', 'removeFormat']]) {
        const b = button(label, icon, () => format(command)); b.addEventListener('mousedown', e => { rememberSelection(); e.preventDefault(); }); toolbar.append(b);
    }
    for (const [label, command, initial] of [['Цвет текста', 'foreColor', '#92caa0'], ['Цвет маркера', 'hiliteColor', '#66513c']]) {
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
    const select = make('select'); select.setAttribute('aria-label', 'Вкладка заметки');
    for (const tab of data.tabs) { const option = make('option', '', tab.title || 'Без названия'); option.value = tab.id; select.append(option); }
    select.value = note.tabId; select.addEventListener('change', () => { note.tabId = select.value; changed(); });
    function moveNote(delta) {
        const siblings = data.notes.filter(n => n.tabId === note.tabId); const target = siblings[siblings.indexOf(note) + delta]; if (!target) return;
        const a = data.notes.indexOf(note), b = data.notes.indexOf(target); [data.notes[a], data.notes[b]] = [data.notes[b], data.notes[a]]; changed(); notify('Порядок изменён');
    }
    bottom.append(select, button('Выше в списке', 'arrow-up', () => moveNote(-1)), button('Ниже в списке', 'arrow-down', () => moveNote(1)), button('Копировать текст заметки', 'copy', () => copyNote(note)), button('Переместить в корзину', 'trash-can', () => {
        data.notes = data.notes.filter(n => n.id !== note.id); note.deletedAt = Date.now(); data.trash.unshift(note); changed(); finish();
    }), saved, button('Готово', 'check', finish, 'Готово'));
    body.append(title, toolbar, editor, bottom); dialog.showModal(); (note.title ? editor : title).focus();
}
function manageTabs() {
    const { dialog, body } = modal('Вкладки блокнота');
    function draw() {
        body.replaceChildren(make('p', 'wnb-hint', 'Переименуй вкладки или измени их порядок. При удалении вкладки её заметки перейдут в первую оставшуюся.'));
        data.tabs.forEach((tab, index) => {
            const row = make('div', 'wnb-tab-row'); const name = make('input'); name.value = tab.title; name.maxLength = 200; name.setAttribute('aria-label', 'Название вкладки');
            name.addEventListener('input', () => { tab.title = name.value; changed(); renderTabs(); });
            row.append(name);
            for (const [delta, label, icon] of [[-1, 'Передвинуть вкладку влево', 'arrow-left'], [1, 'Передвинуть вкладку вправо', 'arrow-right']]) {
                const b = button(label, icon, () => { [data.tabs[index], data.tabs[index + delta]] = [data.tabs[index + delta], tab]; changed(); draw(); renderTabs(); });
                b.disabled = !data.tabs[index + delta]; row.append(b);
            }
            const remove = button('Удалить вкладку', 'trash-can', () => {
                if (!confirm(`Удалить вкладку «${tab.title}»? Заметки будут перенесены в первую оставшуюся вкладку.`)) return;
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
    panel.style.display = 'flex'; fitWindow();
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
        defaultPage: { id: 'notebook', name: 'Блокнот' },
        onMount() { panel.style.resize = 'none'; },
        onRelease() { panel.style.resize = ''; fitWindow(); },
    });
}
window.addEventListener('wani-roleplay-tools:ready', connect);
render(); connect();
if (startupErrors.length) {
    status.textContent = 'Ошибка чтения данных';
    notify(`${startupErrors.join(' ')} Исходные копии не перезаписаны. При необходимости сохрани доступные заметки экспортом.`, true);
} else {
    // Recover newer browser changes after a server interruption.
    save();
}
