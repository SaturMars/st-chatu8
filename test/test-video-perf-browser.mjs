// 「视频多时卡顿」回归：在真实 Chrome 里验证聊天视频的三处改动，全部用 index.js 里的真实实现。
//   1) 读库转 data URL 不再逐字节拼字符串（结果逐字节不变，主线程最长阻塞大幅下降）；
//      fixMp4Faststart 解析不再整份复制（输出逐字节不变）。
//   2) 只播放看得见的视频：滚出视口暂停、滚回来续播；用户按过暂停的不续播；开了声音的滚走也不停。
//   3) 楼层重绘丢掉的视频元素，blob URL 会被释放；短暂搬动的不误收；iframe 被移除也算丢掉。
// 测试视频由页面里的 MediaRecorder 现录，不依赖外部素材。
// 用法：node test/test-video-perf-browser.mjs（可用 CHROME 环境变量指定浏览器路径）
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = [
  process.env.CHROME,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find((p) => p && existsSync(p));
if (!CHROME) throw new Error('找不到 Chrome，请用 CHROME 环境变量指定');

const src = readFileSync(new URL('../index.js', import.meta.url), 'utf8');
function extract(signature) {
  const start = src.indexOf(signature);
  if (start === -1) throw new Error(`未在 index.js 中找到 ${signature}`);
  let depth = 0;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error(`未能定界 ${signature}`);
}
function extractVar(name) {
  const m = new RegExp(`^var ${name} = .*;$`, 'm').exec(src);
  if (!m) throw new Error(`未在 index.js 中找到 var ${name}`);
  return m[0];
}
const realCode = [
  extractVar('chatVideoObservers'),
  extractVar('chatVideoBlobUrls'),
  extractVar('chatVideoSweepTimer'),
  extractVar('CHAT_VIDEO_SWEEP_INTERVAL_MS'),
  extractVar('CHAT_VIDEO_BLOB_RELEASE_MS'),
  extract('function arrayBufferToBase64('),
  extract('function blobToBase64('),
  extract('async function arrayBufferToDataUrlAsync('),
  extract('async function _dataUrlToBlob('),
  extract('function _addToStcoOffsets('),
  extract('async function fixMp4Faststart('),
  extract('function getChatVideoObserver('),
  extract('function playChatVideoIfAllowed('),
  extract('function pauseChatVideoOffscreen('),
  extract('function setupChatVideoPlayback('),
  extract('function trackChatVideoBlobUrl('),
  extract('function isChatVideoAttached('),
  extract('function sweepDetachedChatVideos('),
  extract('function createAndShowImage('),
  extract('async function applyVideoSrc('),
].join('\n');

// 修复前的实现，原样保留作对照（输出必须逐字节一致、阻塞必须明显更长）。
const legacyCode = String.raw`
function legacyArrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}
async function legacyFixMp4Faststart(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const boxes = [];
  let pos = 0;
  while (pos + 8 <= bytes.length) {
    let size = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    if (size === 0) size = bytes.length - pos;
    if (size < 8) break;
    boxes.push({ type, size, data: bytes.slice(pos, pos + size) });
    pos += size;
  }
  const moovIdx = boxes.findIndex((b) => b.type === "moov");
  const mdatIdx = boxes.findIndex((b) => b.type === "mdat");
  if (moovIdx === -1 || mdatIdx === -1 || moovIdx < mdatIdx) return blob;
  const moovBox = boxes[moovIdx];
  const moovData = moovBox.data.slice();
  _addToStcoOffsets(moovData, 8, moovBox.size, moovBox.size);
  const parts = [];
  for (let i = 0; i < boxes.length; i++) {
    if (i === moovIdx) continue;
    if (i === mdatIdx) parts.push(moovData);
    parts.push(boxes[i].data);
  }
  return new Blob(parts, { type: "video/mp4" });
}
`;

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0} .floor{height:700px;border-bottom:1px solid #ccc} .floor video{width:320px;height:180px}</style>
</head><body><div id="chat"></div><pre id="result">PENDING</pre>
<script>
var extensionName = 'st-chatu8';
var extension_settings40 = { 'st-chatu8': { dbclike: 'false', clickToPreview: 'false', longPressToEdit: 'false', collapseImage: 'false' } };
var _showImagePreview = null;
function showEditDialog() {}
function addSmoothShakeEffect() {}
function triggerGeneration() {}
${realCode}
${legacyCode}
const out = [];
const push = (name, ok, detail) => out.push({ name, ok: !!ok, detail: detail || '' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(50); }
  return fn();
}
function randomBytes(n, seed) {
  const b = new Uint8Array(n);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < n; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; b[i] = x & 255; }
  return b;
}
async function blobBytes(blob) { return new Uint8Array(await blob.arrayBuffer()); }
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
// 手搭 MP4 盒结构：ftyp + mdat + moov(trak/mdia/minf/stbl/stco|co64)，moov 在 mdat 之后。
function box(type, ...payloads) {
  const len = 8 + payloads.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(len);
  new DataView(out.buffer).setUint32(0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let pos = 8;
  for (const p of payloads) { out.set(p, pos); pos += p.length; }
  return out;
}
function u32s(...vals) { const b = new Uint8Array(vals.length * 4); const v = new DataView(b.buffer); vals.forEach((x, i) => v.setUint32(i * 4, x)); return b; }
function buildMp4(moovFirst, use64) {
  const ftyp = box('ftyp', new TextEncoder().encode('isom\\0\\0\\0\\0isomavc1'));
  const mdat = box('mdat', randomBytes(50000, 7));
  const table = use64
    ? box('co64', u32s(0, 3, 0, 40, 0, 20040, 0, 40040))
    : box('stco', u32s(0, 3, 40, 20040, 40040));
  const moov = box('moov', box('mvhd', randomBytes(100, 3)), box('trak', box('mdia', box('minf', box('stbl', table)))));
  const parts = moovFirst ? [ftyp, moov, mdat] : [ftyp, mdat, moov];
  return new Blob(parts, { type: 'video/mp4' });
}
async function recordTestVideo() {
  const canvas = document.createElement('canvas');
  canvas.width = 160; canvas.height = 90;
  const ctx = canvas.getContext('2d');
  const stream = canvas.captureStream(30);
  const mime = ['video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m));
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  let frame = 0;
  const timer = setInterval(() => { ctx.fillStyle = 'hsl(' + (frame++ * 12) + ',80%,50%)'; ctx.fillRect(0, 0, 160, 90); }, 33);
  rec.start(100);
  await sleep(1500);
  rec.stop();
  await new Promise((r) => { rec.onstop = r; });
  clearInterval(timer);
  return new Blob(chunks, { type: 'video/webm' });
}
// 最长主线程阻塞：16ms 心跳的最大间隔。
function startJankMeter() {
  let last = performance.now(), max = 0;
  const id = setInterval(() => { const now = performance.now(); max = Math.max(max, now - last); last = now; }, 16);
  return () => { clearInterval(id); return Math.round(Math.max(max, performance.now() - last)); };
}
const floors = [];
function addFloor(doc = document, host = document.getElementById('chat')) {
  const f = doc.createElement('div');
  f.className = 'floor';
  const span = doc.createElement('span');
  f.appendChild(span);
  host.appendChild(f);
  return { floor: f, span };
}
const videoOf = (f) => f.span.querySelector('video');
async function blobAlive(url) { try { await (await fetch(url)).arrayBuffer(); return true; } catch (e) { return false; } }

async function run() {
  try {
    // ---------- 1) 转码：结果逐字节不变 ----------
    let mismatch = [];
    for (const n of [0, 1, 2, 3, 32767, 32768, 32769, 65537, 1048583]) {
      const bytes = randomBytes(n, n + 1);
      const ref = legacyArrayBufferToBase64(bytes.buffer);
      if (arrayBufferToBase64(bytes.buffer) !== ref) mismatch.push('sync@' + n);
      if (await arrayBufferToDataUrlAsync(bytes.buffer, 'video/mp4') !== 'data:video/mp4;base64,' + ref) mismatch.push('async@' + n);
    }
    push('arrayBufferToBase64 / arrayBufferToDataUrlAsync 与修复前逐字节一致', mismatch.length === 0, mismatch.join(','));

    for (const [label, moovFirst, use64] of [['moov 在后 + stco', false, false], ['moov 在后 + co64', false, true], ['已是 faststart', true, false]]) {
      const input = buildMp4(moovFirst, use64);
      const a = await blobBytes(await legacyFixMp4Faststart(input));
      const b = await blobBytes(await fixMp4Faststart(input));
      push('fixMp4Faststart 输出与修复前一致：' + label, sameBytes(a, b), 'len ' + a.length + ' vs ' + b.length);
    }

    // ---------- 1b) 主线程阻塞：模拟打开一个有 6 个 6MB 视频的聊天 ----------
    const big = [];
    for (let i = 0; i < 6; i++) big.push(randomBytes(6 * 1024 * 1024, 100 + i).buffer);
    let stop = startJankMeter();
    await Promise.all(big.map(async (buf) => {
      await sleep(0);
      const dataUrl = 'data:video/mp4;base64,' + legacyArrayBufferToBase64(buf);
      await legacyFixMp4Faststart(await _dataUrlToBlob(dataUrl));
    }));
    const legacyJank = stop();
    stop = startJankMeter();
    await Promise.all(big.map(async (buf) => {
      await sleep(0);
      const dataUrl = await arrayBufferToDataUrlAsync(buf, 'video/mp4');
      await fixMp4Faststart(await _dataUrlToBlob(dataUrl));
    }));
    const newJank = stop();
    push('6×6MB 视频上屏的最长主线程阻塞明显下降', newJank * 3 < legacyJank, '修复前 ' + legacyJank + 'ms → 修复后 ' + newJank + 'ms');

    // ---------- 2) 只播放看得见的 ----------
    const videoBlob = await recordTestVideo();
    const videoDataUrl = await blobToBase64(videoBlob);
    push('测试视频录制成功', videoBlob.size > 1000, videoBlob.size + ' bytes');
    for (let i = 0; i < 10; i++) floors.push(addFloor());
    for (const f of floors) createAndShowImage(f.span, videoDataUrl, 'x', null, '', true, '');
    await waitFor(() => floors.every((f) => videoOf(f)?.getAttribute('src')?.startsWith('blob:')));
    push('视频都换成了 blob URL 并登记待回收', chatVideoBlobUrls.size === 10, 'tracked=' + chatVideoBlobUrls.size);
    push('不再设置 autoplay', floors.every((f) => !videoOf(f).autoplay));

    const playing = () => floors.map((f, i) => (videoOf(f) && !videoOf(f).paused ? i : -1)).filter((i) => i >= 0);
    await waitFor(() => playing().length === 1 && playing()[0] === 0);
    push('首屏只有可见的第 1 个视频在播', JSON.stringify(playing()) === '[0]', 'playing=' + JSON.stringify(playing()));

    window.scrollTo(0, 700 * 5);
    await waitFor(() => JSON.stringify(playing()) === '[5]');
    push('滚动后：新进入视口的开播，滚出去的暂停', JSON.stringify(playing()) === '[5]', 'playing=' + JSON.stringify(playing()));
    push('被自动暂停的不算用户暂停', videoOf(floors[0]).dataset.userPaused === undefined);

    window.scrollTo(0, 0);
    await waitFor(() => JSON.stringify(playing()) === '[0]');
    push('滚回来自动续播', JSON.stringify(playing()) === '[0]', 'playing=' + JSON.stringify(playing()));

    // 用户在视口内手动暂停 → 滚走再滚回也不自动续播
    videoOf(floors[0]).pause();
    await waitFor(() => videoOf(floors[0]).dataset.userPaused === 'true');
    window.scrollTo(0, 700 * 3);
    await sleep(400);
    window.scrollTo(0, 0);
    await sleep(600);
    push('用户按过暂停的，回到视口不自动续播', videoOf(floors[0]).paused && videoOf(floors[0]).dataset.userPaused === 'true');
    // 用户再点播放 → 恢复正常托管
    await videoOf(floors[0]).play();
    await waitFor(() => videoOf(floors[0]).dataset.userPaused === undefined);
    push('用户重新播放后标记清除', !videoOf(floors[0]).paused && videoOf(floors[0]).dataset.userPaused === undefined);

    // 开了声音的视频滚出视口也不停（用户在听）
    videoOf(floors[0]).muted = false;
    window.scrollTo(0, 700 * 6);
    await waitFor(() => JSON.stringify(playing()) === '[0,6]');
    push('开了声音的视频滚出视口继续播放', !videoOf(floors[0]).paused, 'playing=' + JSON.stringify(playing()));
    videoOf(floors[0]).muted = true;
    window.scrollTo(0, 0);
    await waitFor(() => JSON.stringify(playing()) === '[0]');

    // 预览里切换同类型视频走 applyVideoSrc：旧 blob 换上新的之后释放，新 blob 登记，可见的继续播。
    const v0 = videoOf(floors[0]);
    const oldUrl = v0.getAttribute('src');
    await applyVideoSrc(v0, videoDataUrl, '');
    const newUrl = v0.getAttribute('src');
    push('applyVideoSrc 换上新 blob 并登记', newUrl !== oldUrl && chatVideoBlobUrls.get(v0)?.url === newUrl);
    push('applyVideoSrc 释放旧 blob', !(await blobAlive(oldUrl)) && (await blobAlive(newUrl)));
    await waitFor(() => !v0.paused);
    push('applyVideoSrc 之后可见视频继续播放', !v0.paused);

    // ---------- 3) blob 回收 ----------
    const removed = floors.slice(6, 9);
    const removedUrls = removed.map((f) => videoOf(f).getAttribute('src'));
    removed.forEach((f) => f.floor.remove());
    // 短暂搬动：摘下后在两次扫描之间又放回去
    const moved = floors[9];
    moved.floor.remove();
    const now = Date.now();
    const first = sweepDetachedChatVideos(now);
    document.getElementById('chat').appendChild(moved.floor);
    const second = sweepDetachedChatVideos(now + CHAT_VIDEO_BLOB_RELEASE_MS + 1000);
    push('脱离文档的视频第一次扫描只做标记', first === 0, 'released=' + first);
    push('持续脱离超过阈值才释放，短暂搬动的不收', second === 3, 'released=' + second);
    const aliveAfter = await Promise.all(removedUrls.map(blobAlive));
    push('被丢掉的视频 blob 已释放', aliveAfter.every((x) => !x), JSON.stringify(aliveAfter));
    push('仍在页面上的视频 blob 完好', await blobAlive(videoOf(moved).getAttribute('src')) && await blobAlive(videoOf(floors[1]).getAttribute('src')));
    push('释放的元素卸掉了数据源', removed.every((f) => !videoOf(f).getAttribute('src')));

    // iframe 被整个移除：里面的元素 isConnected 仍为 true，也要能识别为丢掉
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const idoc = iframe.contentDocument;
    idoc.open(); idoc.write('<!doctype html><body></body>'); idoc.close();
    const fi = addFloor(idoc, idoc.body);
    createAndShowImage(fi.span, videoDataUrl, 'x', null, '', true, '');
    await waitFor(() => videoOf(fi)?.getAttribute('src')?.startsWith('blob:'));
    const iframeUrl = videoOf(fi).getAttribute('src');
    const iframeVideo = videoOf(fi);
    iframe.remove();
    const t2 = Date.now();
    sweepDetachedChatVideos(t2);
    const r2 = sweepDetachedChatVideos(t2 + CHAT_VIDEO_BLOB_RELEASE_MS + 1000);
    push('iframe 被移除后其中的视频 blob 也被释放', r2 === 1 && !chatVideoBlobUrls.has(iframeVideo) && !(await blobAlive(iframeUrl)), 'released=' + r2);
  } catch (e) {
    push('测试自身异常', false, (e && (e.stack || e.message)) || String(e));
  }
  document.getElementById('result').textContent = JSON.stringify(out);
  try { await fetch('/result', { method: 'POST', body: JSON.stringify(out) }); } catch (e) {}
}
run();
</script></body></html>`;

let resolveResult;
const resultPromise = new Promise((r) => { resolveResult = r; });
const server = createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/result') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.writeHead(204).end();
      try { resolveResult(JSON.parse(body)); } catch (e) { resolveResult([{ name: '结果解析失败', ok: false, detail: body.slice(0, 300) }]); }
    });
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const profile = mkdtempSync(join(tmpdir(), 'chatu8-video-perf-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--autoplay-policy=no-user-gesture-required', '--window-size=800,600',
  `--user-data-dir=${profile}`, `http://127.0.0.1:${port}/`,
], { stdio: 'ignore' });

const results = await Promise.race([resultPromise, new Promise((r) => setTimeout(() => r(null), 120000))]);
chrome.kill();
server.close();
try { rmSync(profile, { recursive: true, force: true }); } catch (e) {}

if (!results) { console.log('FAIL  浏览器在 120 秒内没有回报结果'); process.exit(1); }
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  — ' + r.detail : ''}`);
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 通过`);
process.exit(failed.length ? 1 : 0);
