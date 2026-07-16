# Responsible AI policy (must read before launch)

AfroHit Studio enables AI-assisted music creation, *with the artist always in the loop and rights documented*. We refuse to be the cheap-AI-spam-pipeline.

## Hard rules (enforced in code + ToS)

1. **No impersonation.** Users may not request output that imitates another artist by name. The Studio Chat system prompt refuses; the rights checker flags it as `impersonation` and blocks export.
2. **Voice cloning requires signed consent.** The `VoiceConsent` record (legal name, email, signed disclosure, optional audio reading of the consent) is the prerequisite for any `VoiceProfile`. Consents can be revoked (`revokedAt`); revocation cascades to the profile.
3. **No fake languages.** When a Yoruba/Igbo/Hausa/Pidgin line is uncertain, the system flags it for native review rather than guessing. We do not ship fake heritage language.
4. **Lane references, never clones.** Reference the *style lane* of an artist (e.g. "smooth/pocket lane"), never their name, melody, or lyrics.
5. **No sampling without rights.** Any sample upload is treated as user-owned material; users attest ownership on upload. We do not auto-pull from third-party catalogs.

## Disclosure & distribution

Every export carries a `RightsReceipt`:

- the prompts used
- the providers + models invoked
- the voice consent ID (if any)
- the snapshot of approval IDs at receipt time
- AI disclosure metadata for distributors (DistroKid, TuneCore, Spotify AI credits)
- a sha256 of the canonical receipt JSON

Distributors increasingly require this. We expose the disclosure JSON in the release bundle.

## What we ban at the platform level

- Generating content sexualizing or harming minors.
- Generating hate, harassment, or targeted threats.
- Cloning anyone other than the consenting account holder (or a co-artist with their own signed consent).
- Mass-uploading AI tracks to streaming platforms in volume. (Internally we generate many drafts; the *release* path is gated by approvals.)

## What we'll get wrong

- Yoruba/Igbo/Hausa prosody. We will be conservative — the model flags lines for native review rather than ship slop. Build out the native-review queue as priority follow-up.
- Edge-case similarity detection. The first-pass rights check is heuristic + LLM reasoning. Audio fingerprinting against licensed catalogs is the next major hardening.

## Reporting

If you receive a takedown, DMCA, or impersonation complaint:

1. Pull the song's `RightsReceipt` and the full chain of approvals.
2. Suspend the workspace pending review (`Workspace.deletedAt`).
3. Reach out to the user with the receipt — most complaints resolve here because we have the audit trail.
4. If the receipt was tampered with (hash mismatch), this is a security incident — page the on-call engineer.
