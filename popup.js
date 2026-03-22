document.addEventListener('DOMContentLoaded', function() {
  if (typeof chrome === 'undefined' || !chrome.tabs || !chrome.storage || !chrome.runtime) {
    console.warn('Chrome extension APIs unavailable; popup.js inactive.');
    return;
  }

  const detectButton = document.getElementById('detect-video');
  const copyCommandButton = document.getElementById('copy-command');
  const copyAllCommandsButton = document.getElementById('copy-all-commands');
  const filenameInput = document.getElementById('filename');
  const videoInfo = document.getElementById('video-info');
  const videoCountLabel = document.getElementById('video-count');
  const commandSection = document.getElementById('command-section');
  const ffmpegCommand = document.getElementById('ffmpeg-command');
  const copyToClipboard = document.getElementById('copy-to-clipboard');
  const statusDiv = document.getElementById('status');
  const showSettingsBtn = document.getElementById('show-settings');
  const settingsPanel = document.getElementById('settings-panel');
  const mainPanel = document.getElementById('main-panel');
  const saveSettingsBtn = document.getElementById('save-settings');
  const backToMainBtn = document.getElementById('back-to-main');
  const ffmpegPathInput = document.getElementById('ffmpeg-path');
  const downloadFolderInput = document.getElementById('download-folder');
  const videoListSection = document.getElementById('video-list-section');
  const videoSelect = document.getElementById('video-select');
  const downloadTranscriptButton = document.getElementById('download-transcript');

  let videoUrls = [];
  let selectedVideoUrl = null;
  let transcriptData = null;
  let autoDetectedFfmpegPath = '';

  const showStatus = (message, isSuccess) => {
    statusDiv.textContent = message;
    statusDiv.style.backgroundColor = isSuccess ? '#d4edda' : '#f8d7da';
    setTimeout(() => {
      statusDiv.textContent = '';
      statusDiv.style.backgroundColor = 'transparent';
    }, 2000);
  };

  const getPlatformDefaultFfmpegPaths = (osName) => {
    if(osName === 'win') {
      return [
        'C:\\\\ProgramData\\\\chocolatey\\\\lib\\\\ffmpeg\\\\tools\\\\ffmpeg\\\\bin\\\\ffmpeg.exe',
        'C:\\\\ProgramData\\\\chocolatey\\\\bin\\\\ffmpeg.exe',
        'C:\\\\ffmpeg\\\\bin\\\\ffmpeg.exe',
        'C:\\\\Program Files\\\\ffmpeg\\\\bin\\\\ffmpeg.exe',
        'ffmpeg.exe'
      ];
    }
    if(osName === 'mac') {
      return [
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        'ffmpeg'
      ];
    }
    // linux or other unix
    return [
      '/usr/bin/ffmpeg',
      '/usr/local/bin/ffmpeg',
      'ffmpeg'
    ];
  };

  const detectPlatformAndSetFfmpeg = () => {
    const applyAutoPath = (osName) => {
      const candidates = getPlatformDefaultFfmpegPaths(osName);
      autoDetectedFfmpegPath = candidates[0] || 'ffmpeg';
      if(!ffmpegPathInput.value && autoDetectedFfmpegPath) {
        ffmpegPathInput.value = autoDetectedFfmpegPath;
        showStatus(`FFmpeg path auto-detected for ${osName === 'win' ? 'Windows' : osName === 'mac' ? 'macOS' : 'Linux/Unix'}.`, true);
      }
    };

    if(chrome.runtime && chrome.runtime.getPlatformInfo) {
      chrome.runtime.getPlatformInfo(function(info) {
        applyAutoPath(info?.os || 'linux');
      });
    } else {
      const platform = navigator.userAgent.toLowerCase().includes('win') ? 'win'
        : navigator.userAgent.toLowerCase().includes('mac') ? 'mac'
        : 'linux';
      applyAutoPath(platform);
    }
  };

  // Load saved settings and attempt FFmpeg auto-detection
  chrome.storage.local.get(['ffmpegPath', 'downloadFolder'], function(result) {
    if(result.ffmpegPath) ffmpegPathInput.value = result.ffmpegPath;
    if(result.downloadFolder) downloadFolderInput.value = result.downloadFolder;
    if(!result.ffmpegPath) {
      detectPlatformAndSetFfmpeg();
    }
  });

  // Settings panel toggle
  showSettingsBtn.addEventListener('click', function() {
    mainPanel.classList.add('hidden');
    settingsPanel.classList.remove('hidden');
  });

  backToMainBtn.addEventListener('click', function() {
    settingsPanel.classList.add('hidden');
    mainPanel.classList.remove('hidden');
  });

  saveSettingsBtn.addEventListener('click', function() {
    chrome.storage.local.set({
      ffmpegPath: ffmpegPathInput.value,
      downloadFolder: downloadFolderInput.value
    }, function() {
      showStatus('Settings saved!', true);
      settingsPanel.classList.add('hidden');
      mainPanel.classList.remove('hidden');
    });
  });

  const renderVideoOptions = (urls) => {
    if(!videoSelect || !videoListSection) return;
    videoSelect.innerHTML = '';

    urls.forEach((url, index) => {
      const option = document.createElement('option');
      option.value = url;
      option.textContent = buildOptionLabel(url, index);
      videoSelect.appendChild(option);
    });

    videoSelect.value = selectedVideoUrl || '';
    videoListSection.classList.toggle('hidden', urls.length <= 1);
  };

  const buildOptionLabel = (url, index) => {
    try {
      const parsed = new URL(url);
      const lastPath = parsed.pathname.split('/').filter(Boolean).pop();
      const friendlyPath = lastPath ? ` / ${lastPath}` : '';
      return `${index + 1}. ${parsed.hostname}${friendlyPath}`;
    } catch (e) {
      return `${index + 1}. ${url}`;
    }
  };

  const updateVideoState = (urls) => {
    videoUrls = urls;
    selectedVideoUrl = urls[0] || null;
    copyCommandButton.disabled = !urls.length;
    copyAllCommandsButton.disabled = !urls.length;

    if(urls.length) {
      videoInfo.classList.remove('hidden');
      if(videoCountLabel) {
        videoCountLabel.textContent = urls.length > 1 
          ? `Detected ${urls.length} videos. Select one or copy all commands.`
          : 'Video detected! Ready to download.';
      }
      renderVideoOptions(urls);
    } else {
      videoInfo.classList.add('hidden');
      if(videoListSection) videoListSection.classList.add('hidden');
    }
  };

  // Detect video from current tab and get page title
  detectButton.addEventListener('click', function() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
      chrome.tabs.sendMessage(tabs[0].id, {action: "detectVideo"}, function(response) {
        if (chrome.runtime.lastError) {
          updateVideoState([]);
          showStatus('Unable to detect video on this page.', false);
          return;
        }

        const manifestList = Array.isArray(response?.videoManifestUrls) && response.videoManifestUrls.length
          ? response.videoManifestUrls
          : (response?.videoManifestUrl ? [response.videoManifestUrl] : []);

        if(manifestList.length) {
          const processedUrls = Array.from(new Set(manifestList.map(processManifestUrl)));
          updateVideoState(processedUrls);

          // Get the title of the current tab's page
          const pageTitle = tabs[0].title || 'video';  // Default to 'video' if no title is available
          filenameInput.value = pageTitle; // Set filename to the page title

          showStatus(`Detected ${processedUrls.length} video${processedUrls.length > 1 ? 's' : ''}!`, true);
        } else {
          updateVideoState([]);
          showStatus('No video detected. Make sure you are on a page with a SharePoint or Streams video.', false);
        }
      });
    });
  });

  // Generate FFmpeg command for selected video
  copyCommandButton.addEventListener('click', function() {
    if(!selectedVideoUrl) {
      showStatus('No video URL detected.', false);
      return;
    }
  
    chrome.storage.local.get(['ffmpegPath', 'downloadFolder'], function(result) {
      const filename = filenameInput.value || 'video.mp4'; // Now uses the title of the page or default 'video.mp4'
      const ffmpegPath = result.ffmpegPath || ffmpegPathInput.value || autoDetectedFfmpegPath || 'ffmpeg';
      const downloadFolder = result.downloadFolder || '.';
      const outputPath = downloadFolder ? `${downloadFolder}/${filename}` : filename;
      
      // Create the command
      const command = `${ffmpegPath} -i "${selectedVideoUrl}" -codec copy "${outputPath}"`;
      
      // Display the command
      ffmpegCommand.textContent = command;
      commandSection.classList.remove('hidden');
    });
  });

  // Copy command to clipboard (from the visible code block)
  copyToClipboard.addEventListener('click', function() {
    const command = ffmpegCommand.textContent;
    navigator.clipboard.writeText(command).then(() => {
      showStatus('Command copied to clipboard!', true);
    });
  });

  // Switch selected video when dropdown changes
  if(videoSelect) {
    videoSelect.addEventListener('change', function(event) {
      selectedVideoUrl = event.target.value;
    });
  }

  const buildFilenameWithIndex = (baseName, index, total) => {
    const lastDot = baseName.lastIndexOf('.');
    const hasExtension = lastDot > 0;
    if(total === 1) {
      return baseName;
    }
    if(hasExtension) {
      const name = baseName.substring(0, lastDot);
      const ext = baseName.substring(lastDot);
      return `${name}-${index + 1}${ext}`;
    }
    return `${baseName}-${index + 1}`;
  };

  // Copy FFmpeg commands for all detected videos
  copyAllCommandsButton.addEventListener('click', function() {
    if(!videoUrls.length) {
      showStatus('No videos detected to copy.', false);
      return;
    }

    chrome.storage.local.get(['ffmpegPath', 'downloadFolder'], function(result) {
      const baseName = filenameInput.value || 'video';
      const ffmpegPath = result.ffmpegPath || ffmpegPathInput.value || autoDetectedFfmpegPath || 'ffmpeg';
      const downloadFolder = result.downloadFolder || '.';

      const commands = videoUrls.map((url, index) => {
        const fileName = buildFilenameWithIndex(baseName, index, videoUrls.length);
        const outputPath = `${downloadFolder}/${fileName}`;
        return `${ffmpegPath} -i "${url}" -codec copy "${outputPath}"`;
      });

      const combined = commands.join('\n');
      ffmpegCommand.textContent = combined;
      commandSection.classList.remove('hidden');

      navigator.clipboard.writeText(combined).then(() => {
        showStatus('Commands for all videos copied!', true);
      });
    });
  });

  function processManifestUrl(url) {
    const indexPos = url.indexOf('index&format=dash');
    if(indexPos !== -1) {
      return url.substring(0, indexPos + 'index&format=dash'.length);
    }
    return url;
  }

  // Transcript detection
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    chrome.tabs.sendMessage(tabs[0].id, { action: "detectTranscript" }, function (response) {
        if (response && response.transcript) {
            transcriptData = response.transcript;
            downloadTranscriptButton.disabled = false;
            showStatus('Transcript detected!', true);
        } else {
            showStatus('No transcript detected.', false);
        }
    });
  });

  // Function to format time from "00:00:00.2800000" to "00:00:00,280"
  function formatSRTTime(time) {
      let parts = time.split('.')[0].split(':'); // Extract HH:MM:SS
      let milliseconds = time.split('.')[1]?.slice(0, 3) || "000"; // Take only the first three digits
      return `${parts[0]}:${parts[1]}:${parts[2]},${milliseconds}`;
  }

  // Convert transcript JSON to SRT format
  function convertToSRT(transcriptJson) {
      return transcriptJson.entries.map((entry, index) => {
          const start = formatSRTTime(entry.startOffset);
          const end = formatSRTTime(entry.endOffset);
          return `${index + 1}\n${start} --> ${end}\n${entry.text}\n`;
      }).join("\n");
  }

  // Download the transcript as an SRT file
  downloadTranscriptButton.addEventListener('click', function () {
      if (!transcriptData) return;

      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
          let pageTitle = tabs[0].title || 'video';  // Default to 'video' if no title is found
          let transcriptFilename = pageTitle.replace('.mp4', '') + ".srt";  // Replace .mp4 with .srt

          const srtContent = convertToSRT(transcriptData);
          const blob = new Blob([srtContent], { type: "text/plain" });
          const url = URL.createObjectURL(blob);

          const a = document.createElement("a");
          a.href = url;
          a.download = transcriptFilename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
      });
  });
});
