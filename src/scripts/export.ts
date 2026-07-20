import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { query } from '../db/pool';
import { logger } from '../logger';
import { MessageRow, ChannelRow } from '../types';

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      args[key] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function toCsvValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (/[",\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const slackChannelId = args.channel;
  const slackTeamId = args.team;
  const format = (args.format ?? 'json').toLowerCase();

  if (!slackChannelId || !slackTeamId) {
    console.error('Usage: npm run export -- --channel <slackChannelId> --team <slackTeamId> [--format json|csv]');
    process.exit(1);
  }
  if (format !== 'json' && format !== 'csv') {
    console.error('--format must be "json" or "csv"');
    process.exit(1);
  }

  const channelResult = await query<ChannelRow>(
    `SELECT c.* FROM channels c
     JOIN teams t ON t.id = c.team_id
     WHERE c.slack_channel_id = $1 AND t.slack_team_id = $2`,
    [slackChannelId, slackTeamId]
  );
  const channel = channelResult.rows[0];
  if (!channel) {
    console.error('Channel not found for that team');
    process.exit(1);
  }

  const messagesResult = await query<MessageRow>(
    'SELECT * FROM messages WHERE channel_id = $1 ORDER BY slack_ts ASC',
    [channel.id]
  );

  const outDir = path.join(__dirname, '..', '..', 'exports');
  fs.mkdirSync(outDir, { recursive: true });
  const filename = `${channel.channel_name}-${Date.now()}.${format}`;
  const outPath = path.join(outDir, filename);

  if (format === 'json') {
    fs.writeFileSync(outPath, JSON.stringify(messagesResult.rows, null, 2), 'utf-8');
  } else {
    const headers: (keyof MessageRow)[] = ['slack_ts', 'slack_user_id', 'thread_ts', 'message_type', 'subtype', 'text'];
    const lines = [headers.join(',')];
    for (const m of messagesResult.rows) {
      lines.push(headers.map((h) => toCsvValue(m[h])).join(','));
    }
    fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
  }

  logger.info({ outPath, count: messagesResult.rows.length }, 'Exported channel messages to file');
  console.log(`Wrote ${messagesResult.rows.length} messages to ${outPath}`);
  process.exit(0);
}

main().catch((err) => {
  logger.error({ err }, 'Export failed');
  process.exit(1);
});