/**
 * Maps raw backend/database error strings to user-friendly UI messages.
 * Prevents technical stack traces and internal identifiers from leaking to the user.
 */
export function getFriendlyErrorMessage(error, defaultMessage = "An unexpected error occurred. Please try again.") {
  if (!error) return defaultMessage;

  const errorString = typeof error === 'string' ? error : (error.message || JSON.stringify(error));
  const lowerError = errorString.toLowerCase();

  // Network & Connectivity
  if (lowerError.includes('network error') || lowerError.includes('fetch failed')) {
    return "Please check your internet connection and try again.";
  }
  if (lowerError.includes('timeout') || lowerError.includes('aborted')) {
    return "The server took too long to respond. Please try again.";
  }

  // Authentication & Session
  if (lowerError.includes('jwt') || lowerError.includes('unauthorized') || lowerError.includes('not authenticated')) {
    return "Your session has expired. Please sign in again.";
  }
  if (lowerError.includes('invalid credentials')) {
    return "Invalid email or password. Please check your credentials.";
  }

  // Rate Limiting (slowapi / 429)
  if (lowerError.includes('too many requests') || lowerError.includes('429')) {
    return "You're doing that too often. Please slow down and try again shortly.";
  }

  // Database / Postgres / PostgREST specific
  if (lowerError.includes('duplicate key value violates unique constraint')) {
    return "This item already exists.";
  }
  if (lowerError.includes('violates row level security') || lowerError.includes('rls')) {
    return "You don't have permission to perform this action.";
  }
  if (lowerError.includes('relation') && lowerError.includes('does not exist')) {
    return "We're currently updating our system. Please try again later.";
  }
  if (lowerError.includes('postgrest') || lowerError.includes('supabase') || lowerError.includes('syntax error')) {
    return "We encountered a temporary server issue. Please try again later.";
  }

  // Backend / Python tracebacks
  if (lowerError.includes('traceback') || lowerError.includes('internal server error') || lowerError.includes('500')) {
    return "Our servers are experiencing issues. We're working on it!";
  }

  // If we don't match known technical leaks, and it's a reasonably short string without code jargon,
  // we could return it, but to be completely safe against leaks, we return the generic default unless
  // we know it's already a safe string. Let's return the default to be fully secure against tech leaks.
  return defaultMessage;
}
