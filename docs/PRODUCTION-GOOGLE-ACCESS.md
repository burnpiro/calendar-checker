# Production Google access: provisioning and handoff

Last checked: 2026-11-05.

Google OAuth production access and Chrome Web Store publication are separate processes. An enabled Calendar API or production Cloud project is not evidence that an OAuth consent screen, clients, scopes, branding or public access have been approved.

## CLI preparation

Use a separate production project and explicit project flags. Do not change the developer's active CLI project or overwrite the existing extension key, local client IDs or saved account configuration.

```sh
gcloud projects create YOUR_PRODUCTION_PROJECT --name="Calendar Checker Production"
gcloud services enable calendar-json.googleapis.com --project=YOUR_PRODUCTION_PROJECT
gcloud projects describe YOUR_PRODUCTION_PROJECT
gcloud billing projects describe YOUR_PRODUCTION_PROJECT --format="value(billingEnabled)"
```

The project gets Google's normal default API configuration in addition to the Calendar API. No application backend, database, billable workload or billing-account link is required by this provisioning step. Production Google sign-in uses the extension's existing narrow identity/calendar scopes, not the CLI's Cloud administration permissions.

The local provisioning result is kept in ignored `config/.env.production-setup` with private project identifiers. It is a handoff file, not an application credentials file; do not commit it. Public docs deliberately omit account emails and concrete Cloud project IDs.

On 2026-11-05, macOS blocked reading/executing the previously installed SDK directory. An isolated Google Cloud SDK 592.0.0 in a temporary directory successfully used the existing CLI login. Its current ARM archive was verified against the SHA-256 published by Google before extraction/execution. The original SDK, shell startup files and global CLI project selection were not changed. Usage reporting and automatic update checks were disabled for those CLI commands. Temporary tools are not an application dependency or a permanent SDK repair.

## Google Auth Platform Console steps

The supported CLI does not complete this extension's Google Auth Platform setup. Do not substitute Workforce Identity Federation OAuth clients or deprecated IAP OAuth brand/client commands: they are different resources, and the IAP OAuth Admin APIs were shut down in 2026.

After signing in as the production project owner, use Google Auth Platform:

1. **Branding:** app name Calendar Checker, the chosen support/contact email, app icon, public homepage and privacy policy. The requested homepage remains `https://burnpiro.github.io/calendar-checker/`; the privacy policy is the matching `privacy.html` page. Do not change hosting or add a custom domain without the user's instruction.
2. **Audience:** configure the intended external audience. Moving to In production alone does not complete verification.
3. **Clients:** create a Chrome Extension client using the actual Chrome Web Store draft Item ID and the Web application chooser client with `https://STORE_ITEM_ID.chromiumapp.org/` as the exact redirect. Keep secrets out of the extension. Do not use the local development ID as a substitute for an unknown store ID.
4. **Data Access:** declare the runtime scopes below and explain each requested sensitive scope.
5. **Branding / Verification Center:** complete the required review, publish branding when approved and submit the requested data-access material, including the demonstration video. Do not report approval before Google reports it.

Current runtime scopes:

```text
openid
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/calendar.calendarlist.readonly
https://www.googleapis.com/auth/calendar.events
https://www.googleapis.com/auth/calendar.events.freebusy
```

The existing public calendar website and privacy policy do not by themselves prove domain ownership to Google. Current OAuth domain-troubleshooting guidance specifies a DNS-verified Domain property; ordinary Search Console URL-prefix verification is different. The user has explicitly chosen GitHub Pages without a custom domain. Retain that choice in draft settings and check Google's actual validation/review outcome; do not promise acceptance or silently substitute another domain. This remains an unresolved production-verification requirement.

## Current Console and draft evidence · 2026-11-05

The authenticated project owner approved the User Data Policy and the explicit production-audience warning. Branding fields/logo and all five runtime scopes are saved. The Chrome Extension client uses the assigned store draft identity and its app ownership was verified. The Web chooser client has exactly `https://STORE_ITEM_ID.chromiumapp.org/` as its redirect, with no JavaScript origins. Only the two public client IDs were kept locally; no secret-bearing dialog was exported or JSON credentials downloaded.

The OAuth audience is **In production / External**. Google's branding check has not passed: it reports that the homepage is not registered to the owner and asks for ownership verification followed by a 24-hour propagation wait. The data-access review remains disabled until branding is verified and published. No sensitive-scope approval is claimed.

Search Console offers an HTML file for the exact GitHub Pages URL-prefix property. Its public proof file is included under `site/`; it contains only the expected one-line verification marker. The file is deployed, and Search Console reported **Ownership auto verified / HTML file** for that exact homepage on 2026-11-05. No unrelated Search Console property was accessed after the user's restriction. URL-prefix ownership is distinct from Google's stated DNS Domain-property requirement. Do not mark OAuth domain ownership complete based only on that HTML file or a Search Console success message. The user has prohibited access to unrelated work-domain Search Console properties; use only the Calendar Checker homepage property.

The store draft has the public description, category/language, icon, five fictional-data screenshots, permission explanations, privacy disclosures and reviewer instructions saved. The user approved the three required limited-use certifications before they were checked and saved. The configured production package has replaced the bootstrap upload. **No review submission or extension publication has occurred.** The first package was rejected because the store disallows `manifest.key`. Keep the existing local key and produce a separate upload manifest without that field. Preserve the assigned store public key for an isolated unpacked production test target; never replace the developer's existing key or `.env.local`.

The new production build's manifest/bundle audit and three isolated Chromium popup/restart/chooser regressions pass. ZIP validation permits only omission of `manifest.key` from the tested build and compares all other bytes. The configured archive and keyed unpacked target are ignored local artifacts; see the local release handoff for checksums and identity. Live production OAuth and store review are separate remaining gates.

## Remaining work

- Retry branding no earlier than **2026-11-06 15:10 Europe/Warsaw**, after Google's stated 24-hour propagation wait from the successful homepage ownership verification. GitHub Pages acceptance for OAuth domain/branding verification remains unresolved.
- Preserve the configured production ZIP and keyed unpacked target in ignored `.output/`; the store draft already contains the configured upload.
- Complete Google's sensitive-scope justification and demonstration-video requirements once branding allows the review.
- Review store distribution and publisher readiness, then obtain the final submission decision once Google verification is complete. Draft privacy fields, limited-use certifications and reviewer instructions are already saved.

Concrete project/client/store identifiers are retained in ignored `config/.env.production-setup`, not public setup instructions. Preserve the current unpacked installation and use the separate production identity for live validation.

## Sources

- [Google Cloud SDK installation and archive checksums](https://docs.cloud.google.com/sdk/docs/install-sdk)
- [Production OAuth policies](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance)
- [Sensitive-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Domain ownership requirements](https://support.google.com/cloud/answer/13804266?hl=en)
- [Deprecated IAP OAuth client management](https://docs.cloud.google.com/sdk/gcloud/reference/iap/oauth-clients)
- [Chrome Web Store v2 API: uploads target existing items](https://developer.chrome.com/docs/webstore/api/reference/rest)
- [First store draft upload](https://developer.chrome.com/docs/webstore/publish)
- [Homepage ownership issues](https://support.google.com/cloud/answer/13807376)
- [Chrome extension identity](https://developer.chrome.com/docs/extensions/reference/manifest/key)
