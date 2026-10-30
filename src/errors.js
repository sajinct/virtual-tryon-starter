export function describeError(error, fallback = 'Something went wrong. Please try again.') {
  const cameraErrors = {
    NotAllowedError: 'Camera access was denied. Allow camera access for this site in your browser, then try again.',
    NotFoundError: 'No camera was found. Connect a camera, then try again.',
    NotReadableError: 'The camera could not be opened. Close other apps using it, then try again.',
    OverconstrainedError: 'The selected camera settings are unavailable. Try another camera.',
    SecurityError: 'Camera access is blocked by your browser.'
  };
  if (cameraErrors[error?.name]) return cameraErrors[error.name];
  if (typeof error === 'string' && error.trim()) return error;
  if (typeof error?.message === 'string' && error.message.trim()) return error.message;
  return fallback;
}
