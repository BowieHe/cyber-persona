from cyber_persona.models.state import AssistantState, create_default_state


def test_default_state_has_next_agent():
    state = create_default_state()
    assert "next_agent" in state
    assert state["next_agent"] is None
