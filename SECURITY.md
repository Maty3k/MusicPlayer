# Security

## Reporting a problem

Please do not open a public issue for a security problem.

Use GitHub's private report instead: on this repository open the **Security**
tab and choose **Report a vulnerability**. Say what you found, how to reproduce
it, and what an attacker could do with it. You will get an answer as soon as
the maintainer has read it; this is a hobby project, so that can take a few
days.

Please do not test against other people's accounts on the live site
(music4u.online). An account of your own is enough to show almost any problem,
and the app runs locally in a few minutes (see [CONTRIBUTING.md](CONTRIBUTING.md)).

## What counts

Anything that lets one user read or change another user's library, uploads or
account; anything that runs script in another user's page (for example through
a shared playlist); ways around the sign-in limits; and anything that makes the
server fetch or send something it should not.

## Known limits

- Member accounts sign in with a member number and a PIN. Numbers are handed
  out in order, so the PIN is the only secret: a number locks after a few wrong
  PINs, and members can replace the PIN with a password in Settings.
- Most songs play through YouTube's embedded player and search reads YouTube's
  public pages. Both can stop working when YouTube changes something.
