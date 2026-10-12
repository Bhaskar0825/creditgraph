"""Only explicitly safe messages cross the function boundary."""
class ApiError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status
