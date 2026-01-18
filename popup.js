// const startBtn = document.getElementById('start');
// const pauseBtn = document.getElementById('pause');
// const stopBtn = document.getElementById('stop');
// const statusEl = document.getElementById('status');
// const errorEl = document.getElementById('error');
// const infoEl = document.getElementById('info');
// const statsEls = {
//   spansFound: document.getElementById('spansFound'),
//   buffered: document.getElementById('buffered'),
//   inFlight: document.getElementById('inFlight'),
//   played: document.getElementById('played')
// };

// let isRunning = false;

// startBtn.addEventListener('click', async () => {
//   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//   chrome.tabs.sendMessage(tab.id, { action: 'start' });
//   isRunning = true;
//   updateUI();
// });

// pauseBtn.addEventListener('click', async () => {
//   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//   chrome.tabs.sendMessage(tab.id, { action: 'pause' });
//   isRunning = false;
//   updateUI();
// });

// stopBtn.addEventListener('click', async () => {
//   const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
//   chrome.tabs.sendMessage(tab.id, { action: 'stop' });
//   isRunning = false;
//   updateUI();
//   clearStats();
//   showError('');
// });

// chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
//   if (msg.type === 'update') {
//     updateStats(msg.stats);
//     updateStatus(msg.status);
//   }
//   if (msg.type === 'error') {
//     showError(msg.error);
//   }
//   if (msg.type === 'info') {
//     showInfo(msg.info);
//   }
// });

// function updateUI() {
//   startBtn.disabled = isRunning;
//   pauseBtn.disabled = !isRunning;
//   stopBtn.disabled = !isRunning;
// }

// function updateStatus(status) {
//   statusEl.textContent = status;
//   statusEl.classList.toggle('running', isRunning);
//   statusEl.classList.toggle('idle', !isRunning);
// }

// function updateStats(stats) {
//   Object.entries(stats).forEach(([key, val]) => {
//     if (statsEls[key]) {
//       statsEls[key].textContent = val;
//     }
//   });
// }

// function clearStats() {
//   Object.values(statsEls).forEach(el => el.textContent = '0');
// }

// function showError(msg) {
//   if (msg) {
//     errorEl.textContent = msg;
//     errorEl.style.display = 'block';
//   } else {
//     errorEl.style.display = 'none';
//   }
// }

// function showInfo(msg) {
//   if (msg) {
//     infoEl.textContent = msg;
//     infoEl.style.display = 'block';
//     setTimeout(() => {
//       infoEl.style.display = 'none';
//     }, 3000);
//   }
// }

// updateUI();



let extractedText = "";
let firstSpanText = "";
let firstSpanAudioSize = 0;

document.getElementById("run").onclick = async () => {
  const out = document.getElementById("out");
  const copyBtn = document.getElementById("copy");
  const openTabBtn = document.getElementById("openTab");
  const playFirstBtn = document.getElementById("playFirst");
  const estimateBtn = document.getElementById("estimate");

  // Reset audio size tracking
  firstSpanAudioSize = 0;

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  chrome.tabs.sendMessage(
    tab.id,
    { type: "count"  },
    (res) => {
      if (!res) {
        out.textContent = "no response (content script missing?)";
        copyBtn.disabled = true;
        openTabBtn.disabled = true;
        playFirstBtn.disabled = true;
        estimateBtn.disabled = true;
        return;
      }

      extractedText = res.text;
      firstSpanText = res.firstSpanText;
      const charCount = extractedText.length;
      const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

      out.textContent = `spans: ${res.count} | words: ${wordCount} | chars: ${charCount}`;

      // Update first span info
      if (firstSpanText) {
        const spanInfoDiv = document.getElementById("spanInfo");
        const spanTextDiv = document.getElementById("spanText");
        const spanLengthSpan = document.getElementById("spanLength");
        const spanWordsSpan = document.getElementById("spanWords");

        const firstSpanWords = firstSpanText.split(/\s+/).filter(w => w.length > 0).length;
        const preview = firstSpanText.length > 100 ? firstSpanText.substring(0, 100) + '...' : firstSpanText;

        spanTextDiv.textContent = preview;
        spanLengthSpan.textContent = firstSpanText.length;
        spanWordsSpan.textContent = firstSpanWords;
        spanInfoDiv.classList.add("visible");
      }

      // Enable buttons if we have text
      copyBtn.disabled = !extractedText;
      openTabBtn.disabled = !extractedText;
      playFirstBtn.disabled = !firstSpanText;
    }
  );
};

// Copy to clipboard
document.getElementById("copy").onclick = async () => {
  if (!extractedText) return;

  try {
    await navigator.clipboard.writeText(extractedText);
    const out = document.getElementById("out");
    const originalText = out.textContent;
    out.textContent = "✓ copied to clipboard!";
    setTimeout(() => {
      out.textContent = originalText;
    }, 2000);
  } catch (err) {
    const out = document.getElementById("out");
    out.textContent = `copy failed: ${err.message}`;
  }
};

// Open in new tab
document.getElementById("openTab").onclick = () => {
  if (!extractedText) return;

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Extracted Text</title>
  <style>
    body {
      max-width: 800px;
      margin: 40px auto;
      padding: 20px;
      font-family: Georgia, serif;
      font-size: 18px;
      line-height: 1.6;
      color: #333;
    }
    pre {
      white-space: pre-wrap;
      word-wrap: break-word;
    }
  </style>
</head>
<body>
  <pre>${extractedText.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>
  `;

  const blob = new Blob([htmlContent], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  chrome.tabs.create({ url });
};

// Play first span via TTS
document.getElementById("playFirst").onclick = async () => {
  if (!firstSpanText) return;

  const out = document.getElementById("out");
  const playFirstBtn = document.getElementById("playFirst");
  const originalBtnText = playFirstBtn.textContent;

  try {
    playFirstBtn.disabled = true;
    playFirstBtn.textContent = "loading...";
    out.textContent = "calling TTS API...";

    const formData = new FormData();
    formData.append('text', firstSpanText);

    const response = await fetch('http://localhost:8000/tts', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const audioBlob = await response.blob();
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);

    // Store audio size for estimation
    firstSpanAudioSize = audioBlob.size;

    // Display WAV file size
    const audioInfoDiv = document.getElementById("audioInfo");
    const wavSizeSpan = document.getElementById("wavSize");
    const sizeKB = (audioBlob.size / 1024).toFixed(2);
    wavSizeSpan.textContent = `${sizeKB} KB (${audioBlob.size} bytes)`;
    audioInfoDiv.classList.add("visible");

    // Enable estimate button now that we have the audio
    const estimateBtn = document.getElementById("estimate");
    estimateBtn.disabled = false;

    out.textContent = "playing audio...";

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      out.textContent = "playback complete";
      playFirstBtn.disabled = false;
      playFirstBtn.textContent = originalBtnText;
    };

    audio.onerror = (err) => {
      URL.revokeObjectURL(audioUrl);
      out.textContent = `playback error: ${err.message || 'unknown error'}`;
      playFirstBtn.disabled = false;
      playFirstBtn.textContent = originalBtnText;
    };

    await audio.play();
  } catch (err) {
    out.textContent = `TTS failed: ${err.message}`;
    playFirstBtn.disabled = false;
    playFirstBtn.textContent = originalBtnText;
  }
};

// Calculate estimated full audio size
document.getElementById("estimate").onclick = () => {
  if (!firstSpanText || !firstSpanAudioSize || !extractedText) return;

  const firstSpanChars = firstSpanText.length;
  const totalChars = extractedText.length;

  // Calculate bytes per character ratio
  const ratio = firstSpanAudioSize / firstSpanChars;

  // Estimate total audio size
  const estimatedBytes = totalChars * ratio;
  const estimatedKB = estimatedBytes / 1024;
  const estimatedMB = estimatedKB / 1024;

  // Display the estimate
  const estimateInfoDiv = document.getElementById("estimateInfo");
  const ratioDisplay = document.getElementById("ratioDisplay");
  const totalCharsDisplay = document.getElementById("totalChars");
  const estimatedSizeDisplay = document.getElementById("estimatedSize");

  ratioDisplay.textContent = ratio.toFixed(2);
  totalCharsDisplay.textContent = totalChars.toLocaleString();

  // Format the size nicely
  let sizeText;
  if (estimatedMB >= 1) {
    sizeText = `${estimatedMB.toFixed(2)} MB`;
  } else {
    sizeText = `${estimatedKB.toFixed(2)} KB`;
  }
  sizeText += ` (${Math.round(estimatedBytes).toLocaleString()} bytes)`;

  estimatedSizeDisplay.textContent = sizeText;
  estimateInfoDiv.classList.add("visible");
};
