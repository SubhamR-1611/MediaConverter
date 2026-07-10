// Client-side Application Logic for MediaConvert

document.addEventListener('DOMContentLoaded', () => {
  // App State
  let currentPlatform = null;
  let currentFormat = null;
  let activeTaskId = null;
  let statusPollInterval = null;

  // API Configuration (Update this URL after deploying your backend on Render/Railway)
  const API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? ''
    : 'https://mediaconverter-7li5.onrender.com';

  // DOM Elements
  const platformView = document.getElementById('platform-view');
  const formatView = document.getElementById('format-view');
  const inputView = document.getElementById('input-view');

  const btnYt = document.getElementById('btn-yt');
  const btnIg = document.getElementById('btn-ig');
  const btnSnap = document.getElementById('btn-snap');

  const btnMp3 = document.getElementById('btn-mp3');
  const btnMp4 = document.getElementById('btn-mp4');
  const backToPlatforms = document.getElementById('back-to-platforms');
  const backToFormats = document.getElementById('back-to-formats');

  const urlInput = document.getElementById('url-input');
  const clearInput = document.getElementById('clear-input');
  const inputViewDesc = document.getElementById('input-view-desc');

  const actionButtonsContainer = document.querySelector('.action-buttons-container');
  const mp3Actions = document.getElementById('mp3-actions');
  const mp4Actions = document.getElementById('mp4-actions');

  const btnConvertMp3 = document.getElementById('btn-convert-mp3');
  const btnConvertMp4Audio = document.getElementById('btn-convert-mp4-audio');
  const btnConvertMp4NoAudio = document.getElementById('btn-convert-mp4-noaudio');

  const statusContainer = document.getElementById('status-container');
  const statusText = document.getElementById('status-text');
  const progressBarFill = document.getElementById('progress-bar-fill');

  const downloadContainer = document.getElementById('download-container');
  const downloadTitle = document.getElementById('download-title');
  const mediaBadge = document.getElementById('media-badge');
  const btnDownloadFile = document.getElementById('btn-download-file');
  const btnConvertAnother = document.getElementById('btn-convert-another');

  const errorContainer = document.getElementById('error-container');
  const errorText = document.getElementById('error-text');
  const btnTryAgain = document.getElementById('btn-try-again');

  // VIEW NAVIGATION HELPERS
  function switchView(fromView, toView) {
    fromView.classList.remove('active');
    setTimeout(() => {
      toView.classList.add('active');
    }, 200); // Wait for transition fade-out
  }

  function getPlatformName(platform) {
    switch (platform) {
      case 'youtube': return 'YouTube';
      case 'instagram': return 'Instagram';
      case 'snapchat': return 'Snapchat';
      default: return 'Social Media';
    }
  }

  // 1. PLATFORM SELECTION ACTIONS
  btnYt.addEventListener('click', () => selectPlatform('youtube'));
  btnIg.addEventListener('click', () => selectPlatform('instagram'));
  btnSnap.addEventListener('click', () => selectPlatform('snapchat'));

  function selectPlatform(platform) {
    currentPlatform = platform;
    switchView(platformView, formatView);
  }

  // 2. FORMAT SELECTION ACTIONS
  btnMp3.addEventListener('click', () => selectFormat('mp3'));
  btnMp4.addEventListener('click', () => selectFormat('mp4'));

  backToPlatforms.addEventListener('click', () => {
    currentPlatform = null;
    switchView(formatView, platformView);
  });

  function selectFormat(format) {
    currentFormat = format;
    
    // Set up Input Screen descriptions and visible buttons
    const platformName = getPlatformName(currentPlatform);
    inputViewDesc.textContent = `Paste your ${platformName} link below to convert to ${format.toUpperCase()}`;
    urlInput.placeholder = `Paste ${platformName} link here...`;

    if (format === 'mp3') {
      mp3Actions.classList.add('active');
      mp4Actions.classList.remove('active');
    } else {
      mp3Actions.classList.remove('active');
      mp4Actions.classList.add('active');
    }

    resetInputScreen();
    switchView(formatView, inputView);
  }

  // 3. INPUT SCREEN ACTIONS
  backToFormats.addEventListener('click', () => {
    currentFormat = null;
    stopPolling();
    switchView(inputView, formatView);
  });

  // URL Input utilities (show/hide clear button)
  urlInput.addEventListener('input', () => {
    if (urlInput.value.trim().length > 0) {
      clearInput.style.display = 'flex';
    } else {
      clearInput.style.display = 'none';
    }
  });

  clearInput.addEventListener('click', () => {
    urlInput.value = '';
    clearInput.style.display = 'none';
    urlInput.focus();
  });

  // 4. CONVERSION TRIGGER ACTIONS
  btnConvertMp3.addEventListener('click', () => startConversion(true)); // MP3 is always audio
  btnConvertMp4Audio.addEventListener('click', () => startConversion(true)); // MP4 with audio
  btnConvertMp4NoAudio.addEventListener('click', () => startConversion(false)); // MP4 without audio

  async function startConversion(withAudio) {
    const url = urlInput.value.trim();
    if (!url) {
      alert('Please paste a link first!');
      urlInput.focus();
      return;
    }

    // Hide controls, show status container
    actionButtonsContainer.style.display = 'none';
    backToFormats.style.display = 'none';
    statusContainer.style.display = 'flex';
    progressBarFill.style.width = '0%';
    statusText.textContent = 'Connecting to server...';

    try {
      const response = await fetch(`${API_BASE}/api/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          platform: currentPlatform,
          format: currentFormat,
          withAudio
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Server error occurred');
      }

      const data = await response.json();
      activeTaskId = data.taskId;
      
      // Start polling
      startPolling();

    } catch (err) {
      showError(err.message || 'Failed to connect to the conversion server.');
    }
  }

  // 5. STATUS POLLING LOGIC
  function startPolling() {
    stopPolling(); // Safety clear
    
    let simulatedProgress = 0;
    
    statusPollInterval = setInterval(async () => {
      if (!activeTaskId) return;

      try {
        const response = await fetch(`${API_BASE}/api/status/${activeTaskId}`);
        if (!response.ok) {
          throw new Error('Failed to fetch status');
        }

        const data = await response.json();
        
        // Progress Simulation based on steps
        if (data.status === 'pending') {
          statusText.textContent = 'Waiting in queue...';
          simulatedProgress = Math.min(simulatedProgress + 2, 10);
        } else if (data.status === 'fetching_metadata') {
          statusText.textContent = 'Fetching media information...';
          simulatedProgress = Math.min(simulatedProgress + 3, 30);
        } else if (data.status === 'converting') {
          statusText.textContent = currentFormat === 'mp3' 
            ? 'Downloading and extracting audio...' 
            : 'Downloading video and audio streams...';
          simulatedProgress = Math.min(simulatedProgress + 1, 85);
        } else if (data.status === 'completed') {
          simulatedProgress = 100;
          progressBarFill.style.width = '100%';
          statusText.textContent = 'Conversion complete!';
          
          setTimeout(() => {
            showSuccess(data.title, data.format.toUpperCase());
          }, 600);
          
          stopPolling();
          return;
        } else if (data.status === 'failed') {
          showError(data.error || 'yt-dlp failed to download media. Ensure the link is correct and public.');
          stopPolling();
          return;
        }

        progressBarFill.style.width = `${simulatedProgress}%`;

      } catch (err) {
        console.error('Polling error:', err);
        // We do not stop immediately on a single network check failure to allow resilience
      }
    }, 1500);
  }

  function stopPolling() {
    if (statusPollInterval) {
      clearInterval(statusPollInterval);
      statusPollInterval = null;
    }
  }

  // 6. VIEW TRANSITION SUCCESS/ERROR STATES
  function showSuccess(title, formatLabel) {
    statusContainer.style.display = 'none';
    mediaBadge.textContent = formatLabel;
    downloadTitle.textContent = title;
    downloadContainer.style.display = 'flex';
  }

  function showError(msg) {
    statusContainer.style.display = 'none';
    errorText.textContent = msg;
    errorContainer.style.display = 'flex';
  }

  function resetInputScreen() {
    actionButtonsContainer.style.display = 'block';
    backToFormats.style.display = 'inline-flex';
    statusContainer.style.display = 'none';
    downloadContainer.style.display = 'none';
    errorContainer.style.display = 'none';
    
    // Clear status values
    progressBarFill.style.width = '0%';
    statusText.textContent = 'Starting conversion...';
    
    // Reset active tasks
    activeTaskId = null;
  }

  // 7. RESET / RESTART ACTIONS
  btnConvertAnother.addEventListener('click', () => {
    urlInput.value = '';
    clearInput.style.display = 'none';
    resetInputScreen();
    urlInput.focus();
  });

  btnTryAgain.addEventListener('click', () => {
    resetInputScreen();
    urlInput.focus();
  });

  // 8. FILE DOWNLOAD TRIGGER
  btnDownloadFile.addEventListener('click', () => {
    if (activeTaskId) {
      window.location.href = `${API_BASE}/api/download/${activeTaskId}`;
    }
  });
});
