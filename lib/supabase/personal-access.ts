/** Public account identifier, never a password or authentication substitute. */
export const PERSONAL_ACCOUNT_EMAIL = 'autotradegx2026@gmail.com'

export function isPersonalAccount(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.toLowerCase() === PERSONAL_ACCOUNT_EMAIL
}
