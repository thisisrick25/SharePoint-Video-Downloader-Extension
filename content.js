// content.js
const SHAREPOINT_DOWNLOAD_ENDPOINT = '/_layouts/15/download.aspx';
const ONEDRIVE_PAGE_PATH = '/_layouts/15/onedrive.aspx';
const MP4_LINK_PATTERN = /\.mp4($|[?#/])/i;

const looksLikeUrl = (value) => {
  if (!value || typeof value !== 'string') return false;
  const lower = value.toLowerCase();
  return lower.startsWith('http://')
    || lower.startsWith('https://')
    || (value.startsWith('/') && !value.startsWith('//'))
    || lower.includes(ONEDRIVE_PAGE_PATH)
    || (MP4_LINK_PATTERN.test(value) && value.includes('/'));
};
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    if(request.action === "detectVideo") {
      const manifestUrls = new Set();

      const addVideoUrl = (url) => {
        if(!url || typeof url !== 'string') return;
        const quickLower = url.toLowerCase();
        if(!quickLower.includes('videomanifest') && !quickLower.includes('.mp4') && !quickLower.includes('onedrive.aspx')) {
          return;
        }
        try {
          const parsed = new URL(url, window.location.href);
          const href = parsed.href;
          const hrefLower = href.toLowerCase();

          // Existing behavior: collect videomanifest links immediately.
          if(hrefLower.includes('videomanifest')) {
            manifestUrls.add(href);
            return;
          }

          const pathLower = parsed.pathname.toLowerCase();
          const idParam = parsed.searchParams.get('id');
          const idLower = idParam ? idParam.toLowerCase() : '';
          const looksLikeVideo = pathLower.endsWith('.mp4')
            || pathLower.includes(ONEDRIVE_PAGE_PATH)
            || idLower.endsWith('.mp4');
          if(!looksLikeVideo) {
            return;
          }

          // OneDrive/SharePoint list view links: onedrive.aspx?id=<path to *.mp4>
          if(idParam && idLower.endsWith('.mp4')) {
            const base = `${parsed.protocol}//${parsed.host}`;
            let decodedPath;
            try {
              decodedPath = decodeURIComponent(idParam);
            } catch (e) {
              console.warn('SP Video Downloader: skipping malformed OneDrive item id', { idParam, error: e });
              return;
            }
            const normalizedPath = decodedPath.startsWith('/') ? decodedPath : `/${decodedPath}`;
            const sourceUrl = `${base}${normalizedPath}`;
            const downloadUrl = `${base}${SHAREPOINT_DOWNLOAD_ENDPOINT}?sourceurl=${encodeURIComponent(sourceUrl)}`;
            manifestUrls.add(downloadUrl);
            return;
          }

          // Direct mp4 links on the page; ensure they are download links.
          if(pathLower.endsWith('.mp4')) {
            const alreadyDownloadEndpoint = pathLower.includes('/download.aspx');
            if(alreadyDownloadEndpoint) {
              manifestUrls.add(href);
              return;
            }

            // Prefer SharePoint download.aspx to preserve auth context.
            const absoluteSource = parsed.href;
            const downloadUrl = `${parsed.protocol}//${parsed.host}${SHAREPOINT_DOWNLOAD_ENDPOINT}?sourceurl=${encodeURIComponent(absoluteSource)}`;
            manifestUrls.add(downloadUrl);
            return;
          }
        } catch (e) {
          console.warn('SP Video Downloader: skipping malformed video URL', { url, error: e });
        }
      };
      
      // Check if we can access the network requests
      if(window.performance && window.performance.getEntries) {
        const entries = window.performance.getEntries();
        for(let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          addVideoUrl(entry.name);
        }
      }
      
      // Look for video elements on the page
      const videoElements = document.querySelectorAll('video');
      for(let i = 0; i < videoElements.length; i++) {
        const video = videoElements[i];
        addVideoUrl(video.src);
      }

      // Look for list-view anchors that point to videos (even if not yet played)
      const anchorElements = document.querySelectorAll('a[href]');
      for(let i = 0; i < anchorElements.length; i++) {
        const href = anchorElements[i].href;
        const hrefLower = href.toLowerCase();
        const looksLikeVideoLink = hrefLower.includes('videomanifest')
          || MP4_LINK_PATTERN.test(href)
          || hrefLower.includes(ONEDRIVE_PAGE_PATH);
        if(!looksLikeVideoLink) continue;
        addVideoUrl(href);
      }

      // SharePoint list rows often store file URLs in data-* attributes without navigation.
      const attributeSelectors = [
        '[data-downloadurl]',
        '[data-href]',
        '[data-url]',
        '[data-linkhref]',
        '[data-item-path]',
        '[data-path]',
        '[data-file-path]',
        '[data-resource-path]',
        '[aria-label]'
      ];
      const candidateElements = document.querySelectorAll(attributeSelectors.join(','));
      for(let i = 0; i < candidateElements.length; i++) {
        const el = candidateElements[i];
        const attrs = [
          { key: 'data-downloadurl', value: el.getAttribute('data-downloadurl') },
          { key: 'data-href', value: el.getAttribute('data-href') },
          { key: 'data-url', value: el.getAttribute('data-url') },
          { key: 'data-linkhref', value: el.getAttribute('data-linkhref') },
          { key: 'data-item-path', value: el.getAttribute('data-item-path') },
          { key: 'data-path', value: el.getAttribute('data-path') },
          { key: 'data-file-path', value: el.getAttribute('data-file-path') },
          { key: 'data-resource-path', value: el.getAttribute('data-resource-path') }
        ];

        // data-downloadurl can be pipe- or colon-delimited; pick likely URL parts.
        attrs.forEach(entry => {
          const raw = entry.value;
          if (!raw) return;
          const candidateSet = new Set();

          raw.split('|').map(p => p.trim()).filter(Boolean).forEach(p => candidateSet.add(p));

          if (entry.key === 'data-downloadurl' && raw.includes(':')) {
            const queryIndex = raw.indexOf('?');
            const hashIndex = raw.indexOf('#');
            const boundaryCandidates = [queryIndex, hashIndex].filter(idx => idx >= 0);
            const boundary = boundaryCandidates.length ? Math.min(...boundaryCandidates) : raw.length;
            // SharePoint data-downloadurl is typically "mime/type:<actual-url>"; grab text after the first colon before any query/hash.
            const firstColon = raw.indexOf(':');
            const colonBeforeBoundary = firstColon > -1 && firstColon < boundary;
            if (colonBeforeBoundary) {
              const tail = raw.slice(firstColon + 1).trim();
              if (tail) {
                candidateSet.add(tail);
              }
            }
          }

          if (candidateSet.size === 0) {
            candidateSet.add(raw);
          }

          candidateSet.forEach(c => {
            if (!looksLikeUrl(c)) return;
            addVideoUrl(c);
          });
        });

        const ariaLabel = el.getAttribute('aria-label') || '';
        if (ariaLabel && MP4_LINK_PATTERN.test(ariaLabel)) {
          addVideoUrl(ariaLabel);
        }
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
          addVideoUrl(event.data.url);
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
