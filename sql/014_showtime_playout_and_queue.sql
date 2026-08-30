-- Showtime playout mode and safer queue ordering.

ALTER TABLE current_stream
ADD COLUMN IF NOT EXISTS playout_mode text DEFAULT 'manual',
ADD COLUMN IF NOT EXISTS schedule_early_ended_slot text,
ADD COLUMN IF NOT EXISTS schedule_early_ended_at timestamptz;

UPDATE current_stream
SET playout_mode = COALESCE(playout_mode, 'manual')
WHERE id = 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'current_stream_playout_mode_check'
  ) THEN
    ALTER TABLE current_stream
    ADD CONSTRAINT current_stream_playout_mode_check
    CHECK (playout_mode IN ('manual', 'schedule'));
  END IF;
END;
$$;

COMMENT ON COLUMN current_stream.playout_mode IS
  'manual uses current_stream/queue state; schedule resolves playback from showtime.yaml.';

COMMENT ON COLUMN current_stream.schedule_early_ended_slot IS
  'Current scheduled slot id marked ended early by the player; schedule mode shows hold until the next slot.';

COMMENT ON COLUMN current_stream.schedule_early_ended_at IS
  'Timestamp when the current scheduled slot was marked ended early.';

CREATE OR REPLACE FUNCTION enqueue_video(mux_item_id uuid, admin_user_id text)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  mux_data record;
  queued record;
  next_position int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));

  SELECT id, playback_id, label, kind, duration_seconds
  INTO mux_data
  FROM mux_items
  WHERE id = mux_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mux item not found';
  END IF;

  SELECT COALESCE(MAX(position), 0) + 1
  INTO next_position
  FROM video_queue;

  INSERT INTO video_queue (mux_item_id, position)
  VALUES (mux_item_id, next_position)
  RETURNING id, position, created_at, mux_item_id
  INTO queued;

  INSERT INTO admin_actions (action_type, admin_user, details)
  VALUES (
    'queue_add',
    admin_user_id,
    json_build_object('mux_item_id', mux_item_id, 'position', next_position)
  );

  RETURN json_build_object(
    'id', queued.id,
    'position', queued.position,
    'created_at', queued.created_at,
    'mux_item_id', queued.mux_item_id,
    'mux_items', json_build_object(
      'id', mux_data.id,
      'playback_id', mux_data.playback_id,
      'label', mux_data.label,
      'kind', mux_data.kind,
      'duration_seconds', mux_data.duration_seconds
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION reorder_queue(items json, admin_user_id text)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  item_count int;
  queue_count int;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));

  CREATE TEMP TABLE IF NOT EXISTS temp_queue_order (
    id uuid PRIMARY KEY,
    new_position int NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE temp_queue_order;

  INSERT INTO temp_queue_order (id, new_position)
  SELECT (item.value->>'id')::uuid, (item.value->>'position')::int
  FROM json_array_elements(items) AS item(value);

  SELECT COUNT(*) INTO item_count FROM temp_queue_order;
  SELECT COUNT(*) INTO queue_count FROM video_queue;

  IF item_count <> queue_count THEN
    RAISE EXCEPTION 'Reorder must include every queue item';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM temp_queue_order
    GROUP BY new_position
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Queue positions must be unique';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM temp_queue_order t
    LEFT JOIN video_queue q ON q.id = t.id
    WHERE q.id IS NULL
  ) THEN
    RAISE EXCEPTION 'Queue item not found';
  END IF;

  UPDATE video_queue q
  SET position = -1000000 - t.new_position
  FROM temp_queue_order t
  WHERE q.id = t.id;

  UPDATE video_queue q
  SET position = t.new_position
  FROM temp_queue_order t
  WHERE q.id = t.id;

  INSERT INTO admin_actions (action_type, admin_user, details)
  VALUES ('queue_reorder', admin_user_id, json_build_object('items', items));

  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION delete_from_queue(queue_item_id uuid, admin_user_id text)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_position int;
  deleted_mux_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));

  DELETE FROM video_queue
  WHERE id = queue_item_id
  RETURNING position, mux_item_id INTO deleted_position, deleted_mux_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Queue item not found';
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS temp_queue_repack (
    id uuid PRIMARY KEY,
    new_position int NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE temp_queue_repack;

  INSERT INTO temp_queue_repack (id, new_position)
  SELECT id, (row_number() OVER (ORDER BY position))::int
  FROM video_queue;

  UPDATE video_queue q
  SET position = -1000000 - t.new_position
  FROM temp_queue_repack t
  WHERE q.id = t.id;

  UPDATE video_queue q
  SET position = t.new_position
  FROM temp_queue_repack t
  WHERE q.id = t.id;

  INSERT INTO admin_actions (action_type, admin_user, details)
  VALUES (
    'queue_remove',
    admin_user_id,
    json_build_object(
      'queue_item_id', queue_item_id,
      'mux_item_id', deleted_mux_id,
      'old_position', deleted_position
    )
  );

  RETURN json_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION advance_queue_next(admin_user_id text)
RETURNS json
LANGUAGE plpgsql
AS $$
DECLARE
  next_item record;
  mux_data record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('video_queue_order'));

  PERFORM 1
  FROM current_stream
  WHERE id = 1
  FOR UPDATE;

  SELECT id, position, mux_item_id
  INTO next_item
  FROM video_queue
  ORDER BY position ASC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No videos in queue';
  END IF;

  SELECT playback_id, label, kind
  INTO mux_data
  FROM mux_items
  WHERE id = next_item.mux_item_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid queue item data';
  END IF;

  UPDATE current_stream
  SET playback_id = mux_data.playback_id,
      title = mux_data.label,
      kind = COALESCE(mux_data.kind, 'vod'),
      updated_at = NOW(),
      updated_by = admin_user_id,
      playback_state = 'playing',
      playback_position = 0,
      playout_mode = 'manual',
      schedule_early_ended_slot = NULL,
      schedule_early_ended_at = NULL,
      auto_advance_in_progress = false,
      auto_advance_lock_at = NULL,
      hold_screen_enabled = false,
      hold_screen_resume_playback_id = NULL,
      hold_screen_resume_position = NULL,
      hold_screen_resume_state = NULL,
      last_playback_command = 'queue_advance',
      last_command_id = 'advance-' || extract(epoch from NOW())::text
  WHERE id = 1;

  DELETE FROM video_queue WHERE id = next_item.id;

  CREATE TEMP TABLE IF NOT EXISTS temp_queue_repack (
    id uuid PRIMARY KEY,
    new_position int NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE temp_queue_repack;

  INSERT INTO temp_queue_repack (id, new_position)
  SELECT id, (row_number() OVER (ORDER BY position))::int
  FROM video_queue;

  UPDATE video_queue q
  SET position = -1000000 - t.new_position
  FROM temp_queue_repack t
  WHERE q.id = t.id;

  UPDATE video_queue q
  SET position = t.new_position
  FROM temp_queue_repack t
  WHERE q.id = t.id;

  INSERT INTO admin_actions (action_type, admin_user, details)
  VALUES (
    'queue_advance',
    admin_user_id,
    json_build_object(
      'to_playback_id', mux_data.playback_id,
      'to_title', mux_data.label
    )
  );

  RETURN json_build_object(
    'success', true,
    'playback_id', mux_data.playback_id,
    'title', mux_data.label,
    'kind', mux_data.kind
  );
END;
$$;

GRANT EXECUTE ON FUNCTION enqueue_video(uuid, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION reorder_queue(json, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION delete_from_queue(uuid, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION advance_queue_next(text) TO authenticated, anon;
