-- Make create_default_board idempotent: if the user already has a board, return it
-- instead of creating a new one. Prevents race conditions creating duplicate boards.

CREATE OR REPLACE FUNCTION public.create_default_board(p_user_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_board_id uuid;
BEGIN
  -- If user already has a board, return it (prevents race condition)
  SELECT board_id INTO v_board_id
  FROM public.board_members WHERE user_id = p_user_id LIMIT 1;
  IF v_board_id IS NOT NULL THEN RETURN v_board_id; END IF;

  INSERT INTO public.boards (name) VALUES ('Dig Tracker') RETURNING id INTO v_board_id;
  INSERT INTO public.board_members (board_id, user_id, role) VALUES (v_board_id, p_user_id, 'owner');
  INSERT INTO public.columns (board_id, slug, title, color, icon, position, is_protected) VALUES
    (v_board_id, 'backlog', 'Backlog', '#6b7280', '📋', 0, true),
    (v_board_id, 'todo', 'To Do', '#3b82f6', '📝', 1000, false),
    (v_board_id, 'in-progress', 'In Progress', '#f59e0b', '⚡', 2000, false),
    (v_board_id, 'review', 'Review', '#8b5cf6', '🔍', 3000, false),
    (v_board_id, 'done', 'Done', '#10b981', '✅', 4000, true);
  RETURN v_board_id;
END; $$;
