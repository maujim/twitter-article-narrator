// const API_URL = 'http://localhost:8000/tts';
// const WORD_THRESHOLD = 100;

// let state = {
//   running: false,
//   paused: false,
//   allSpans: [],
//   nextSpanIndex: 0,
//   currentBuffer: [],
//   currentBufferWords: 0,
//   queue: [], // {id, spans, audioUrl, ready, playing}
//   queueIdCounter: 0,
//   playedCount: 0,
//   currentAudio: null
// };


// function init() {
//   console.log('[narrator] initializing...');
//   console.log('[narrator] document ready:', document.readyState);
//   console.log('[narrator] document body:', document.body ? 'exists' : 'MISSING');
  
//   // try different selectors to debug
//   const selector1 = 'span[data-text="true"]';
//   const selector2 = 'span[data-text]';
//   const selector3 = 'span';
  
//   const result1 = document.querySelectorAll(selector1);
//   const result2 = document.querySelectorAll(selector2);
//   const result3 = document.querySelectorAll(selector3);
  
//   console.log(`[narrator] "${selector1}": ${result1.length}`);
//   console.log(`[narrator] "${selector2}": ${result2.length}`);
//   console.log(`[narrator] "${selector3}": ${result3.length}`);
  
//   if (result1.length > 0) {
//     console.log('[narrator] first span:', result1[0], result1[0].textContent.substring(0, 100));
//   }
  
//   if (result2.length > 0 && result1.length === 0) {
//     console.log('[narrator] spans with data-text but not "true":', result2[0].getAttribute('data-text'));
//   }
  
//   state.allSpans = Array.from(result1);
//   console.log('[narrator] final span count:', state.allSpans.length);
//   updatePopup();
// }

// function countWords(text) {
//   return text.split(/\s+/).filter(w => w.length > 0).length;
// }

// function addToBuffer(span) {
//   const words = countWords(span.textContent);
//   state.currentBuffer.push(span);
//   state.currentBufferWords += words;
  
//   if (state.currentBufferWords >= WORD_THRESHOLD) {
//     submitBuffer();
//   }
// }

// async function submitBuffer() {
//   if (state.currentBuffer.length === 0) return;
  
//   const requestId = state.queueIdCounter++;
//   const formData = new FormData();
  
//   state.currentBuffer.forEach((span, i) => {
//     formData.append(`text_${i}`, span.textContent);
//   });
  
//   state.queue.push({
//     id: requestId,
//     spans: [...state.currentBuffer],
//     audioUrl: null,
//     ready: false,
//     playing: false
//   });
  
//   state.currentBuffer = [];
//   state.currentBufferWords = 0;
  
//   updatePopup();
  
//   // send to api
//   try {
//     const response = await fetch(API_URL, {
//       method: 'POST',
//       body: formData
//     });
    
//     if (!response.ok) {
//       throw new Error(`api error: ${response.status}`);
//     }
    
//     const blob = await response.blob();
//     const audioUrl = URL.createObjectURL(blob);
    
//     const queueItem = state.queue.find(q => q.id === requestId);
//     if (queueItem) {
//       queueItem.audioUrl = audioUrl;
//       queueItem.ready = true;
//       updatePopup();
//       checkAndPlay();
//     }
//   } catch (err) {
//     sendError(`request ${requestId} failed: ${err.message}`);
//     updatePopup();
//   }
// }

// function checkAndPlay() {
//   if (!state.running || state.paused) return;
//   if (state.queue.length === 0) return;
//   if (state.currentAudio) return; // already playing
  
//   const nextItem = state.queue[0];
//   if (!nextItem.ready) return;
  
//   playItem(nextItem);
// }

// function playItem(item) {
//   state.currentAudio = new Audio(item.audioUrl);
//   item.playing = true;
//   updatePopup();
  
//   // scroll to first span in this batch
//   if (item.spans.length > 0) {
//     item.spans[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
//   }
  
//   state.currentAudio.onended = () => {
//     item.playing = false;
//     state.playedCount += item.spans.length;
//     state.queue.shift();
//     state.currentAudio = null;
//     updatePopup();
    
//     // scroll to last span we just finished
//     if (item.spans.length > 0) {
//       item.spans[item.spans.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
//     }
    
//     // if we're done with all spans and queue is empty, auto stop
//     if (state.nextSpanIndex >= state.allSpans.length && state.queue.length === 0) {
//       stop();
//       sendInfo('finished');
//     } else {
//       // keep buffering if needed
//       fillBuffer();
//       checkAndPlay();
//     }
//   };
  
//   state.currentAudio.play().catch(err => {
//     sendError(`playback failed: ${err.message}`);
//   });
// }

// function fillBuffer() {
//   if (state.queue.length >= 2) return; // we have enough in flight
  
//   while (state.nextSpanIndex < state.allSpans.length && state.currentBufferWords < WORD_THRESHOLD) {
//     const span = state.allSpans[state.nextSpanIndex];
//     state.nextSpanIndex++;
//     addToBuffer(span);
//   }
  
//   // if we've reached the end and have a partial buffer, submit it
//   if (state.nextSpanIndex >= state.allSpans.length && state.currentBuffer.length > 0) {
//     submitBuffer();
//   }
  
//   updatePopup();
// }

// function start() {
//   console.log("Hi")
//   if (state.allSpans.length === 0) {
//     sendError('no spans found on this page');
//     return;
//   }
  
//   state.running = true;
//   state.paused = false;
//   state.nextSpanIndex = 0;
//   state.playedCount = 0;
  
//   fillBuffer();
//   checkAndPlay();
//   updatePopup();
// }

// function pause() {
//   state.paused = true;
//   if (state.currentAudio) {
//     state.currentAudio.pause();
//   }
//   updatePopup();
// }

// function resume() {
//   state.paused = false;
//   if (state.currentAudio) {
//     state.currentAudio.play();
//   }
//   checkAndPlay();
//   updatePopup();
// }

// function stop() {
//   state.running = false;
//   state.paused = false;
  
//   if (state.currentAudio) {
//     state.currentAudio.pause();
//     state.currentAudio = null;
//   }
  
//   // revoke all audio URLs
//   state.queue.forEach(item => {
//     if (item.audioUrl) {
//       URL.revokeObjectURL(item.audioUrl);
//     }
//   });
  
//   state.queue = [];
//   state.currentBuffer = [];
//   state.currentBufferWords = 0;
//   state.nextSpanIndex = 0;
//   state.playedCount = 0;
  
//   updatePopup();
// }

// function updatePopup() {
//   const stats = {
//     spansFound: state.allSpans.length,
//     buffered: state.currentBuffer.length,
//     inFlight: state.queue.filter(q => !q.ready).length,
//     played: state.playedCount
//   };
  
//   const statusMsg = state.running 
//     ? (state.paused ? 'paused' : 'playing')
//     : 'stopped';
  
//   chrome.runtime.sendMessage({
//     type: 'update',
//     stats,
//     status: statusMsg
//   }).catch(() => {}); // ignore if popup is closed
// }

// function sendError(msg) {
//   chrome.runtime.sendMessage({
//     type: 'error',
//     error: msg
//   }).catch(() => {});
// }

// function sendInfo(msg) {
//   chrome.runtime.sendMessage({
//     type: 'info',
//     info: msg
//   }).catch(() => {});
// }

// // listen for commands from popup
// chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
//   if (msg.action === 'start') {
//     start();
//   } else if (msg.action === 'pause') {
//     if (state.paused) resume();
//     else pause();
//   } else if (msg.action === 'stop') {
//     stop();
//   }
//   sendResponse({ ok: true });
// });

// // initialize on page load
// console.log('=== CONTENT SCRIPT LOADED ===');
// console.log('Location:', window.location.href);
// console.log('Chrome runtime available:', typeof chrome !== 'undefined' && typeof chrome.runtime !== 'undefined');
// init();



chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== "count") return;

  const selector = 'span[data-text="true"]';

  const nodes = document.querySelectorAll(selector);

  sendResponse({ count: nodes.length });
  return true; // THIS is the fix
});
