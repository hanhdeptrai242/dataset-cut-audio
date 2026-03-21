// ===== Audio Silence Splitter App =====
(() => {
    'use strict';

    // State
    let audioBuffer = null;
    let audioContext = null;
    let segments = [];
    let wavBlobs = [];
    let currentPlayingSource = null;
    let currentPlayingBtn = null;

    // DOM Elements
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

    // ===== Upload Handlers =====
    uploadZone.addEventListener('click', () => fileInput.click());
    
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });

    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });

    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleFile(file);
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files[0]) handleFile(e.target.files[0]);
    });

    btnRemove.addEventListener('click', (e) => {
        e.stopPropagation();
        resetAll();
    });

    btnAnalyze.addEventListener('click', analyzeAndSplit);
    btnDownloadAll.addEventListener('click', downloadAllAsZip);

    // ===== CSV Upload Handler =====
    const btnCsvUpload = document.getElementById('btnCsvUpload');
    const csvFileInput = document.getElementById('csvFileInput');
    const csvStatus = document.getElementById('csvStatus');

    btnCsvUpload.addEventListener('click', () => csvFileInput.click());

    csvFileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            const text = ev.target.result;
            // Count non-empty lines
            const lines = text.split('\n').filter(line => line.trim().length > 0);
            const lineCount = lines.length;

            // Update the expected segments input
            document.getElementById('expectedSegments').value = lineCount;

            // Show status
            csvStatus.className = 'csv-status';
            csvStatus.textContent = `✓ ${file.name} — ${lineCount} dòng`;
        };
        reader.onerror = () => {
            csvStatus.className = 'csv-status error';
            csvStatus.textContent = '✕ Không đọc được file';
        };
        reader.readAsText(file, 'UTF-8');
    });

    // ===== File Handler =====
    async function handleFile(file) {
        if (!file.name.toLowerCase().endsWith('.wav') && file.type !== 'audio/wav') {
            alert('Vui lòng chọn file WAV!');
            return;
        }

        // Show file info
        fileName.textContent = file.name;
        fileSize.textContent = formatFileSize(file.size);
        uploadZone.style.display = 'none';
        fileInfo.style.display = 'block';

        // Decode audio
        try {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const arrayBuffer = await file.arrayBuffer();
            audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            infoDuration.textContent = `⏱ ${formatTime(audioBuffer.duration)}`;
            infoSampleRate.textContent = `🎵 ${audioBuffer.sampleRate} Hz`;
            infoChannels.textContent = `🔊 ${audioBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}`;

            settingsSection.style.display = 'block';
            resultsSection.style.display = 'none';
        } catch (err) {
            alert('Không thể đọc file audio. Hãy chắc chắn đây là file WAV hợp lệ.');
            console.error(err);
            resetAll();
        }
    }

    // ===== Analyze & Split =====
    async function analyzeAndSplit() {
        if (!audioBuffer) return;

        const silenceDuration = parseFloat(document.getElementById('silenceDuration').value);
        const expectedSegments = parseInt(document.getElementById('expectedSegments').value);
        const thresholdDb = parseFloat(document.getElementById('silenceThreshold').value);

        if (isNaN(silenceDuration) || silenceDuration < 0.1) {
            alert('Thời gian trống tối thiểu không hợp lệ!');
            return;
        }

        btnAnalyze.disabled = true;
        progressSection.style.display = 'block';
        resultsSection.style.display = 'none';
        segments = [];
        wavBlobs = [];

        await sleep(50); // Let UI render

        try {
            // Step 1: Get mono audio data
            updateProgress(5, 'Đang đọc dữ liệu audio...');
            const channelData = audioBuffer.getChannelData(0);
            const sampleRate = audioBuffer.sampleRate;

            // Step 2: Detect silence regions
            updateProgress(15, 'Đang phát hiện khoảng trống...');
            await sleep(30);

            const threshold = Math.pow(10, thresholdDb / 20); // Convert dB to linear
            const windowSize = Math.floor(sampleRate * 0.02); // 20ms analysis window
            const minSilenceSamples = Math.floor(silenceDuration * sampleRate);

            const silenceRegions = [];
            let silenceStart = -1;
            let inSilence = false;

            for (let i = 0; i < channelData.length; i += windowSize) {
                const end = Math.min(i + windowSize, channelData.length);
                let rms = 0;
                for (let j = i; j < end; j++) {
                    rms += channelData[j] * channelData[j];
                }
                rms = Math.sqrt(rms / (end - i));

                if (rms < threshold) {
                    if (!inSilence) {
                        silenceStart = i;
                        inSilence = true;
                    }
                } else {
                    if (inSilence) {
                        const silenceLen = i - silenceStart;
                        if (silenceLen >= minSilenceSamples) {
                            silenceRegions.push({ start: silenceStart, end: i });
                        }
                        inSilence = false;
                    }
                }

                // Progress update every 10%
                if (i % (Math.floor(channelData.length / 10)) < windowSize) {
                    const pct = 15 + Math.floor((i / channelData.length) * 35);
                    updateProgress(pct, `Đang phân tích... ${Math.round(i / sampleRate)}s / ${Math.round(channelData.length / sampleRate)}s`);
                    await sleep(5);
                }
            }

            // Handle trailing silence
            if (inSilence) {
                const silenceLen = channelData.length - silenceStart;
                if (silenceLen >= minSilenceSamples) {
                    silenceRegions.push({ start: silenceStart, end: channelData.length });
                }
            }

            updateProgress(55, `Tìm thấy ${silenceRegions.length} khoảng trống ≥ ${silenceDuration}s`);
            await sleep(100);

            // Step 3: Extract audio segments (between silences)
            updateProgress(60, 'Đang cắt audio...');
            await sleep(30);

            const audioSegments = [];
            let segStart = 0;

            for (const silence of silenceRegions) {
                if (silence.start > segStart) {
                    // Add small padding (50ms) to avoid cutting speech
                    const padSamples = Math.floor(sampleRate * 0.05);
                    const start = Math.max(0, segStart);
                    const end = Math.min(channelData.length, silence.start + padSamples);
                    if (end - start > sampleRate * 0.1) { // At least 100ms
                        audioSegments.push({ start, end });
                    }
                }
                segStart = silence.end - Math.floor(sampleRate * 0.05); // Small padding on the other side
                segStart = Math.max(segStart, silence.end);
            }

            // Add last segment
            if (segStart < channelData.length) {
                const remaining = channelData.length - segStart;
                if (remaining > sampleRate * 0.1) {
                    audioSegments.push({ start: segStart, end: channelData.length });
                }
            }

            segments = audioSegments;

            updateProgress(70, `Đã tách được ${segments.length} đoạn audio`);
            await sleep(100);

            // Step 4: Resample to 22050 Hz and encode WAV
            const targetSampleRate = 22050;
            
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                const pct = 70 + Math.floor((i / segments.length) * 25);
                updateProgress(pct, `Đang xử lý đoạn ${i + 1}/${segments.length}...`);

                // Extract segment data (use all channels but mix to mono)
                const numChannels = audioBuffer.numberOfChannels;
                const segLength = seg.end - seg.start;
                const monoData = new Float32Array(segLength);

                for (let ch = 0; ch < numChannels; ch++) {
                    const chData = audioBuffer.getChannelData(ch);
                    for (let j = 0; j < segLength; j++) {
                        monoData[j] += chData[seg.start + j] / numChannels;
                    }
                }

                // Resample
                const resampledData = resample(monoData, sampleRate, targetSampleRate);

                // Encode WAV
                const wavBlob = encodeWAV(resampledData, targetSampleRate);
                wavBlobs.push(wavBlob);

                if (i % 5 === 0) await sleep(5);
            }

            updateProgress(98, 'Đang hiển thị kết quả...');
            await sleep(100);

            // Step 5: Show results
            displayResults(expectedSegments);
            updateProgress(100, 'Hoàn tất!');
            await sleep(300);

            progressSection.style.display = 'none';
            btnAnalyze.disabled = false;

        } catch (err) {
            console.error(err);
            alert('Có lỗi xảy ra: ' + err.message);
            progressSection.style.display = 'none';
            btnAnalyze.disabled = false;
        }
    }

    // ===== Resample (linear interpolation) =====
    function resample(data, fromRate, toRate) {
        if (fromRate === toRate) return data;

        const ratio = fromRate / toRate;
        const newLength = Math.round(data.length / ratio);
        const result = new Float32Array(newLength);

        for (let i = 0; i < newLength; i++) {
            const srcIndex = i * ratio;
            const srcIndexFloor = Math.floor(srcIndex);
            const srcIndexCeil = Math.min(srcIndexFloor + 1, data.length - 1);
            const frac = srcIndex - srcIndexFloor;
            result[i] = data[srcIndexFloor] * (1 - frac) + data[srcIndexCeil] * frac;
        }

        return result;
    }

    // ===== WAV Encoder =====
    function encodeWAV(samples, sampleRate) {
        const buffer = new ArrayBuffer(44 + samples.length * 2);
        const view = new DataView(buffer);

        // RIFF header
        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeString(view, 8, 'WAVE');

        // fmt chunk
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true); // chunk size
        view.setUint16(20, 1, true);  // PCM
        view.setUint16(22, 1, true);  // mono
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * 2, true); // byte rate
        view.setUint16(32, 2, true);  // block align
        view.setUint16(34, 16, true); // bits per sample

        // data chunk
        writeString(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);

        // Write samples (16-bit)
        let offset = 44;
        for (let i = 0; i < samples.length; i++) {
            let s = Math.max(-1, Math.min(1, samples[i]));
            s = s < 0 ? s * 0x8000 : s * 0x7FFF;
            view.setInt16(offset, s, true);
            offset += 2;
        }

        return new Blob([buffer], { type: 'audio/wav' });
    }

    function writeString(view, offset, str) {
        for (let i = 0; i < str.length; i++) {
            view.setUint8(offset + i, str.charCodeAt(i));
        }
    }

    // ===== Display Results =====
    function displayResults(expectedSegments) {
        resultsSection.style.display = 'block';

        const count = segments.length;
        statSegments.textContent = `${count} đoạn`;
        statSegments.className = 'stat-badge';

        if (count === expectedSegments) {
            statMatch.textContent = `✓ Khớp với ${expectedSegments} đoạn mong muốn`;
            statMatch.className = 'stat-badge match';
        } else {
            statMatch.textContent = `≠ Mong muốn ${expectedSegments}, thực tế ${count}`;
            statMatch.className = 'stat-badge mismatch';
        }

        downloadHint.textContent = `${count} file WAV • 22050 Hz • Mono`;

        // Render segments
        segmentsList.innerHTML = '';

        for (let i = 0; i < segments.length; i++) {
            const seg = segments[i];
            const duration = (seg.end - seg.start) / audioBuffer.sampleRate;
            const name = `audio_${String(i + 1).padStart(4, '0')}.wav`;

            const item = document.createElement('div');
            item.className = 'segment-item';
            item.innerHTML = `
                <span class="segment-index">${i + 1}</span>
                <span class="segment-name">${name}</span>
                <span class="segment-duration">${formatTime(duration)}</span>
                <div class="segment-waveform"><canvas data-idx="${i}"></canvas></div>
                <button class="btn-play" data-idx="${i}" title="Phát">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                        <path d="M3 2L12 7L3 12V2Z" fill="currentColor"/>
                    </svg>
                </button>
                <button class="btn-download-single" data-idx="${i}">Tải</button>
            `;

            segmentsList.appendChild(item);

            // Draw mini waveform
            const canvas = item.querySelector('canvas');
            drawMiniWaveform(canvas, i);
        }

        // Event delegation for buttons
        segmentsList.addEventListener('click', handleSegmentClick);

        // Scroll to results
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function handleSegmentClick(e) {
        const playBtn = e.target.closest('.btn-play');
        const dlBtn = e.target.closest('.btn-download-single');

        if (playBtn) {
            const idx = parseInt(playBtn.dataset.idx);
            togglePlay(idx, playBtn);
        }

        if (dlBtn) {
            const idx = parseInt(dlBtn.dataset.idx);
            downloadSingle(idx);
        }
    }

    // ===== Mini Waveform Drawing =====
    function drawMiniWaveform(canvas, segIdx) {
        const seg = segments[segIdx];
        const data = audioBuffer.getChannelData(0);
        const ctx = canvas.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = 80;
        const h = 28;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        const segLength = seg.end - seg.start;
        const step = Math.ceil(segLength / w);

        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = '#6366f1';
        ctx.lineWidth = 1;
        ctx.beginPath();

        for (let x = 0; x < w; x++) {
            const sampleIdx = seg.start + x * step;
            let min = 1, max = -1;
            for (let j = 0; j < step && sampleIdx + j < seg.end; j++) {
                const val = data[sampleIdx + j];
                if (val < min) min = val;
                if (val > max) max = val;
            }

            const yMin = ((1 + min) / 2) * h;
            const yMax = ((1 + max) / 2) * h;

            ctx.moveTo(x, yMin);
            ctx.lineTo(x, yMax);
        }

        ctx.stroke();
    }

    // ===== Playback =====
    function togglePlay(idx, btn) {
        // Stop current
        if (currentPlayingSource) {
            currentPlayingSource.stop();
            currentPlayingSource = null;
            if (currentPlayingBtn) {
                currentPlayingBtn.classList.remove('playing');
                currentPlayingBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2L12 7L3 12V2Z" fill="currentColor"/></svg>`;
            }
            if (currentPlayingBtn === btn) {
                currentPlayingBtn = null;
                return;
            }
        }

        // Play
        const blob = wavBlobs[idx];
        const reader = new FileReader();
        reader.onload = async () => {
            const playCtx = new (window.AudioContext || window.webkitAudioContext)();
            const buffer = await playCtx.decodeAudioData(reader.result);
            const source = playCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(playCtx.destination);
            source.start();

            currentPlayingSource = source;
            currentPlayingBtn = btn;
            btn.classList.add('playing');
            btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="3" y="2" width="3" height="10" fill="currentColor"/><rect x="8" y="2" width="3" height="10" fill="currentColor"/></svg>`;

            source.onended = () => {
                btn.classList.remove('playing');
                btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 2L12 7L3 12V2Z" fill="currentColor"/></svg>`;
                currentPlayingSource = null;
                currentPlayingBtn = null;
            };
        };
        reader.readAsArrayBuffer(blob);
    }

    // ===== Download Single =====
    function downloadSingle(idx) {
        const name = `audio_${String(idx + 1).padStart(4, '0')}.wav`;
        const url = URL.createObjectURL(wavBlobs[idx]);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        URL.revokeObjectURL(url);
    }

    // ===== Download All as ZIP =====
    async function downloadAllAsZip() {
        btnDownloadAll.disabled = true;
        btnDownloadAll.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px"></div> Đang nén...`;

        try {
            const zip = new JSZip();
            for (let i = 0; i < wavBlobs.length; i++) {
                const name = `audio_${String(i + 1).padStart(4, '0')}.wav`;
                zip.file(name, wavBlobs[i]);
            }

            const content = await zip.generateAsync({ type: 'blob' }, (metadata) => {
                // Optional: track compression progress
            });

            const url = URL.createObjectURL(content);
            const a = document.createElement('a');
            a.href = url;
            a.download = `audio_segments_${wavBlobs.length}.zip`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            alert('Lỗi khi tạo ZIP: ' + err.message);
        }

        btnDownloadAll.disabled = false;
        btnDownloadAll.innerHTML = `
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                <path d="M9 2V12M5 8L9 12L13 8M3 15H15" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            Tải tất cả (ZIP)
        `;
    }

    // ===== Reset =====
    function resetAll() {
        audioBuffer = null;
        segments = [];
        wavBlobs = [];
        fileInput.value = '';
        uploadZone.style.display = '';
        fileInfo.style.display = 'none';
        settingsSection.style.display = 'none';
        progressSection.style.display = 'none';
        resultsSection.style.display = 'none';
    }

    // ===== Utilities =====
    function updateProgress(pct, text, detail) {
        progressBar.style.width = pct + '%';
        if (text) progressText.textContent = text;
        if (detail) progressDetail.textContent = detail;
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = Math.floor(seconds % 60);
        const ms = Math.round((seconds % 1) * 10);
        if (m > 0) return `${m}:${String(s).padStart(2, '0')}.${ms}`;
        return `${s}.${ms}s`;
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return bytes + ' B';
        if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
        return (bytes / 1048576).toFixed(1) + ' MB';
    }

    function sleep(ms) {
        return new Promise(r => setTimeout(r, ms));
    }
})();
