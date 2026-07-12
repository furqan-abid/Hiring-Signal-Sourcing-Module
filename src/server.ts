import Fastify from 'fastify';
import { config } from './config.js';
import { log } from './lib/logger.js';
import { runPipeline } from './pipeline.js';
import { isValidationError, validatePayload } from './steps/validate.js';

export function buildServer() {
  const app = Fastify({
    logger: false,
    bodyLimit: 2 * 1024 * 1024,
  });

  app.get('/health', async () => ({ status: 'ok' }));

  app.post('/run', async (request, reply) => {
    if (config.moduleSharedSecret) {
      const provided = request.headers['x-module-secret'];
      if (provided !== config.moduleSharedSecret) {
        return reply.code(401).send({ status: 'error', error: 'unauthorized' });
      }
    }

    const validated = validatePayload(request.body);
    if (isValidationError(validated)) {
      log.warn('validate', `400: ${validated.error}`);
      return reply.code(400).send({ status: 'error', error: validated.error });
    }

    // Only a TOTAL failure becomes a 500 — per-company errors are counters.
    try {
      const now = new Date();
      const result = await runPipeline(validated, now);
      return reply.code(200).send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('run', `total failure: ${message}`);
      return reply.code(500).send({ status: 'error', error: message });
    }
  });

  return app;
}

async function start() {
  const app = buildServer();
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
    log.info('run', `sourcing module listening on :${config.port}`);
  } catch (err) {
    log.error('run', `failed to start: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

// Auto-start unless imported by the test runner (vitest sets VITEST=true).
if (!process.env.VITEST) {
  start();
}
