// Regression for the visible Tavern menu, using the real Tavern CSS/fonts.
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
const st = process.env.ST_PUBLIC_DIR;
assert.ok(st, 'Set ST_PUBLIC_DIR to the real SillyTavern/public directory');
const base = '/scripts/extensions/third-party/';
const html = hosted => `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/css/fontawesome.min.css"><link rel="stylesheet" href="/css/solid.min.css">
<link rel="stylesheet" href="${base}host/style.css"><link rel="stylesheet" href="${base}notebook/style.css">
<style>:root{--SmartThemeBlurTintColor:#09161e;--SmartThemeBodyColor:#dedbd5;--SmartThemeQuoteColor:#c8ab8d;--SmartThemeBorderColor:#666;--SmartThemeBlurStrength:0px;--mainFontFamily:Arial;--mainFontSize:16px;--bottomFormBlockSize:40px}
body{background:#283b42}#extensionsMenu{position:fixed;left:24px;top:60px;width:285px;display:flex!important}</style>
</head><body><div id="extensionsMenu">
<div id="reference-row" class="list-group-item flex-container flexGap5 interactable" tabindex="0"><i class="fa-solid fa-book extensionsMenuExtensionButton"></i><span>Open Notebook</span></div>
<div class="list-group-item flex-container flexGap5 interactable"><i class="fa-solid fa-shirt extensionsMenuExtensionButton"></i><span>Открыть Визуал персонажа</span></div>
</div><script type="module">
window.context={extensionSettings:{},saveSettingsDebounced(){}};window.SillyTavern={getContext:()=>context};
${hosted ? `await import('${base}host/index.js');` : ''}
await import('${base}notebook/index.js');window.ready=true;
</script></body></html>`;
const server = createServer(async(req,res)=>{
    try {
        const url = new URL(req.url,'http://localhost');
        if(url.pathname==='/'){res.setHeader('Content-Type','text/html');res.end(html(url.searchParams.has('host')));return;}
        if(url.pathname==='/scripts/user.js'){res.setHeader('Content-Type','text/javascript');res.end('export const getCurrentUserHandle=()=>"menu-test";');return;}
        const match=url.pathname.match(/^\/scripts\/extensions\/third-party\/(host|notebook)\/(index\.js|model\.js|style\.css)$/);
        let file;
        if(match)file=path.join(match[1]==='host'?host:root,match[2]);
        else {
            file=path.resolve(st,'.'+decodeURIComponent(url.pathname));
            if(!file.startsWith(path.resolve(st)+path.sep)||! /\.(css|woff2?|ttf)$/.test(file)){res.writeHead(404);res.end();return;}
        }
        res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'font/woff2');res.end(await readFile(file));
    }catch(error){res.writeHead(404);res.end(String(error));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,...(process.env.RPT_CHROMIUM_PATH?{executablePath:process.env.RPT_CHROMIUM_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;console.log('PASS',label)};
try {
    const page=await browser.newPage({viewport:{width:1100,height:850}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    for(const hosted of [false,true]){
        const mode=hosted?'hosted':'standalone';
        await page.goto(`http://127.0.0.1:${server.address().port}/${hosted?'?host':''}`);await page.waitForFunction(()=>window.ready);
        await page.evaluate(()=>document.fonts.ready);
        const menu=page.locator('#wnb-menu-button');
        const style=await menu.evaluate(el=>{
            const read=node=>{const s=getComputedStyle(node),r=node.getBoundingClientRect();return {color:s.color,background:s.backgroundColor,border:s.borderTopWidth,display:s.display,height:r.height,opacity:s.opacity}};
            const i=el.querySelector('i').getBoundingClientRect(),label=el.querySelector('span').getBoundingClientRect();
            return {self:read(el),ref:read(document.querySelector('#reference-row')),sameLine:Math.abs(i.y-label.y)<8&&label.x>=i.right,iconFont:getComputedStyle(el.querySelector('i')).fontFamily,loaded:document.fonts.check('900 16px "Font Awesome 6 Free"')};
        });
        assert.deepEqual(style.self,style.ref);check(true,`${mode}: real Tavern menu styles match neighboring row`);
        check(style.self.background==='rgba(0, 0, 0, 0)'&&style.self.border==='0px'&&style.self.display==='flex',`${mode}: no native button background or border`);
        check(style.sameLine&&style.loaded&&style.iconFont.includes('Font Awesome'),`${mode}: loaded icon and title share a line`);
        await menu.hover();check(await menu.evaluate(el=>getComputedStyle(el).opacity)==='1',`${mode}: native menu hover feedback`);
        for(const key of ['mouse','Enter',' ']){
            if(!hosted)await page.evaluate(()=>document.querySelector('#wnb-panel').style.display='none');
            else {
                await page.getByRole('button',{name:'Свернуть панель',exact:true}).click();
            }
            if(key==='mouse')await menu.click();else{await menu.focus();await menu.press(key===' '?'Space':key);}
            check(await page.locator('#wnb-panel').isVisible(),`${mode}: opens Notebook with ${key===' '?'Space':key}`);
        }
        for(const color of ['#25303b','#efe5d5']){
            await page.evaluate(color=>document.documentElement.style.setProperty('--SmartThemeBodyColor',color),color);
            check(await menu.evaluate(el=>getComputedStyle(el).color===getComputedStyle(document.querySelector('#reference-row')).color),`${mode}: menu text follows theme ${color}`);
        }
        await page.evaluate(()=>document.documentElement.style.setProperty('--SmartThemeBodyColor','#dedbd5'));
        await page.mouse.move(600,700);
        await mkdir(path.join(root,'tests/output'),{recursive:true});
        await page.locator('#extensionsMenu').screenshot({path:path.join(root,`tests/output/notebook-menu-${mode}.png`)});
    }
    check(errors.length===0,`no uncaught errors: ${errors.join('; ')}`);
    console.log(`${checks} menu checks passed.`);
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
