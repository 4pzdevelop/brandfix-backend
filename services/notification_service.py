from __future__ import annotations

import logging
from typing import Any


logger = logging.getLogger("brandfix.notifications")


def publish_workflow_event(
    module: str,
    action: str,
    request_id: str,
    details: dict[str, Any] | None = None,
) -> None:
    logger.info(
        "workflow_event module=%s action=%s request_id=%s details=%s",
        module,
        action,
        request_id,
        details or {},
    )
