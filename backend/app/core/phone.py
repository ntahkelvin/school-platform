"""Phone numbers are stored in one standard form (+234...) so the same parent
is always recognised, whether someone types 0803 123 4567 or +234 803 123 4567."""
import re


def normalize_phone(raw: str | None) -> str | None:
    if raw is None:
        return None
    digits = re.sub(r"[^\d+]", "", raw.strip())
    if not digits:
        return None
    if digits.startswith("+"):
        return "+" + re.sub(r"\D", "", digits)
    if digits.startswith("00"):
        return "+" + digits[2:]
    if digits.startswith("0") and len(digits) == 11:  # Nigerian local format
        return "+234" + digits[1:]
    if digits.startswith("234") and len(digits) == 13:
        return "+" + digits
    return digits


def looks_like_phone(text: str) -> bool:
    return bool(re.fullmatch(r"[\d\s+()-]{7,}", text.strip()))
