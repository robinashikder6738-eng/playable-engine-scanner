// content.js v0.1.6
// Passive bridge for engine detection, only runs on explicit command

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "RUN_SCAN" && msg.scanId) {
    // Injected-probe.js is already injected by manifest or we inject it here
    // However, service_worker currently uses executeScript for MAIN world access 
    // which is more robust. We'll leave this bridge here for future use.
    
    // For now, we'll just acknowledge that we are ready
    sendResponse({ status: "ready", url: window.location.href });
  }
});

// We keep the message listener for probe results, but don't auto-inject
window.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'ENGINE_PROBE_RESULT') {
    // If needed, we could send this back to background
    // chrome.runtime.sendMessage({ action: 'PROBE_UPDATE', findings: event.data.findings });
  }
});
