/** Mirrors backend/app/core/phone.py so forms can validate before submitting. */
export function normalizePhone(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const plus = v.startsWith("+");
  const digits = v.replace(/\D/g, "");
  let e164: string;
  if (plus) e164 = `+${digits}`;
  else if (digits.startsWith("254") && digits.length === 12) e164 = `+${digits}`;
  else if (digits.startsWith("0") && digits.length === 10 && "17".includes(digits[1])) e164 = `+254${digits.slice(1)}`;
  else if (digits.length === 9 && "17".includes(digits[0])) e164 = `+254${digits}`;
  else throw new Error("Enter a Kenyan number like 0712 345 678, or an international number starting with +");
  if (e164.startsWith("+254") && e164.length !== 13) throw new Error("Kenyan numbers have 9 digits after +254");
  if (e164.length < 8 || e164.length > 16) throw new Error("Phone number length is not valid");
  return e164;
}

export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return "";
  if (e164.startsWith("+254") && e164.length === 13) {
    const n = e164.slice(4);
    return `+254 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
  }
  return e164;
}

export function phoneError(raw: string): string | null {
  try {
    normalizePhone(raw);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}
