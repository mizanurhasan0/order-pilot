// The JSON answers for requests that no route handled: 404, 503 while the server is not
// configured, and errors thrown or passed on by a route.

export function notFound(req, res) {
  res.status(404).json({ success: false, message: 'Not found' });
}

export function notConfigured(req, res) {
  res.status(503).json({ success: false, message: 'Server is not configured' });
}

// Client errors keep their status (400, 401, 413, ...); everything else is a 500. Only the error
// class and status are logged: a JSON parse error message can quote part of the request body.
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  const status = err.status ?? err.statusCode;
  const isClientError = Number.isInteger(status) && status >= 400 && status < 500;
  console.error(`Request error: ${err.name} (${isClientError ? status : 500})`);

  if (isClientError) {
    const message = status === 413 ? 'Payload too large' : 'Bad request';
    return res.status(status).json({ success: false, message });
  }
  return res.status(500).json({ success: false, message: 'Internal server error' });
}
