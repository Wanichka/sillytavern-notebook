import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? `${process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES}/playwright` : 'playwright');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = process.env.RPT_HOST_DIR || path.resolve(root, '../roleplay-tools');
const stPublic = process.env.ST_PUBLIC_DIR;
const base = '/scripts/extensions/third-party/';
const seed = { format: 'wani-notebook', version: 1, updatedAt: 1,
    tabs: [{ id: 'commands', title: 'Команды' }, { id: 'details', title: 'Важные детали' }, { id: 'schedule', title: 'Расписание' }],
    notes: [
        { id: 'summary', tabId: 'commands', title: 'Инжект для пересказа', html: '&lt;roleplay_summary&gt;\n{{summary}}\n&lt;/roleplay_summary&gt;', collapsed: false },
        { id: 'day', tabId: 'commands', title: 'Новый день', html: 'The scene continued. A new day has begun.', collapsed: false },
        { id: 'crew', tabId: 'details', title: 'Команда', html: '<b>Уни</b> — наблюдатель.\n<span style="color: rgb(146, 202, 160)">Важная деталь</span>: записать маршрут.', collapsed: false },
        { id: 'hours', tabId: 'schedule', title: 'Распорядок дня', html: '07:00 — подъём\n08:00 — завтрак\n09:00–12:00 — занятия\n13:00 — обед', collapsed: false },
    ], trash: [] };
const stub = `
const saved=JSON.parse(localStorage.getItem('qa-server')||'{}');
if(!saved.wani_notebook_v1 && !new URL(location.href).searchParams.has('empty'))saved.wani_notebook_v1=${JSON.stringify(seed)};
window.context={extensionSettings:saved,saveSettingsDebounced(){window.saves++; if(!window.failServer)localStorage.setItem('qa-server',JSON.stringify(this.extensionSettings));}};
window.saves=0;window.SillyTavern={getContext:()=>context};
window.promptCalls=[];context.setExtensionPrompt=(...args)=>promptCalls.push(args);
window.copied=null;Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copied=text}}});
`;
function html(order) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root{--SmartThemeBlurTintColor:#09161e;--SmartThemeBodyColor:#dedbd5;--SmartThemeQuoteColor:#c8ab8d;--mainFontFamily:Georgia}
    *{box-sizing:border-box}body{background:#253f46;margin:0;color:#dedbd5;font:15px Georgia}#extensionsMenu{display:none}button,input,select{font:inherit}
    .qa-chat{margin:80px 460px 0 12%;line-height:1.8;max-width:620px}.qa-chat h1{font-weight:normal}
    </style>${stPublic ? '<link rel="stylesheet" href="/css/fontawesome.min.css"><link rel="stylesheet" href="/css/solid.min.css">' : ''}<link rel="stylesheet" href="${base}notebook/style.css"><link rel="stylesheet" href="${base}host/style.css"></head><body>
    <div class="qa-chat"><small>ЛИЧНЫЕ ЗАМЕТКИ</small><h1>Всё нужное — под рукой</h1><p>Команды, важные детали и расписания живут в блокноте. Они доступны во время игры и не отправляются модели.</p></div><div id="extensionsMenu"></div>
    <script type="module">${stub}
    ${order === 'first' ? `await import('${base}host/index.js');` : ''}
    await import('${base}notebook/index.js');
    ${order === 'last' ? `await import('${base}host/index.js');` : ''}
    window.ready=true;
    </script></body></html>`;
}
const server = createServer(async (req, res) => {
    try {
        const url = new URL(req.url, 'http://localhost');
        if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html(url.searchParams.get('order') || 'first')); return; }
        if (url.pathname === '/scripts/user.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(`export const getCurrentUserHandle=()=>new URL(location.href).searchParams.get('user')||'test-user';`); return; }
        if (stPublic && ['/css/fontawesome.min.css','/css/solid.min.css','/webfonts/fa-solid-900.woff2','/webfonts/fa-solid-900.ttf'].includes(url.pathname)) {
            res.setHeader('Content-Type', url.pathname.endsWith('css')?'text/css':'font/woff2');
            res.end(await readFile(path.join(stPublic,url.pathname))); return;
        }
        const match = url.pathname.match(/^\/scripts\/extensions\/third-party\/(notebook|host)\/(index\.js|style\.css|model\.js)$/);
        if (!match) { res.writeHead(404); res.end(); return; }
        res.setHeader('Content-Type', match[2].endsWith('css') ? 'text/css' : 'text/javascript');
        res.end(await readFile(path.join(match[1] === 'host' ? host : root, match[2])));
    } catch (error) { res.writeHead(500); res.end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true,
    ...(process.env.RPT_CHROMIUM_PATH ? { executablePath: process.env.RPT_CHROMIUM_PATH } : {}),
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log('PASS', label); };
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
ctx.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const getData = () => page.evaluate(() => context.extensionSettings.wani_notebook_v1);
const card = id => page.locator(`.wnb-card[data-note="${id}"]`);
async function open(order = 'first') {
    await page.goto(`${url}/?order=${order}`); await page.waitForFunction(() => window.ready);
    if (order !== 'none') await page.evaluate(() => WaniRoleplayTools.open('notebook'));
    else await page.locator('#wnb-launcher').click();
}
async function chooseText(text) {
    await page.locator('.wnb-editor').evaluate((editor, target) => {
        const walk=document.createTreeWalker(editor,NodeFilter.SHOW_TEXT); let n;
        while((n=walk.nextNode())) { const i=n.textContent.indexOf(target); if(i<0)continue; const r=document.createRange(); r.setStart(n,i);r.setEnd(n,i+target.length);const s=getSelection();s.removeAllRanges();s.addRange(r);editor.dispatchEvent(new Event('mouseup'));return; }
        throw Error('Selection not found: '+target);
    }, text);
    await page.waitForTimeout(40);
}
try {
    await open();
    for (const [width,height,label] of [[1400,950,'desktop'],[360,800,'narrow']]) {
        await page.setViewportSize({width,height});
        await page.waitForFunction(() => { const r=document.querySelector('#rpt-shell').getBoundingClientRect(); return r.right<=innerWidth && r.bottom<=innerHeight; });
        const add=page.getByRole('button',{name:'Добавить вкладку',exact:true});
        const {b,p,t}=await add.evaluate(el=>{const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}};return {b:rect(el),p:rect(document.querySelector('#wnb-panel')),t:rect(document.querySelector('.wnb-tabs'))}});
        check(b.width>=30 && b.x>=t.x+t.width-0.5 && b.x+b.width<=p.x+p.width+0.5 && b.y>=p.y,`${label}: add-tab button fully visible outside scroller: ${JSON.stringify({b,p,t})}`);
        await page.locator('.wnb-tabs').evaluate(el=>el.scrollLeft=el.scrollWidth);
        assert.deepEqual(await add.boundingBox(),b);
        check(await add.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.right-3,r.top+r.height/2))}),`${label}: scrolling tabs keeps entire add button reachable`);
        const title=`Новая длинная вкладка ${label}`;
        await page.getByRole('searchbox').fill('old query');
        page.once('dialog',dialog=>dialog.accept(title));
        await add.click();
        check((await getData()).tabs.at(-1).title===title && await page.locator('.wnb-tabs [aria-selected="true"]').textContent()===title && await page.getByRole('searchbox').inputValue()==='',`${label}: fixed plus creates and activates tab, clears old search`);
    }
    const add=page.getByRole('button',{name:'Добавить вкладку',exact:true});
    page.once('dialog',dialog=>dialog.accept('С клавиатуры'));
    await add.focus();await add.press('Enter');
    check((await getData()).tabs.at(-1).title==='С клавиатуры','fixed plus supports keyboard activation');
    await page.evaluate(seed=>{localStorage.clear();localStorage.setItem('qa-server',JSON.stringify({wani_notebook_v1:seed}));},seed);
    await page.setViewportSize({width:1400,height:950});await open();
    check(await page.locator('#wnb-panel').getAttribute('data-rpt-docked') === 'true', 'host-first registers Notebook');
    check(await page.locator('#rpt-shell').getByRole('tab', { name: 'Блокнот', exact: true }).isVisible(), 'own default host page');
    await card('summary').getByRole('button', { name: 'Копировать текст заметки' }).click();
    check(await page.evaluate(() => copied) === '<roleplay_summary>\n{{summary}}\n</roleplay_summary>', 'copy preserves literal tags, macros and line breaks, excludes title');
    await card('summary').getByRole('button', { name: 'Свернуть заметку' }).click();
    check(!await card('summary').locator('.wnb-note-body').isVisible(), 'note collapse');
    await card('summary').getByRole('button', { name: 'Раскрыть заметку' }).click();
    await page.getByRole('searchbox').fill('подъём');
    check(await page.locator('.wnb-card').count() === 1 && await card('hours').isVisible(), 'search across inactive tabs');
    await page.getByRole('searchbox').fill('');

    await page.getByRole('button', { name: 'Добавить заметку', exact: true }).click();
    await page.getByRole('textbox', { name: 'Название заметки', exact: true }).fill('Тестовая заметка');
    const literal='  <inject>\n{{summary}}\n\n    Учёба & отдых\n</inject>  ';
    await page.getByRole('textbox', { name: 'Текст заметки', exact: true }).fill(literal);
    const newId=(await getData()).notes.at(-1).id;
    await chooseText('Учёба');
    await page.getByRole('button', { name: 'Жирный', exact: true }).click();
    check(/font-weight: bold|<b>|<strong>/.test((await getData()).notes.at(-1).html), 'bold selection saved');
    await chooseText('отдых');
    await page.getByLabel('Цвет текста', { exact: true }).fill('#40c080');
    check((await getData()).notes.at(-1).html.includes('rgb(64, 192, 128)'), 'selected text color saved');
    await chooseText('Учёба');
    await page.getByLabel('Цвет маркера', { exact: true }).fill('#654321');
    check((await getData()).notes.at(-1).html.includes('background-color: rgb(101, 67, 33)'), 'selected text highlight saved');
    await page.locator('dialog').getByRole('button', { name: 'Копировать текст заметки' }).click();
    assert.equal(await page.evaluate(() => copied), literal, JSON.stringify((await getData()).notes.at(-1)));
    check(true, 'formatted copy preserves spaces and empty lines');
    const small=await page.locator('dialog').boundingBox();
    await page.getByRole('button', { name: 'Развернуть редактор', exact: true }).click();
    check((await page.locator('dialog').boundingBox()).width > small.width + 100, 'editor expands to viewport');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await open();
    check((await getData()).notes.some(n => n.id === newId && n.html.includes('rgb(64, 192, 128)')), 'formatted text survives reload');
    await card(newId).getByRole('button', { name: 'Редактировать заметку' }).click();
    await page.getByLabel('Вкладка заметки', { exact: true }).selectOption('details');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    check(!await card(newId).count(), 'moving note removes it from old tab');
    await page.locator('.wnb-tabs').getByRole('tab', { name: 'Важные детали', exact: true }).click();
    await card(newId).getByRole('button', { name: 'Редактировать заметку' }).click();
    await page.getByRole('button', { name: 'Выше в списке', exact: true }).click();
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await page.waitForFunction(id => document.querySelector('.wnb-card')?.dataset.note === id, newId);
    check(true, 'note ordering within tab');
    await card(newId).getByRole('button', { name: 'Редактировать заметку' }).click();
    await page.getByRole('button', { name: 'Переместить в корзину', exact: true }).click();
    check((await getData()).trash.some(n => n.id === newId), 'soft delete keeps full note');
    await page.getByRole('button', { name: 'Корзина', exact: true }).click();
    await card(newId).getByRole('button', { name: 'Восстановить заметку' }).click();
    check((await getData()).notes.some(n => n.id === newId) && !(await getData()).trash.length, 'restore keeps id, content and original tab');
    await page.getByRole('button', { name: 'Корзина', exact: true }).click();

    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Экспорт блокнота', exact: true }).click();
    const download = await downloadEvent, exported = JSON.parse(await readFile(await download.path(), 'utf8'));
    assert.deepEqual(exported, await getData()); check(true, 'export equals entire notebook');
    const before=await getData();
    await page.locator('input[type=file]').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"format":"wrong"}') });
    await page.waitForTimeout(100); assert.deepEqual(await getData(), before); check(true, 'invalid import leaves notebook unchanged');
    await page.locator('input[type=file]').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
    await page.getByRole('button', { name: 'Добавить к моим заметкам', exact: true }).click();
    const merged=await getData();
    check(merged.notes.length===before.notes.length*2 && new Set(merged.notes.map(n=>n.id)).size===merged.notes.length, 'merge import duplicates data with unique ids');
    check(merged.tabs.length===before.tabs.length*2, 'merge import creates independent tabs');

    const sanitized=await page.evaluate(async base=>{
        const {sanitize,validateNotebook}=await import(base+'notebook/model.js');
        window.injected=false;
        const raw='<script>window.injected=true</script><img src=x onerror="window.injected=true"><svg onload="window.injected=true"></svg><p onclick="window.injected=true" style="color:red;background-image:url(https://invalid.local/x)">safe</p><a href="javascript:evil()">link</a>';
        const html=sanitize(raw);const el=document.createElement('div');el.innerHTML=html;document.body.append(el);
        let rejected=false;try{validateNotebook({format:'wani-notebook',version:1,tabs:[{id:'same',title:'a'},{id:'same',title:'b'}],notes:[],trash:[]})}catch{rejected=true}
        return {html,rejected};
    }, base);
    check(!/script|img|svg|onclick|href|background-image|url\(/.test(sanitized.html) && sanitized.html.includes('color: red'), 'import sanitizer strips active HTML but preserves text color');
    check(sanitized.rejected, 'duplicate backup identifiers rejected');
    check(!await page.evaluate(()=>injected), 'imported HTML cannot execute');

    await page.getByRole('button', { name: 'Управление вкладками', exact: true }).click();
    await page.getByRole('textbox', { name: 'Название вкладки', exact: true }).first().fill('Мои команды');
    await page.getByRole('button', { name: 'Передвинуть вкладку вправо', exact: true }).first().click();
    await page.getByRole('button', { name: 'Закрыть редактор', exact: true }).click();
    check((await getData()).tabs[1].title==='Мои команды', 'tab rename and reordering');
    const sameData=await getData();
    await page.evaluate(()=>WaniRoleplayTools.destroy());
    await page.locator('#wnb-launcher').click();
    assert.deepEqual(await getData(), sameData); check(!await page.locator('#wnb-panel').getAttribute('data-rpt-docked'), 'host detach preserves data and restores standalone');
    await open('last');
    check(await page.locator('#wnb-panel').getAttribute('data-rpt-docked')==='true', 'Notebook-first integration');
    await page.locator('.wnb-tabs').getByRole('tab', { name: 'Мои команды', exact: true }).click();
    await card('summary').getByRole('button', { name: 'Редактировать заметку' }).click();
    await page.getByRole('textbox', { name: 'Текст заметки', exact: true }).fill('Черновик при смене панели');
    await page.evaluate(()=>WaniRoleplayTools.destroy());
    check(await page.locator('.wnb-editor').innerText()==='Черновик при смене панели', 'host detach leaves active editor intact');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();

    // A failed server sync is recovered from the newer local copy on reload.
    await page.locator('#wnb-launcher').click();
    await page.evaluate(()=>window.failServer=true);
    await page.getByRole('button', { name: 'Добавить заметку', exact: true }).click();
    await page.getByRole('textbox', { name: 'Название заметки', exact: true }).fill('Без сервера');
    await page.getByRole('textbox', { name: 'Текст заметки', exact: true }).fill('Сохранить локально');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await open('none');
    check((await getData()).notes.some(n=>n.title==='Без сервера'), 'newer local copy recovers after server failure');
    check(await page.evaluate(()=>promptCalls.length)===0, 'no prompt or generation calls');

    // Replacement is explicit and downloads the old notebook first.
    await page.locator('input[type=file]').setInputFiles({name:'restore.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(seed))});
    const oldCopyEvent=page.waitForEvent('download');
    page.once('dialog',d=>d.accept());
    await page.getByRole('button',{name:'Заменить блокнот',exact:true}).click();
    const oldCopy=JSON.parse(await readFile(await (await oldCopyEvent).path(),'utf8'));
    check(oldCopy.notes.some(n=>n.title==='Без сервера') && (await getData()).notes.length===seed.notes.length,'replace import backs up old content before replacing');
    await page.getByRole('button',{name:'Управление вкладками',exact:true}).click();
    page.once('dialog',d=>d.accept());
    await page.getByRole('button',{name:'Удалить вкладку',exact:true}).nth(1).click();
    await page.getByRole('button',{name:'Закрыть редактор',exact:true}).click();
    check((await getData()).notes.find(n=>n.id==='crew').tabId==='commands','deleting a tab moves its notes instead of deleting them');

    // Clipboard denial uses the synchronous browser fallback, still with plain text.
    await page.evaluate(()=>{
        navigator.clipboard.writeText=async()=>{throw Error('denied')};
        window.originalExec=document.execCommand.bind(document);
        document.execCommand=(command,...args)=>{if(command==='copy'){window.fallbackCopied=document.activeElement.value;return true}return window.originalExec(command,...args)};
    });
    await card('summary').getByRole('button',{name:'Копировать текст заметки'}).click();
    check(await page.evaluate(()=>fallbackCopied)==='<roleplay_summary>\n{{summary}}\n</roleplay_summary>','clipboard fallback preserves plain text');
    await page.evaluate(()=>{document.execCommand=window.originalExec;navigator.clipboard.writeText=async text=>{window.copied=text};});

    // Persisted local data is separated by Tavern account, not by RP persona.
    const other=await ctx.newPage();
    await other.goto(`${url}/?order=none&user=second-user`);await other.waitForFunction(()=>window.ready);
    check(await other.evaluate(()=>!!localStorage.getItem('wani_notebook_v1:second-user')&&!!localStorage.getItem('wani_notebook_v1:test-user')),'separate local backup keys per Tavern account');
    await other.close();

    // A concurrent browser tab must never overwrite an open note silently.
    await card('summary').getByRole('button',{name:'Редактировать заметку'}).click();
    await page.getByRole('textbox',{name:'Текст заметки',exact:true}).fill('Моя открытая заметка');
    const peer=await ctx.newPage();
    await peer.goto(`${url}/?order=none`);await peer.waitForFunction(()=>window.ready);
    await peer.evaluate(()=>{
        const key='wani_notebook_v1:test-user',value=JSON.parse(localStorage.getItem(key));
        value.notes[0].html='Из другой вкладки';value.updatedAt=Date.now()+1000;localStorage.setItem(key,JSON.stringify(value));
    });
    await page.waitForFunction(()=>document.querySelector('.wnb-status').textContent==='Изменено в другой вкладке');
    check(await page.locator('.wnb-editor').innerText()==='Моя открытая заметка','concurrent update does not replace active editor');
    await page.getByRole('button',{name:'Готово',exact:true}).click();
    await page.locator('.wnb-status').click();
    const conflictCopy=page.waitForEvent('download');
    await page.getByRole('button',{name:'Загрузить изменения из другой вкладки',exact:true}).click();
    await conflictCopy;
    check((await getData()).notes[0].html==='Из другой вкладки','conflict resolution loads selected copy and exports the other');
    await peer.close();

    // Quota errors cannot claim that a local save succeeded.
    await page.evaluate(()=>{window.storageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='wani_notebook_v1:test-user')throw new DOMException('quota','QuotaExceededError');return window.storageSet.call(this,key,value)}});
    await page.getByRole('button',{name:'Добавить заметку',exact:true}).click();
    await page.getByRole('textbox',{name:'Название заметки',exact:true}).fill('Проверка квоты');
    check(await page.locator('.wnb-status').textContent()==='Не сохранено локально','local storage failure reports unsaved status');
    await page.evaluate(()=>{Storage.prototype.setItem=window.storageSet;});
    await page.getByRole('textbox',{name:'Текст заметки',exact:true}).fill('Повтор после восстановления');
    await page.getByRole('button',{name:'Готово',exact:true}).click();
    check(await page.locator('.wnb-status').textContent()==='Сохранено','saving recovers after quota error');

    const copyCases=await page.evaluate(async base=>{
        const {plainText}=await import(base+'notebook/model.js');
        return [plainText('<ol><li>Раз</li><li>Два</li></ol>'),plainText('начало<div><br></div><div>конец</div>'),plainText('<ul><li>Пункт</li></ul>')];
    },base);
    assert.deepEqual(copyCases,['1. Раз\n2. Два','начало\n\nконец','• Пункт']);check(true,'plain copy retains list markers and blank editable lines');

    await page.evaluate(()=>document.documentElement.style.setProperty('--SmartThemeQuoteColor','#c83f72'));
    check(await page.locator('#wnb-panel .wnb-brand').evaluate(el=>getComputedStyle(el).color)==='rgb(200, 63, 114)','Notebook follows theme accent changes');
    await page.evaluate(()=>document.documentElement.style.removeProperty('--SmartThemeQuoteColor'));

    // Actual paste event: tags are stored as literal text, never as markup.
    await page.getByRole('button', { name: 'Добавить заметку', exact: true }).click();
    await page.locator('.wnb-editor').focus();
    await page.locator('.wnb-editor').evaluate(el=>{
        const clipboardData=new DataTransfer();clipboardData.setData('text/plain','<inject>\n{{summary}}\n</inject>');clipboardData.setData('text/html','<img src=x onerror=alert(1)>');
        el.dispatchEvent(new ClipboardEvent('paste',{clipboardData,bubbles:true,cancelable:true}));
    });
    await page.locator('dialog').getByRole('button', { name: 'Копировать текст заметки' }).click();
    check(await page.evaluate(()=>copied)==='<inject>\n{{summary}}\n</inject>', 'paste strips foreign HTML and preserves literal command');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();

    await page.setViewportSize({width:390,height:844});
    await open();
    const box=await page.locator('#wnb-panel').boundingBox();
    check(box.x>=0 && box.x+box.width<=390, 'docked panel fits mobile viewport');
    await page.getByRole('button', { name: 'Добавить заметку', exact: true }).click();
    const dialogBox=await page.locator('dialog').boundingBox();
    check(dialogBox.x>=0 && dialogBox.x+dialogBox.width<=390 && dialogBox.y+dialogBox.height<=844, 'mobile editor fits viewport');
    await page.getByRole('button', { name: 'Готово', exact: true }).click();
    await page.setViewportSize({width:1400,height:950});

    // Screenshots use clean demo content; they are not production user data.
    await page.evaluate(seed=>{localStorage.clear();localStorage.setItem('qa-server',JSON.stringify({wani_notebook_v1:seed}));},seed);
    await open();
    await mkdir(path.join(root,'tests/output'),{recursive:true});
    await page.locator('#rpt-shell').screenshot({path:path.join(root,'tests/output/notebook-panel.png')});
    await card('summary').getByRole('button', { name:'Редактировать заметку'}).click();
    await page.locator('dialog').screenshot({path:path.join(root,'tests/output/notebook-editor.png')});
    check(errors.length===0, `no uncaught browser errors: ${errors.join('; ')}`);
    console.log(`\n${checks} browser checks passed.`);
} catch(error) {
    await mkdir(path.join(root,'tests/output'),{recursive:true});
    await page.screenshot({path:path.join(root,'tests/output/failure.png')});
    console.error('BROWSER ERRORS',errors); console.error('DIALOGS',await page.locator('dialog').evaluateAll(nodes=>nodes.map(n=>({open:n.open,text:n.textContent}))));
    throw error;
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
