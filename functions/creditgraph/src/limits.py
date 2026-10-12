"""Best-effort per-process throttling; not a distributed billing quota."""
import threading
import time
from collections import deque

from .errors import ApiError


class RateLimiter:
    def __init__(self):
        self.entries = {}
        self.lock = threading.Lock()

    def check(self, owner, action):
        cap = {'collect': 3, 'extract': 6, 'review': 30, 'bootstrap': 20, 'runStatus': 30}.get(action, 20)
        now = time.monotonic()
        with self.lock:
            for key in list(self.entries):
                values = self.entries[key]
                while values and values[0] <= now - 60:
                    values.popleft()
                if not values:
                    del self.entries[key]
            key = (owner, action)
            if key not in self.entries and len(self.entries) >= 5000:
                raise ApiError('Service is busy; retry in a minute.', 429)
            values = self.entries.setdefault(key, deque())
            if len(values) >= cap:
                raise ApiError('Request limit reached; retry in a minute.', 429)
            values.append(now)


LIMITER = RateLimiter()
