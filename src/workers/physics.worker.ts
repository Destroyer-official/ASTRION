import { SimCore } from '@/sim/simCore';
import type { ToWorker } from '@/sim/protocol';
import { CONSOLE_LOG_SINK, Logger } from '@/observability';

const logger = new Logger('physics-worker', CONSOLE_LOG_SINK);
const core = new SimCore();

self.onmessage = (e: MessageEvent<ToWorker>) => {
  try {
    const out = core.handle(e.data);
    if (out) {
      self.postMessage(out, {
        transfer: [
          out.pos.buffer,
          out.vel.buffer,
          out.pos0.buffer,
          out.vel0.buffer,
          out.samples.buffer,
          out.baryDist.buffer,
        ],
      });
    }
  } catch (error) {
    logger.log('error', 'physics worker failed to handle message', logger.errorDetails(error, {
      messageType: e.data?.type ?? 'unknown',
    }));
    throw error;
  }
};
