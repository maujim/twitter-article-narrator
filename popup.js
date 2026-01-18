let extractedText = "";
let firstSpanText = "";
let lastPlayedAudioSize = 0;
let totalSpanCount = 0;

// Restore UI state from cached data
function restoreFromCache(data) {
  extractedText = data.text;
  firstSpanText = data.firstSpanText;
  totalSpanCount = data.count;

  const out = document.getElementById("out");
  const copyBtn = document.getElementById("copy");
  const openTabBtn = document.getElementById("openTab");
  const playFirstBtn = document.getElementById("playFirst");
  const playSpanNBtn = document.getElementById("playSpanN");
  const spanIndexInput = document.getElementById("spanIndex");

  const charCount = extractedText.length;
  const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

  out.textContent = `spans: ${data.count} | words: ${wordCount} | chars: ${charCount}`;

  // Update first span info
  if (firstSpanText) {
    updateSpanInfo(firstSpanText, 0);
  }

  // Enable buttons
  copyBtn.disabled = !extractedText;
  openTabBtn.disabled = !extractedText;
  playFirstBtn.disabled = !firstSpanText;
  playSpanNBtn.disabled = !extractedText;
  spanIndexInput.disabled = !extractedText;
  spanIndexInput.max = data.count - 1;
}

// Update the span info panel
function updateSpanInfo(text, index) {
  const spanInfoDiv = document.getElementById("spanInfo");
  const spanTextDiv = document.getElementById("spanText");
  const spanLengthSpan = document.getElementById("spanLength");
  const spanWordsSpan = document.getElementById("spanWords");

  const words = text.split(/\s+/).filter(w => w.length > 0).length;
  const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;

  spanTextDiv.textContent = preview;
  spanLengthSpan.textContent = text.length;
  spanWordsSpan.textContent = words;
  spanInfoDiv.classList.add("visible");

  // Update label to show which span
  const label = spanInfoDiv.querySelector(".info-label");
  if (label) {
    label.textContent = `Span ${index}`;
  }
}

// Play audio for given text
async function playSpanAudio(text, spanIndex) {
  const out = document.getElementById("out");
  const playFirstBtn = document.getElementById("playFirst");
  const playSpanNBtn = document.getElementById("playSpanN");

  try {
    playFirstBtn.disabled = true;
    playSpanNBtn.disabled = true;
    out.textContent = `calling TTS API for span ${spanIndex}...`;

    const formData = new FormData();
    formData.append('text', text);

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
    lastPlayedAudioSize = audioBlob.size;

    // Display WAV file size
    const audioInfoDiv = document.getElementById("audioInfo");
    const wavSizeSpan = document.getElementById("wavSize");
    const sizeKB = (audioBlob.size / 1024).toFixed(2);
    wavSizeSpan.textContent = `${sizeKB} KB (${audioBlob.size} bytes)`;
    audioInfoDiv.classList.add("visible");

    // Enable estimate button now that we have audio
    document.getElementById("estimate").disabled = false;

    out.textContent = `playing span ${spanIndex}...`;

    audio.onended = () => {
      URL.revokeObjectURL(audioUrl);
      out.textContent = "playback complete";
      playFirstBtn.disabled = !firstSpanText;
      playSpanNBtn.disabled = !extractedText;
    };

    audio.onerror = (err) => {
      URL.revokeObjectURL(audioUrl);
      out.textContent = `playback error: ${err.message || 'unknown error'}`;
      playFirstBtn.disabled = !firstSpanText;
      playSpanNBtn.disabled = !extractedText;
    };

    await audio.play();
  } catch (err) {
    out.textContent = `TTS failed: ${err.message}`;
    playFirstBtn.disabled = !firstSpanText;
    playSpanNBtn.disabled = !extractedText;
  }
}

// Check for cached data on popup open
async function init() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  chrome.tabs.sendMessage(
    tab.id,
    { type: "getCache" },
    (res) => {
      if (res && res.cached) {
        restoreFromCache(res.cached);
        document.getElementById("out").textContent += " (cached)";
      }
    }
  );
}

init();

// Extract text button
document.getElementById("run").onclick = async () => {
  const out = document.getElementById("out");
  const copyBtn = document.getElementById("copy");
  const openTabBtn = document.getElementById("openTab");
  const playFirstBtn = document.getElementById("playFirst");
  const playSpanNBtn = document.getElementById("playSpanN");
  const spanIndexInput = document.getElementById("spanIndex");
  const estimateBtn = document.getElementById("estimate");

  // Reset audio size tracking
  lastPlayedAudioSize = 0;

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  chrome.tabs.sendMessage(
    tab.id,
    { type: "count" },
    (res) => {
      if (!res) {
        out.textContent = "no response, try reloading the page.";
        copyBtn.disabled = true;
        openTabBtn.disabled = true;
        playFirstBtn.disabled = true;
        playSpanNBtn.disabled = true;
        spanIndexInput.disabled = true;
        estimateBtn.disabled = true;
        return;
      }

      extractedText = res.text;
      firstSpanText = res.firstSpanText;
      totalSpanCount = res.count;
      const charCount = extractedText.length;
      const wordCount = extractedText.split(/\s+/).filter(w => w.length > 0).length;

      out.textContent = `spans: ${res.count} | words: ${wordCount} | chars: ${charCount}`;

      // Update first span info
      if (firstSpanText) {
        updateSpanInfo(firstSpanText, 0);
      }

      // Enable buttons if we have text
      copyBtn.disabled = !extractedText;
      openTabBtn.disabled = !extractedText;
      playFirstBtn.disabled = !firstSpanText;
      playSpanNBtn.disabled = !extractedText;
      spanIndexInput.disabled = !extractedText;
      spanIndexInput.max = res.count - 1;
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
    out.textContent = "copied to clipboard!";
    setTimeout(() => {
      out.textContent = originalText;
    }, 2000);
  } catch (err) {
    document.getElementById("out").textContent = `copy failed: ${err.message}`;
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

// Play first span
document.getElementById("playFirst").onclick = async () => {
  if (!firstSpanText) return;
  updateSpanInfo(firstSpanText, 0);
  await playSpanAudio(firstSpanText, 0);
};

// Play span N
document.getElementById("playSpanN").onclick = async () => {
  const spanIndex = parseInt(document.getElementById("spanIndex").value, 10);
  const out = document.getElementById("out");

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  chrome.tabs.sendMessage(
    tab.id,
    { type: "getSpanText", index: spanIndex },
    async (res) => {
      if (!res || !res.ok) {
        out.textContent = res?.error || "failed to get span text";
        return;
      }

      updateSpanInfo(res.text, res.index);
      await playSpanAudio(res.text, res.index);
    }
  );
};

// Calculate estimated full audio size
document.getElementById("estimate").onclick = () => {
  const spanIndex = parseInt(document.getElementById("spanIndex").value, 10) || 0;
  const spanInfoLabel = document.querySelector("#spanInfo .info-label");
  const currentSpanChars = parseInt(document.getElementById("spanLength").textContent, 10);

  if (!lastPlayedAudioSize || !currentSpanChars || !extractedText) return;

  const totalChars = extractedText.length;

  // Calculate bytes per character ratio
  const ratio = lastPlayedAudioSize / currentSpanChars;

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
