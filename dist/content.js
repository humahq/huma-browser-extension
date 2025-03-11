(function () {

  // Constants
  const EVENTS = {
    // incoming
    INIT: "INIT", // before setting up extension
    SCRAPE: "SCRAPE", // command for scrape
    ACK: "ACK", // command for ack

    // outgoing
    INIT_SUCCESS: "INIT_SUCCESS", // to the huma client indicates extension setup complete
    ACK_SUCCESS: "ACK_SUCCESS", // to the huma client indicates ack complete
    REQUEST_SCRAPE_DATA: "REQUEST_SCRAPE_DATA", // request to scrape data
    REQUEST_ALL_URLS: "REQUEST_ALL_URLS", // request to get all urls
    HTML_CONTENT: "HTML_CONTENT", // for sending html content
  };

  // Utility function for safe HTML extraction
  function safeExtractHTML() {
    try {
      return {
        html: document.documentElement.outerHTML,
        url: window.location.href,
        title: document.title,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      console.error("Error extracting HTML:", error);
      return null;
    }
  }

  // utility function to send message to background script or extension service worker
  async function sendMessageToBackground(message) {
    try {
      // @ts-ignore
      return await browser.runtime.sendMessage(message);
    } catch (error) {
      console.error("Error sending message:", error);
      throw error;
    }
  }

  // Main extraction function with validation
  async function extractAndSendHTML() {
    try {
      const content = safeExtractHTML();
      if (!content) throw new Error("Failed to extract HTML content");

      await sendMessageToBackground({
        type: EVENTS.HTML_CONTENT,
        content: content.html,
        url: content.url,
        metadata: {
          title: content.title,
          timestamp: content.timestamp,
        },
      });
    } catch (error) {
      console.error("Error in content script:", error);
      throw error;
    }
  }

  // Event handlers with proper cleanup
  function setupEventListeners() {
    const handlers = {
      [EVENTS.REQUEST_SCRAPE_DATA]: (event) => {
        sendMessageToBackground({
          type: EVENTS.REQUEST_SCRAPE_DATA,
          url: event.detail,
        });
      },
      [EVENTS.REQUEST_ALL_URLS]: () => {
        sendMessageToBackground({
          type: EVENTS.REQUEST_ALL_URLS,
        });
      },
      [EVENTS.ACK]: () => {
        window.dispatchEvent(new CustomEvent(EVENTS.ACK_SUCCESS));
      },
    };

    // Add listeners
    Object.entries(handlers).forEach(([event, handler]) => {
      window.addEventListener(event, handler);
    });

    // Return cleanup function
    return () => {
      Object.entries(handlers).forEach(([event, handler]) => {
        window.removeEventListener(event, handler);
      });
    };
  }

  // Automatically run when content script is injected
  function init() {
    setupEventListeners();
    window.dispatchEvent(new CustomEvent(EVENTS.INIT_SUCCESS));
  }

  init();

  // Listen for messages from extension service worker or background script
  // @ts-ignore
  browser.runtime.onMessage.addListener((message) => {
    if (message.action === EVENTS.INIT) {
      init();
    } else if (message.action === EVENTS.SCRAPE) {
      extractAndSendHTML();
    } else {
      window.dispatchEvent(new CustomEvent(message.type, { detail: message }));
    }
  });

}())
