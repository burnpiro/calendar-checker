# Source publication and feature site

Calendar Checker source is licensed under **GPL-3.0-only**, with the full license in `LICENSE`. Runtime dependencies retain their own licenses; builds include both `LICENSE.txt` and `third-party-notices.txt`. Preserve upstream attribution when redistributing. Publishing source or the feature website does not publish a Chrome Web Store listing or establish the remaining live acceptance gates.

## Privacy review before the first push

- The entire pre-publication reachable Git history was scanned with Gitleaks 8.30.1 using redacted output. No detected secrets were found. This is evidence from an automated scan, not a guarantee that every possible secret pattern is recognized.
- Personal Google Cloud project references in documentation and personal commit email metadata were removed from the published history. Author names and development history are preserved; commit hashes change during sanitation. The author's public GitHub noreply address is used instead.
- Real OAuth client configuration remains in ignored local environment files. Only the empty `.env.example` template is versioned. All dotenv variants, `.envrc`, local credentials, private keys, generated builds, release ZIPs and browser/test artifacts remain ignored.
- The committed extension public key is intentional: it fixes the extension ID and OAuth redirect registration. It is not a signing key. Public example addresses and fictional test identities are not personal account data.
- Public images use isolated fictional fixtures. Production builds do not include fixture events. Do not upload a personally configured release ZIP merely because source publication is authorized.

Before each later push, inspect staged changes and reachable history for secrets and identifiers, run the appropriate checks, and verify ignored configuration with `git check-ignore`. A secret found after publication must be revoked/rotated as well as removed from history.

## Feature website

`site/` is a buildless static site with feature descriptions, a six-screen interactive gallery, source installation instructions and a privacy policy. All scripts, styles, icons and screenshots are local assets. There are no forms, analytics, external fonts or automatic third-party resource requests. GitHub Pages serves ordinary public website requests; its hosting is separate from extension data storage.

The Pages workflow uploads **only `site/`**. It never uploads the working directory, `.env.local`, `.output/` or test artifacts. It uses commit-pinned official GitHub Actions and scoped deployment permissions. Pushes to `main` that change the site or its workflow deploy it; other source-only pushes do not trigger a site deployment. Manual dispatch is also available.

Configure GitHub repository Settings → Pages → Source as **GitHub Actions**. The project URL is `https://burnpiro.github.io/calendar-checker/`. Repository and website publication status/evidence belongs in `STATUS.md`.

## Screenshots and verification

See `marketing/chrome-web-store/README.md` for the five store-ready 1280 × 800 images and regeneration instructions. `npm run screenshots` uses a disposable profile, fictional two-account event fixtures, blocked network requests and a fixed clock. Keep fixtures out of `src/`, `entrypoints/` and `public/`.

Preview locally with:

```sh
python3 -m http.server 4173 --directory site
```

Run `npm run test:site` for desktop/mobile layout, image gallery, keyboard/dialog focus, accessibility and resource-isolation checks. It starts its own loopback server and requires Python 3 and Playwright Chromium. It does not use a personal browser profile or Google credentials. Continue running `npm run check` and the isolated extension suite when extension/build behavior changes.

The initial public repository contains source and screenshot assets, not preconfigured binaries. Each installer registers their own Google OAuth clients; a Google Cloud project authorizes API access without hosting the application or calendar data.
