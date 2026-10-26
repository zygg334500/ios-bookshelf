/**
 * Load the real sample books into the reader page and require visible glyphs.
 * Needs Google Chrome. Unit tests cover the same strings without a browser.
 */
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const enginePath = resolve(root, 'app/assets/reader/engine.readerhtml');
const pdfJs = readFileSync(resolve(root, 'app/assets/pdfjs/pdf.min.pdfjs'), 'utf8');
const pdfWorker = readFileSync(resolve(root, 'app/assets/pdfjs/pdf.worker.min.pdfjs'), 'utf8');

const extracted = spawnSync(
  'python3',
  [
    '-c',
    `
import json, zipfile
from pathlib import Path
root = Path(${JSON.stringify(root)})
samples = root / "samples"
def chapter(name, inner):
    with zipfile.ZipFile(samples / name) as archive:
        return archive.read(inner).decode("utf-8")
pdf = (samples / "notes.pdf").read_bytes()
print(json.dumps({
    "simplified": chapter("window.epub", "OEBPS/c1.xhtml"),
    "traditional": chapter("vertical-traditional.epub", "OEBPS/c1.xhtml"),
    "pdf": pdf.hex(),
}))
`,
  ],
  { encoding: 'utf8' },
);
if (extracted.status !== 0) {
  console.error(extracted.stderr || extracted.stdout);
  process.exit(1);
}
const books = JSON.parse(extracted.stdout);
const html = readFileSync(enginePath, 'utf8')
  .replace('___BOOKSHELF_PDFJS___', pdfJs.replace(/<\/script/gi, '<\\/script'))
  .replace('___BOOKSHELF_PDFWORKER___', pdfWorker.replace(/<\/script/gi, '<\\/script'));
const pagePath = '/tmp/bookshelf-reader-check.html';
writeFileSync(pagePath, html);

const chromeBin = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'].find((name) => {
  const found = spawnSync('bash', ['-lc', `command -v ${name}`], { encoding: 'utf8' });
  return found.status === 0 && found.stdout.trim();
});
if (!chromeBin) {
  console.error('没有找到 Chrome，跳过屏幕核对。npm test 仍会检查示例正文。');
  process.exit(2);
}

const chrome = spawn(chromeBin, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--user-data-dir=/tmp/bookshelf-glyph-chrome',
  '--remote-debugging-port=9224',
  '--window-size=390,844',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

async function waitVersion() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch('http://127.0.0.1:9224/json/version');
      if (response.ok) return response.json();
    } catch {
      await sleep(150);
    }
  }
  throw new Error('Chrome 调试端口没有起来。');
}

const version = await waitVersion();
const browser = new WebSocket(version.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;
const send = (method, params = {}, sessionId) => {
  const id = nextId++;
  const payload = { id, method, params };
  if (sessionId) payload.sessionId = sessionId;
  browser.send(JSON.stringify(payload));
  return new Promise((resolveSend, rejectSend) => pending.set(id, { resolve: resolveSend, reject: rejectSend }));
};
await new Promise((resolveOpen, rejectOpen) => {
  browser.addEventListener('open', resolveOpen);
  browser.addEventListener('error', rejectOpen);
});
browser.addEventListener('message', (event) => {
  const data = JSON.parse(event.data);
  if (!data.id || !pending.has(data.id)) return;
  const waiter = pending.get(data.id);
  pending.delete(data.id);
  if (data.error) waiter.reject(new Error(JSON.stringify(data.error)));
  else waiter.resolve(data.result);
});

const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
await send('Page.enable', {}, sessionId);
await send('Runtime.enable', {}, sessionId);
await send('Page.navigate', { url: `file://${pagePath}` }, sessionId);
await sleep(600);

async function show(settings, chapterHtml) {
  await send('Runtime.evaluate', {
    expression: `window.postMessage(${JSON.stringify(JSON.stringify({
      type: 'load',
      settings,
      position: { chapterIndex: 0, pageIndex: 0 },
      book: { kind: 'html', chapters: [{ title: '样本', html: chapterHtml, styles: '' }] },
    }))}, '*'); true`,
  }, sessionId);
  await sleep(350);
  const evaluated = await send('Runtime.evaluate', {
    expression: `(() => {
      const front = document.getElementById('front-html');
      const paragraph = front && front.querySelector('p,h1');
      const style = paragraph ? getComputedStyle(paragraph) : null;
      return JSON.stringify({
        text: ((front && front.innerText) || '').replace(/\\s+/g, ''),
        color: style && style.color,
        vertical: document.getElementById('leaf').classList.contains('vertical'),
        status: document.getElementById('status').style.display
      });
    })()`,
    returnByValue: true,
  }, sessionId);
  if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.text);
  return JSON.parse(evaluated.result.value);
}

const base = { fontId: 'songti', fontSize: 20, theme: 'sepia', verticalTraditional: false, brightness: 1 };
const simplified = await show(base, books.simplified);
const firstShot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('/opt/cursor/artifacts/reader-chinese.png', Buffer.from(firstShot.data, 'base64'));
await send('Runtime.evaluate', {
  expression: `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })); true`,
}, sessionId);
await sleep(700);
const turned = await send('Runtime.evaluate', {
  expression: `JSON.stringify({ text: (document.getElementById('front-html').innerText || '').replace(/\\s+/g, ''), status: document.getElementById('status').style.display })`,
  returnByValue: true,
}, sessionId);
const turnedPage = JSON.parse(turned.result.value);
const vertical = await show({ ...base, verticalTraditional: true }, books.traditional);
const verticalShot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('/opt/cursor/artifacts/reader-vertical-sample.png', Buffer.from(verticalShot.data, 'base64'));

await send('Runtime.evaluate', {
  expression: `window.postMessage(${JSON.stringify(JSON.stringify({
    type: 'load',
    settings: base,
    position: { chapterIndex: 0, pageIndex: 0 },
    book: { kind: 'pdf', pdfBase64: Buffer.from(books.pdf, 'hex').toString('base64') },
  }))}, '*'); true`,
}, sessionId);
await sleep(1200);
const pdf = await send('Runtime.evaluate', {
  expression: `(() => {
    const canvas = document.getElementById('front-canvas');
    const ctx = canvas.getContext('2d');
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      if (pixels[i] < 250 || pixels[i + 1] < 250 || pixels[i + 2] < 250) ink += 1;
    }
    return JSON.stringify({
      status: document.getElementById('status').style.display,
      ink,
      width: canvas.width,
      hiddenHtml: document.getElementById('front-html').hidden
    });
  })()`,
  returnByValue: true,
}, sessionId);
const pdfResult = JSON.parse(pdf.result.value);
const shot = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
writeFileSync('/opt/cursor/artifacts/reader-english-pdf.png', Buffer.from(shot.data, 'base64'));

function fail(message) {
  console.error(message);
  console.error(JSON.stringify({ simplified, vertical, pdf: pdfResult }, null, 2));
  browser.close();
  chrome.kill('SIGKILL');
  process.exit(1);
}

if (!simplified.text.includes('雨下到后半夜') || simplified.status !== 'none' || simplified.color === 'rgb(255, 255, 255)') {
  fail('简体 EPUB 没有画出正文。');
}
if (!turnedPage.text || turnedPage.status !== 'none' || turnedPage.text === simplified.text) {
  fail('翻页后正文不见了，或页面没有翻过去。');
}
if (!vertical.text.includes('窗下有雨') || !vertical.vertical || vertical.status !== 'none') {
  fail('竖排繁体没有画出正文。');
}
if (pdfResult.status !== 'none' || pdfResult.ink < 20 || !pdfResult.hiddenHtml) {
  fail('英文 PDF 没有画到页面上。');
}

console.log(JSON.stringify({
  simplified: simplified.text.slice(0, 24),
  vertical: vertical.text.slice(0, 24),
  pdfInk: pdfResult.ink,
}, null, 2));
browser.close();
chrome.kill('SIGKILL');
process.exit(0);
