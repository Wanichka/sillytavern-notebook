// Original Wani Notebook implementation. No code from Extension-Notebook.
export const KEY = 'wani_notebook_v1';
export const uid = () => crypto.randomUUID();
export function emptyNotebook() {
    return { format: 'wani-notebook', version: 1, updatedAt: 0,
        tabs: [{ id: uid(), title: 'Заметки' }], notes: [], trash: [] };
}

const allowed = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'SPAN', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'H1', 'H2', 'H3', 'FONT']);
const blocked = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE', 'FORM', 'INPUT', 'BUTTON', 'TEXTAREA', 'SELECT', 'LINK', 'META', 'IMG', 'VIDEO', 'AUDIO']);
export function sanitize(html) {
    const template = document.createElement('template');
    template.innerHTML = String(html);
    const out = document.createElement('div');
    function walk(node, parent) {
        if (node.nodeType === Node.TEXT_NODE) { parent.append(document.createTextNode(node.textContent)); return; }
        if (node.nodeType !== Node.ELEMENT_NODE || blocked.has(node.tagName)) return;
        let target = parent;
        if (allowed.has(node.tagName)) {
            target = document.createElement(node.tagName === 'FONT' ? 'span' : node.tagName.toLowerCase());
            for (const property of ['color', 'background-color', 'font-weight', 'font-style', 'text-decoration-line']) {
                const value = node.style.getPropertyValue(property);
                if (value && !/url\s*\(|var\s*\(/i.test(value)) target.style.setProperty(property, value);
            }
            if (node.tagName === 'FONT' && node.getAttribute('color')) target.style.color = node.getAttribute('color');
            parent.append(target);
        }
        for (const child of node.childNodes) walk(child, target);
    }
    for (const node of template.content.childNodes) walk(node, out);
    return out.innerHTML;
}

export function plainText(html) {
    const node = document.createElement('div');
    node.innerHTML = sanitize(html);
    const blocks = new Set(['DIV', 'P', 'PRE', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'UL', 'OL', 'LI']);
    function content(parent) {
        // Chromium represents an empty editable line as <div><br></div>.
        // innerText counts both the BR and block boundary, inventing a blank line.
        if (parent.childNodes.length === 1 && parent.firstChild.nodeName === 'BR') return '';
        let text = '', previousBlock = false, hasContent = false;
        for (const child of parent.childNodes) {
            const block = blocks.has(child.nodeName);
            if (hasContent && (block || previousBlock)) text += '\n';
            if (child.nodeType === Node.TEXT_NODE) text += child.textContent;
            else if (child.nodeName === 'BR') text += '\n';
            else {
                if (child.nodeName === 'LI' && parent.nodeName === 'UL') text += '• ';
                if (child.nodeName === 'LI' && parent.nodeName === 'OL') text += `${Array.from(parent.children).indexOf(child) + 1}. `;
                text += content(child);
            }
            previousBlock = block; hasContent = true;
        }
        return text;
    }
    return content(node);
}

// Strict, atomic validation: a bad backup never replaces the current notebook.
export function validateNotebook(value) {
    if (!value || value.format !== 'wani-notebook' || value.version !== 1) throw new Error('Это не резервная копия Wani Notebook версии 1.');
    if (!Array.isArray(value.tabs) || !value.tabs.length || value.tabs.length > 100 ||
        !Array.isArray(value.notes) || !Array.isArray(value.trash) || value.notes.length + value.trash.length > 10000) throw new Error('Некорректный список вкладок или заметок.');
    const ids = new Set();
    function id(value) {
        if (typeof value !== 'string' || !value || value.length > 100 || ids.has(value)) throw new Error('Некорректные или повторяющиеся идентификаторы.');
        ids.add(value); return value;
    }
    function title(value) {
        if (typeof value !== 'string' || value.length > 200) throw new Error('Некорректный заголовок.');
        return value;
    }
    const tabs = value.tabs.map(tab => ({ id: id(tab.id), title: title(tab.title) }));
    const tabIds = new Set(tabs.map(tab => tab.id));
    const note = (item, trash = false) => {
        if (typeof item.html !== 'string' || item.html.length > 2000000) throw new Error('Некорректный или слишком большой текст заметки.');
        if (!trash && !tabIds.has(item.tabId)) throw new Error('У заметки отсутствует вкладка.');
        return { id: id(item.id), tabId: tabIds.has(item.tabId) ? item.tabId : tabs[0].id,
            title: title(item.title), html: sanitize(item.html), collapsed: Boolean(item.collapsed),
            ...(trash ? { deletedAt: Number(item.deletedAt) || 0 } : {}) };
    };
    return { format: 'wani-notebook', version: 1, updatedAt: Number(value.updatedAt) || 0,
        tabs, notes: value.notes.map(item => note(item)), trash: value.trash.map(item => note(item, true)) };
}

export function mergeNotebook(current, imported) {
    const tabIds = new Map(imported.tabs.map(tab => [tab.id, uid()]));
    return { ...current,
        tabs: [...current.tabs, ...imported.tabs.map(tab => ({ ...tab, id: tabIds.get(tab.id) }))],
        notes: [...current.notes, ...imported.notes.map(note => ({ ...note, id: uid(), tabId: tabIds.get(note.tabId) }))],
        trash: [...current.trash, ...imported.trash.map(note => ({ ...note, id: uid(), tabId: tabIds.get(note.tabId) }))] };
}
