import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import express, { Router, type RequestHandler } from 'express';
import { arkaOpenApi } from '../docs/openapi.js';

const swaggerAssets = dirname(
  createRequire(import.meta.url).resolve('swagger-ui-dist/package.json'),
);
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join('; ');

const swaggerHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <title>Arka API Documentation</title>
    <link rel="icon" type="image/png" href="/docs/assets/favicon-32x32.png" />
    <link rel="stylesheet" href="/docs/assets/swagger-ui.css" />
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="/docs/assets/swagger-ui-bundle.js"></script>
    <script src="/docs/assets/swagger-ui-standalone-preset.js"></script>
    <script src="/docs/swagger-initializer.js"></script>
  </body>
</html>`;

const swaggerInitializer = `window.ui = SwaggerUIBundle({
  urls: [
    { url: '/openapi.json', name: 'Arka API' },
    { url: '/api/auth/open-api/generate-schema', name: 'Authentication' }
  ],
  'urls.primaryName': 'Arka API',
  dom_id: '#swagger-ui',
  deepLinking: true,
  displayOperationId: true,
  displayRequestDuration: true,
  filter: true,
  requestSnippetsEnabled: true,
  showCommonExtensions: true,
  showExtensions: true,
  supportedSubmitMethods: ['get'],
  validatorUrl: null,
  withCredentials: true,
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
  layout: 'StandaloneLayout'
});`;

const documentationHeaders: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Security-Policy', contentSecurityPolicy);
  next();
};

export function createSwaggerRouter(): Router {
  const router = Router();
  router.use(['/docs', '/docs/*splat', '/openapi.json'], documentationHeaders);
  router.get('/openapi.json', (_req, res) => res.status(200).json(arkaOpenApi));
  router.use(
    '/docs/assets',
    express.static(swaggerAssets, { fallthrough: false, index: false }),
  );
  router.get('/docs/swagger-initializer.js', (_req, res) => {
    res.type('application/javascript').send(swaggerInitializer);
  });
  router.get(['/docs', '/docs/'], (_req, res) => res.type('html').send(swaggerHtml));
  return router;
}
