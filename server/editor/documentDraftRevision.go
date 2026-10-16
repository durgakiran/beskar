package editor

func matchesDocumentDraftRevision(expected *DocumentDraftRevision, current Document, draft bool) bool {
	return expected != nil && expected.DocID == current.DocId && expected.Generation == current.DraftGeneration && expected.Draft == draft
}
