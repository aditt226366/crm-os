export const COMPANY_LOGIN_USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;
export const COMPANY_LOGIN_PASSWORD_MIN_LENGTH = 8;
export const COMPANY_LOGIN_PASSWORD_MAX_LENGTH = 128;

export const COMPANY_LOGIN_USERNAME_MESSAGE =
  "Username can use letters, numbers, dots, underscores, and hyphens.";
export const COMPANY_LOGIN_PASSWORD_MESSAGE =
  "Password must be at least 8 characters and contain uppercase, lowercase, and a number.";
export const COMPANY_LOGIN_PASSWORD_MAX_MESSAGE = "Password must be 128 characters or fewer.";

export function isCompanyLoginUsernameValid(username: string) {
  return COMPANY_LOGIN_USERNAME_PATTERN.test(username);
}

export function isCompanyLoginPasswordValid(password: string) {
  return (
    password.length >= COMPANY_LOGIN_PASSWORD_MIN_LENGTH &&
    password.length <= COMPANY_LOGIN_PASSWORD_MAX_LENGTH &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password)
  );
}
