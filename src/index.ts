import 'dotenv/config';
import express from 'express';
import { logger } from './logger';
import authRoutes from './routes/auth';
import channelRoutes from './routes/channels';
import archiveApiRoutes from './api/archive';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/channels', channelRoutes);
app.use('/api', archiveApiRoutes);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  logger.info({ port }, 'Slack Archiver API listening');
});