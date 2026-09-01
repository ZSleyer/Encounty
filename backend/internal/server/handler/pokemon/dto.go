// dto.go defines the JSON request and response bodies of the Pokemon endpoints.
// They live apart from the handlers so the wire format of the package can be
// read in one place.

package pokemon

// countResponse is returned by increment, decrement, and set_encounters.
type countResponse struct {
	Count int `json:"count"`
}

// setEncountersRequest is the body for POST /api/pokemon/{id}/set_encounters.
type setEncountersRequest struct {
	Count int `json:"count"`
}

// setTimerRequest is the JSON body for POST /api/pokemon/{id}/timer/set.
type setTimerRequest struct {
	Ms int64 `json:"ms"`
}

// endPhaseRequest is the JSON body for POST /api/pokemon/{id}/phase. It only
// carries the identity of the off-target shiny that ended the phase; every
// other field of the resulting archive entry comes from the parent hunt. Name
// is the sole required field so a phase can also be ended with a free-text
// species that has no Pokédex entry yet.
type endPhaseRequest struct {
	CanonicalName string `json:"canonical_name"`
	Name          string `json:"name"`
	BaseName      string `json:"base_name"`
	FormName      string `json:"form_name"`
	SpriteURL     string `json:"sprite_url"`
	Gender        string `json:"gender"`
	// Failed marks the resulting phase entry as sighted-but-not-caught instead
	// of a regular catch.
	Failed bool `json:"failed"`
}

// setCompletedAtRequest is the JSON body for PUT /api/pokemon/{id}/completed_at.
type setCompletedAtRequest struct {
	CompletedAt string `json:"completed_at"`
}

// reorderRequest is the JSON body for PUT /api/pokemon/reorder. Order lists the
// Pokemon IDs in their new display order (index becomes the SortOrder).
type reorderRequest struct {
	Order []string `json:"order"`
}
