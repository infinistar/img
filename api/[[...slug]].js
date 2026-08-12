import { existsSync, readFileSync, statSync } from 'fs';
import { dirname, join, extname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { Buffer } from 'buffer';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS_DIR = join(__dirname, '../functions');
const moduleCache = new Map();
const STATIC_DIR = join(__dirname, '../frontend-dist');

async function importModule(filePath) {
  if (moduleCache.has(filePath)) {
    return moduleCache.get(filePath);
  }
  const mod = await import(pathToFileURL(filePath).href);
  moduleCache.set(filePath, mod);
  return mod;
}

function findFunctionFile(pathname) {
  const parts = pathname.split('/').filter(Boolean);

  if (parts.length > 0) {
    const exactFile = join(FUNCTIONS_DIR, ...parts) + '.js';
    if (existsSync(exactFile) && statSync(exactFile).isFile()) {
      return { file: exactFile, params: {} };
    }
  }

  if (parts.length > 0) {
    const indexFile = join(FUNCTIONS_DIR, ...parts, 'index.js');
    if (existsSync(indexFile) && statSync(indexFile).isFile()) {
      return { file: indexFile, params: {} };
    }
  }

  for (let i = parts.length; i >= 0; i--) {
    const dirParts = parts.slice(0, i);
    const dirPath = join(FUNCTIONS_DIR, ...dirParts);
    if (existsSync(dirPath) && statSync(dirPath).isDirectory()) {
      const catchAllFile = join(dirPath, '[[path]].js');
      if (existsSync(catchAllFile) && statSync(catchAllFile).isFile()) {
        const pathParam = parts.slice(i);
        return { file: catchAllFile, params: { path: pathParam } };
      }
    }
  }

  return null;
}

async function findMiddlewares(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  const allMiddlewares = [];

  const rootMiddleware = join(FUNCTIONS_DIR, '_middleware.js');
  if (existsSync(rootMiddleware)) {
    const mod = await importModule(rootMiddleware);
    if (mod.onRequest) {
      const handlers = Array.isArray(mod.onRequest) ? mod.onRequest : [mod.onRequest];
      allMiddlewares.push(...handlers);
    }
  }

  for (let i = 1; i <= parts.length; i++) {
    const dirParts = parts.slice(0, i);
    const middlewareFile = join(FUNCTIONS_DIR, ...dirParts, '_middleware.js');
    if (existsSync(middlewareFile) && statSync(middlewareFile).isFile()) {
      const mod = await importModule(middlewareFile);
      if (mod.onRequest) {
        const handlers = Array.isArray(mod.onRequest) ? mod.onRequest : [mod.onRequest];
        allMiddlewares.push(...handlers);
      }
    }
  }

  return allMiddlewares;
}

async function executeChain(middlewares, handler, context) {
  const chain = [...middlewares, handler];
  let index = 0;

  context.next = async function () {
    if (index < chain.length) {
      const fn = chain[index++];
      return await fn(context);
    }
    return new Response('Not Found', { status: 404 });
  };

  return await context.next();
}

function createEnv() {
  return {
    ...process.env,
  };
}

function injectCf(request) {
  if (request.cf) {
    return request;
  }

  try {
    request.cf = {
      country: 'XX',
      city: 'Unknown',
      continent: 'XX',
      latitude: '0',
      longitude: '0',
      region: '',
      regionCode: '',
      timezone: '',
      postalCode: '',
      asn: 0,
      asOrganization: '',
      colo: 'LOCAL',
      httpProtocol: 'HTTP/1.1',
      requestPriority: '',
      tlsCipher: '',
      tlsVersion: '',
    };
  } catch (e) {
    // Some environments may not allow extending Request objects directly.
  }

  return request;
}

function normalizePath(pathname) {
  return pathname;
}

async function handleFunctionRequest(request, pathname) {
  const funcInfo = findFunctionFile(pathname);
  if (!funcInfo) return null;

  const mod = await importModule(funcInfo.file);
  const method = request.method.toUpperCase();
  const methodHandlerName = 'onRequest' + method.charAt(0) + method.slice(1).toLowerCase();

  let handler = null;
  if (typeof mod[methodHandlerName] === 'function') {
    handler = mod[methodHandlerName];
  } else if (mod.onRequest) {
    handler = typeof mod.onRequest === 'function'
      ? mod.onRequest
      : mod.onRequest[mod.onRequest.length - 1];
  }

  if (!handler) {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const middlewares = await findMiddlewares(pathname);
  if (Array.isArray(mod.onRequest) && mod.onRequest.length > 1 && handler === mod.onRequest[mod.onRequest.length - 1]) {
    middlewares.push(...mod.onRequest.slice(0, -1));
  }

  const enrichedRequest = injectCf(request);
  const env = createEnv();
  const waitUntilPromises = [];
  const context = {
    request: enrichedRequest,
    env,
    params: funcInfo.params,
    waitUntil: (promise) => {
      if (promise && typeof promise.then === 'function') {
        waitUntilPromises.push(
          promise.catch(err => console.error('waitUntil error:', err))
        );
      }
    },
    next: null,
    data: {},
  };

  const response = await executeChain(middlewares, handler, context);
  if (waitUntilPromises.length > 0) {
    await Promise.allSettled(waitUntilPromises);
  }
  return response;
}

export const config = {
  runtime: 'nodejs',
};

function respondStaticFile(pathname) {
  const filePath = join(STATIC_DIR, pathname);
  if (existsSync(filePath) && statSync(filePath).isFile()) {
    const body = readFileSync(filePath);
    const contentType = getContentType(filePath);
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
      },
    });
  }
  return null;
}

function getContentType(filePath) {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'application/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.ico': return 'image/x-icon';
    case '.map': return 'application/json; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

async function handleRequestObject(request) {
  const url = new URL(request.url);
  const targetPath = normalizePath(url.pathname);
  const response = await handleFunctionRequest(request, targetPath);

  if (response) {
    return response;
  }

  const staticResponse = respondStaticFile(targetPath === '/' ? 'index.html' : targetPath.slice(1));
  if (staticResponse) {
    return staticResponse;
  }

  const spaFallback = respondStaticFile('index.html');
  if (spaFallback) {
    return spaFallback;
  }

  return new Response('Not Found', { status: 404 });
}

export default async function handler(request, response) {
  if (response && typeof response.setHeader === 'function') {
    try {
      const host = request.headers.host || 'localhost';
      const protocol = request.headers['x-forwarded-proto'] || 'https';
      const requestUrl = `${protocol}://${host}${request.url}`;

      let body = undefined;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        body = await new Promise((resolve, reject) => {
          const chunks = [];
          request.on('data', (chunk) => chunks.push(chunk));
          request.on('end', () => resolve(Buffer.concat(chunks)));
          request.on('error', reject);
        });
      }

      const req = new Request(requestUrl, {
        method: request.method,
        headers: request.headers,
        body,
      });

      const res = await handleRequestObject(req);
      response.statusCode = res.status;
      res.headers.forEach((value, name) => {
        response.setHeader(name, value);
      });
      const responseBody = await res.arrayBuffer();
      response.end(Buffer.from(responseBody));
      return;
    } catch (err) {
      console.error('Node handler exception:', err);
      if (!response.headersSent) {
        response.statusCode = 500;
        response.setHeader('Content-Type', 'application/json');
      }
      response.end(JSON.stringify({ error: err.message, stack: err.stack }));
      return;
    }
  }

  try {
    return await handleRequestObject(request);
  } catch (err) {
    console.error('Fetch handler exception:', err);
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
