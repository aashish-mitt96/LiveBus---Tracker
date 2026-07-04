import datetime
import zoneinfo

from ..config import TIMEZONE


# Convert a Timestamp into Minutes since Midnight.
def minute_of_day(epoch_ms: int) -> int:
    dt = datetime.datetime.fromtimestamp(
        epoch_ms / 1000,
        tz=zoneinfo.ZoneInfo(TIMEZONE),
    )
    return dt.hour * 60 + dt.minute


# Convert a Timestamp into the Weekday index (Monday=0 ... Sunday=6).
def day_of_week(epoch_ms: int) -> int:
    dt = datetime.datetime.fromtimestamp(
        epoch_ms / 1000,
        tz=zoneinfo.ZoneInfo(TIMEZONE),
    )
    return dt.weekday()