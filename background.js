// Background Service Worker for Natural Voice Reader (Manifest V3 - v1.1.0)

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "nvr-read-selection",
    title: "Read with Natural Voice Reader",
    contexts: ["selection", "page"]
  });

  chrome.storage.local.get(["nvrSettings"], (res) => {
    if (!res.nvrSettings) {
      chrome.storage.local.set({
        nvrSettings: {
          rate: 1.0,
          voiceURI: "",
          flowMode: "fluent",
          clickToRead: true,
          autoScroll: true,
          widgetVisible: true
        }
      });
    }
  });
});

async function sendMessageToTab(tabId, message) {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch (err) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ["content.js"]
      });
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (injectErr) {
      console.warn("Could not inject content script on this page:", injectErr);
      return null;
    }
  }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "nvr-read-selection" && tab && tab.id) {
    sendMessageToTab(tab.id, {
      action: "SHOW_AND_PLAY",
      selectionText: info.selectionText || ""
    });
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-reader") {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      sendMessageToTab(tab.id, { action: "TOGGLE_WIDGET" });
    }
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === "CONTENT_TAB" && msg.tabId) {
    sendMessageToTab(msg.tabId, msg.payload).then((res) => sendResponse(res));
    return true;
  }
});
