document.addEventListener("DOMContentLoaded", () => {
  const btnToggle = document.getElementById("btn-toggle-player");
  const btnPlay = document.getElementById("btn-play-now");

  async function sendToActiveTab(payload) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) return;
    chrome.runtime.sendMessage({
      target: "CONTENT_TAB",
      tabId: tab.id,
      payload
    });
  }

  btnToggle.addEventListener("click", () => {
    sendToActiveTab({ action: "TOGGLE_WIDGET" });
    window.close();
  });

  btnPlay.addEventListener("click", () => {
    sendToActiveTab({ action: "SHOW_AND_PLAY" });
    window.close();
  });
});
