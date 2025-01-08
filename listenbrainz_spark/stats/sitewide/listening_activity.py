import logging
from datetime import datetime
from typing import Iterator, Optional, Dict

from listenbrainz_spark.stats.incremental.sitewide.listening_activity import ListeningActivitySitewideEntity

logger = logging.getLogger(__name__)


def get_listening_activity(stats_range: str) -> Iterator[Optional[Dict]]:
    """ Compute the number of listens for a time range compared to the previous range

    Given a time range, this computes a histogram of all listens for that range
    and the previous range of the same duration, so that they can be compared. The
    bin size of the histogram depends on the size of the range (e.g.
    year -> 12 months, month -> ~30 days, week -> ~7 days, see get_time_range for
    details). These values are used on the listening activity reports.
    """
    logger.debug(f"Calculating listening_activity_{stats_range}")
    entity_obj = ListeningActivitySitewideEntity(stats_range)
    from_date, to_date, data = entity_obj.generate_stats(0)
    messages = create_messages(data=data, stats_range=stats_range, from_date=from_date, to_date=to_date)
    return messages


def create_messages(data, stats_range: str, from_date: datetime, to_date: datetime):
    """
    Create messages to send the data to webserver via RabbitMQ

    Args:
        data: Data to send to webserver
        stats_range: The range for which the statistics have been calculated
        from_date: The start time of the stats
        to_date: The end time of the stats
    Returns:
        messages: A list of messages to be sent via RabbitMQ
    """
    message = {
        "type": "sitewide_listening_activity",
        "stats_range": stats_range,
        "from_ts": int(from_date.timestamp()),
        "to_ts": int(to_date.timestamp())
    }

    _dict = next(data).asDict(recursive=True)
    message["data"] = _dict["listening_activity"]

    return [message]
