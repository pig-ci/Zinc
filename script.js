const CHUNK_SIZE = 1024 * 1024;
const editor = document.getElementById('editor');
const mediaViewer = document.getElementById('media-viewer');
const decryptedImg = document.getElementById('decrypted-img');
const zipBox = document.getElementById('zip-box');
const zipInfoText = document.getElementById('zip-info-text');
const textToolbar = document.getElementById('text-toolbar');
const filenameInput = document.getElementById('filename-input');
const charCount = document.getElementById('char-count');
const lineCount = document.getElementById('line-count');
const statusMsg = document.getElementById('status-msg');
const undoBtn = document.getElementById('undo-btn');
const redoBtn = document.getElementById('redo-btn');
const navMenu = document.getElementById('nav-menu');
const hamburgerBtn = document.getElementById('hamburger-btn');
const sunIcon = document.getElementById('theme-icon-sun');
const moonIcon = document.getElementById('theme-icon-moon');

let historyStack = [''];
let historyIndex = 0;
let isUndoRedoAction = false;
let debounceTimer = null;
let decryptedMediaBlobUrl = null;
let decryptedMediaFilename = 'decrypted_file';

// ==================== 主題切換邏輯 ====================
function initTheme() {
  const savedTheme = localStorage.getItem('zinc-theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  if (savedTheme === 'dark' || (!savedTheme && prefersDark)) {
    setTheme('dark');
  } else {
    setTheme('light');
  }
}

function setTheme(theme) {
  if (theme === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
    sunIcon.style.display = 'block';
    moonIcon.style.display = 'none';
    localStorage.setItem('zinc-theme', 'dark');
  } else {
    document.documentElement.removeAttribute('data-theme');
    sunIcon.style.display = 'none';
    moonIcon.style.display = 'block';
    localStorage.setItem('zinc-theme', 'light');
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  setTheme(isDark ? 'light' : 'dark');
}

// ==================== Toast 與 UI 控制 ====================
function showToast(message, isError = false) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${isError ? 'error' : ''}`;
  toast.textContent = message;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function toggleMenu() {
  navMenu.classList.toggle('active');
  hamburgerBtn.classList.toggle('active');
}

function closeMenu() {
  navMenu.classList.remove('active');
  hamburgerBtn.classList.remove('active');
}

function triggerUpload() { document.getElementById('file-input').click(); closeMenu(); }
function triggerImageUpload() { document.getElementById('image-input').click(); closeMenu(); }
function triggerZipUpload() { document.getElementById('zip-input').click(); closeMenu(); }

function showMode(mode, subType = '') {
  if (mode === 'media') {
    editor.style.display = 'none';
    textToolbar.style.visibility = 'hidden';
    mediaViewer.style.display = 'flex';
    
    if (subType === 'image') {
      decryptedImg.style.display = 'block';
      zipBox.style.display = 'none';
    } else if (subType === 'zip') {
      decryptedImg.style.display = 'none';
      zipBox.style.display = 'flex';
    }
  } else {
    editor.style.display = 'block';
    textToolbar.style.visibility = 'visible';
    mediaViewer.style.display = 'none';
  }
}

// ==================== 最近開啟紀錄 (LocalStorage) ====================
function saveRecentFile(fileData) {
  let recents = JSON.parse(localStorage.getItem('zinc_recent_files') || '[]');
  recents = recents.filter(item => item.name !== fileData.name);
  recents.unshift(fileData);
  
  if (recents.length > 3) {
    recents = recents.slice(0, 3);
  }
  
  try {
    localStorage.setItem('zinc_recent_files', JSON.stringify(recents));
    renderRecentFiles();
  } catch (e) {
    console.warn('LocalStorage 空間不足，無法紀錄歷史檔案');
  }
}

function renderRecentFiles() {
  const recentList = document.getElementById('recent-list');
  if (!recentList) return;
  
  const recents = JSON.parse(localStorage.getItem('zinc_recent_files') || '[]');
  recentList.innerHTML = '';
  
  if (recents.length === 0) {
    recentList.innerHTML = '<span style="color:var(--text-muted); font-size:12px;">無紀錄</span>';
    return;
  }
  
  recents.forEach((item, index) => {
    const btn = document.createElement('button');
    btn.className = 'recent-item-btn';
    btn.textContent = item.name;
    btn.onclick = () => loadRecentFile(index);
    recentList.appendChild(btn);
  });
}

function loadRecentFile(index) {
  const recents = JSON.parse(localStorage.getItem('zinc_recent_files') || '[]');
  const item = recents[index];
  if (!item) return;

  if (item.type === 'media') {
    const bytes = base64ToBuffer(item.content);
    const blob = new Blob([bytes], { type: item.mimeType });

    if (decryptedMediaBlobUrl) URL.revokeObjectURL(decryptedMediaBlobUrl);
    decryptedMediaBlobUrl = URL.createObjectURL(blob);
    decryptedMediaFilename = item.originalName || item.name;

    if (item.subType === 'image') {
      decryptedImg.src = decryptedMediaBlobUrl;
      showMode('media', 'image');
    } else if (item.subType === 'zip') {
      zipInfoText.textContent = `已解密：${decryptedMediaFilename}`;
      showMode('media', 'zip');
    }
    filenameInput.value = item.name;
    statusMsg.textContent = '狀態：已載入歷史紀錄';
    showToast(`已載入紀錄：${item.name}`);
  } else if (item.type === 'text') {
    showMode('text');
    editor.value = item.content;
    filenameInput.value = item.name;
    historyStack = [item.content];
    historyIndex = 0;
    updateUndoRedoUI();
    triggerUpdate();
    statusMsg.textContent = '狀態：已載入歷史紀錄';
    showToast(`已載入紀錄：${item.name}`);
  }
}

function clearRecentFiles() {
  localStorage.removeItem('zinc_recent_files');
  renderRecentFiles();
  showToast('已清除最近歷史紀錄');
}

// ==================== 拖曳上傳 ZINC 檔案功能 ====================
function initDragAndDrop() {
  let overlay = document.getElementById('drag-overlay');
  
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'drag-overlay';
    overlay.className = 'drag-overlay';
    overlay.innerHTML = '<div class="drag-message">放開以解密載入 ZINC 檔案</div>';
    document.body.appendChild(overlay);
  }

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    overlay.classList.add('active');
  });

  overlay.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  overlay.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.relatedTarget === null) {
      overlay.classList.remove('active');
    }
  });

  overlay.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    overlay.classList.remove('active');

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.name.toLowerCase().endsWith('.zinc')) {
        handleZincFile(file);
      } else {
        showToast('請拖曳 .zinc 格式的檔案！', true);
      }
    }
  });
}

// ==================== 編解碼與加密核心演算法 ====================
function bufferToBase64(buffer) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return window.btoa(binary);
}

function base64ToBuffer(base64) {
  const binaryString = window.atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

async function encryptChunks(arrayBuffer, key) {
  const bytes = new Uint8Array(arrayBuffer);
  const totalLen = bytes.length;
  let offset = 0;
  let encryptedChunks = [];

  while (offset < totalLen) {
    const chunk = bytes.subarray(offset, offset + CHUNK_SIZE);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encryptedBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      chunk
    );
    
    const combined = new Uint8Array(iv.length + encryptedBuffer.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedBuffer), iv.length);
    
    encryptedChunks.push(bufferToBase64(combined.buffer));
    offset += CHUNK_SIZE;
  }

  return encryptedChunks.join('|');
}

async function decryptChunks(encryptedDataStr, key) {
  const chunkBase64List = encryptedDataStr.split('|');
  let decryptedBuffers = [];
  let totalLength = 0;

  for (const chunkStr of chunkBase64List) {
    const combinedBuffer = new Uint8Array(base64ToBuffer(chunkStr));
    if (combinedBuffer.length < 12) {
      throw new Error('密文長度過短或無效');
    }

    const iv = combinedBuffer.slice(0, 12);
    const ciphertext = combinedBuffer.slice(12);

    const decryptedBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      ciphertext
    );

    decryptedBuffers.push(new Uint8Array(decryptedBuffer));
    totalLength += decryptedBuffer.byteLength;
  }

  const result = new Uint8Array(totalLength);
  let currentOffset = 0;
  for (const buf of decryptedBuffers) {
    result.set(buf, currentOffset);
    currentOffset += buf.length;
  }

  return result.buffer;
}

// ==================== 檔案解密邏輯 ====================
async function handleZincFile(file) {
  const reader = new FileReader();
  reader.onload = async function(e) {
    try {
      const fileContent = e.target.result;
      const lines = fileContent.split('\n');

      if (lines.length < 2) throw new Error('檔案格式不正確');

      const firstLine = lines[0].trim();

      // 圖片格式解密
      if (firstLine === 'ZINC_IMG_V1') {
        const fileMeta = lines[1].trim();
        const rawKeyBase64 = lines[2].trim();
        const encryptedDataBase64 = lines[3].trim();

        const key = await crypto.subtle.importKey('raw', base64ToBuffer(rawKeyBase64), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const decryptedBuffer = await decryptChunks(encryptedDataBase64, key);
        const originalName = fileMeta.split(';')[0] || 'decrypted_image.png';
        const mimeType = fileMeta.split(';')[1] || 'image/png';
        
        const blob = new Blob([decryptedBuffer], { type: mimeType });

        if (decryptedMediaBlobUrl) URL.revokeObjectURL(decryptedMediaBlobUrl);
        decryptedMediaBlobUrl = URL.createObjectURL(blob);
        decryptedMediaFilename = originalName;

        decryptedImg.src = decryptedMediaBlobUrl;
        filenameInput.value = file.name;
        showMode('media', 'image');
        statusMsg.textContent = '狀態：已解密圖片';
        showToast('已成功解密載入圖片！');

        saveRecentFile({
          name: file.name,
          type: 'media',
          subType: 'image',
          originalName: originalName,
          mimeType: mimeType,
          content: bufferToBase64(decryptedBuffer)
        });
        return;
      }

      // ZIP 格式解密
      if (firstLine === 'ZINC_ZIP_V1') {
        const fileMeta = lines[1].trim();
        const rawKeyBase64 = lines[2].trim();
        const encryptedDataBase64 = lines[3].trim();

        const key = await crypto.subtle.importKey('raw', base64ToBuffer(rawKeyBase64), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const decryptedBuffer = await decryptChunks(encryptedDataBase64, key);
        const originalName = fileMeta.split(';')[0] || 'decrypted_archive.zip';
        
        const blob = new Blob([decryptedBuffer], { type: 'application/zip' });

        if (decryptedMediaBlobUrl) URL.revokeObjectURL(decryptedMediaBlobUrl);
        decryptedMediaBlobUrl = URL.createObjectURL(blob);
        decryptedMediaFilename = originalName;

        zipInfoText.textContent = `已解密：${originalName}`;
        filenameInput.value = file.name;
        showMode('media', 'zip');
        statusMsg.textContent = '狀態：已解密 ZIP 檔';
        showToast('已成功解密載入 ZIP 壓縮檔！');

        saveRecentFile({
          name: file.name,
          type: 'media',
          subType: 'zip',
          originalName: originalName,
          mimeType: 'application/zip',
          content: bufferToBase64(decryptedBuffer)
        });
        return;
      }

      // 文字格式解密
      if (firstLine === 'ZINC_TXT_V1') {
        const rawKeyBase64 = lines[1].trim();
        const encryptedDataBase64 = lines[2].trim();

        const key = await crypto.subtle.importKey('raw', base64ToBuffer(rawKeyBase64), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
        const decryptedBuffer = await decryptChunks(encryptedDataBase64, key);
        const decryptedText = new TextDecoder('utf-8').decode(decryptedBuffer);

        showMode('text');
        editor.value = decryptedText;
        filenameInput.value = file.name;
        historyStack = [decryptedText];
        historyIndex = 0;
        updateUndoRedoUI();
        triggerUpdate();
        statusMsg.textContent = '狀態：已解密文字';
        showToast('成功載入並解密文字文件！');

        saveRecentFile({
          name: file.name,
          type: 'text',
          content: decryptedText
        });
        return;
      }

      // 舊版相容性解密
      const rawKeyBase64 = firstLine;
      const encryptedDataBase64 = fileContent.substring(fileContent.indexOf('\n') + 1).trim();

      const key = await crypto.subtle.importKey('raw', base64ToBuffer(rawKeyBase64), { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      const combinedBuffer = new Uint8Array(base64ToBuffer(encryptedDataBase64));
      if (combinedBuffer.length < 12) throw new Error('密文長度無效');

      const iv = combinedBuffer.slice(0, 12);
      const ciphertext = combinedBuffer.slice(12);

      const decryptedBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv }, key, ciphertext);
      const decryptedText = new TextDecoder('utf-8').decode(decryptedBuffer);

      showMode('text');
      editor.value = decryptedText;
      filenameInput.value = file.name;
      historyStack = [decryptedText];
      historyIndex = 0;
      updateUndoRedoUI();
      triggerUpdate();
      statusMsg.textContent = '狀態：已解密 (舊版相容)';
      showToast('成功解密並載入舊版 .zinc 檔案！');

      saveRecentFile({
        name: file.name,
        type: 'text',
        content: decryptedText
      });

    } catch (err) {
      console.error(err);
      showToast('解密檔案失敗！檔案可能損毀或格式不正確。', true);
      statusMsg.textContent = '狀態：解密失敗';
    }
  };

  reader.readAsText(file, 'UTF-8');
}

function uploadFile(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (!file.name.toLowerCase().endsWith('.zinc')) {
    showToast('請選擇 .zinc 格式的檔案！', true);
    return;
  }

  handleZincFile(file);
  event.target.value = '';
}

// ==================== 檔案轉換與下載 ====================
async function convertImageToZinc(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    statusMsg.textContent = '狀態：正在加密圖片...';
    const reader = new FileReader();
    reader.onload = async function(e) {
      const imageArrayBuffer = e.target.result;

      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
      const rawKeyBuffer = await crypto.subtle.exportKey('raw', key);
      const rawKeyBase64 = bufferToBase64(rawKeyBuffer);

      const encryptedDataStr = await encryptChunks(imageArrayBuffer, key);

      const fileMeta = `${file.name};${file.type}`;
      const zincContent = `ZINC_IMG_V1\n${fileMeta}\n${rawKeyBase64}\n${encryptedDataStr}`;

      const zincFilename = file.name.replace(/\.[^/.]+$/, "") + ".zinc";
      const blob = new Blob([zincContent], { type: 'text/plain;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = zincFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      statusMsg.textContent = '狀態：圖片轉檔成功！';
      showToast('圖片已成功加密並轉換為 .zinc！');
    };

    reader.readAsArrayBuffer(file);
  } catch (err) {
    console.error(err);
    showToast('圖片轉換加密失敗！', true);
    statusMsg.textContent = '狀態：加密失敗';
  }
  event.target.value = '';
}

async function convertZipToZinc(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    statusMsg.textContent = '狀態：正在加密壓縮檔...';
    const reader = new FileReader();
    reader.onload = async function(e) {
      const zipArrayBuffer = e.target.result;

      const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
      const rawKeyBuffer = await crypto.subtle.exportKey('raw', key);
      const rawKeyBase64 = bufferToBase64(rawKeyBuffer);

      const encryptedDataStr = await encryptChunks(zipArrayBuffer, key);

      const fileMeta = `${file.name};application/zip`;
      const zincContent = `ZINC_ZIP_V1\n${fileMeta}\n${rawKeyBase64}\n${encryptedDataStr}`;

      const zincFilename = file.name.replace(/\.[^/.]+$/, "") + ".zinc";
      const blob = new Blob([zincContent], { type: 'text/plain;charset=utf-8' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = zincFilename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);

      statusMsg.textContent = '狀態：ZIP 轉檔成功！';
      showToast('ZIP 檔案已成功加密並轉換為 .zinc！');
    };

    reader.readAsArrayBuffer(file);
  } catch (err) {
    console.error(err);
    showToast('ZIP 轉換失敗！', true);
    statusMsg.textContent = '狀態：加密失敗';
  }
  event.target.value = '';
}

function downloadDecryptedMedia() {
  if (!decryptedMediaBlobUrl) return;
  const link = document.createElement('a');
  link.href = decryptedMediaBlobUrl;
  link.download = decryptedMediaFilename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function downloadFile() {
  try {
    const textContent = editor.value;
    let filename = filenameInput.value.trim();

    if (!filename) {
      filename = '未命名文件.zinc';
    } else if (!filename.toLowerCase().endsWith('.zinc')) {
      filename += '.zinc';
    }

    statusMsg.textContent = '狀態：正在加密...';

    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const rawKeyBuffer = await crypto.subtle.exportKey('raw', key);
    const rawKeyBase64 = bufferToBase64(rawKeyBuffer);

    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(textContent);

    const encryptedDataStr = await encryptChunks(dataBuffer, key);
    const fileData = `ZINC_TXT_V1\n${rawKeyBase64}\n${encryptedDataStr}`;

    const blob = new Blob([fileData], { type: 'text/plain;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(link.href);

    statusMsg.textContent = '狀態：已儲存下載';
    showToast('檔案已成功加密並開始下載！');
    closeMenu();
  } catch (err) {
    console.error(err);
    showToast('加密過程發生錯誤！', true);
    statusMsg.textContent = '狀態：加密失敗';
  }
}

// ==================== 編輯器 Undo / Redo 與事件偵聽 ====================
function updateUndoRedoUI() {
  undoBtn.disabled = historyIndex <= 0;
  redoBtn.disabled = historyIndex >= historyStack.length - 1;
}

function saveHistory(text) {
  if (historyStack[historyIndex] === text) return;
  historyStack = historyStack.slice(0, historyIndex + 1);
  historyStack.push(text);
  if (historyStack.length > 100) {
    historyStack.shift();
  } else {
    historyIndex++;
  }
  updateUndoRedoUI();
}

function undo() {
  if (historyIndex > 0) {
    historyIndex--;
    isUndoRedoAction = true;
    editor.value = historyStack[historyIndex];
    triggerUpdate();
    updateUndoRedoUI();
    statusMsg.textContent = '狀態：已復原';
  }
}

function redo() {
  if (historyIndex < historyStack.length - 1) {
    historyIndex++;
    isUndoRedoAction = true;
    editor.value = historyStack[historyIndex];
    triggerUpdate();
    updateUndoRedoUI();
    statusMsg.textContent = '狀態：已重做';
  }
}

function triggerUpdate() {
  const text = editor.value;
  charCount.textContent = `字數：${text.length}`;
  lineCount.textContent = `行數：${text.split('\n').length}`;
}

editor.addEventListener('input', () => {
  triggerUpdate();
  if (isUndoRedoAction) {
    isUndoRedoAction = false;
    return;
  }
  statusMsg.textContent = '狀態：編輯中...';
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    saveHistory(editor.value);
  }, 300);
});

document.addEventListener('keydown', (e) => {
  const isCmdOrCtrl = e.ctrlKey || e.metaKey;
  if (isCmdOrCtrl && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) {
      e.preventDefault();
      redo();
    } else {
      e.preventDefault();
      undo();
    }
  } else if (isCmdOrCtrl && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  }
});

// 初始化
initTheme();
document.addEventListener('DOMContentLoaded', () => {
  renderRecentFiles();
  initDragAndDrop();
});