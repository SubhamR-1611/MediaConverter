const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const youtubedl = require('youtube-dl-exec');
const ffmpegPath = require('ffmpeg-static');

const app = express();
const PORT = process.env.PORT || 3000;

// Enable CORS and JSON parsing
app.use(cors());
app.use(express.json());

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// Ensure temp directory exists
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

// In-memory store for conversion tasks
const tasks = {};

// Sanitize filename to prevent directory traversal and remove invalid characters
function sanitizeFilename(name) {
  return name
    .replace(/[\\/:*?"<>|]/g, '_') // Replace invalid Windows filename characters
    .replace(/\s+/g, ' ')          // Collapse multiple spaces
    .trim();
}

// Wrapper for youtubedl that tries cookies.txt and browser cookie databases sequentially
async function runYtdlWithFallbacks(url, options, platform) {
  let lastError = null;

  // Try 1: Standard (No cookies or user-supplied cookies)
  try {
    return await youtubedl(url, options);
  } catch (err) {
    lastError = err;
    console.log(`[YTDL-Fallback] Default download failed: ${err.message.substring(0, 150)}...`);
  }

  // Try 2: cookies.txt in project root directory
  const cookiesPath = path.join(__dirname, 'cookies.txt');
  if (fs.existsSync(cookiesPath)) {
    try {
      console.log(`[YTDL-Fallback] Found cookies.txt. Retrying with local cookies file...`);
      const newOptions = { ...options, cookies: cookiesPath };
      return await youtubedl(url, newOptions);
    } catch (err) {
      lastError = err;
      console.log(`[YTDL-Fallback] Download with cookies.txt failed: ${err.message.substring(0, 150)}...`);
    }
  }

  // Try 3: Browser fallbacks (ONLY on local environment; skip if running on Render/production server)
  const isCloudServer = process.env.RENDER || process.env.NODE_ENV === 'production' || __dirname.includes('render') || __dirname.includes('opt');
  if (!isCloudServer) {
    const browsers = ['firefox', 'edge', 'chrome'];
    for (const browser of browsers) {
      try {
        console.log(`[YTDL-Fallback] Retrying with cookies from browser: ${browser}...`);
        const newOptions = { ...options, cookiesFromBrowser: browser };
        return await youtubedl(url, newOptions);
      } catch (err) {
        lastError = err;
        console.log(`[YTDL-Fallback] Download with cookies from ${browser} failed: ${err.message.substring(0, 150)}...`);
      }
    }
  } else {
    console.log(`[YTDL-Fallback] Running on cloud server. Skipping browser cookie database fallbacks.`);
  }

  throw lastError;
}

// Background conversion runner
async function runConversion(taskId, url, format, withAudio) {
  const task = tasks[taskId];
  const platform = task.platform;

  try {
    task.status = 'fetching_metadata';
    console.log(`[Task ${taskId}] Fetching metadata for ${url}`);
    
    // Fetch video info first
    let info;
    try {
      info = await runYtdlWithFallbacks(url, {
        dumpJson: true,
        noWarnings: true,
        noCheckCertificates: true,
        preferFreeFormats: true,
      }, platform);
      task.title = sanitizeFilename(info.title || 'Downloaded_Media');
    } catch (metaError) {
      console.error(`[Task ${taskId}] Error fetching metadata:`, metaError);
      // Fallback title if we can't fetch metadata
      task.title = `media_${taskId}`;
    }

    task.status = 'converting';
    console.log(`[Task ${taskId}] Starting download & conversion. Format: ${format}, withAudio: ${withAudio}`);

    const options = {
      ffmpegLocation: ffmpegPath,
      output: path.join(tempDir, `${taskId}.%(ext)s`),
      noWarnings: true,
      noCheckCertificates: true,
    };

    if (format === 'mp3') {
      options.extractAudio = true;
      options.audioFormat = 'mp3';
      options.audioQuality = '0'; // Best quality
    } else { // mp4
      options.mergeOutputFormat = 'mp4';
      if (withAudio) {
        // Try MP4 first, fall back to best available video + best audio and merge into MP4
        options.format = 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bestvideo+bestaudio/best';
      } else {
        // Try MP4 video first, fall back to best video only
        options.format = 'bv*[ext=mp4]/b[ext=mp4]/bestvideo/best';
      }
    }

    // Run the yt-dlp binary via youtube-dl-exec with cookie fallbacks
    await runYtdlWithFallbacks(url, options, platform);

    // Verify file exists
    const expectedFilePath = path.join(tempDir, `${taskId}.${format}`);
    if (fs.existsSync(expectedFilePath)) {
      task.status = 'completed';
      task.filePath = expectedFilePath;
      task.ext = format;
      console.log(`[Task ${taskId}] Conversion completed successfully! File: ${expectedFilePath}`);
    } else {
      // Check if it saved with a slightly different extension or name
      const files = fs.readdirSync(tempDir);
      const matchedFile = files.find(f => f.startsWith(taskId));
      if (matchedFile) {
        task.status = 'completed';
        task.filePath = path.join(tempDir, matchedFile);
        task.ext = path.extname(matchedFile).substring(1);
        console.log(`[Task ${taskId}] Conversion completed. File found with fallback match: ${task.filePath}`);
      } else {
        throw new Error('Downloaded file not found after conversion');
      }
    }
  } catch (error) {
    console.error(`[Task ${taskId}] Conversion failed:`, error);
    tasks[taskId].status = 'failed';
    
    // Customize the error message if it fails due to authentication/cookies on Instagram
    let friendlyError = error.message || 'Unknown error occurred during conversion';
    const isCloudServer = process.env.RENDER || process.env.NODE_ENV === 'production' || __dirname.includes('render') || __dirname.includes('opt');

    if (platform === 'instagram' && (friendlyError.includes('login') || friendlyError.includes('empty media') || friendlyError.toLowerCase().includes('cookie') || friendlyError.includes('401'))) {
      if (isCloudServer) {
        friendlyError = "Instagram requires cookies to download Reels.\n\n" +
                        "Since this website is hosted on Render, you must place your exported 'cookies.txt' file (in Netscape format) in your GitHub repository's root folder and redeploy.";
      } else {
        friendlyError = "Instagram requires cookies to download Reels. To download this Reel:\n\n" +
                        "1. Open Chrome, Edge, or Firefox and log into your Instagram account.\n" +
                        "2. Close your browser completely (to unlock its cookie file) and click Convert again;\n\n" +
                        "OR: Export your Instagram cookies to a 'cookies.txt' file in Netscape format (using a browser extension like 'Get cookies.txt LOCALLY') and save it in the project root folder.";
      }
    } else if (friendlyError.toLowerCase().includes('confirm you are not a bot') || friendlyError.toLowerCase().includes('sign in') || friendlyError.toLowerCase().includes('bot') || friendlyError.toLowerCase().includes('format is not available')) {
      if (isCloudServer) {
        friendlyError = "This download was blocked by bot-detection. Cloud provider IP addresses (like Render) are heavily rate-limited by YouTube.\n\n" +
                        "To resolve this, you must run this website locally on your computer, OR place a 'cookies.txt' file in your GitHub repository root folder and redeploy.";
      } else {
        friendlyError = "YouTube bot-protection triggered. Please try playing the video in your browser first, or export your browser cookies to a 'cookies.txt' file in the project folder.";
      }
    }
    tasks[taskId].error = friendlyError;
  }
}

// 1. POST /api/convert - Start conversion
app.post('/api/convert', (req, res) => {
  const { url, platform, format, withAudio } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  const taskId = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  tasks[taskId] = {
    id: taskId,
    status: 'pending',
    platform: platform || 'unknown',
    format: format || 'mp3',
    withAudio: withAudio !== false, // Default to true
    title: null,
    filePath: null,
    ext: null,
    error: null,
    createdAt: Date.now()
  };

  // Run the conversion asynchronously
  runConversion(taskId, url, format, withAudio !== false);

  // Return the taskId immediately so client can poll
  res.json({ taskId });
});

// 2. GET /api/status/:id - Get status of a conversion task
app.get('/api/status/:id', (req, res) => {
  const taskId = req.params.id;
  const task = tasks[taskId];

  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json({
    id: task.id,
    status: task.status,
    title: task.title,
    error: task.error,
    format: task.format
  });
});

// 3. GET /api/download/:id - Download completed file
app.get('/api/download/:id', (req, res) => {
  const taskId = req.params.id;
  const task = tasks[taskId];

  if (!task) {
    return res.status(404).send('Task not found');
  }

  if (task.status !== 'completed' || !task.filePath || !fs.existsSync(task.filePath)) {
    return res.status(400).send('File is not ready or does not exist');
  }

  const safeTitle = task.title || 'download';
  const downloadName = `${safeTitle}.${task.ext}`;

  res.download(task.filePath, downloadName, (err) => {
    if (err) {
      console.error(`Error sending file for task ${taskId}:`, err);
    }
  });
});

// Cleanup files older than 15 minutes periodically (every 5 minutes)
setInterval(() => {
  const timeLimit = 15 * 60 * 1000; // 15 minutes
  const now = Date.now();

  fs.readdir(tempDir, (err, files) => {
    if (err) {
      console.error('Error reading temp directory for cleanup:', err);
      return;
    }

    files.forEach(file => {
      const filePath = path.join(tempDir, file);
      fs.stat(filePath, (statErr, stats) => {
        if (statErr) {
          console.error(`Error getting stats for ${file}:`, statErr);
          return;
        }

        if (now - stats.mtimeMs > timeLimit) {
          fs.unlink(filePath, (unlinkErr) => {
            if (unlinkErr) {
              console.error(`Error deleting expired file ${file}:`, unlinkErr);
            } else {
              console.log(`Cleaned up expired file: ${file}`);
            }
          });
        }
      });
    });
  });

  // Also clean up in-memory task metadata older than 1 hour
  Object.keys(tasks).forEach(taskId => {
    if (now - tasks[taskId].createdAt > 60 * 60 * 1000) {
      delete tasks[taskId];
    }
  });
}, 5 * 60 * 1000);

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
