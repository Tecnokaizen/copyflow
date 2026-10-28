// SUR4 N2/N22: warns when a post-it text or a reason seems to carry an email or
// a Spanish phone number. It only warns: it never blocks, hides or suppresses
// anything by itself. Input is plain text (use richTextToPlainText first).

export type PersonalDataMatch = {
  email: boolean;
  phone: boolean;
  any: boolean;
};

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;

// Nine digits starting with 6, 7, 8 or 9 (mobiles and landlines), optionally
// after +34, 0034 or 34, with single spaces, dots or dashes between digits.
// Not inside a longer number: no digit right before or after (also across one
// separator), and no decimal part after it (an amount such as 612.345.678,50).
const PHONE =
  /(?<!\d[\s.-]?)(?:(?:\+|00)?34[\s.-]?)?[6-9](?:[\s.-]?\d){8}(?![\s.-]?\d|,\d)/;

export function detectPersonalData(text: string | null | undefined): PersonalDataMatch {
  const value = (text ?? "").replace(/ /g, " ");
  const email = EMAIL.test(value);
  const phone = PHONE.test(value);
  return { email, phone, any: email || phone };
}

export function personalDataWarning(match: PersonalDataMatch): string | null {
  if (match.email && match.phone) {
    return "Parece que contiene un email y un teléfono.";
  }
  if (match.email) {
    return "Parece que contiene un email.";
  }
  if (match.phone) {
    return "Parece que contiene un teléfono.";
  }
  return null;
}
