// groups.go holds the group and tag mutations: creating, renaming and deleting
// the sidebar sections a hunt can be filed under, and assigning a hunt to a
// group or to a set of tags. Group membership is stored on the hunt itself, so
// deleting a group only has to clear the reference on its members.

package state

import (
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Groups and tags
// ---------------------------------------------------------------------------

// ListGroups returns a copy of all groups in their current sort order.
// The returned slice is safe to mutate without affecting state.
func (m *Manager) ListGroups() []Group {
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := make([]Group, len(m.state.Groups))
	copy(out, m.state.Groups)
	return out
}

// CreateGroup appends a new Group with a generated UUID. Name is trimmed and
// must be non-empty. The new group is placed at the end of the sort order.
// Returns the created Group or an error when the name is empty.
func (m *Manager) CreateGroup(name, color string) (Group, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return Group{}, fmt.Errorf("group name must not be empty")
	}
	g := Group{
		ID:    uuid.NewString(),
		Name:  name,
		Color: strings.TrimSpace(color),
	}
	m.mu.Lock()
	g.SortOrder = len(m.state.Groups)
	m.state.Groups = append(m.state.Groups, g)
	m.mu.Unlock()
	m.markDirty()
	return g, nil
}

// UpdateGroup applies the non-nil fields of patch to the group with the given
// id. Returns the updated group, or an error when the group is not found or
// the patched name would become empty.
func (m *Manager) UpdateGroup(id string, patch GroupPatch) (Group, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Groups {
		if m.state.Groups[i].ID != id {
			continue
		}
		if patch.Name != nil {
			trimmed := strings.TrimSpace(*patch.Name)
			if trimmed == "" {
				return Group{}, fmt.Errorf("group name must not be empty")
			}
			m.state.Groups[i].Name = trimmed
		}
		if patch.Color != nil {
			m.state.Groups[i].Color = strings.TrimSpace(*patch.Color)
		}
		if patch.SortOrder != nil {
			m.state.Groups[i].SortOrder = *patch.SortOrder
		}
		if patch.Collapsed != nil {
			m.state.Groups[i].Collapsed = *patch.Collapsed
		}
		updated := m.state.Groups[i]
		m.markDirty()
		return updated, nil
	}
	return Group{}, fmt.Errorf("group %q not found", id)
}

// DeleteGroup removes the group with the given id and clears GroupID on any
// Pokémon that referenced it. Returns false when the group is not found.
func (m *Manager) DeleteGroup(id string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Groups {
		if m.state.Groups[i].ID == id {
			m.state.Groups = append(m.state.Groups[:i], m.state.Groups[i+1:]...)
			for j := range m.state.Pokemon {
				if m.state.Pokemon[j].GroupID == id {
					m.state.Pokemon[j].GroupID = ""
				}
			}
			m.markDirty()
			return true
		}
	}
	return false
}

// SetPokemonGroup assigns the given group to the Pokémon with pokemonID.
// Pass an empty groupID to clear the group. Returns false when the Pokémon is
// not found or when a non-empty groupID does not refer to an existing group.
func (m *Manager) SetPokemonGroup(pokemonID, groupID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if groupID != "" {
		found := false
		for _, g := range m.state.Groups {
			if g.ID == groupID {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == pokemonID {
			m.state.Pokemon[i].GroupID = groupID
			m.markDirty()
			return true
		}
	}
	return false
}

// SetPokemonTags replaces the tag list on the Pokémon with pokemonID. Tags are
// trimmed, deduplicated, and empty entries are dropped. Returns false when the
// Pokémon does not exist.
func (m *Manager) SetPokemonTags(pokemonID string, tags []string) bool {
	normalised := normalizeTags(tags)
	m.mu.Lock()
	defer m.mu.Unlock()
	for i := range m.state.Pokemon {
		if m.state.Pokemon[i].ID == pokemonID {
			m.state.Pokemon[i].Tags = normalised
			m.markDirty()
			return true
		}
	}
	return false
}
