/**
 * QR Code utilities for parsing and validating code IDs.
 *
 * The QR payload can be either:
 * 1. Just the code ID: "A6F3HW7L"
 * 2. A URL containing the ID: "https://app.example.com/code/A6F3HW7L"
 * 3. A URL with query param: "https://app.example.com?code=A6F3HW7L"
 *
 * This keeps the QR codes "safe" - no sensitive data is encoded,
 * only an ID that references the database.
 */

const CODE_ID_MIN_LENGTH = 6;
const CODE_ID_MAX_LENGTH = 32;
const CODE_ID_REGEX = /^[A-Z0-9]+$/;

/**
 * Extracts a code ID from a raw QR code payload.
 *
 * @param raw - The raw string scanned from the QR code
 * @returns The extracted and validated code ID (uppercase, alphanumeric)
 * @throws Error if the payload is invalid or doesn't contain a valid code ID
 *
 * @example
 * extractCodeId("A6F3HW7L") // Returns "A6F3HW7L"
 * extractCodeId("https://app.example.com/code/A6F3HW7L") // Returns "A6F3HW7L"
 * extractCodeId("https://app.example.com?code=a6f3hw7l") // Returns "A6F3HW7L"
 */
export function extractCodeId(raw: string): string {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Invalid QR payload: empty or not a string');
  }

  // Trim whitespace
  const trimmed = raw.trim();

  if (!trimmed) {
    throw new Error('Invalid QR payload: empty after trimming');
  }

  let codeId: string;

  // Check if it's a URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      const url = new URL(trimmed);

      // Option 1: Check for 'code' query parameter
      const queryCode = url.searchParams.get('code');
      if (queryCode) {
        codeId = queryCode.trim().toUpperCase();
      } else {
        // Option 2: Use the last path segment
        const pathSegments = url.pathname
          .split('/')
          .filter((segment) => segment.length > 0);

        if (pathSegments.length === 0) {
          throw new Error(
            'Invalid QR URL: no path segments or query parameter found'
          );
        }

        codeId = pathSegments[pathSegments.length - 1].trim().toUpperCase();
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Invalid QR')) {
        throw error;
      }
      throw new Error(
        `Invalid QR URL: unable to parse URL - ${error instanceof Error ? error.message : 'unknown error'}`
      );
    }
  } else {
    // Not a URL - treat the entire payload as the code ID
    codeId = trimmed.toUpperCase();
  }

  // Validate the extracted code ID
  if (codeId.length < CODE_ID_MIN_LENGTH) {
    throw new Error(
      `Invalid code ID: too short (minimum ${CODE_ID_MIN_LENGTH} characters)`
    );
  }

  if (codeId.length > CODE_ID_MAX_LENGTH) {
    throw new Error(
      `Invalid code ID: too long (maximum ${CODE_ID_MAX_LENGTH} characters)`
    );
  }

  if (!CODE_ID_REGEX.test(codeId)) {
    throw new Error(
      'Invalid code ID: must contain only uppercase letters (A-Z) and numbers (0-9)'
    );
  }

  return codeId;
}

/**
 * Validates if a string is a valid code ID.
 *
 * @param codeId - The string to validate
 * @returns true if valid, false otherwise
 */
export function isValidCodeId(codeId: string): boolean {
  try {
    extractCodeId(codeId);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates a sample QR code URL for testing.
 *
 * @param codeId - The code ID to include in the URL
 * @param baseUrl - The base URL (default: placeholder)
 * @returns A full URL that can be encoded in a QR code
 */
export function generateQRUrl(
  codeId: string,
  baseUrl: string = 'https://app.example.com'
): string {
  const validatedId = extractCodeId(codeId); // Validates first
  return `${baseUrl}/code/${validatedId}`;
}
