const https = require('https');
const crypto = require('crypto');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = 'stuhallybone/archiesarcade';
const CLOUDINARY_CLOUD = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_SECRET = process.env.CLOUDINARY_API_SECRET;

// Helper: HTTPS request
function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Upload to Cloudinary
async function uploadToCloudinary(fileBase64, fileName, mimeType) {
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'archiesarcade';
  const publicId = fileName.replace(/\.[^/.]+$/, '').replace(/[^a-z0-9]/gi, '-').toLowerCase();
  
  const sigString = `folder=${folder}&public_id=${publicId}&timestamp=${timestamp}${CLOUDINARY_SECRET}`;
  const signature = crypto.createHash('sha1').update(sigString).digest('hex');

  const boundary = '----FormBoundary' + crypto.randomBytes(8).toString('hex');
  
  const fields = {
    file: `data:${mimeType};base64,${fileBase64}`,
    api_key: CLOUDINARY_KEY,
    timestamp: String(timestamp),
    signature,
    folder,
    public_id: publicId,
  };

  let body = '';
  for (const [key, value] of Object.entries(fields)) {
    body += `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`;
  }
  body += `--${boundary}--\r\n`;

  const resourceType = mimeType.startsWith('video') ? 'video' : 'image';
  const bodyBuffer = Buffer.from(body);

  const result = await httpsRequest({
    hostname: 'api.cloudinary.com',
    path: `/v1_1/${CLOUDINARY_CLOUD}/${resourceType}/upload`,
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': bodyBuffer.length,
    }
  }, bodyBuffer);

  if (result.status !== 200) throw new Error('Cloudinary upload failed: ' + JSON.stringify(result.body));
  return result.body.secure_url;
}

// Get current projects.json from GitHub
async function getProjectsFromGitHub() {
  const result = await httpsRequest({
    hostname: 'api.github.com',
    path: `/repos/${GITHUB_REPO}/contents/projects.json`,
    method: 'GET',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'User-Agent': 'archiesarcade',
      'Accept': 'application/vnd.github.v3+json',
    }
  });
  
  if (result.status === 404) return { projects: [], sha: null };
  
  const content = Buffer.from(result.body.content, 'base64').toString('utf8');
  return { projects: JSON.parse(content), sha: result.body.sha };
}

// Save projects.json to GitHub
async function saveProjectsToGitHub(projects, sha) {
  const content = Buffer.from(JSON.stringify(projects, null, 2)).toString('base64');
  
  const body = JSON.stringify({
    message: 'Update projects.json via admin',
    content,
    ...(sha && { sha }),
  });

  const result = await httpsRequest({
    hostname: 'api.github.com',
    path: `/repos/${GITHUB_REPO}/contents/projects.json`,
    method: 'PUT',
    headers: {
      'Authorization': `token ${GITHUB_TOKEN}`,
      'User-Agent': 'archiesarcade',
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    }
  }, body);

  if (result.status !== 200 && result.status !== 201) {
    throw new Error('GitHub save failed: ' + JSON.stringify(result.body));
  }
  return result.body;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    const { action, password, project, projects, fileBase64, fileName, mimeType } = JSON.parse(event.body || '{}');

    // Auth check
    if (password !== 'KingRhino876') {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorised' }) };
    }

    // GET projects
    if (action === 'get') {
      const { projects } = await getProjectsFromGitHub();
      return { statusCode: 200, headers, body: JSON.stringify({ projects }) };
    }

    // UPLOAD file to Cloudinary
    if (action === 'upload') {
      const url = await uploadToCloudinary(fileBase64, fileName, mimeType);
      return { statusCode: 200, headers, body: JSON.stringify({ url }) };
    }

    // SAVE full projects list
    if (action === 'save') {
      const { sha } = await getProjectsFromGitHub();
      await saveProjectsToGitHub(projects, sha);
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
