import logging

from django.db import DatabaseError, connection

logger = logging.getLogger(__name__)


def check_database() -> bool:
    """Return True if a trivial query succeeds against the default database."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except DatabaseError:
        logger.exception("Database health check failed")
        return False
    return True
