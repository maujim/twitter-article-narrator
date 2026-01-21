// Background service worker for handling HTTP requests to TTS server
// Content scripts on HTTPS pages cannot make HTTP requests due to mixed content blocking
// This proxy allows them to fetch from a configurable URL

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "fetchTTS") {
    const apiUrl = msg.apiUrl || 'http://localhost:8000';

    const formData = new FormData();
    formData.append('text', msg.text);

    fetch(`${apiUrl}/tts`, {
      method: 'POST',
      body: formData
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const reader = response.body.getReader();

        sendResponse({ type: 'start', ok: true });

        const readChunk = () => {
          reader.read().then(({ done, value }) => {
            if (done) {
              chrome.tabs.sendMessage(sender.tab.id, { type: 'ttsChunk', done: true });
              return;
            }
            chrome.tabs.sendMessage(sender.tab.id, {
              type: 'ttsChunk',
              done: false,
              value: Array.from(value)
            });
            readChunk();
          });
        };
        readChunk();
      })
      .catch(error => {
        sendResponse({ type: 'error', error: error.message });
      });

    return true;
  }
});
