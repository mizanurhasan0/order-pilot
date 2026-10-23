// The languages the bot speaks. Bangla is the default; a customer gets English when their
// Facebook language (locale, e.g. en_US) is English, or when they choose it with the 🌐 button.

export const LANGUAGES = Object.freeze(['bn', 'en']);
export const DEFAULT_LANGUAGE = 'bn';

export const isLanguage = (value) => LANGUAGES.includes(value);

// "en_US", "en_GB" -> 'en'; "bn_IN" and everything else (or nothing) -> Bangla.
export const languageFromLocale = (locale) =>
  typeof locale === 'string' && /^en(?:[_-]|$)/i.test(locale.trim()) ? 'en' : DEFAULT_LANGUAGE;
