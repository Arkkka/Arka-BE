import type { Server } from 'node:http';

/** Stops accepting traffic, then force-closes requests that outlive the graceful deadline. */
export async function closeHttpServer(server: Server, graceMs: number): Promise<void> {
  const closed = new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeIdleConnections();
  const deadline = setTimeout(() => server.closeAllConnections(), graceMs);
  deadline.unref();

  try {
    await closed;
  } finally {
    clearTimeout(deadline);
  }
}
