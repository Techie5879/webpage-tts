function getSelectionText() {
  const selection = window.getSelection();
  if (selection && selection.toString().trim()) {
    return selection.toString().trim();
  }
  return "";
}

function getPageText() {
  const text = document.body ? document.body.innerText : "";
  return text ? text.trim() : "";
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "ping") {
    console.log("[WebpageTTS] content ping");
    sendResponse({ ok: true });
    return;
  }

  if (message.type === "get_text") {
    const source = message.source || "selection";
    const text = source === "page" ? getPageText() : getSelectionText() || getPageText();
    console.log("[WebpageTTS] content get_text", source, text?.length || 0);
    sendResponse({ text });
    return;
  }
});
