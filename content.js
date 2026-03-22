// content.js
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if(request.action === "detectVideo") {
      const manifestUrls = new Set();

      const addManifestUrl = (url) => {
        if(url && typeof url === 'string' && url.includes('videomanifest')) {
          manifestUrls.add(url);
        }
      };
      
      // Check if we can access the network requests
      if(window.performance && window.performance.getEntries) {
        const entries = window.performance.getEntries();
        for(let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          addManifestUrl(entry.name);
        }
      }
      
      // Look for video elements on the page
      const videoElements = document.querySelectorAll('video');
      for(let i = 0; i < videoElements.length; i++) {
        const video = videoElements[i];
        addManifestUrl(video.src);
      }
      
      if(manifestUrls.size > 0) {
        sendResponse({videoManifestUrls: Array.from(manifestUrls)});
        return true;
      }
      
      // Try to get manifest URL(s) from any source available
      const script = document.createElement('script');
      script.textContent = `
        (function() {
          const notifyIfManifest = function(url) {
            if(url && url.includes('videomanifest')) {
              window.postMessage({type: 'VIDEO_MANIFEST_FOUND', url: url}, '*');
            }
          };
          
          // Listen for video manifest URL messages from other scripts
          window.addEventListener('message', function(event) {
            if(event.data && event.data.type === 'VIDEO_MANIFEST_URL') {
              notifyIfManifest(event.data.url);
            }
          });
          
          // Watch for XHR requests
          const originalOpen = XMLHttpRequest.prototype.open;
          XMLHttpRequest.prototype.open = function(method, url) {
            notifyIfManifest(url);
            return originalOpen.apply(this, arguments);
          };

          // Watch for fetch calls
          if(window.fetch) {
            const originalFetch = window.fetch;
            window.fetch = function(input, init) {
              const url = typeof input === 'string' ? input : (input && input.url);
              notifyIfManifest(url);
              return originalFetch.call(this, input, init);
            };
          }
        })();
      `;
      
      document.head.appendChild(script);
      
      let responded = false;
      const respondWithFoundUrls = () => {
        if(!responded) {
          responded = true;
          sendResponse({videoManifestUrls: Array.from(manifestUrls)});
        }
      };

      // Listen for messages from the injected script
      const messageHandler = function(event) {
        if(event.data && event.data.type === 'VIDEO_MANIFEST_FOUND') {
          addManifestUrl(event.data.url);
          respondWithFoundUrls();
        }
      };

      window.addEventListener('message', messageHandler);
      
      // If we still don't have a URL, prompt the user to play the video and respond with empty list
      setTimeout(() => {
        if(manifestUrls.size === 0) {
          alert('Please start playing the video to detect the URL. Then click "Detect Video" again.');
        }
        respondWithFoundUrls();
        window.removeEventListener('message', messageHandler);
      }, 2000);
      
      // Return true to indicate we'll send a response asynchronously
      return true;
    }
  });



  chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
    if (request.action === "detectTranscript") {
        let transcriptUrl = null;

        if (window.performance && window.performance.getEntries) {
            const entries = window.performance.getEntries();
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                if (entry.name.includes('/streamContent?format=json')) {
                    transcriptUrl = entry.name;
                    break;
                }
            }
        }

        if (transcriptUrl) {
            fetch(transcriptUrl)
                .then(response => response.json())
                .then(data => sendResponse({ transcript: data }))
                .catch(() => sendResponse({ transcript: null }));
            return true;
        }

        sendResponse({ transcript: null });
    }
});
