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



document.getElementById("run").onclick = async () => {
  const out = document.getElementById("out");

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
        return;
      }
      out.textContent = `results: ${res.count}`;
    }
  );
};
