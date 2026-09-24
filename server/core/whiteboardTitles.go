package core

// WhiteboardTitleJoins projects v2 draft and published titles without loading
// document bytes. The caller must have a core.page (or page-id) alias named p
// and choose the draft title only when the caller has edit permission.
const WhiteboardTitleJoins = `
 LEFT JOIN whiteboard.whiteboard wb ON wb.page_id=p.id
 LEFT JOIN whiteboard.whiteboard_draft wbd ON wbd.page_id=p.id
 LEFT JOIN whiteboard.whiteboard_snapshot wbs ON wbs.page_id=p.id AND wbs.id=wbd.base_snapshot_id
 LEFT JOIN LATERAL (
  SELECT title FROM whiteboard.whiteboard_title_update
  WHERE page_id=p.id AND sequence>wbs.through_sequence AND sequence<=wbd.head_sequence
  ORDER BY sequence DESC LIMIT 1
 ) wbt ON TRUE
 LEFT JOIN whiteboard.whiteboard_version wbv ON wbv.page_id=p.id AND wbv.id=wb.published_version_id
 LEFT JOIN whiteboard.whiteboard_snapshot wbp ON wbp.page_id=p.id AND wbp.id=wbv.snapshot_id
`
