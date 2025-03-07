import './browser-polyfill.js';

// Constants in a separate config section
const CONFIG = {
    blacklist: ['chrome://', 'edge://', '127.0.0.1', 'huma.ai'],
    retryAttempts: 3,
    retryDelay: 1000,
    tabLoadTimeout: 30000, // 30 seconds timeout for tab loading
};

// Utility function for better error handling
const handleError = (error, context) => {
    const errorDetails = {
        message: error.message,
        stack: error.stack,
        context,
        timestamp: new Date().toISOString()
    };
    console.error('Extension Error:', errorDetails);
    return { status: 'error', error: errorDetails };
};

// Add retry mechanism for message sending
async function sendMessageWithRetry(tabId, message, attempts = CONFIG.retryAttempts) {
    for (let i = 0; i < attempts; i++) {
        try {
            // @ts-ignore
            return await browser.tabs.sendMessage(tabId, message);
        } catch (error) {
            if (i === attempts - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, CONFIG.retryDelay));
        }
    }
}

// Improved tab loading with timeout
// @ts-ignore
async function waitForTabLoad(tabId) {
    return Promise.race([
        new Promise((resolve, reject) => {
            function listener(changedTabId, info) {
                if (changedTabId === tabId && info.status === 'complete') {
                    // @ts-ignore
                    browser.tabs.onUpdated.removeListener(listener);
                    resolve(true);
                }
            }
            // @ts-ignore
            browser.tabs.onUpdated.addListener(listener);
        }),
        new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Tab load timeout')), CONFIG.tabLoadTimeout)
        )
    ]);
}

// Main message handler with improved error handling
// @ts-ignore
browser.runtime.onMessage.addListener(async (message, sender) => {
    try {
        switch (message.type) {
            case 'HTML_CONTENT':
                return await sendToHumaWindow(message.content, message.url);
            case 'REQUEST_SCRAPE_DATA':
                return await handleScrapeRequest(message.url);
            default:
                throw new Error(`Unknown message type: ${message.type}`);
        }
    } catch (error) {
        return handleError(error, `Message handler: ${message.type}`);
    }
});

// Separated scraping logic
async function handleScrapeRequest(url) {
    try {
        // @ts-ignore
        const tabs = await browser.tabs.query({});
        let targetTab = tabs.find(tab => tab.url === url);
        
        if (!targetTab) {
            // @ts-ignore
            targetTab = await browser.tabs.create({ url, active: false });
            await waitForTabLoad(targetTab.id);
        }

        return await sendMessageWithRetry(targetTab.id, { action: 'SCRAPE' });
    } catch (error) {
        return handleError(error, 'handleScrapeRequest');
    }
}

// Function to send HTML content to Huma AI window
async function sendToHumaWindow(htmlContent, url) {
    try {
        // Open or focus existing Huma 
        
        // @ts-ignore
        const windows = await browser.windows.getAll({ populate: true });
        let humaWindows = windows
        const focusedWindow = humaWindows.find(w=>w.focused);
        // Send message to the Huma window
        if (focusedWindow && focusedWindow?.tabs && focusedWindow.tabs?.length > 0) {
            for(let tab of focusedWindow.tabs) {
                if (!CONFIG.blacklist.some(item => tab.url?.startsWith(item))) {
                    // @ts-ignore
                        await browser?.tabs?.sendMessage(tab.id, {
                            type: 'SCRAPED_DATA',
                            data: {
                                html: htmlContent,
                                sourceUrl: url,
                                timestamp: new Date().toISOString()
                            }
                        })
                        .catch(error => {
                            console.log("Error sending message:", error);
                        });
                }
            }
        }

        return { status: 'success' };
    } catch (error) {
        console.error('Failed to send to Huma window:', error);
        return { status: 'error', message: error.message };
    }
}

// Process all tabs when extension is installed
// @ts-ignore
browser.runtime.onInstalled.addListener(async () => {
    try {
        // @ts-ignore   
        const tabs = await browser.tabs.query({});
        for (const tab of tabs) {
            if (!CONFIG.blacklist.some(item => tab.url?.startsWith(item))) {
                try {
                    // @ts-ignore
                    await browser.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ['browser-polyfill.js']
                    });
                    // @ts-ignore
                    await browser?.scripting?.executeScript({
                        target: { tabId: tab.id },
                        files: ['content.js']
                    });
                    // @ts-ignore
                    await browser?.tabs?.sendMessage(tab.id, {
                        action: 'INIT'
                    })
                    .catch(error => {
                        console.log("Error sending message:", error);
                    });
                } catch (err) {
                    console.log(`Failed to inject into tab ${tab.id}:`, err);
                }
            }
        }
    } catch (error) {
        console.error('Error processing tabs:', error);
    }
});

// Process new tabs as they are created
// @ts-ignore
browser.tabs.onCreated.addListener((tab) => {
    // @ts-ignore
    browser.tabs.onUpdated.addListener(function listener(tabId, info) {
        if (tabId === tab.id && 
            info.status === 'complete' && 
            !CONFIG.blacklist.some(item => tab.url?.startsWith(item))) {
            // @ts-ignore
            browser.tabs.onUpdated.removeListener(listener);
            // @ts-ignore
            browser.scripting.executeScript({
                target: { tabId: tab.id },
                files: ['browser-polyfill.js']
            }).then(() => {
                // @ts-ignore
                return browser.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['content.js']
                });
            }).then(() => {
                // @ts-ignore
                return browser?.tabs?.sendMessage(tab.id, {
                    action: 'INIT'
                })
            }).catch(err => {
                console.log('Failed to inject content script:', err);
            });
        }
    });
});