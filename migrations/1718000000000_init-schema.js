exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('teams', {
    id: 'id',
    slack_team_id: { type: 'text', notNull: true, unique: true },
    team_name: { type: 'text', notNull: true },
    bot_user_id: { type: 'text' },
    bot_access_token: { type: 'text', notNull: true },
    installed_by_slack_user_id: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.createTable('channels', {
    id: 'id',
    team_id: {
      type: 'integer',
      notNull: true,
      references: 'teams',
      onDelete: 'CASCADE',
    },
    slack_channel_id: { type: 'text', notNull: true },
    channel_name: { type: 'text', notNull: true },
    is_active: { type: 'boolean', notNull: true, default: true },
    added_by_slack_user_id: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('channels', 'channels_team_slack_channel_unique', {
    unique: ['team_id', 'slack_channel_id'],
  });

  pgm.createTable('messages', {
    id: 'id',
    channel_id: {
      type: 'integer',
      notNull: true,
      references: 'channels',
      onDelete: 'CASCADE',
    },
    slack_ts: { type: 'text', notNull: true },
    slack_user_id: { type: 'text' },
    thread_ts: { type: 'text' },
    message_type: { type: 'text' },
    subtype: { type: 'text' },
    text: { type: 'text' },
    raw: { type: 'jsonb', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('messages', 'messages_channel_ts_unique', {
    unique: ['channel_id', 'slack_ts'],
  });
  // pgm.createIndex('messages', ['channel_id', 'slack_ts']);
  pgm.createIndex('messages', ['slack_user_id']);
  pgm.createIndex('messages', ['thread_ts']);

  pgm.createTable('archive_runs', {
    id: 'id',
    channel_id: {
      type: 'integer',
      notNull: true,
      references: 'channels',
      onDelete: 'CASCADE',
    },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: { type: 'timestamptz' },
    status: { type: 'text', notNull: true, default: 'running' },
    messages_fetched: { type: 'integer', notNull: true, default: 0 },
    last_ts: { type: 'text' },
    error_message: { type: 'text' },
  });
  pgm.createIndex('archive_runs', ['channel_id', 'started_at']);
};

exports.down = (pgm) => {
  pgm.dropTable('archive_runs');
  pgm.dropTable('messages');
  pgm.dropTable('channels');
  pgm.dropTable('teams');
};