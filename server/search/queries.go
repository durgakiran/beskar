package search

// Bind plain text before applying boost. Otherwise PostgreSQL infers $1 as
// pdb.boost, and the body clause's ::text searches its serialized query JSON
// (including internal tokens such as "string") instead of the user's text.
const searchCandidatesQuery = `SELECT page_id, space_id, doc_id, updated_at,
    left(body_text, 240), pdb.score(page_id)
FROM public.documents
WHERE title ||| $1::text::pdb.boost(3) OR body_text ||| $1::text
   OR title @@@ pdb.regex($4::text)::pdb.boost(2)
   OR body_text @@@ pdb.regex($4::text)::pdb.boost(0.5)
ORDER BY pdb.score(page_id) DESC, page_id
LIMIT $2 OFFSET $3`

// Recheck publication and space state against the authoritative database. The
// index is asynchronous and cannot establish current eligibility or permissions.
const currentPublicationsQuery = `SELECT p.id, p.space_id, s.name, d.doc_id, COALESCE(d.title, ''), d.version
FROM core.page p
JOIN core.space s ON s.id = p.space_id
JOIN LATERAL (
    SELECT doc_id, title, version FROM core.page_doc_map
    WHERE page_id = p.id AND draft = 0
    ORDER BY version DESC, doc_id DESC LIMIT 1
) d ON true
WHERE p.id = ANY($1::bigint[]) AND p.type = 'document'
  AND s.deleted_at IS NULL AND s.archived_at IS NULL`
