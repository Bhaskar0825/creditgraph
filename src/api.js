const actionFields = {
  health: [], bootstrap: [],
  extract: ['text', 'sourceUrl', 'publishedAt', 'issuerId', 'sourceTitle', 'page'],
  review: ['eventId', 'status', 'note'],
  collect: ['url', 'companyName'], runStatus: ['runId'],
};

export function publicUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a valid public HTTPS source URL.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') || host === 'localhost' || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host.includes(':') || host.endsWith('.local')) {
    throw new Error('Use a public HTTPS URL without credentials or private addresses.');
  }
  return value;
}

export function safePayload(action, input = {}) {
  const fields = actionFields[action];
  if (!fields) throw new Error('Unsupported action.');
  for (const key of Object.keys(input)) {
    if (!fields.includes(key)) throw new Error(`Unexpected field “${key}”. Private portfolio data is never sent.`);
  }
  const payload = { action, ...input };
  if (action === 'extract') {
    if (typeof input.text !== 'string' || !input.text.trim()) throw new Error('Paste public source text first.');
    if (input.text.length > 30000) throw new Error('Source text must be 30,000 characters or fewer.');
    if (/position_id\s*,\s*entity_id\s*,\s*currency\s*,\s*amount\s*,\s*as_of/i.test(input.text) || /"(?:positions|portfolio|amountMinor)"\s*:/.test(input.text)) throw new Error('This looks like private portfolio data. Paste a public source excerpt, never your exposure book.');
    publicUrl(input.sourceUrl);
    if (input.sourceTitle && (typeof input.sourceTitle !== 'string' || input.sourceTitle.length > 300)) throw new Error('Source title must be 300 characters or fewer.');
    if (input.page != null && (!Number.isInteger(input.page) || input.page < 1 || input.page > 10000)) throw new Error('Source page must be between 1 and 10,000.');
    if (input.publishedAt && (!/^\d{4}-\d{2}-\d{2}$/.test(input.publishedAt) || Number.isNaN(Date.parse(input.publishedAt)) || new Date(input.publishedAt).toISOString().slice(0, 10) !== input.publishedAt)) throw new Error('Use a valid publication date.');
  }
  if (action === 'collect') {
    publicUrl(input.url);
    if (typeof input.companyName !== 'string' || !input.companyName.trim() || input.companyName.length > 160) throw new Error('Enter a company name, up to 160 characters.');
  }
  if (action === 'review') {
    if (!input.eventId || !['approved', 'dismissed', 'candidate'].includes(input.status)) throw new Error('Select a valid event and review decision.');
    if (input.note && (typeof input.note !== 'string' || input.note.length > 2000)) throw new Error('Review note must be 2,000 characters or fewer.');
  }
  if (action === 'runStatus' && !input.runId) throw new Error('A collection run ID is required.');
  return payload;
}

export function mergeExposureImport(existing, result, replaceSynthetic = false) {
  const merged = new Map((replaceSynthetic ? [] : existing).map((position) => [position.positionId, position]));
  let added = 0, duplicates = result.duplicates || 0;
  for (const position of result.positions) {
    const previous = merged.get(position.positionId);
    if (previous) {
      if (['entityId', 'currency', 'amountMinor', 'asOf'].some((key) => previous[key] !== position[key])) throw new Error(`Position “${position.positionId}” already exists with different values. Clear the book to replace it deliberately.`);
      duplicates++;
    } else { merged.set(position.positionId, position); added++; }
  }
  return { positions: [...merged.values()], added, duplicates };
}

export function hydrateWorkspace(source) {
  const data = Object.fromEntries(['entities', 'events', 'relationships', 'reviews', 'runs'].map((key) => [key, Array.isArray(source[key]) ? source[key] : []]));
  const reviews = new Map(data.reviews.map((review) => [review.eventId, review]));
  data.events = data.events.map((event) => {
    const review = reviews.get(event.id);
    return { ...event, ...(review ? { status: review.status, reviewNote: review.note || '' } : {}) };
  });
  return data;
}

const env = import.meta.env || {};
export const publicConfig = Object.freeze({
  endpoint: env.VITE_APPWRITE_ENDPOINT || '',
  projectId: env.VITE_APPWRITE_PROJECT_ID || '',
  functionId: env.VITE_APPWRITE_FUNCTION_ID || 'creditgraph-api',
});

export function createCloudClient({ endpoint = publicConfig.endpoint, projectId = publicConfig.projectId, functionId = publicConfig.functionId, fetcher = globalThis.fetch, storage } = {}) {
  let connected = false;
  let fallback = '';
  const storageKey = `creditgraph:session:${endpoint}:${projectId}`;
  let sessionStore = null;
  try {
    sessionStore = storage || (typeof window !== 'undefined' ? window.sessionStorage : null);
    fallback = sessionStore?.getItem(storageKey) || '';
  } catch { fallback = ''; sessionStore = null; }

  async function request(path, { method = 'GET', body } = {}) {
    if (!endpoint || !projectId) throw new Error('Cloud workspace is not configured. Set the public Appwrite endpoint and project ID during deployment. The historical demo still works.');
    const headers = { 'Content-Type': 'application/json', 'X-Appwrite-Project': projectId, 'X-Appwrite-Response-Format': '1.8.0' };
    if (fallback) headers['X-Fallback-Cookies'] = fallback;
    let response;
    try {
      response = await fetcher(`${endpoint.replace(/\/$/, '')}${path}`, { method, headers, credentials: 'include', ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(65000) });
    } catch (error) {
      throw new Error(error.name === 'TimeoutError' ? 'The cloud request timed out. Check its status before retrying.' : 'Could not reach the cloud workspace. Check your connection and allowed web origin.');
    }
    const cookie = response.headers.get('X-Fallback-Cookies');
    if (cookie) {
      fallback = cookie;
      try { sessionStore?.setItem(storageKey, cookie); } catch { console.warn('Session storage unavailable; this cloud session will last until refresh.'); }
    }
    let result;
    try { result = await response.json(); } catch { throw new Error('Cloud returned an unreadable response.'); }
    if (!response.ok) {
      const error = new Error(result.message || `Cloud request failed (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return result;
  }

  return {
    get connected() { return connected; },
    async connect() {
      try { await request('/account'); }
      catch (error) {
        if (error.status !== 401) throw error;
        await request('/account/sessions/anonymous', { method: 'POST', body: {} });
      }
      connected = true;
    },
    async call(action, input = {}) {
      const payload = safePayload(action, input);
      if (action !== 'health' && !connected) throw new Error('Connect your private workspace before sending public sources or review decisions.');
      const execution = await request(`/functions/${encodeURIComponent(functionId)}/executions`, {
        method: 'POST', body: { body: JSON.stringify(payload), async: false, method: 'POST', path: '/', headers: { 'content-type': 'application/json' } },
      });
      let result;
      try { result = JSON.parse(execution.responseBody); } catch { throw new Error('The cloud function did not return a valid result. Check the deployment and try again.'); }
      if (!result.ok || execution.responseStatusCode >= 400) throw new Error(result.error || 'The cloud action could not be completed.');
      return result;
    },
  };
}
