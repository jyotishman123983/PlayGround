import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { config, durationPlans } from './config.mjs';
import { all, nowIso, one, run, transaction } from './db.mjs';
import { ApiError } from './errors.mjs';
import { getStyle, MODES } from './catalog.mjs';
import { getPricing, getSettings } from './settings.mjs';
import { randomToken } from './security.mjs';
import {
  refundTokensTx,
  reserveTokensTx,
  settleTokensTx,
  walletView
} from './wallet.mjs';

const activeRunners = new Set();
const demoDelay = Math.max(0, Number(process.env.DEMO_SCENE_DELAY_MS ?? 850));

class JobCancelledError extends Error {}

function planForDuration(duration) {
  return durationPlans[duration] || null;
}

function costForDuration(duration) {
  const plan = planForDuration(duration);
  if (!plan) throw new ApiError(400, 'INVALID_DURATION', 'Choose a 30-second Short or a 10-minute Long Video.');
  const pricing = getPricing();
  return { plan, cost: pricing[plan.costKey] };
}

function sceneSecondsFor(duration) {
  return duration === 30 ? 30 / config.generation.shortScenes : 600 / config.generation.longScenes;
}

function sceneTitles(count) {
  const beats = [
    'Cold open', 'Hook', 'Establishing shot', 'Context', 'Rising action', 'Detail shot',
    'Turning point', 'Reveal', 'Proof point', 'Emotional beat', 'Transition', 'Build-up',
    'Feature highlight', 'Payoff', 'Social proof', 'Call to action', 'Recap', 'Closing frame',
    'End card', 'Logo sting'
  ];
  return Array.from({ length: count }, (_, index) => beats[index % beats.length]);
}

function buildScenes({ prompt, style, mode, duration }) {
  const plan = planForDuration(duration);
  const count = duration === 30 ? config.generation.shortScenes : config.generation.longScenes;
  const sceneSeconds = duration / count;
  const titles = sceneTitles(count);
  const suffix = mode === 'image-to-video' ? ' Animate from the supplied reference image while preserving its subject.' : '';
  return Array.from({ length: count }, (_, index) => ({
    index: index + 1,
    title: `${titles[index]} — ${plan.label}`,
    durationSeconds: Number(sceneSeconds.toFixed(2)),
    status: 'queued',
    prompt: `${prompt.trim()}${suffix} Scene ${index + 1} of ${count}: ${style.prompt}. Keep visual continuity with the other scenes.`
  }));
}

export function publicJob(job, { includeScenes = true } = {}) {
  if (!job) return null;
  const scenes = parseScenes(job.scenes_json);
  const completed = job.status === 'completed';
  return {
    id: job.id,
    mode: job.mode,
    style: job.style,
    styleName: getStyle(job.style)?.name || job.style,
    prompt: job.prompt,
    targetDuration: job.target_duration,
    aspectRatio: job.aspect_ratio,
    sceneCount: job.scene_count,
    scenes: includeScenes ? scenes : undefined,
    currentScene: scenes.find(scene => scene.status === 'active')?.index || null,
    status: job.status,
    progress: job.progress,
    cost: job.cost,
    reservedAmount: job.reserved_amount,
    chargedAmount: job.charged_amount,
    isDemo: Boolean(job.is_demo),
    provider: job.provider,
    actualDuration: job.actual_duration,
    outputKind: job.output_kind,
    errorCode: job.error_code,
    errorMessage: job.error_message,
    refunded: Boolean(job.refunded),
    cancelRequested: Boolean(job.cancel_requested),
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    startedAt: job.started_at,
    completedAt: job.completed_at,
    downloadUrl: completed && job.output_kind === 'video' ? `/api/jobs/${job.id}/download` : null,
    manifestUrl: completed && job.output_kind === 'storyboard' ? `/api/jobs/${job.id}/manifest` : null,
    demoLabel: job.is_demo ? 'Demo simulation — not AI-generated' : null
  };
}

function parseScenes(json) {
  try { return JSON.parse(json || '[]'); } catch { return []; }
}

function getJob(id) {
  return one('SELECT * FROM video_jobs WHERE id = ?', id);
}

function updateScenes(jobId, scenes) {
  run('UPDATE video_jobs SET scenes_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(scenes), nowIso(), jobId);
}

function sceneProgress(sceneIndex, sceneCount, start = 8, end = 88) {
  if (sceneCount <= 0) return start;
  return Math.min(end, Math.round(start + ((end - start) * sceneIndex) / sceneCount));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ensureNotCancelled(jobId) {
  const row = one('SELECT cancel_requested, status FROM video_jobs WHERE id = ?', jobId);
  if (!row || row.cancel_requested || row.status === 'cancelled') throw new JobCancelledError('Job cancelled');
}

function parseImageData(dataUrl) {
  if (!dataUrl) throw new ApiError(400, 'IMAGE_REQUIRED', 'Choose an image for Image-to-Video.');
  const match = String(dataUrl).match(/^data:(image\/(png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new ApiError(400, 'INVALID_IMAGE', 'Upload a PNG, JPEG or WebP image.');
  const buffer = Buffer.from(match[3], 'base64');
  if (!buffer.length) throw new ApiError(400, 'INVALID_IMAGE', 'The uploaded image is empty.');
  if (buffer.length > config.generation.maxImageBytes) {
    throw new ApiError(413, 'IMAGE_TOO_LARGE', `Image must be smaller than ${Math.round(config.generation.maxImageBytes / 1024 / 1024)}MB.`);
  }
  const subtype = match[2];
  const png = buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const webp = buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP';
  if ((subtype === 'png' && !png) || (subtype === 'jpeg' && !jpeg) || (subtype === 'webp' && !webp)) {
    throw new ApiError(400, 'INVALID_IMAGE', 'The uploaded file does not match its image type.');
  }
  return { mime: match[1], buffer, extension: subtype === 'jpeg' ? 'jpg' : subtype };
}

export function createJob({ user, body, idempotencyKey, req }) {
  const settings = getSettings();
  if (settings.maintenance.enabled && user.role !== 'admin') {
    throw new ApiError(503, 'MAINTENANCE_MODE', settings.maintenance.message || 'ViralYantra AI is under maintenance.');
  }
  if (user.status !== 'active') throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.');

  const key = String(idempotencyKey || '').trim();
  if (!/^[A-Za-z0-9_.:-]{8,160}$/.test(key)) {
    throw new ApiError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required.');
  }
  const existing = one('SELECT * FROM video_jobs WHERE user_id = ? AND idempotency_key = ?', user.id, key);
  if (existing) return { job: publicJob(existing), duplicate: true, wallet: walletView(user) };

  const mode = String(body.mode || '');
  if (!MODES.includes(mode)) throw new ApiError(400, 'INVALID_MODE', 'Choose Text-to-Video or Image-to-Video.');
  const style = getStyle(String(body.style || ''));
  if (!style) throw new ApiError(400, 'INVALID_STYLE', 'Choose a valid video style.');
  const prompt = String(body.prompt || '').trim();
  if (prompt.length < 3 || prompt.length > config.generation.maxPromptLength) {
    throw new ApiError(400, 'INVALID_PROMPT', `Describe your video in 3 to ${config.generation.maxPromptLength} characters.`);
  }
  const duration = Number(body.duration);
  if (!Number.isInteger(duration) || !planForDuration(duration)) {
    throw new ApiError(400, 'INVALID_DURATION', 'Choose the 30-second Short or the 10-minute Long Video.');
  }
  const { plan, cost } = costForDuration(duration);
  const isDemo = Boolean(body.demo);
  if (isDemo) {
    if (!config.generation.demoEnabled) {
      throw new ApiError(403, 'DEMO_UNAVAILABLE', 'Demo simulation is disabled. Configure an AI video provider to generate real videos.');
    }
  } else if (!config.generation.configured) {
    throw new ApiError(503, 'AI_PROVIDER_NOT_CONFIGURED', 'No AI video provider is configured. Add Replicate credentials or use the clearly labelled development demo.', {
      provider: config.generation.provider,
      required: ['VIDEO_PROVIDER=replicate', 'REPLICATE_API_TOKEN', 'REPLICATE_VIDEO_MODEL']
    });
  } else {
    const sceneSeconds = sceneSecondsFor(duration);
    if (sceneSeconds > config.generation.replicateMaxSceneSeconds) {
      throw new ApiError(422, 'MODEL_DURATION_LIMITATION',
        `The connected model supports up to ${config.generation.replicateMaxSceneSeconds}s per scene, but this plan needs ${sceneSeconds}s scenes. The ${plan.label} cannot be generated faithfully with this model. No tokens were charged.`,
        { maxSceneSeconds: config.generation.replicateMaxSceneSeconds, requiredSceneSeconds: sceneSeconds }
      );
    }
  }

  let image = null;
  if (mode === 'image-to-video') image = parseImageData(body.imageDataUrl);

  const jobId = randomToken(16);
  let imagePath = null;
  if (image) {
    imagePath = join(config.dataDir, 'uploads', `${jobId}.${image.extension}`);
    writeFileSync(imagePath, image.buffer, { mode: 0o600 });
  }

  const timestamp = nowIso();
  const scenes = buildScenes({ prompt, style, mode, duration });
  const providerName = isDemo ? 'demo' : config.generation.provider;

  try {
    const result = transaction(() => {
      const currentUser = one('SELECT * FROM users WHERE id = ?', user.id);
      if (!currentUser || currentUser.status !== 'active') throw new ApiError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.');
      const reservation = currentUser.role === 'admin'
        ? { reserved: 0, balance: 0, unlimited: true }
        : reserveTokensTx(currentUser, cost, jobId);
      run(
        `INSERT INTO video_jobs
          (id, user_id, idempotency_key, mode, style, prompt, image_path, image_mime, target_duration,
           aspect_ratio, scene_count, scenes_json, status, progress, cost, reserved_amount, is_demo,
           provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)`,
        jobId, currentUser.id, key, mode, style.id, prompt, imagePath, image?.mime || null,
        duration, plan.aspectRatio, scenes.length, JSON.stringify(scenes), cost, reservation.reserved,
        isDemo ? 1 : 0, providerName, timestamp, timestamp
      );
      return { reserved: reservation.reserved, user: currentUser };
    });
    return {
      job: publicJob(getJob(jobId)),
      duplicate: false,
      wallet: walletView(result.user)
    };
  } catch (error) {
    if (imagePath) { try { unlinkSync(imagePath); } catch {} }
    throw error;
  }
}

function ffmpegAvailable() {
  return Boolean(config.generation.ffmpegPath && existsSync(config.generation.ffmpegPath));
}

function filterEscape(value) {
  return String(value).replace(/([\\':,])/g, '\\$1');
}

function runProcess(command, args, { timeoutMs = 30 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('Process timed out.'));
    }, timeoutMs);
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${basename(command)} exited with code ${code}: ${stderr.slice(-1200)}`));
    });
  });
}

function probeDuration(path) {
  const result = spawnSync(config.generation.ffmpegPath, ['-hide_banner', '-i', path], { encoding: 'utf8', timeout: 30_000 });
  const output = `${result.stderr || ''}\n${result.stdout || ''}`;
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!match) return null;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function assTime(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = (total % 60).toFixed(2).padStart(5, '0');
  return `${hours}:${String(minutes).padStart(2, '0')}:${secs}`;
}

function writeDemoSubtitles(job, width, height) {
  const path = join(config.dataDir, 'outputs', `${job.id}-demo.ass`);
  const size = job.aspect_ratio === '9:16' ? 22 : 28;
  const target = job.target_duration === 600 ? '10 MINUTE TARGET' : '30 SECOND TARGET';
  const end = assTime(job.target_duration);
  const content = `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Demo,DejaVu Sans,${size},&H00FFFFFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,3,1,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,${end},Demo,,0,0,0,,{\\an5\\pos(${Math.round(width / 2)},${Math.round(height / 2)})\\fs${size}\\c&HFFFFFF&}VIRALYANTRA AI\\N{\\fs${Math.round(size * 0.64)}\\c&HF9E867&}DEMO - NOT AI GENERATED\\N{\\fs${Math.round(size * 0.48)}\\c&HB8A394&}${target}
`;
  writeFileSync(path, content);
  return path;
}

async function renderDemoVideo(job) {
  if (!ffmpegAvailable()) throw new Error('FFMPEG_UNAVAILABLE: Install ffmpeg or the optional ffmpeg-static dependency to render demo videos.');
  const outputPath = join(config.dataDir, 'outputs', `${job.id}-demo.mp4`);
  const vertical = job.aspect_ratio === '9:16';
  const width = vertical ? 360 : 640;
  const height = vertical ? 640 : 360;
  const rate = job.target_duration > 120 ? 2 : 6;
  const subtitlesPath = writeDemoSubtitles(job, width, height);
  const gradient = [
    `gradients=size=${width}x${height}`,
    `rate=${rate}`,
    `duration=${job.target_duration}`,
    'c0=0x0b1020',
    'c1=0x1e1b4b',
    'c2=0x0e7490',
    'n=3',
    'type=radial',
    'speed=0'
  ].join(':');
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'lavfi', '-i', gradient,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-vf', `subtitles=filename='${filterEscape(subtitlesPath)}'`,
    '-t', String(job.target_duration),
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '30', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '32k', '-shortest', '-movflags', '+faststart',
    '-metadata', 'title=ViralYantra AI Demo - Not AI Generated',
    '-metadata', 'comment=Development demo placeholder rendered locally for wallet testing.',
    outputPath
  ];
  try {
    await runProcess(config.generation.ffmpegPath, args, { timeoutMs: 10 * 60 * 1000 });
  } finally {
    try { unlinkSync(subtitlesPath); } catch {}
  }
  return outputPath;
}

async function replicatePrediction(job, scene) {
  const token = config.generation.replicateToken;
  if (!token) throw new Error('REPLICATE_API_TOKEN is missing.');
  const model = config.generation.replicateModel;
  const [owner, name] = model.split('/');
  if (!owner || !name) throw new Error('REPLICATE_VIDEO_MODEL must be in owner/name format.');
  const input = {
    prompt: scene.prompt,
    duration: Math.round(scene.durationSeconds),
    duration_seconds: Math.round(scene.durationSeconds),
    aspect_ratio: job.aspect_ratio
  };
  if (job.mode === 'image-to-video' && job.image_path && existsSync(job.image_path)) {
    const mime = job.image_mime || 'image/png';
    input.first_frame_image = `data:${mime};base64,${readFileSync(job.image_path).toString('base64')}`;
    input.image = input.first_frame_image;
  }
  const createResponse = await fetch(`https://api.replicate.com/v1/models/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/predictions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'wait=10'
    },
    body: JSON.stringify({ input }),
    signal: AbortSignal.timeout(60_000)
  });
  if (!createResponse.ok) {
    const text = await createResponse.text().catch(() => '');
    throw new Error(`Replicate rejected scene ${scene.index} (HTTP ${createResponse.status}): ${text.slice(0, 500)}`);
  }
  let prediction = await createResponse.json();
  const deadline = Date.now() + 20 * 60 * 1000;
  while (!['succeeded', 'failed', 'canceled'].includes(prediction.status)) {
    if (Date.now() > deadline) throw new Error(`Replicate scene ${scene.index} timed out.`);
    await sleep(2500);
    const poll = await fetch(prediction.urls?.get, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000)
    });
    if (!poll.ok) throw new Error(`Replicate polling failed with HTTP ${poll.status}.`);
    prediction = await poll.json();
  }
  if (prediction.status !== 'succeeded') {
    throw new Error(`Replicate scene ${scene.index} failed: ${prediction.error || prediction.status}`);
  }
  const output = Array.isArray(prediction.output) ? prediction.output[prediction.output.length - 1] : prediction.output;
  if (!output || typeof output !== 'string') throw new Error(`Replicate scene ${scene.index} returned no video URL.`);
  const videoResponse = await fetch(output, { signal: AbortSignal.timeout(120_000) });
  if (!videoResponse.ok) throw new Error(`Could not download scene ${scene.index} output (HTTP ${videoResponse.status}).`);
  const buffer = Buffer.from(await videoResponse.arrayBuffer());
  const path = join(config.dataDir, 'outputs', `${job.id}-scene-${scene.index}.mp4`);
  writeFileSync(path, buffer);
  return path;
}

async function assembleScenes(job, scenePaths) {
  if (!ffmpegAvailable()) throw new Error('FFMPEG_UNAVAILABLE: ffmpeg is required to assemble scene clips.');
  const listPath = join(config.dataDir, 'outputs', `${job.id}-concat.txt`);
  const outputPath = join(config.dataDir, 'outputs', `${job.id}.mp4`);
  writeFileSync(listPath, scenePaths.map(path => `file '${path.replace(/'/g, "'\\''")}'`).join('\n'));
  try {
    await runProcess(config.generation.ffmpegPath, [
      '-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
      '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outputPath
    ], { timeoutMs: 20 * 60 * 1000 });
  } finally {
    try { unlinkSync(listPath); } catch {}
    for (const path of scenePaths) { try { unlinkSync(path); } catch {} }
  }
  return outputPath;
}

async function recordAiUsage(job, provider, model, scenes, estimatedCost) {
  run(
    `INSERT INTO ai_usage (id, job_id, provider, model, scenes, estimated_cost_usd, actual_cost_usd, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    randomToken(16), job.id, provider, model, scenes, estimatedCost, estimatedCost, nowIso()
  );
}

async function completeJob(job, outputPath, outputKind, actualDuration) {
  return transaction(() => {
    const current = getJob(job.id);
    if (!current) throw new Error('Job disappeared.');
    if (current.status === 'cancelled' || current.cancel_requested) throw new JobCancelledError('Job cancelled');
    if (current.status === 'completed') return current;
    const target = current.target_duration;
    if (outputKind === 'video' && (!Number.isFinite(actualDuration) || actualDuration < target - 1)) {
      throw new ApiError(422, 'DURATION_MISMATCH',
        `The assembled video is ${Number(actualDuration || 0).toFixed(1)}s, which does not reach the requested ${target}s. It was not marked complete.`,
        { actualDuration, targetDuration: target }
      );
    }
    const timestamp = nowIso();
    settleTokensTx(current);
    run(
      `UPDATE video_jobs SET status = 'completed', progress = 100, actual_duration = ?, output_path = ?,
        output_mime = 'video/mp4', output_kind = ?, charged_amount = ?, error_code = NULL,
        error_message = NULL, completed_at = ?, updated_at = ? WHERE id = ?`,
      actualDuration, outputPath, outputKind, current.charged_amount || current.reserved_amount || 0,
      timestamp, timestamp, current.id
    );
    if (outputKind === 'video') {
      run(
        `INSERT OR REPLACE INTO generated_videos
          (id, job_id, user_id, title, duration_seconds, aspect_ratio, mime, path, is_demo, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'video/mp4', ?, ?, ?)`,
        randomToken(16), current.id, current.user_id, `ViralYantra ${current.target_duration === 600 ? 'Long Video' : 'Short'} — ${current.style}`,
        actualDuration, current.aspect_ratio, outputPath, current.is_demo, timestamp
      );
    }
    return getJob(current.id);
  });
}

function failJob(job, code, message) {
  try {
    return transaction(() => {
      const current = getJob(job.id);
      if (!current || current.status === 'completed' || current.status === 'cancelled') return current;
      refundTokensTx(current, `Refund: ${message.slice(0, 250)}`);
      const timestamp = nowIso();
      run(
        `UPDATE video_jobs SET status = 'failed', error_code = ?, error_message = ?, refunded = ?,
          completed_at = ?, updated_at = ? WHERE id = ?`,
        code, message.slice(0, 1000), current.reserved_amount > 0 ? 1 : 0, timestamp, timestamp, current.id
      );
      return getJob(current.id);
    });
  } catch (error) {
    console.error(`[generation] Failed to record failure for ${job.id}:`, error);
    return null;
  }
}

export function cancelJob({ job, user, reason = 'Cancelled by user' }) {
  return transaction(() => {
    const current = getJob(job.id);
    if (!current) throw new ApiError(404, 'JOB_NOT_FOUND', 'Generation job not found.');
    if (current.user_id !== user.id && user.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'You cannot cancel this job.');
    if (current.status === 'completed') throw new ApiError(409, 'JOB_COMPLETED', 'This video is already complete and cannot be cancelled.');
    if (current.status === 'cancelled') return publicJob(current);
    refundTokensTx(current, 'Refund: generation cancelled');
    const timestamp = nowIso();
    run(
      `UPDATE video_jobs SET status = 'cancelled', cancel_requested = 1, refunded = ?,
        error_code = 'JOB_CANCELLED', error_message = ?, completed_at = ?, updated_at = ? WHERE id = ?`,
      current.reserved_amount > 0 ? 1 : 0, String(reason).slice(0, 500), timestamp, timestamp, current.id
    );
    return publicJob(getJob(current.id));
  });
}

async function runDemoJob(job) {
  if (!config.generation.demoEnabled) throw new Error('Demo simulation is disabled.');
  let current = getJob(job.id);
  const scenes = parseScenes(current.scenes_json);
  run('UPDATE video_jobs SET status = ?, progress = ?, started_at = ?, updated_at = ? WHERE id = ?',
    'generating', 5, nowIso(), nowIso(), current.id);
  for (let index = 0; index < scenes.length; index++) {
    ensureNotCancelled(current.id);
    scenes.forEach((scene, i) => { scene.status = i < index ? 'complete' : i === index ? 'active' : 'queued'; });
    updateScenes(current.id, scenes);
    run('UPDATE video_jobs SET progress = ?, updated_at = ? WHERE id = ?',
      sceneProgress(index, scenes.length), nowIso(), current.id);
    await sleep(demoDelay);
  }
  scenes.forEach(scene => { scene.status = 'complete'; });
  updateScenes(current.id, scenes);
  ensureNotCancelled(current.id);
  run("UPDATE video_jobs SET status = 'assembling', progress = 94, updated_at = ? WHERE id = ?", nowIso(), current.id);
  const outputPath = await renderDemoVideo(current);
  const actualDuration = probeDuration(outputPath);
  if (actualDuration === null) {
    try { unlinkSync(outputPath); } catch {}
    throw new Error('Rendered demo video could not be verified with ffmpeg. It was not marked complete.');
  }
  current = getJob(current.id);
  ensureNotCancelled(current.id);
  const completed = await completeJob(current, outputPath, 'video', actualDuration);
  await recordAiUsage(completed, 'demo', 'local-demo-render', scenes.length, 0);
}

async function runReplicateJob(job) {
  let current = getJob(job.id);
  if (!config.generation.configured) throw new Error('AI provider is not configured.');
  if (sceneSecondsFor(current.target_duration) > config.generation.replicateMaxSceneSeconds) {
    throw new Error(`MODEL_DURATION_LIMITATION: ${config.generation.replicateMaxSceneSeconds}s max scene length cannot satisfy ${sceneSecondsFor(current.target_duration)}s scenes.`);
  }
  const scenes = parseScenes(current.scenes_json);
  run("UPDATE video_jobs SET status = 'generating', progress = 5, started_at = ?, updated_at = ? WHERE id = ?",
    nowIso(), nowIso(), current.id);
  const scenePaths = [];
  for (let index = 0; index < scenes.length; index++) {
    ensureNotCancelled(current.id);
    scenes.forEach((scene, i) => { scene.status = i < index ? 'complete' : i === index ? 'active' : 'queued'; });
    updateScenes(current.id, scenes);
    run('UPDATE video_jobs SET progress = ?, updated_at = ? WHERE id = ?', sceneProgress(index, scenes.length), nowIso(), current.id);
    const path = await replicatePrediction(current, scenes[index]);
    scenePaths.push(path);
  }
  scenes.forEach(scene => { scene.status = 'complete'; });
  updateScenes(current.id, scenes);
  ensureNotCancelled(current.id);
  run("UPDATE video_jobs SET status = 'assembling', progress = 94, updated_at = ? WHERE id = ?", nowIso(), current.id);
  const outputPath = await assembleScenes(current, scenePaths);
  const actualDuration = probeDuration(outputPath);
  current = getJob(current.id);
  ensureNotCancelled(current.id);
  const completed = await completeJob(current, outputPath, 'video', actualDuration);
  await recordAiUsage(completed, 'replicate', config.generation.replicateModel, scenes.length,
    scenes.length * config.generation.costPerSceneUsd);
}

export function startJob(jobId) {
  if (activeRunners.has(jobId)) return;
  activeRunners.add(jobId);
  const job = getJob(jobId);
  if (!job) { activeRunners.delete(jobId); return; }
  setTimeout(async () => {
    try {
      run("UPDATE video_jobs SET status = 'planning', updated_at = ? WHERE id = ? AND status = 'queued'", nowIso(), jobId);
      const fresh = getJob(jobId);
      if (fresh.is_demo) await runDemoJob(fresh);
      else await runReplicateJob(fresh);
    } catch (error) {
      const current = getJob(jobId);
      if (error instanceof JobCancelledError || current?.cancel_requested) {
        if (current && current.status !== 'cancelled') cancelJob({ job: current, user: { id: current.user_id, role: 'admin' }, reason: 'Cancelled during generation' });
      } else {
        console.error(`[generation] Job ${jobId} failed:`, error.message);
        const message = String(error.message || 'Generation failed.');
        const code = message.includes('DURATION') ? 'DURATION_MISMATCH'
          : message.includes('MODEL_DURATION_LIMITATION') ? 'MODEL_DURATION_LIMITATION'
          : message.includes('FFMPEG_UNAVAILABLE') ? 'ASSEMBLY_UNAVAILABLE'
          : 'GENERATION_FAILED';
        failJob(current || job, code, message);
      }
    } finally {
      activeRunners.delete(jobId);
    }
  }, 40);
}

export function recoverStalledJobs() {
  const jobs = all("SELECT * FROM video_jobs WHERE status IN ('queued', 'planning', 'generating', 'assembling')");
  for (const job of jobs) {
    failJob(job, 'SERVER_RESTART', 'Generation was interrupted by a server restart. Reserved tokens were refunded.');
  }
  return jobs.length;
}

export function listJobsForUser(userId, limit = 50) {
  return all('SELECT * FROM video_jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, Math.min(Number(limit) || 50, 200))
    .map(job => publicJob(job));
}

export function listJobsForAdmin({ status, limit = 100, userId } = {}) {
  const filters = [];
  const params = [];
  if (status && status !== 'all') { filters.push('j.status = ?'); params.push(status); }
  if (userId) { filters.push('j.user_id = ?'); params.push(userId); }
  const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
  return all(
    `SELECT j.*, u.phone_e164 FROM video_jobs j JOIN users u ON u.id = j.user_id
     ${where} ORDER BY j.created_at DESC LIMIT ?`,
    ...params, Math.min(Number(limit) || 100, 300)
  ).map(row => ({ ...publicJob(row, { includeScenes: false }), userPhone: row.phone_e164 }));
}

export function demoSetupStatus() {
  return {
    enabled: config.generation.demoEnabled,
    reason: config.isProduction ? 'Demo simulation is disabled in production.'
      : !ffmpegAvailable() ? 'ffmpeg is not installed, so demo video rendering is unavailable.'
      : !config.generation.demoEnabled ? 'Demo simulation is disabled by ENABLE_DEMO.'
      : null
  };
}
