import {
  type BasicResponse,
  type ContentRequestMessage,
  type GetTextResponse,
  isContentRequestMessage,
  isRuntimeMessage,
} from "@/lib/messages";

function getSelectionText(): string {
  const selection = window.getSelection();
  if (selection && selection.toString().trim()) {
    return selection.toString().trim();
  }
  return "";
}

function getPageText(): string {
  const text = document.body ? document.body.innerText : "";
  return text ? text.trim() : "";
}

chrome.runtime.onMessage.addListener(
  (
    rawMessage: unknown,
    _sender: chrome.runtime.MessageSender,
    sendResponse: (response: BasicResponse | GetTextResponse) => void
  ) => {
    if (!isRuntimeMessage(rawMessage)) return;
    if (!isContentRequestMessage(rawMessage)) return;
    const message: ContentRequestMessage = rawMessage;

    if (message.type === "ping") {
      console.log("[WebpageTTS] content ping");
      sendResponse({ ok: true });
      return;
    }

    if (message.type === "get_text") {
      const source = message.source || "selection";
      const selectionText = getSelectionText();
      const pageText = getPageText();
      const usedSource = source;
      const text = usedSource === "selection" ? selectionText : pageText;
      const response: GetTextResponse = {
        text,
        sourceUsed: usedSource,
        selectionLen: selectionText.length,
        pageLen: pageText.length,
      };

      console.log("[WebpageTTS] content get_text", {
        requestedSource: source,
        sourceUsed: usedSource,
        selectionLen: selectionText.length,
        pageLen: pageText.length,
        resultLen: text.length,
        selectionText,
        pageText,
        resultText: text,
      });
      sendResponse(response);
      return;
    }
  }
);
