// @ts-nocheck
// Import modules
import { extension_settings, extensionTypes } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, reloadCurrentChat, saveChatConditional, chat, messageFormatting, saveChat } from "../../../../script.js";
import { defaultSettings, extensionName, extensionFolderPath } from './utils/config.js';
import { replaceWithSd } from './utils/sd.js';
import { replaceWithnovelai } from './utils/novelai.js';
// import { replaceSpansWithImagesstcomfyui } from './utils/comfyui.js';
import { initUI } from './utils/ui.js';
import { replaceWithBanana } from './utils/banana.js';
import { replaceWithRunningHub } from './utils/runninghub.js';
import { checkSendBuClass } from './utils/utils.js';
import { replaceWithcomfyui } from "./utils/comfyui.js";
import { initializeNewlineFixer } from './utils/newline_fix.js';
import { } from './utils/settings/stream_generate.js';
import { installGlobalErrorHandler } from './utils/errorCollector.js';
import { initImageGenStatsListener } from './utils/imageGenStats.js';
import { initializeTTS } from './utils/tts.js';
import { initializeASR } from './utils/asr.js';
import { migrateToolAndTailConfigIfOldDefault } from './utils/settings/defaultToolCallConfig.js';
import { ensureInjectionTemplatesInit } from './utils/settings/character/injectionTemplates.js';

let token;

try {
    const tokenResponse = await fetch('/csrf-token');
    const data = await tokenResponse.json();
    token = data.token;

    window.token = token;

} catch (err) {
    console.error('Initialization failed', err);
    throw new Error('Initialization failed');
}


let jszipLoadPromise;
let cryptoLoadPromise;
let msgpackLoadPromise;

function getModuleEnvironmentInfo() {
    return {
        hasDefine: typeof globalThis.define === 'function',
        hasDefineAmd: Boolean(globalThis.define?.amd),
        defineType: typeof globalThis.define,
        hasRequire: typeof globalThis.require === 'function',
        requireType: typeof globalThis.require,
        hasModule: typeof globalThis.module !== 'undefined',
        moduleType: typeof globalThis.module,
        hasExports: typeof globalThis.exports !== 'undefined',
        exportsType: typeof globalThis.exports,
    };
}

async function loadJSZipIsolated(scriptSrc) {
    return loadIsolatedUmdLibrary(scriptSrc, 'JSZip');
}

async function loadIsolatedUmdLibrary(scriptSrc, globalName) {
    const absoluteScriptSrc = new URL(scriptSrc, window.location.href).href;
    const response = await fetch(absoluteScriptSrc, { cache: 'no-cache' });
    if (!response.ok) {
        throw new Error(`[st-chatu8] Failed to fetch ${globalName} source: ${response.status} ${response.statusText}`);
    }

    const source = await response.text();
    const isolatedGlobal = {};
    isolatedGlobal.window = isolatedGlobal;
    isolatedGlobal.global = isolatedGlobal;
    isolatedGlobal.self = isolatedGlobal;
    isolatedGlobal.globalThis = isolatedGlobal;

    const isolatedLoader = new Function(
        'window',
        'global',
        'self',
        'globalThis',
        'define',
        'module',
        'exports',
        `${source}\nreturn this[${JSON.stringify(globalName)}] || window[${JSON.stringify(globalName)}] || globalThis[${JSON.stringify(globalName)}] || self[${JSON.stringify(globalName)}] || global[${JSON.stringify(globalName)}];`,
    );

    const library = isolatedLoader.call(
        isolatedGlobal,
        isolatedGlobal,
        isolatedGlobal,
        isolatedGlobal,
        isolatedGlobal,
        undefined,
        undefined,
        undefined,
    );

    if (typeof library === 'undefined') {
        throw new Error(`[st-chatu8] Isolated ${globalName} evaluation completed but no library was returned`);
    }

    return library;
}

function loadJSZip() {
    if (typeof window.stChatu8JSZip === 'function') {
        return Promise.resolve(window.stChatu8JSZip);
    }

    if (jszipLoadPromise) {
        return jszipLoadPromise;
    }

    const scriptSrc = `${extensionFolderPath}/jszip.min.js`;
    jszipLoadPromise = loadJSZipIsolated(scriptSrc).then(jszipConstructor => {
        window.stChatu8JSZip = jszipConstructor;
        if (typeof window.JSZip !== 'function') {
            window.JSZip = jszipConstructor;
        }
        return jszipConstructor;
    }).catch(error => {
        console.error('[st-chatu8] JSZip isolated load failed', {
            error,
            scriptSrc,
            environment: getModuleEnvironmentInfo(),
        });
        jszipLoadPromise = undefined;
        throw error;
    });

    return jszipLoadPromise;
}

function loadcrypto() {
    if (typeof window.stChatu8CryptoJS !== 'undefined') {
        return Promise.resolve(window.stChatu8CryptoJS);
    }

    if (typeof window.CryptoJS !== 'undefined') {
        window.stChatu8CryptoJS = window.CryptoJS;
        return Promise.resolve(window.stChatu8CryptoJS);
    }

    if (cryptoLoadPromise) {
        return cryptoLoadPromise;
    }

    const scriptSrc = `${extensionFolderPath}/crypto-js.min.js`;
    cryptoLoadPromise = loadIsolatedUmdLibrary(scriptSrc, 'CryptoJS').then(cryptoJs => {
        window.stChatu8CryptoJS = cryptoJs;
        if (typeof window.CryptoJS === 'undefined') {
            window.CryptoJS = cryptoJs;
        }
        return cryptoJs;
    }).catch(error => {
        console.error('[st-chatu8] CryptoJS isolated load failed', {
            error,
            scriptSrc,
            environment: getModuleEnvironmentInfo(),
        });
        cryptoLoadPromise = undefined;
        throw error;
    });

    return cryptoLoadPromise;
}

function loadmsgpack() {
    if (typeof window.stChatu8MessagePack !== 'undefined') {
        return Promise.resolve(window.stChatu8MessagePack);
    }

    if (typeof window.MessagePack !== 'undefined') {
        window.stChatu8MessagePack = window.MessagePack;
        return Promise.resolve(window.stChatu8MessagePack);
    }

    if (msgpackLoadPromise) {
        return msgpackLoadPromise;
    }

    const scriptSrc = `${extensionFolderPath}/msgpack.min.js`;
    msgpackLoadPromise = loadIsolatedUmdLibrary(scriptSrc, 'MessagePack').then(messagePack => {
        window.stChatu8MessagePack = messagePack;
        if (typeof window.MessagePack === 'undefined') {
            window.MessagePack = messagePack;
        }
        return messagePack;
    }).catch(error => {
        console.error('[st-chatu8] MessagePack isolated load failed', {
            error,
            scriptSrc,
            environment: getModuleEnvironmentInfo(),
        });
        msgpackLoadPromise = undefined;
        throw error;
    });

    return msgpackLoadPromise;
}
window.loadmsgpack = loadmsgpack;

function getRequestHeaders(token) {
    return {
        'X-CSRF-Token': token,
        'Content-Type': 'application/json',
    };
}

function getExtensionType(externalId) {
    const id = Object.keys(extensionTypes).find(
        (id) => id === externalId || (id.startsWith('third-party') && id.endsWith(externalId)),
    );
    return id ? extensionTypes[id] : 'local';
}

async function update_extension(extensionname, global) {
    // 每次请求前重新获取一次 csrf token，避免 token 过期/失效导致更新失败
    let freshToken = window.token || token;
    try {
        const tokenResponse = await fetch('/csrf-token');
        if (tokenResponse.ok) {
            const data = await tokenResponse.json();
            if (data && data.token) {
                freshToken = data.token;
                window.token = freshToken;
            }
        }
    } catch (e) {
        // 忽略，使用缓存的 token
    }

    const response = await fetch('/api/extensions/update', {
        method: 'POST',
        headers: getRequestHeaders(freshToken),
        body: JSON.stringify({ extensionName: extensionname, global }),
    });
    return response;
}

// 比较两个版本号，a > b 返回正数，相等返回 0，a < b 返回负数
function compareVersion(a, b) {
    if (!a || !b) return 0;
    const pa = String(a).replace(/^v\.?/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const pb = String(b).replace(/^v\.?/i, '').split('.').map(n => parseInt(n, 10) || 0);
    const len = Math.max(pa.length, pb.length);
    for (let i = 0; i < len; i++) {
        const x = pa[i] || 0;
        const y = pb[i] || 0;
        if (x !== y) return x - y;
    }
    return 0;
}

function setUpdateStatus(text, cls) {
    const el = document.getElementById('ch-update-status');
    if (el) {
        el.textContent = text;
        el.className = `st-chatu8-update-status ${cls || ''}`.trim();
    }
}

const REINSTALL_GIT_URL = 'https://github.com/damoshen123/st-chatu8.git';

function showReinstallGuide(reason) {
    // 避免重复弹出
    const existing = document.getElementById('st-chatu8-reinstall-guide');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'st-chatu8-reinstall-guide';
    overlay.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:100000',
        'background:rgba(0,0,0,0.6)',
        'display:flex', 'align-items:center', 'justify-content:center',
        'font-family:inherit',
    ].join(';');

    const safeReason = reason
        ? String(reason).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
        : '';

    overlay.innerHTML = `
        <div style="background:var(--SmartThemeBlurTintColor, #1f2128); color:var(--SmartThemeBodyColor, #eee);
                    border:1px solid var(--SmartThemeBorderColor, #444); border-radius:10px;
                    width:min(560px, 92vw); max-height:85vh; overflow:auto;
                    box-shadow:0 10px 40px rgba(0,0,0,0.5); padding:18px 20px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px;">
                <h3 style="margin:0; font-size:18px;">⚠️ 自动更新失败，请手动重装</h3>
                <button id="st-chatu8-reinstall-close" title="关闭"
                        style="background:transparent; border:none; color:inherit; font-size:20px; cursor:pointer; line-height:1;">×</button>
            </div>
            ${safeReason ? `<div style="opacity:.85; font-size:13px; margin-bottom:10px;">原因：${safeReason}</div>` : ''}
            <div style="font-size:14px; line-height:1.7;">
                <p style="margin:6px 0;">请按以下步骤手动重新安装本插件（<b>不会丢失你的设置</b>）：</p>
                <ol style="padding-left:22px; margin:8px 0;">
                    <li>点击酒馆<b>右上角的小箱子图标</b>（扩展 / Extensions）。</li>
                    <li>点击里面的「<b>管理插件</b>」（Manage extensions）。</li>
                    <li>找到 <code>st-chatu8</code>，点击其右侧的<b>删除</b>按钮卸载。</li>
                    <li>回到扩展面板，点击「<b>安装扩展</b>」（Install extension），粘贴下面的安装地址并确认安装：</li>
                </ol>
                <p style="margin:8px 0; padding:8px 10px; border-radius:6px;
                          background:rgba(255, 193, 7, 0.12); border:1px solid rgba(255, 193, 7, 0.45);
                          font-size:13px;">
                    ⏳ <b>安装过程需要等待</b>，完成后会<b>自动刷新页面</b>。<br>
                    请<b>不要手动刷新页面</b>，否则会导致安装失败。
                </p>
                <div style="display:flex; gap:8px; align-items:stretch; margin:10px 0;">
                    <input id="st-chatu8-reinstall-url" type="text" readonly
                           value="${REINSTALL_GIT_URL}"
                           style="flex:1; padding:8px 10px; border-radius:6px; border:1px solid var(--SmartThemeBorderColor, #555);
                                  background:rgba(255,255,255,0.06); color:inherit; font-family:monospace; font-size:13px;" />
                    <button id="st-chatu8-reinstall-copy"
                            style="padding:8px 14px; border-radius:6px; border:1px solid var(--SmartThemeBorderColor, #555);
                                   background:var(--SmartThemeQuoteColor, #4a90e2); color:#fff; cursor:pointer; white-space:nowrap;">
                        📋 复制地址
                    </button>
                </div>
            </div>
            <div style="display:flex; justify-content:flex-end; margin-top:14px;">
                <button id="st-chatu8-reinstall-ok"
                        style="padding:8px 18px; border-radius:6px; border:1px solid var(--SmartThemeBorderColor, #555);
                               background:transparent; color:inherit; cursor:pointer;">我知道了</button>
            </div>
        </div>
    `;

    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    overlay.querySelector('#st-chatu8-reinstall-close').addEventListener('click', close);
    overlay.querySelector('#st-chatu8-reinstall-ok').addEventListener('click', close);

    const copyBtn = overlay.querySelector('#st-chatu8-reinstall-copy');
    const urlInput = overlay.querySelector('#st-chatu8-reinstall-url');
    copyBtn.addEventListener('click', async () => {
        const text = REINSTALL_GIT_URL;
        let ok = false;
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                ok = true;
            }
        } catch (_) { /* fallback below */ }
        if (!ok) {
            try {
                const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
                    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
                const prevContentEditable = urlInput.contentEditable;
                const prevReadOnly = urlInput.readOnly;
                // iOS Safari 对 readonly + select() 不会真的选中，需要临时关掉 readonly 并设为可编辑
                urlInput.removeAttribute('readonly');
                if (isIOS) {
                    urlInput.contentEditable = 'true';
                    urlInput.readOnly = false;
                    const range = document.createRange();
                    range.selectNodeContents(urlInput);
                    const sel = window.getSelection();
                    sel?.removeAllRanges();
                    sel?.addRange(range);
                    urlInput.setSelectionRange(0, text.length);
                } else {
                    urlInput.focus();
                    urlInput.select();
                    urlInput.setSelectionRange(0, text.length);
                }
                ok = document.execCommand('copy');
                urlInput.contentEditable = prevContentEditable;
                urlInput.readOnly = prevReadOnly;
                urlInput.setAttribute('readonly', 'readonly');
                window.getSelection()?.removeAllRanges();
            } catch (_) { ok = false; }
        }
        // 兜底：实在复制不了，至少把内容选中让用户手动复制
        if (!ok) {
            try {
                urlInput.focus();
                urlInput.setSelectionRange(0, text.length);
            } catch (_) { /* ignore */ }
        }
        copyBtn.textContent = ok ? '✅ 已复制' : '❌ 复制失败';
        if (ok && typeof toastr !== 'undefined') {
            try { toastr.success('安装地址已复制到剪贴板'); } catch (_) { }
        }
        setTimeout(() => { copyBtn.textContent = '📋 复制地址'; }, 2000);
    });
}

async function check_update() {
    const type = getExtensionType(extensionName);
    const global = type === 'global';

    const reload = () => {
        toastr.success(`成功更新插件，4 秒后自动刷新页面`);
        console.log(`成功更新插件`);
        setUpdateStatus('✅ 更新成功，正在刷新页面...', 'uptodate');
        setTimeout(() => location.reload(), 4000);
    };

    let update_response;
    try {
        update_response = await update_extension(extensionName, global);
    } catch (err) {
        console.error('调用更新接口失败：', err);
        toastr.error(`无法连接到酒馆更新接口：${err && err.message ? err.message : err}`, '更新失败');
        setUpdateStatus('❌ 无法连接到酒馆更新接口', 'error');
        showReinstallGuide(`无法连接到酒馆更新接口：${err && err.message ? err.message : err}`);
        return false;
    }

    // 服务端返回非 2xx：暴露具体错误信息，便于排查
    if (!update_response.ok) {
        let errText = '';
        try { errText = await update_response.text(); } catch (_) { }
        const status = update_response.status;
        console.error(`更新失败 ${status}:`, errText);

        if (status === 403) {
            toastr.error('当前用户没有更新全局插件的权限，请使用管理员账号登录后再试。', '更新失败');
            setUpdateStatus('❌ 没有更新权限（需要管理员）', 'error');
            showReinstallGuide('当前用户没有更新全局插件的权限（需要管理员账号）。');
        } else if (status === 404) {
            toastr.error('未找到插件目录。请确认插件是通过"安装扩展"按钮（git clone）安装的，而不是手动复制粘贴文件夹。', '更新失败');
            setUpdateStatus('❌ 插件目录不存在或不是 Git 仓库', 'error');
            showReinstallGuide('未找到插件目录，或当前安装方式不是通过 git 克隆。');
        } else if (status === 500) {
            toastr.error(
                '酒馆后端 git 操作失败，可能原因：\n' +
                '1. 无法访问 GitHub（请检查网络/代理）\n' +
                '2. 插件目录不是 git 仓库（用 ZIP 解压安装会出现）\n' +
                '3. 本地有未提交的修改导致无法 pull\n' +
                '建议：手动删除插件后通过"安装扩展"重新安装。',
                '更新失败',
                { timeOut: 12000, extendedTimeOut: 6000 }
            );
            setUpdateStatus('❌ 服务端 git 更新失败，请查看控制台/日志', 'error');
            showReinstallGuide('酒馆后端 git 更新失败（网络/仓库状态/权限问题）。');
        } else {
            toastr.error(`更新失败 (${status}): ${errText || update_response.statusText}`, '更新失败');
            setUpdateStatus(`❌ 更新失败 (${status})`, 'error');
            showReinstallGuide(`更新失败 (${status})：${errText || update_response.statusText || ''}`);
        }
        return false;
    }

    let result;
    try {
        result = await update_response.json();
    } catch (e) {
        console.error('解析更新响应失败：', e);
        toastr.error('更新响应解析失败', '更新失败');
        setUpdateStatus('❌ 更新响应解析失败', 'error');
        showReinstallGuide('更新响应解析失败');
        return false;
    }

    if (result.isUpToDate) {
        // git 认为已是最新，但需要和远端 manifest 版本号交叉验证
        // 部分用户的本地仓库 origin 指向了过期的 fork、或 git fetch 因网络问题静默失败，
        // 此时仅靠 git 的判断会误报"已是最新"。
        const local = window.chatu8LocalVersion;
        const remote = window.chatu8RemoteVersion;
        if (local && remote && compareVersion(remote, local) > 0) {
            console.warn(`git 报告已是最新，但 manifest 版本不一致：本地 v${local}，远端 v${remote}`);
            toastr.warning(
                `检测到新版本 v${remote}（当前 v${local}），但酒馆 git 更新未生效。\n` +
                `常见原因：\n` +
                `· 网络无法访问 GitHub（请使用代理后重试）\n` +
                `· 当前插件不是用"安装扩展"按钮安装的，git 拉取无效\n` +
                `· 本地仓库 origin 指向了旧的 fork\n` +
                `建议：删除插件后通过"安装扩展"重新安装最新版本。`,
                '更新未生效',
                { timeOut: 15000, extendedTimeOut: 8000 }
            );
            setUpdateStatus(`⚠️ 检测到新版本 v${remote}，但更新未生效，请手动重装`, 'error');
            showReinstallGuide(`检测到新版本 v${remote}，但 git 更新未生效（当前仍为 v${local}）。`);
            return false;
        }
        toastr.success('插件是最新版本');
        console.log('插件是最新版本');
        setUpdateStatus(`✅ 已是最新版本 v${local || ''}`.trim(), 'uptodate');
        return true;
    }

    reload();
    return true;
}


async function chenk() {
    if (checkSendBuClass()) {
        return;
    }

    replaceWithcomfyui();
    replaceWithBanana();
    replaceWithRunningHub();
    replaceWithnovelai();
    replaceWithSd();
}

// 使用方式
await loadJSZip().then(() => {
    // JSZip 加载完毕，可以使用

    console.log("Initializing..JSZip.");

});
await loadcrypto().then(() => {
    // JSZip 加载完毕，可以使用
    console.log("Initializing..CryptoJS.");

});
// MessagePack 改为按需懒加载，不阻塞首屏扩展加载
if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => { loadmsgpack().catch(() => {}); });
} else {
    setTimeout(() => { loadmsgpack().catch(() => {}); }, 2000);
}
// Global state variables
let ster = "";
window.imagesid = "";
window.xiancheng = true;
let settings;


async function checkForUpdates() {
    // Always try to fetch and display local version first.
    try {
        const localManifestResponse = await fetch(`${extensionFolderPath}/manifest.json?t=${new Date().getTime()}`, { cache: 'no-cache' });
        if (localManifestResponse.ok) {
            const localManifest = await localManifestResponse.json();
            const localVersion = localManifest.version;
            window.chatu8LocalVersion = localVersion;
        } else {
            console.error('Failed to fetch local manifest for version check.');
        }
    } catch (error) {
        console.error('Error fetching local manifest:', error);
    }

    // Now, check for remote updates.
    const updateNotesElement = document.getElementById('ch-update-notes');

    console.log("Checking for updates...", updateNotesElement);
    try {
        // Fetch remote manifest
        const remoteManifestUrl = `https://raw.githubusercontent.com/damoshen123/st-chatu8/master/manifest.json?t=${new Date().getTime()}`;
        const response = await fetch(remoteManifestUrl, { cache: 'no-cache' });
        if (!response.ok) {
            console.error('Failed to fetch remote manifest for update check.');
            if (updateNotesElement) {
                updateNotesElement.textContent = '无法获取最新更新，尝试点击更新按钮，检查更新。';
            }
            window.chatu8UpdateAvailable = false;
            return; // Exit if remote check fails, but local version is already set.
        }
        const remoteManifest = await response.json();
        const remoteVersion = remoteManifest.version;

        // Store remote version for UI
        window.chatu8RemoteVersion = remoteVersion;

        if (updateNotesElement && remoteManifest.updata) {
            // 更新日志会由 update.js 的 displayChangelog 渲染为美化的 HTML
            // 这里仅作为兜底，存储原始数据供后续使用
            updateNotesElement.textContent = remoteManifest.updata;
            // 通知 update.js 重新渲染美化的更新日志
            updateNotesElement.dispatchEvent(new CustomEvent('chatu8-changelog-update', {
                detail: { rawText: remoteManifest.updata, currentVersion: window.chatu8LocalVersion }
            }));
        }

        // Compare versions if local version is available
        if (window.chatu8LocalVersion) {
            if (remoteVersion.localeCompare(window.chatu8LocalVersion, undefined, { numeric: true, sensitivity: 'base' }) > 0) {
                console.log(`New version available: ${remoteVersion} (current: ${window.chatu8LocalVersion})`);
                window.chatu8UpdateAvailable = true;
            } else {
                console.log('Extension is up to date.');
                window.chatu8UpdateAvailable = false;
            }
        } else {
            // If local version couldn't be read, we can't compare.
            window.chatu8UpdateAvailable = false;
        }
    } catch (error) {
        console.error('Error checking for updates:', error);
        if (updateNotesElement) {
            updateNotesElement.textContent = '无法获取最新更新，尝试点击更新按钮，检查更新。';
        }
        window.chatu8UpdateAvailable = false; // Ensure it's false on error
    }
}


main()

function loadCSS(url) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${extensionFolderPath}/${url}?t=${new Date().getTime()}`;
    document.head.appendChild(link);
}

// Main initialization function
async function main() {
    const cssFiles = [
        'styles/main.css',
        'styles/about.css',
        'styles/forms.css',
        'styles/cache.css',
        'styles/image_cache.css',
        'styles/modals.css',
        'styles/fab.css',
        'styles/responsive.css',
        'styles/click-trigger.css',
        'styles/ai-assistant.css',
        'styles/summary-manager.css'
    ];
    cssFiles.forEach(loadCSS);

    // console.log("Initializing chatu extension.");
    const mergedSettings = { ...JSON.parse(JSON.stringify(defaultSettings)), ...extension_settings[extensionName] };

    // 自动热迁移：将旧的 .mp4 中文路径转换为英文 .chatu8 路径
    if (mergedSettings.chatu8_fab_video_paths) {
        let pathsChanged = false;

        if (mergedSettings.chatu8_fab_video_paths.idle && mergedSettings.chatu8_fab_video_paths.idle.includes('.mp4')) {
            mergedSettings.chatu8_fab_video_paths.idle = mergedSettings.chatu8_fab_video_paths.idle
                .replace('静息画面.mp4', 'idle.chatu8')
                .replace(/\.mp4$/, '.chatu8');
            pathsChanged = true;
        }

        if (mergedSettings.chatu8_fab_video_paths.dragging && mergedSettings.chatu8_fab_video_paths.dragging.includes('.mp4')) {
            mergedSettings.chatu8_fab_video_paths.dragging = mergedSettings.chatu8_fab_video_paths.dragging
                .replace('拖动.mp4', 'dragging.chatu8')
                .replace(/\.mp4$/, '.chatu8');
            pathsChanged = true;
        }

        if (pathsChanged) {
            console.log('[st-chatu8] 自动迁移旧版视频配置路径 -> .chatu8');
        }
    }

    const configMigrated = migrateToolAndTailConfigIfOldDefault(mergedSettings);
    if (configMigrated) {
        console.log('[st-chatu8] 自动更新全局 Tool Call / Tail 默认配置');
        saveSettingsDebounced();
    }

    extension_settings[extensionName] = mergedSettings;
    ensureInjectionTemplatesInit();

    // console.log("Initializing chatu extension.", extension_settings[extensionName]);

    // 安装全局错误处理器
    installGlobalErrorHandler();

    // 初始化生图生涯统计监听
    initImageGenStatsListener();

    await initUI({ check_update });

    // 手势监控和点击触发监控已在 initUI() 内部调用，无需在此重复调用

    // Initialize the newline fixer.
    initializeNewlineFixer();

    // Initialize TTS voice synthesis module.
    initializeTTS();

    // Initialize ASR voice input module.
    initializeASR();

    setTimeout(addNewElement, 2000);

    // Start the main loop
    setInterval(chenk, 4000);
    await checkForUpdates();
    // Set up listeners for communication from other scripts
}


function addNewElement() {
    const targetElement = document.querySelector('#option_toggle_AN');
    if (targetElement) {
        if (!document.getElementById('option_toggle_AN88')) {
            const newElement = document.createElement('a');
            newElement.id = 'option_toggle_AN88';
            const icon = document.createElement('i');
            icon.className = 'fa-lg fa-solid fa-note-sticky';
            newElement.appendChild(icon);
            const span = document.createElement('span');
            span.setAttribute('data-i18n', "打开设置");
            span.textContent = '打开文生图设置';
            newElement.appendChild(span);
            targetElement.parentNode.insertBefore(newElement, targetElement.nextSibling);
            console.log("chatu settings button added.");
            document.getElementById('option_toggle_AN88').addEventListener('click', window.showChatuSettingsPanel);
        }
    }
}
