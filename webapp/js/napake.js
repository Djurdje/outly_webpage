/* Razumljiva sporocila napak - prevod iOS APIErrorMessages.swift in SupabaseAuthError.
   Surovega besedila streznika uporabnik nikoli ne vidi (razen izjeme "you must be at least",
   kot na iOS). Pravila so podnizi v besedilu odgovora, v istem vrstnem redu kot na iOS. */
import { t } from "./i18n.js";

export class ApiError extends Error {
  constructor(status, raw, retryAfter = 0) {
    super(`API ${status}: ${raw}`);
    this.status = status;   // -1 = ni odgovora (omrezje)
    this.raw = raw || "";
    this.retryAfter = retryAfter;   // sekunde iz glave Retry-After (0 = ni znana)
  }
}

/* Semafor nakupov (backend #111): POST .../orders vrne 503 + Retry-After, ko hkrati kupuje preveliko ljudi.
   NE ponavljamo samodejno (nakup nima idempotencnega kljuca) - uporabnik dobi sporocilo, gumb pa je nekaj
   sekund onemogocen. Ta dva 503 imata svoje sporocilo (pravila spodaj), vsi 503 drugje ostanejo splosni.
   Pozor: brskalnik glave Retry-After cez CORS ne vidi, dokler je backend ne razkrije (Access-Control-Expose-
   Headers); brez nje velja privzetih 5 s (isto, kot streznik vedno poslje). */
export const NAKUP_PREMOR_S = 5;
export function jeNakupZaseden(e) {
  return e instanceof ApiError && e.status === 503 && !/payments are not available|auth service unavailable/i.test(e.raw);
}
export function nakupPocakajS(e) {
  const s = e instanceof ApiError ? Number(e.retryAfter) : 0;
  return s >= 1 ? Math.min(Math.ceil(s), 30) : NAKUP_PREMOR_S;
}
export function nakupZasedenoSporocilo() {
  return t("Lots of people are buying right now. Please try again in a few seconds.");
}

export class AuthError extends Error {
  constructor(status, code, message) {
    super(message || code || "auth error");
    this.status = status;
    this.code = code || "";
  }
}

const PRAVILA = [
  ["invalid or expired code", "The code is wrong or has expired. Request a new one."],
  ["too many attempts", "Too many wrong attempts. Request a new code."],
  ["code must be 6 digits", "Enter the code from the email."],
  ["password too short", "Password must be at least 8 characters."],
  ["email not verified", "Your email is not verified yet."],
  ["locked", "Too many failed logins. Try again in 15 minutes."],
  ["invalid credentials", "Wrong email or password."],
  ["username too short", "Username must be at least 3 characters."],
  ["username too long", "Username can have at most 20 characters."],
  ["username invalid", "Username can contain only letters, numbers and underscore."],
  ["username already in use", "That username is already taken."],
  ["phone must be", "Enter the phone number with country code, e.g. +386 41 123 456."],
  ["phone number already in use", "That phone number is already used by another account."],
  ["refresh token", "Your session has expired. Please log in again."],
  ["invalid token", "Your session has expired. Please log in again."],
  ["missing token", "Your session has expired. Please log in again."],
  ["auth service unavailable", "Sign-in service is temporarily unavailable. Please try again."],
  ["at least 15 years", "You must be at least 15 years old to use Outly."],
  // Poslovni del (faza 4) - kot iOS APIErrorMessages
  ["club name is required", "Enter the club name."],
  ["lat and lng", "Location could not be saved. Try again."],
  ["invalid club data", "Some club data is out of range. Check the values and try again."],
  ["invalid value type", "Please check what you entered and try again."],
  ["title is required", "Enter a title."],
  ["startat must be", "Enter a valid start date."],
  ["endat must be", "Enter a valid end date."],
  ["ticketpricecents", "Enter the price as a number, e.g. 12.50."],
  ["minage must be", "Minimum age must be between 0 and 99."],
  ["capacity must be", "Capacity must be a whole number between 1 and 100000."],
  ["status must be", "Invalid event status."],
  ["own club", "You can only manage events of your own club."],
  ["not_top_event", "Only your three most popular past events can have a video. This keeps your club page fast to open."],
  ["recap video can only be added", "A video can only be added after the event has ended."],
  ["barprices", "Check the bar prices: each item needs a name (max 60) and a price up to 1000 €."],
  ["galleryurls", "Photo upload failed. Please try again."],
  ["your role in the club does not allow", "You do not have permission to do that."],
  ["not in a club team", "You are not in a club team."],
  ["event not found", "This event no longer exists."],
  ["club not found", "This club is not available."],
  ["country must be", "Choose your country."],
  ["unknown_genres", "One of the selected genres is not available. Reload and try again."],
  ["genres must be", "Select at least one genre."],
  ["nothing to update", "Nothing to save."],
  ["event_ended", "This event has already ended."],
  ["already used", "This ticket was already used."],
  ["ticket not found", "This ticket is not available anymore."],
  ["no longer valid", "This ticket is no longer valid."],
  ["quantity must be", "Choose between 1 and 10 tickets."],
  ["not on sale", "This event is not on sale."],
  ["no tickets on outly", "Tickets for this event are not sold on Outly."],
  ["already started", "This event has already started."],
  ["have not opened", "Ticket sales have not opened yet."],
  ["sales are closed", "Ticket sales are closed."],
  ["tickets left", "Not enough tickets left."],
  ["not enough tickets", "Not enough tickets left."],
  // VIP mize (kupec): mizo je vmes kupil nekdo drug / paket ni izbran ali ni od tega kluba
  ["already booked", "This table is already booked."],
  ["price has changed", "The table price has changed. Check the new price and try again."],
  ["table not found", "This table is not available anymore."],
  ["choose a bottle package", "Choose a bottle for your table."],
  ["package does not belong", "Choose a bottle for your table."],
  ["add your date of birth", "Add your date of birth in Personal info to buy tickets."],
  ["payments are not available", "Payments are not available yet."],
  ["already exists", "An account with this email or username already exists."],
  ["already registered", "An account with this email or username already exists."]
];

/* Pravila, ki morajo pred splosnim "date of birth" (prenos vstopnice govori o prijateljevem datumu). */
const PREDNOSTNA = [
  ["valid email is required", "Enter your friend's email address."],
  ["no outly account with this email", "No Outly account with this email. Ask your friend to sign up first."],
  ["no outly account with this username", "No Outly account with this username."],
  ["already hold this ticket", "That is your own email."],
  ["not verified yet", "Your friend's account is not verified yet."],
  ["must add a date of birth", "Your friend must add a date of birth in the app before receiving this ticket."],
  ["friend must be at least", "Your friend is too young for this event."],
  ["club_has_orders", "Your club has sold tickets. Transfer club ownership before deleting your account."],
  ["already_invited", "This person already has a pending invitation from your club."],
  ["already_member", "You are already in this club's team."],
  ["is_owner", "You own a club, so you can't join another team."],
  ["invitation not found", "This invitation is no longer available."],
  ["already_friends", "You are already friends."],
  ["already_requested", "A friend request is already pending."],
  ["already pending", "You already have an application waiting for review."],
  ["can't add yourself", "You can't add yourself."],
  ["businessname is required", "Enter the business name (at least 2 characters)."],
  ["contactname is required", "Enter the contact person's name."],
  ["phone must contain", "Enter a valid phone number, e.g. +386 41 123 456."]
];

function prevediApi(e) {
  const s = e.raw.toLowerCase();
  for (const [podniz, sporocilo] of PREDNOSTNA) if (s.includes(podniz)) return t(sporocilo);
  if (s.includes("dateofbirth") || s.includes("date of birth")) {
    if (s.includes("future")) return t("Date of birth cannot be in the future.");
    if (s.includes("plausible")) return t("That date of birth does not look right.");
    return t("Enter a valid date of birth.");
  }
  // "You must be at least 18 years old..." - streznik pove mejo, iOS pokaze besedilo, kot je.
  if (s.includes("you must be at least") && !s.includes("15 years")) return e.raw;
  for (const [podniz, sporocilo] of PRAVILA) if (s.includes(podniz)) return t(sporocilo);
  switch (true) {
    case e.status === 400: return t("Please check what you entered and try again.");
    case e.status === 401: return t("Your session has expired. Please log in again.");
    case e.status === 403: return t("You do not have permission to do that.");
    case e.status === 404: return t("Not found.");
    case e.status === 409: return t("This is already in use.");
    case e.status === 429: return t("Too many attempts. Please wait a while and try again.");
    case e.status >= 500: return t("The server is having trouble. Please try again later.");
    case e.status === -1: return t("No response from the server. Check your connection.");
    default: return t("Something went wrong. Please try again.");
  }
}

function prevediAuth(e) {
  switch (e.code) {
    case "invalid_credentials": return t("Wrong email or password.");
    case "email_not_confirmed": return t("Your email is not verified yet.");
    case "user_already_exists":
    case "email_exists": return t("That email is already registered. Sign in instead.");
    case "weak_password": return t("Password must be at least 8 characters.");
    case "otp_expired":
    case "otp_disabled": return t("The code is wrong or has expired. Request a new one.");
    case "over_email_send_rate_limit":
    case "over_request_rate_limit": return t("Too many attempts. Please wait a minute and try again.");
    case "same_password": return t("New password must be different from the current one.");
    case "session_expired":
    case "refresh_token_not_found":
    case "refresh_token_already_used":
    case "bad_jwt": return t("Your session has expired. Please log in again.");
    case "user_not_found": return t("No account with this email.");
    case "validation_failed": return t("Please check what you entered and try again.");
  }
  const m = (e.message || "").toLowerCase();
  if (e.status >= 500) return t("The server is having trouble. Please try again later.");
  if (m.includes("invalid login credentials")) return t("Wrong email or password.");
  if (m.includes("already registered")) return t("That email is already registered. Sign in instead.");
  if (m.includes("failed to fetch") || m.includes("network")) return t("No internet connection. Check your network and try again.");
  return t("Something went wrong. Please try again.");
}

/** Sporocilo za uporabnika iz katerekoli napake. */
export function sporocilo(e) {
  if (e instanceof ApiError) return prevediApi(e);
  if (e instanceof AuthError) return prevediAuth(e);
  if (e && e.name === "AuthApiError") return prevediAuth(new AuthError(e.status, e.code, e.message));
  if (e && (e.name === "TypeError" || e.name === "AbortError" || e.name === "AuthRetryableFetchError")) return t("No internet connection. Check your network and try again.");
  return t("Something went wrong. Please try again.");
}
