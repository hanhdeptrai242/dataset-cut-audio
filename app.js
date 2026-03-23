// app.js — All 3 modules: Audio Splitter, CSV Generator, Tag Number

// ===== Main Tab Controller =====
(() => {
    'use strict';

    const tabs = document.querySelectorAll('.main-tab');
    const panels = document.querySelectorAll('.tab-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const target = tab.dataset.tab;

            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            panels.forEach(p => {
                p.classList.toggle('active', p.id === `panel-${target}`);
            });
        });
    });
})();

// ===== 1. Audio Silence Splitter =====
(() => {
    'use strict';

    let audioBuffer = null;
    let audioContext = null;
    let segments = [];
    let wavBlobs = [];
    let currentPlayingSource = null;
    let currentPlayingBtn = null;

    const uploadZone = document.getElementById('uploadZone');
    const fileInput = document.getElementById('fileInput');
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    const fileSize = document.getElementById('fileSize');
    const btnRemove = document.getElementById('btnRemove');
    const infoDuration = document.getElementById('infoDuration');
    const infoSampleRate = document.getElementById('infoSampleRate');
    const infoChannels = document.getElementById('infoChannels');
    const settingsSection = document.getElementById('settingsSection');
    const progressSection = document.getElementById('progressSection');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressDetail = document.getElementById('progressDetail');
    const resultsSection = document.getElementById('resultsSection');
    const statSegments = document.getElementById('statSegments');
    const statMatch = document.getElementById('statMatch');
    const segmentsList = document.getElementById('segmentsList');
    const btnAnalyze = document.getElementById('btnAnalyze');
    const btnDownloadAll = document.getElementById('btnDownloadAll');
    const downloadHint = document.getElementById('downloadHint');

    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', e => { e.preventDefault(); uploadZone.classList.add('dragover'); });
    uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));
    uploadZone.addEventListener('drop', e => { e.preventDefault(); uploadZone.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
    fileInput.addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
    btnRemove.addEventListener('click', e => { e.stopPropagation(); resetAll(); });
    btnAnalyze.addEventListener('click', analyzeAndSplit);
    btnDownloadAll.addEventListener('click', downloadAllAsZip);

    // CSV upload in settings
    const btnCsvUpload = document.getElementById('btnCsvUpload');
    const csvFileInput = document.getElementById('csvFileInput');
    const csvStatus = document.getElementById('csvStatus');

    btnCsvUpload.addEventListener('click', () => csvFileInput.click());
    csvFileInput.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = ev => {
            const lines = ev.target.result.split('\n').filter(l => l.trim().length > 0);
            document.getElementById('expectedSegments').value = lines.length;
            csvStatus.className = 'csv-status';
            csvStatus.textContent = `✓ ${file.name} — ${lines.length} dòng`;
        };
        reader.onerror = () => { csvStatus.className = 'csv-status error'; csvStatus.textContent = '✕ Không đọc được'; };
        reader.readAsText(file, 'UTF-8');
    });

    async function handleFile(file) {
        if (!file.name.toLowerCase().endsWith('.wav') && file.type !== 'audio/wav') { alert('Vui lòng chọn file WAV!'); return; }
        fileName.textContent = file.name;
        fileSize.textContent = fmtSize(file.size);
        uploadZone.style.display = 'none';
        fileInfo.style.display = 'block';
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            audioBuffer = await audioContext.decodeAudioData(await file.arrayBuffer());
            infoDuration.textContent = `⏱ ${fmtTime(audioBuffer.duration)}`;
            infoSampleRate.textContent = `🎵 ${audioBuffer.sampleRate} Hz`;
            infoChannels.textContent = `🔊 ${audioBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}`;
            settingsSection.style.display = 'block';
            resultsSection.style.display = 'none';
        } catch (err) { alert('Không thể đọc file audio.'); console.error(err); resetAll(); }
    }

    async function analyzeAndSplit() {
        if (!audioBuffer) return;
        const silDur = parseFloat(document.getElementById('silenceDuration').value);
        const expected = parseInt(document.getElementById('expectedSegments').value);
        const thDb = parseFloat(document.getElementById('silenceThreshold').value);
        if (isNaN(silDur) || silDur < 0.1) { alert('Thời gian trống không hợp lệ!'); return; }

        btnAnalyze.disabled = true;
        progressSection.style.display = 'block';
        resultsSection.style.display = 'none';
        segments = []; wavBlobs = [];
        await sleep(50);

        try {
            prog(5, 'Đang đọc dữ liệu...');
            const data = audioBuffer.getChannelData(0);
            const sr = audioBuffer.sampleRate;
            prog(15, 'Đang phát hiện khoảng trống...');
            await sleep(30);

            const th = Math.pow(10, thDb / 20);
            const winSz = Math.floor(sr * 0.02);
            const minSil = Math.floor(silDur * sr);
            const silRegions = [];
            let silStart = -1, inSil = false;

            for (let i = 0; i < data.length; i += winSz) {
                const end = Math.min(i + winSz, data.length);
                let rms = 0;
                for (let j = i; j < end; j++) rms += data[j] * data[j];
                rms = Math.sqrt(rms / (end - i));
                if (rms < th) { if (!inSil) { silStart = i; inSil = true; } }
                else { if (inSil) { if (i - silStart >= minSil) silRegions.push({ start: silStart, end: i }); inSil = false; } }
                if (i % Math.floor(data.length / 10) < winSz) { prog(15 + Math.floor(i / data.length * 35), `Phân tích... ${Math.round(i / sr)}s / ${Math.round(data.length / sr)}s`); await sleep(5); }
            }
            if (inSil && data.length - silStart >= minSil) silRegions.push({ start: silStart, end: data.length });

            prog(55, `${silRegions.length} khoảng trống ≥ ${silDur}s`);
            await sleep(100);
            prog(60, 'Đang cắt...');
            await sleep(30);

            const segs = [];
            let segS = 0;
            const pad = Math.floor(sr * 0.05);
            for (const s of silRegions) {
                if (s.start > segS) { const st = Math.max(0, segS), en = Math.min(data.length, s.start + pad); if (en - st > sr * 0.1) segs.push({ start: st, end: en }); }
                segS = Math.max(s.end - pad, s.end);
            }
            if (segS < data.length && data.length - segS > sr * 0.1) segs.push({ start: segS, end: data.length });
            segments = segs;

            prog(70, `${segments.length} đoạn`);
            await sleep(100);

            const tsr = 22050;
            for (let i = 0; i < segments.length; i++) {
                prog(70 + Math.floor(i / segments.length * 25), `Xử lý ${i + 1}/${segments.length}...`);
                const seg = segments[i], len = seg.end - seg.start;
                const mono = new Float32Array(len);
                for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) { const cd = audioBuffer.getChannelData(ch); for (let j = 0; j < len; j++) mono[j] += cd[seg.start + j] / audioBuffer.numberOfChannels; }
                wavBlobs.push(encodeWAV(resample(mono, sr, tsr), tsr));
                if (i % 5 === 0) await sleep(5);
            }

            prog(98, 'Hiển thị kết quả...');
            await sleep(100);
            displayResults(expected);
            prog(100, 'Hoàn tất!');
            await sleep(300);
            progressSection.style.display = 'none';
        } catch (err) { console.error(err); alert('Lỗi: ' + err.message); progressSection.style.display = 'none'; }
        btnAnalyze.disabled = false;
    }

    function resample(d, from, to) {
        if (from === to) return d;
        const r = from / to, n = Math.round(d.length / r), out = new Float32Array(n);
        for (let i = 0; i < n; i++) { const si = i * r, f = Math.floor(si), c = Math.min(f + 1, d.length - 1), fr = si - f; out[i] = d[f] * (1 - fr) + d[c] * fr; }
        return out;
    }

    function encodeWAV(s, sr) {
        const buf = new ArrayBuffer(44 + s.length * 2), v = new DataView(buf);
        wStr(v, 0, 'RIFF'); v.setUint32(4, 36 + s.length * 2, true); wStr(v, 8, 'WAVE');
        wStr(v, 12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
        v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
        wStr(v, 36, 'data'); v.setUint32(40, s.length * 2, true);
        let o = 44;
        for (let i = 0; i < s.length; i++) { let x = Math.max(-1, Math.min(1, s[i])); v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7FFF, true); o += 2; }
        return new Blob([buf], { type: 'audio/wav' });
    }

    function wStr(v, o, s) { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); }

    function displayResults(exp) {
        resultsSection.style.display = 'block';
        statSegments.textContent = `${segments.length} đoạn`;
        statSegments.className = 'stat-pill';
        if (segments.length === exp) { statMatch.textContent = `✓ Khớp ${exp} đoạn`; statMatch.className = 'stat-pill match'; }
        else { statMatch.textContent = `≠ Mong muốn ${exp}, thực tế ${segments.length}`; statMatch.className = 'stat-pill mismatch'; }
        downloadHint.textContent = `${segments.length} file WAV • 22050 Hz`;
        segmentsList.innerHTML = '';

        for (let i = 0; i < segments.length; i++) {
            const dur = (segments[i].end - segments[i].start) / audioBuffer.sampleRate;
            const name = `audio_${String(i + 1).padStart(4, '0')}.wav`;
            const item = document.createElement('div');
            item.className = 'segment-item';
            item.innerHTML = `<span class="seg-idx">${i + 1}</span><span class="seg-name">${name}</span><span class="seg-dur">${fmtTime(dur)}</span><div class="seg-wave"><canvas data-idx="${i}"></canvas></div><button class="btn-play" data-idx="${i}" title="Phát"><svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 1.5L10 6L3 10.5V1.5Z" fill="currentColor"/></svg></button><button class="btn-dl-single" data-idx="${i}">Tải</button>`;
            segmentsList.appendChild(item);
            drawWave(item.querySelector('canvas'), i);
        }
        segmentsList.addEventListener('click', handleSegClick);
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function handleSegClick(e) {
        const pb = e.target.closest('.btn-play'), db = e.target.closest('.btn-dl-single');
        if (pb) togglePlay(parseInt(pb.dataset.idx), pb);
        if (db) dlSingle(parseInt(db.dataset.idx));
    }

    function drawWave(c, idx) {
        const seg = segments[idx], d = audioBuffer.getChannelData(0);
        const ctx = c.getContext('2d'), dpr = window.devicePixelRatio || 1, w = 70, h = 24;
        c.width = w * dpr; c.height = h * dpr; ctx.scale(dpr, dpr);
        const step = Math.ceil((seg.end - seg.start) / w);
        ctx.fillStyle = '#f8f7f4'; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1; ctx.beginPath();
        for (let x = 0; x < w; x++) {
            const si = seg.start + x * step; let mn = 1, mx = -1;
            for (let j = 0; j < step && si + j < seg.end; j++) { const v = d[si + j]; if (v < mn) mn = v; if (v > mx) mx = v; }
            ctx.moveTo(x, ((1 + mn) / 2) * h); ctx.lineTo(x, ((1 + mx) / 2) * h);
        }
        ctx.stroke();
    }

    function togglePlay(idx, btn) {
        if (currentPlayingSource) { currentPlayingSource.stop(); currentPlayingSource = null; if (currentPlayingBtn) { currentPlayingBtn.classList.remove('playing'); currentPlayingBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 1.5L10 6L3 10.5V1.5Z" fill="currentColor"/></svg>`; } if (currentPlayingBtn === btn) { currentPlayingBtn = null; return; } }
        const reader = new FileReader();
        reader.onload = async () => {
            const pc = new (window.AudioContext || window.webkitAudioContext)(), buf = await pc.decodeAudioData(reader.result);
            const src = pc.createBufferSource(); src.buffer = buf; src.connect(pc.destination); src.start();
            currentPlayingSource = src; currentPlayingBtn = btn; btn.classList.add('playing');
            btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="2.5" y="2" width="2.5" height="8" fill="currentColor"/><rect x="7" y="2" width="2.5" height="8" fill="currentColor"/></svg>`;
            src.onended = () => { btn.classList.remove('playing'); btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 1.5L10 6L3 10.5V1.5Z" fill="currentColor"/></svg>`; currentPlayingSource = null; currentPlayingBtn = null; };
        };
        reader.readAsArrayBuffer(wavBlobs[idx]);
    }

    function dlSingle(idx) {
        const a = document.createElement('a'); a.href = URL.createObjectURL(wavBlobs[idx]); a.download = `audio_${String(idx + 1).padStart(4, '0')}.wav`; a.click(); URL.revokeObjectURL(a.href);
    }

    async function downloadAllAsZip() {
        btnDownloadAll.disabled = true;
        btnDownloadAll.innerHTML = `<div class="spinner-sm"></div> Đang nén...`;
        try {
            const zip = new JSZip();
            for (let i = 0; i < wavBlobs.length; i++) zip.file(`audio_${String(i + 1).padStart(4, '0')}.wav`, wavBlobs[i]);
            const blob = await zip.generateAsync({ type: 'blob' });
            const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `audio_segments_${wavBlobs.length}.zip`; a.click(); URL.revokeObjectURL(a.href);
        } catch (err) { alert('Lỗi ZIP: ' + err.message); }
        btnDownloadAll.disabled = false;
        btnDownloadAll.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 2V10.5M4.5 7L8 10.5L11.5 7M3 13.5H13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg> Tải tất cả (ZIP)`;
    }

    function resetAll() {
        audioBuffer = null; segments = []; wavBlobs = [];
        fileInput.value = ''; uploadZone.style.display = ''; fileInfo.style.display = 'none';
        settingsSection.style.display = 'none'; progressSection.style.display = 'none'; resultsSection.style.display = 'none';
    }

    function prog(p, t) { progressBar.style.width = p + '%'; if (t) progressText.textContent = t; }
    function fmtTime(s) { const m = Math.floor(s / 60), sec = Math.floor(s % 60), ms = Math.round((s % 1) * 10); return m > 0 ? `${m}:${String(sec).padStart(2, '0')}.${ms}` : `${sec}.${ms}s`; }
    function fmtSize(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
})();

// ===== 2. CSV Dataset Generator =====
(() => {
    'use strict';

    let textLines = [];

    const tabBtnFile = document.getElementById('tabBtnFile');
    const tabBtnText = document.getElementById('tabBtnText');
    const tabFile = document.getElementById('tabFile');
    const tabText = document.getElementById('tabText');
    const txtFileInput = document.getElementById('txtFileInput');
    const txtUploadZone = document.getElementById('txtUploadZone');
    const txtFileStatus = document.getElementById('txtFileStatus');
    const textAreaInput = document.getElementById('textAreaInput');
    const textAreaCount = document.getElementById('textAreaCount');
    const voiceNameInput = document.getElementById('voiceNameInput');
    const lineCountBadge = document.getElementById('lineCountBadge');
    const lineCountEmpty = document.getElementById('lineCountEmpty');
    const btnGenerateCsv = document.getElementById('btnGenerateCsv');
    const csvPreviewSection = document.getElementById('csvPreviewSection');
    const csvPreviewBody = document.getElementById('csvPreviewBody');
    const csvPreviewTotal = document.getElementById('csvPreviewTotal');
    const btnDownloadCsv = document.getElementById('btnDownloadCsv');

    tabBtnFile.addEventListener('click', () => { tabBtnFile.classList.add('active'); tabBtnText.classList.remove('active'); tabFile.style.display = 'block'; tabText.style.display = 'none'; });
    tabBtnText.addEventListener('click', () => { tabBtnText.classList.add('active'); tabBtnFile.classList.remove('active'); tabText.style.display = 'block'; tabFile.style.display = 'none'; });

    txtUploadZone.addEventListener('click', () => txtFileInput.click());
    txtUploadZone.addEventListener('dragover', e => { e.preventDefault(); txtUploadZone.classList.add('dragover'); });
    txtUploadZone.addEventListener('dragleave', () => txtUploadZone.classList.remove('dragover'));
    txtUploadZone.addEventListener('drop', e => { e.preventDefault(); txtUploadZone.classList.remove('dragover'); if (e.dataTransfer.files[0]) handleTxt(e.dataTransfer.files[0]); });
    txtFileInput.addEventListener('change', e => { if (e.target.files[0]) handleTxt(e.target.files[0]); });

    function handleTxt(file) {
        const reader = new FileReader();
        reader.onload = ev => {
            const lines = ev.target.result.split('\n').filter(l => l.trim().length > 0);
            textLines = lines; updateCount(lines.length);
            txtFileStatus.className = 'file-status success';
            txtFileStatus.textContent = `✓ ${file.name} — ${lines.length} dòng hợp lệ`;
            txtUploadZone.classList.add('has-file');
        };
        reader.onerror = () => { txtFileStatus.className = 'file-status error'; txtFileStatus.textContent = '✕ Không đọc được'; };
        reader.readAsText(file, 'UTF-8');
    }

    textAreaInput.addEventListener('input', () => {
        const lines = textAreaInput.value.split('\n').filter(l => l.trim().length > 0);
        textLines = lines; updateCount(lines.length);
        textAreaCount.textContent = `${lines.length} dòng hợp lệ`;
    });

    function updateCount(n) {
        lineCountBadge.textContent = `${n} dòng`;
        lineCountBadge.style.display = n > 0 ? 'inline-flex' : 'none';
        lineCountEmpty.style.display = n > 0 ? 'none' : 'inline';
        btnGenerateCsv.disabled = n === 0;
    }

    btnGenerateCsv.addEventListener('click', () => {
        const voice = voiceNameInput.value.trim();
        if (!voice) { voiceNameInput.focus(); voiceNameInput.style.borderColor = 'var(--red)'; setTimeout(() => voiceNameInput.style.borderColor = '', 2000); return; }
        if (textLines.length === 0) return;

        csvPreviewBody.innerHTML = '';
        const max = Math.min(textLines.length, 10);
        for (let i = 0; i < max; i++) {
            const row = document.createElement('div');
            row.className = 'preview-row';
            row.innerHTML = `<span class="pcol pcol-audio">audio_${String(i + 1).padStart(4, '0')}.wav</span><span class="pcol-sep">|</span><span class="pcol pcol-voice">${esc(voice)}</span><span class="pcol-sep">|</span><span class="pcol pcol-text">${esc(textLines[i])}</span>`;
            csvPreviewBody.appendChild(row);
        }
        if (textLines.length > max) { const m = document.createElement('div'); m.className = 'preview-more'; m.textContent = `... và ${textLines.length - max} dòng nữa`; csvPreviewBody.appendChild(m); }

        csvPreviewTotal.textContent = `Tổng cộng: ${textLines.length} dòng`;
        csvPreviewSection.style.display = 'block';
        csvPreviewSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    btnDownloadCsv.addEventListener('click', () => {
        const voice = voiceNameInput.value.trim();
        if (!voice || textLines.length === 0) return;
        let csv = '';
        for (let i = 0; i < textLines.length; i++) csv += `audio_${String(i + 1).padStart(4, '0')}.wav|${voice}|${textLines[i]}\n`;
        const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); a.download = `${voice}_dataset_${textLines.length}.csv`; a.click(); URL.revokeObjectURL(a.href);
    });

    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
})();

// ===== 3. Tag Number Inserter =====
(() => {
    'use strict';

    const taggerNum = document.getElementById('taggerNum');
    const tagDisplay = document.getElementById('tagDisplay');
    const taggerInput = document.getElementById('taggerInput');
    const taggerResult = document.getElementById('taggerResult');
    const taggerResultText = document.getElementById('taggerResultText');
    const btnConvert = document.getElementById('btnConvertTag');
    const btnReset = document.getElementById('btnResetTag');
    const btnCopy = document.getElementById('btnCopyTag');

    taggerNum.addEventListener('input', () => {
        const n = taggerNum.value !== '' ? taggerNum.value : '?';
        tagDisplay.textContent = `<#${n}#>`;
    });

    btnConvert.addEventListener('click', () => {
        const text = taggerInput.value;
        const num = taggerNum.value;
        if (!text.trim()) return;
        const tag = ` <#${num}#>`;
        const result = text.split('\n').map(line => line + tag).join('\n');
        taggerResultText.textContent = result;
        taggerResult.style.display = 'block';
        btnCopy.textContent = 'Sao chép';
        btnCopy.className = 'btn-copy';
    });

    btnCopy.addEventListener('click', () => {
        navigator.clipboard.writeText(taggerResultText.textContent).then(() => {
            btnCopy.textContent = 'Đã chép!';
            btnCopy.className = 'btn-copy done';
            setTimeout(() => { btnCopy.textContent = 'Sao chép'; btnCopy.className = 'btn-copy'; }, 2000);
        });
    });

    btnReset.addEventListener('click', () => {
        taggerInput.value = '';
        taggerNum.value = '5';
        tagDisplay.textContent = '<#5#>';
        taggerResult.style.display = 'none';
    });
})();
