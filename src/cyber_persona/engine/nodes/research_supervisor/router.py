"""Router for research supervisor.

Routes after reflect node: continue gathering or proceed to synthesis.
"""

import logging

from cyber_persona.models import AssistantState

logger = logging.getLogger(__name__)

MAX_GATHER_ROUNDS = 2


def research_supervisor_router(state: AssistantState) -> str:
    """Route after reflect node.

    Returns:
        - "continue": information insufficient, gather more.
        - "synthesize": information sufficient or max rounds reached.
    """
    status = state.get("current_harness_status", "")
    round_count = state.get("gather_round", 0)

    logger.info("ResearchSupervisorRouter status=%s round=%d", status, round_count)

    if status == "PASSED" or status == "PARTIAL_ACCEPT" or round_count >= MAX_GATHER_ROUNDS:
        return "synthesize"

    return "continue"
