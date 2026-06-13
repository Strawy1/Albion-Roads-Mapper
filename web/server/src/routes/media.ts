import type { FastifyInstance } from 'fastify';
import { createReadStream, statSync } from 'fs';
import { join } from 'path';

const MEDIA_DIR = process.env['MEDIA_PATH'] ?? join(process.cwd(), 'media');

export async function mediaRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/media/demov1.mp4', async (request, reply) => {
    const filePath = join(MEDIA_DIR, 'demov1.mp4');

    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(filePath);
    } catch {
      return reply.status(404).send({ error: 'Video not found' });
    }

    const fileSize = stat.size;
    const rangeHeader = request.headers['range'];

    if (rangeHeader) {
      const [startStr, endStr] = rangeHeader.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr, 10);
      const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
      const chunkSize = end - start + 1;

      reply.status(206).headers({
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
      });

      return reply.send(createReadStream(filePath, { start, end }));
    }

    reply.headers({
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes',
    });

    return reply.send(createReadStream(filePath));
  });
}
