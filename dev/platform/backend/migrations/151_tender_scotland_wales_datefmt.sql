-- Public Contracts Scotland + Sell2Wales returned nothing on a live scan: the
-- 'mm-yyyy' dateFrom we sent isn't the format the Scottish-Gov OCDS API accepts,
-- so the windowed call came back empty. That API's dateFrom is 'dd-mm-yyyy'.
-- (The adapter now also falls back to the unwindowed /v1/Notices batch when a
-- windowed call is empty, so a daily poll still gets the current notices even if
-- the reach-back window is off.)
UPDATE tender_sources
  SET config = jsonb_set(config, '{windowFormat}', '"dd-mm-yyyy"'),
      last_status = NULL
  WHERE name IN ('Public Contracts Scotland', 'Sell2Wales');
